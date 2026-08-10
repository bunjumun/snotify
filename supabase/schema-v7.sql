-- S'notify v7 — S'nart: artwork revisions in the same library.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v6.
--
-- S'nart is the same tool pointed at pictures instead of mixes: upload a
-- revision of a piece of art, comment on it, resolve the comment. The one
-- structural difference is where a comment hangs — not off a timestamp, but
-- off a rectangle drawn over part of the image.
--
-- So this migration adds two columns and re-signs three functions. It does NOT
-- add art tables. Art is a `kind` of song: same songs/versions rows, same
-- stack semantics, same trash, same share links, and — most importantly — the
-- same comments table, so threading, resolve, dismiss and carry-forward apply
-- to art for free instead of being written twice. A parallel set of art tables
-- would have meant re-implementing ~15 working RPCs and would have broken
-- comments.version_id, which points at versions(id).
--
-- Every new parameter is DEFAULTed, so index.html as currently cached on
-- people's phones keeps calling these functions with the old argument lists
-- and keeps getting the old behaviour.

-- ---------------------------------------------------------------------------
-- songs.kind — 'audio' (a song) or 'art' (a piece with revisions)
-- ---------------------------------------------------------------------------
alter table songs add column if not exists kind text not null default 'audio';

do $$ begin
  alter table songs add constraint songs_kind_chk check (kind in ('audio', 'art'));
exception when duplicate_object then null; end $$;

-- The library list is always filtered by kind now.
create index if not exists songs_band_kind on songs (band, kind, position) where trashed_at is null;

-- Note: unique (band, folder) still spans both kinds, so a song and a piece of
-- art in one band cannot share a folder name. That is deliberate — one folder
-- namespace, one storage path (tracks/<band>/<folder>/), no collisions.

-- ---------------------------------------------------------------------------
-- comments.region — the box the comment is about, or null for "this image"
-- ---------------------------------------------------------------------------
-- {x, y, w, h} as fractions of the image, 0–1: a box survives window resizes,
-- retina vs not, and a revision exported at different pixel dimensions. Null
-- on every audio comment, and on art comments about the piece as a whole.
alter table comments add column if not exists region jsonb;

create or replace function _valid_region(r jsonb) returns boolean
language sql immutable set search_path = public as $$
  select r is null or (
        jsonb_typeof(r) = 'object'
    and jsonb_typeof(r->'x') = 'number' and jsonb_typeof(r->'y') = 'number'
    and jsonb_typeof(r->'w') = 'number' and jsonb_typeof(r->'h') = 'number'
    and (r->>'x')::real between 0 and 1 and (r->>'y')::real between 0 and 1
    and (r->>'w')::real >  0 and (r->>'w')::real <= 1
    and (r->>'h')::real >  0 and (r->>'h')::real <= 1
  )
$$;

-- ---------------------------------------------------------------------------
-- get_library gains a kind filter. Defaulted to 'audio' so already-cached
-- players calling get_library(b, p) are unaffected.
-- Adding a parameter means drop + create, not create-or-replace.
-- ---------------------------------------------------------------------------
drop function if exists get_library(text, text);

create or replace function get_library(b text, p text, k text default 'audio') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return (select jsonb_build_object(
    'slug', bd.slug,
    'title', coalesce(bd.title, bd.slug),
    'songs', coalesce((
      select jsonb_agg(_song_json(s) order by s.position, s.created_at desc)
      from songs s
      where s.band = bd.slug and s.trashed_at is null
        and s.kind = coalesce(k, 'audio')), '[]'::jsonb))
  from bands bd where bd.slug = lower(b));
end $$;

-- ---------------------------------------------------------------------------
-- get_trash, same treatment — the art page's trash must not list mixes.
-- ---------------------------------------------------------------------------
drop function if exists get_trash(text, text);

create or replace function get_trash(b text, p text, k text default 'audio') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return jsonb_build_object(
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object('folder', s.folder, 'title', s.title,
               'versions', (select count(*) from versions v where v.song_id = s.id))
             order by s.trashed_at desc)
      from songs s where s.band = lower(b) and s.trashed_at is not null
        and s.kind = coalesce(k, 'audio')), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('folder', s.folder, 'song', s.title, 'name', v.name)
             order by v.trashed_at desc)
      from versions v join songs s on s.id = v.song_id
      where s.band = lower(b) and s.trashed_at is null and v.trashed_at is not null
        and s.kind = coalesce(k, 'audio')), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- add_comment gains the region. Same drop-first dance v6 did, for the same
-- reason: a new signature rather than a second overload for PostgREST to
-- disambiguate.
-- ---------------------------------------------------------------------------
drop function if exists add_comment(text, text, text, real, text, text, text, uuid, uuid);

