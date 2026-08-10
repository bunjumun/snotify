-- S'notify v6 — threaded, resolvable comments ("issues" for mixes).
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v5.
--
-- Comments move from a flat per-version list to something closer to GitHub PR
-- review threads: reply to a note (one level deep — no reply-to-reply chains),
-- resolve it once it's addressed, or dismiss it as not relevant to one
-- particular mix without resolving the underlying issue. An unresolved comment
-- automatically carries forward onto every new version of the same song made
-- after it, until it's resolved — so notes don't get silently stranded on an
-- old mix nobody plays anymore.
--
-- Editing is honor-system, same trust level as delete already had in v3: any
-- bandmate CAN edit any comment server-side, but the client warns before
-- opening the editor when the comment's self-reported name doesn't match the
-- editor's own remembered name, so a same-band edit doesn't happen by
-- accident. No device token, no timer — bandmates trust each other.

-- ---------------------------------------------------------------------------
-- comments — created outside this repo (a "v2" migration) with columns
-- id/song_id/time_s/text/name/version/created_at. The create-table-if-not-
-- exists below is only for a fresh install; on the live DB it's a no-op and
-- the alter-table lines add just the new columns.
-- ---------------------------------------------------------------------------
create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  song_id      text not null,            -- '<band>/<comment_key>' — not a real FK; comment_key is frozen so comments survive song renames
  time_s       real not null default 0,
  text         text not null,
  name         text not null default '',
  version      text not null default '', -- version *name* at post time — for display/export even after a rename or delete
  created_at   timestamptz not null default now(),
  parent_id    uuid references comments(id) on delete cascade,
  version_id   uuid references versions(id) on delete set null,
  edited_at    timestamptz,
  resolved     boolean not null default false,
  resolved_at  timestamptz,
  resolved_by  text
);
alter table comments enable row level security;

alter table comments add column if not exists parent_id    uuid references comments(id) on delete cascade;
alter table comments add column if not exists version_id   uuid references versions(id) on delete set null;
alter table comments add column if not exists edited_at    timestamptz;
alter table comments add column if not exists resolved     boolean not null default false;
alter table comments add column if not exists resolved_at  timestamptz;
alter table comments add column if not exists resolved_by  text;

create index if not exists comments_song   on comments (song_id);
create index if not exists comments_parent on comments (parent_id);

-- Backfill version_id for every comment written before this migration, by
-- matching the version *name* it was posted under. Without this each existing
-- comment has a null origin and the client can't place it on any mix.
-- Idempotent: only touches rows still null.
update comments c
   set version_id = v.id
  from songs s
  join versions v on v.song_id = s.id
 where c.version_id is null
   and c.song_id = s.band || '/' || s.comment_key
   and v.name = c.version;
-- Anything still null here was posted on a mix that has since been renamed or
-- deleted; the client shows those on every version rather than hiding them.

-- Per-version "not relevant here" override — independent of resolved.
create table if not exists comment_dismissals (
  comment_id  uuid not null references comments(id) on delete cascade,
  version_id  uuid not null references versions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, version_id)
);
alter table comment_dismissals enable row level security;
-- RLS on, zero anon policies — same posture as every table since v3. All
-- access flows through the RPCs below (and get_comments/add_comment/etc.).