create or replace function add_comment(b text, p text, sid text, time_s real,
                                        txt text, who text, ver text, vid uuid,
                                        parent_id uuid default null,
                                        reg jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
-- pid/tsec shadow the parent_id/time_s parameters, whose names collide with
-- comments' own columns — referencing the parameters directly inside a query
-- against comments is an ambiguous-identifier error. (`reg` is named to avoid
-- the same collision with comments.region.) The parameter names stay as-is so
-- the RPC's named-argument API doesn't change.
declare row_out comments; parent comments;
        pid uuid := parent_id; tsec real := time_s; rgn jsonb := reg;
begin
  perform _require_pass(b, p);
  if sid not like lower(b) || '/%' then
    raise exception using errcode = '42501', message = 'comment outside this band';
  end if;
  if coalesce(trim(txt), '') = '' then
    raise exception 'comment text required';
  end if;
  if not _valid_region(rgn) then
    raise exception 'region must be {x,y,w,h} as fractions between 0 and 1';
  end if;
  if pid is not null then
    select * into parent from comments where comments.id = pid and comments.song_id = sid;
    if not found then
      raise exception 'original comment not found';
    end if;
    if parent.parent_id is not null then
      raise exception 'replies can only be one level deep';
    end if;
    -- a reply always inherits its thread's timestamp/version/region, never its
    -- own — so it can never drift onto a different pin, box or mix than its
    -- parent.
    tsec := parent.time_s;
    ver  := parent.version;
    vid  := parent.version_id;
    rgn  := parent.region;
  end if;
  insert into comments (song_id, time_s, text, name, version, version_id, parent_id, region)
    values (sid, tsec, txt, coalesce(who, ''), coalesce(ver, ''), vid, pid, rgn)
    returning * into row_out;
  return to_jsonb(row_out) || jsonb_build_object('dismissed_versions', '[]'::jsonb);
end $$;

-- get_comments needs no change: to_jsonb(c) picks up region for free, and the
-- band's whole pool still comes back in one call. Art keys into that pool as
-- '<band>/art/<comment_key>', which each page filters for by prefix — so the
-- two pages never show each other's notes.

-- ---------------------------------------------------------------------------
-- unstack_version — a revision pulled out of an art stack must stay art.
-- (Everything else in v3 — rename/reorder/stack/trash/restore/projects — is
-- kind-agnostic already and needs no change.)
-- ---------------------------------------------------------------------------
create or replace function unstack_version(b text, p text, f text,
                                           ver_name text, new_title text) returns void
language plpgsql security definer set search_path = public as $$
declare src_id uuid := _song_id(lower(b), f);
        vid uuid; nf text; base text; i int := 1; new_id uuid; src_kind text;
begin
  perform _require_pass(b, p);
  select id into vid from versions where song_id = src_id and name = ver_name limit 1;
  if vid is null then raise exception 'version not found'; end if;
  select kind into src_kind from songs where id = src_id;
  base := coalesce(nullif(_slugify(new_title), ''), 'song');
  nf := base;
  while exists (select 1 from songs where band = lower(b) and folder = nf) loop
    i := i + 1; nf := base || '-' || i;
  end loop;
  insert into songs (band, folder, title, comment_key, position, kind)
    values (lower(b), nf, new_title, nf,
            coalesce((select min(position) - 1 from songs where band = lower(b)), 0),
            coalesce(src_kind, 'audio'))
    returning id into new_id;
  update versions set song_id = new_id, position = 0 where id = vid;
  -- unstacking the only version empties the source song — remove the shell
  delete from songs s where s.id = src_id
    and not exists (select 1 from versions where song_id = s.id);
end $$;

-- ---------------------------------------------------------------------------
-- get_shared_version now says which kind it handed back, so a link opened on
-- the wrong page can say "that's a mix, not a picture" instead of rendering
-- nothing. Additive — the existing keys are untouched, and the function stays
-- passwordless and single-item as before.
-- ---------------------------------------------------------------------------
create or replace function get_shared_version(b text, s text, v text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sg songs; vr versions;
begin
  select * into sg from songs
    where band = lower(b) and (folder = s or title = s) and trashed_at is null
    limit 1;
  if not found then return null; end if;
  select * into vr from versions
    where song_id = sg.id and name = v and trashed_at is null
    limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'band', sg.band,
    'band_title', (select coalesce(title, slug) from bands where slug = sg.band),
    'kind', sg.kind,
    'song', jsonb_build_object(
      'folder', sg.folder, 'id', sg.comment_key, 'title', sg.title,
      'artist', sg.artist, 'album', sg.album, 'cover', sg.cover, 'kind', sg.kind,
      'versions', jsonb_build_array(jsonb_build_object(
        'name', vr.name, 'src', vr.src,
        'date', coalesce(to_char(vr.date, 'YYYY-MM-DD'), ''),
        'changelog', vr.changelog, 'changes', vr.changes))));
end $$;

-- ---------------------------------------------------------------------------
-- Service-role helper for the v2 import-inbox Edge Function: create the song
-- row with a kind in one call, so the function doesn't need its own insert
-- path per kind. Same posture as shift_versions_down — service_role only.
-- ---------------------------------------------------------------------------
create or replace function ensure_song(b text, f text, k text default 'audio') returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; ckey text; top int;
begin
  select id into sid from songs where band = lower(b) and folder = f;
  if sid is not null then return sid; end if;
  ckey := coalesce(nullif(_slugify(f), ''), 'song');
  select coalesce(min(position) - 1, 0) into top from songs where band = lower(b);
  insert into songs (band, folder, title, comment_key, position, kind)
    values (lower(b), f, f, ckey, top, coalesce(k, 'audio'))
    returning id into sid;
  return sid;
end $$;
revoke execute on function ensure_song(text, text, text) from public, anon, authenticated;
grant execute on function ensure_song(text, text, text) to service_role;