-- ---------------------------------------------------------------------------
-- _song_json (v3) gains version id + created_at — additive, nothing reads
-- these keys today. The client needs them to tell whether a version existed
-- yet when a given comment was posted (propagation) and to target dismiss/
-- resolve calls at a specific version.
-- ---------------------------------------------------------------------------
create or replace function _song_json(s songs) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'folder', s.folder,
    'id',     s.comment_key,
    'title',  s.title,
    'artist', s.artist,
    'album',  s.album,
    'cover',  s.cover,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'src', v.src,
               'date', coalesce(to_char(v.date, 'YYYY-MM-DD'), ''),
               'changelog', v.changelog, 'changes', v.changes,
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- get_comments — same shape as v3 (to_jsonb(c) already carries every new
-- column for free) plus a computed dismissed_versions array per comment.
-- ---------------------------------------------------------------------------
create or replace function get_comments(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(
             to_jsonb(c) || jsonb_build_object('dismissed_versions', coalesce((
               select jsonb_agg(d.version_id) from comment_dismissals d where d.comment_id = c.id
             ), '[]'::jsonb))
           order by c.created_at)
    from comments c where c.song_id like lower(b) || '/%'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- add_comment gains vid/parent_id — a different signature from the v3
-- function of the same name, so drop the old one first rather than leave two
-- overloads for PostgREST to disambiguate.
-- ---------------------------------------------------------------------------
drop function if exists add_comment(text, text, text, real, text, text, text);

create or replace function add_comment(b text, p text, sid text, time_s real,
                                        txt text, who text, ver text, vid uuid,
                                        parent_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
-- pid/tsec shadow the parent_id/time_s parameters, whose names collide with
-- comments' own columns — referencing the parameters directly inside a query
-- against comments is an ambiguous-identifier error. (Same trap that broke
-- admin_create_band in v4.) The parameter names stay as-is so the RPC's
-- named-argument API doesn't change.
declare row_out comments; parent comments;
        pid uuid := parent_id; tsec real := time_s;
begin
  perform _require_pass(b, p);
  if sid not like lower(b) || '/%' then
    raise exception using errcode = '42501', message = 'comment outside this band';
  end if;
  if coalesce(trim(txt), '') = '' then
    raise exception 'comment text required';
  end if;
  if pid is not null then
    select * into parent from comments where comments.id = pid and comments.song_id = sid;
    if not found then
      raise exception 'original comment not found';
    end if;
    if parent.parent_id is not null then
      raise exception 'replies can only be one level deep';
    end if;
    -- a reply always inherits its thread's timestamp/version, never its own —
    -- so it can never drift onto a different pin or mix than its parent.
    tsec := parent.time_s;
    ver  := parent.version;
    vid  := parent.version_id;
  end if;
  insert into comments (song_id, time_s, text, name, version, version_id, parent_id)
    values (sid, tsec, txt, coalesce(who, ''), coalesce(ver, ''), vid, pid)
    returning * into row_out;
  return to_jsonb(row_out) || jsonb_build_object('dismissed_versions', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- edit_comment — honor system, same trust level as delete_comment: any
-- bandmate can edit any comment. The client is where "is this actually your
-- comment?" gets asked, by comparing the poster's name against the editor's
-- own remembered name before it even opens the editor.
-- ---------------------------------------------------------------------------
create or replace function edit_comment(b text, p text, cid uuid, txt text, who text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out comments;
begin
  perform _require_pass(b, p);
  if coalesce(trim(txt), '') = '' then
    raise exception 'comment text required';
  end if;
  update comments set text = txt, name = coalesce(who, name), edited_at = now()
    where id = cid and comments.song_id like lower(b) || '/%'
    returning * into row_out;
  if not found then
    raise exception 'comment not found';
  end if;
  return to_jsonb(row_out);
end $$;

-- ---------------------------------------------------------------------------
-- resolve_comment — root-only (resolves the whole thread, like a GitHub PR
-- review conversation). Param named is_resolved, not resolved, to steer clear
-- of the parameter/column ambiguity bug that bit admin_create_band in v4.
-- ---------------------------------------------------------------------------
create or replace function resolve_comment(b text, p text, cid uuid,
                                            is_resolved boolean, who text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out comments;
begin
  perform _require_pass(b, p);
  select * into row_out from comments where id = cid and comments.song_id like lower(b) || '/%';
  if not found then
    raise exception 'comment not found';
  end if;
  if row_out.parent_id is not null then
    raise exception 'only the original comment in a thread can be resolved';
  end if;
  update comments set
      resolved    = is_resolved,
      resolved_at = case when is_resolved then now() else null end,
      resolved_by = case when is_resolved then coalesce(who, '') else null end
    where id = cid
    returning * into row_out;
  return to_jsonb(row_out);
end $$;

-- ---------------------------------------------------------------------------
-- set_comment_dismissed — "not relevant to this mix" on a whim, independent
-- of resolved. Root-only, same reasoning as resolve.
-- ---------------------------------------------------------------------------
create or replace function set_comment_dismissed(b text, p text, cid uuid,
                                                   target_version uuid, is_dismissed boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare row_out comments;
begin
  perform _require_pass(b, p);
  select * into row_out from comments where id = cid and comments.song_id like lower(b) || '/%';
  if not found then
    raise exception 'comment not found';
  end if;
  if row_out.parent_id is not null then
    raise exception 'only the original comment in a thread can be marked not-relevant';
  end if;
  if is_dismissed then
    insert into comment_dismissals (comment_id, version_id) values (cid, target_version)
      on conflict do nothing;
  else
    delete from comment_dismissals where comment_id = cid and version_id = target_version;
  end if;
end $$;

-- delete_comment (v3) is unchanged — stays open to the whole band, same as
-- before. Not part of this migration.
