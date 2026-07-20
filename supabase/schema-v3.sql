-- S'notify v3 — Supabase-backed library (no studio-Mac bridge required)
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v2
-- (bands + band_pass_ok + inbox bucket stay as they are).
--
-- Model: the browser is the only client. Nothing is readable or writable with
-- the publishable key directly — every access goes through the SECURITY
-- DEFINER functions below. Read functions that take (b, p) check the band
-- password server-side; the only passwordless reads are a single shared mix
-- version, minimal project-gate metadata, and band-name resolution.

create extension if not exists fuzzystrmatch;

-- Band display titles (v2 only had slug + pass).
alter table bands add column if not exists title text;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists songs (
  id           uuid primary key default gen_random_uuid(),
  band         text not null references bands(slug),
  folder       text not null,           -- stable key; matches tracks/<band>/<folder>
  title        text not null,
  artist       text not null default '',
  album        text,                    -- optional grouping; null → band title
  cover        text,                    -- bucket path or absolute URL
  comment_key  text not null,           -- frozen; comments.song_id = band||'/'||comment_key
  position     int  not null default 0, -- 0 = top of the library
  trashed_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (band, folder)
);
create index if not exists songs_band on songs (band, position) where trashed_at is null;

create table if not exists versions (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references songs(id) on delete cascade,
  name       text not null,
  src        text not null,             -- object path in the 'tracks' bucket: <band>/<folder>/<file>
  date       date,
  changelog  text not null default '',
  changes    jsonb,
  position   int  not null default 0,   -- 0 = newest / top of the stack
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (song_id, name)
);
create index if not exists versions_song on versions (song_id, position) where trashed_at is null;

create table if not exists projects (
  slug     text primary key,            -- unguessable; old projects.json slugs preserved
  band     text not null references bands(slug),
  name     text not null,
  songs    text[] not null default '{}',-- ordered song folders
  created  date default now()
);

-- RLS on, zero anon policies: direct table access with the publishable key
-- returns nothing / is rejected. All access flows through the RPCs.
alter table songs    enable row level security;
alter table versions enable row level security;
alter table projects enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: 'tracks' bucket — publicly readable by exact URL, never listable
-- (public bucket ⇒ GET /object/public/... works; no select policy on
-- storage.objects ⇒ listing with the publishable key is denied). Not DRM —
-- same posture the site has always had.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('tracks', 'tracks', true)
  on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- Inbox: v2 granted INSERT only, but the uploader sends x-upsert (re-uploading
-- a version under the same name is meant to replace it, and a retry after a
-- half-finished upload hits the same path). Without UPDATE, storage rejects
-- those with a generic 400 that looks exactly like a bad password.
-- Same check as the insert policy: the password lives in the object path.
-- ---------------------------------------------------------------------------
drop policy if exists "band inbox replace" on storage.objects;
create policy "band inbox replace" on storage.objects
  for update to anon
  using (
    bucket_id = 'inbox'
    and band_pass_ok((storage.foldername(name))[1], (storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'inbox'
    and band_pass_ok((storage.foldername(name))[1], (storage.foldername(name))[2])
  );

-- Upsert also has to see whether the object is already there.
drop policy if exists "band inbox see own" on storage.objects;
create policy "band inbox see own" on storage.objects
  for select to anon
  using (
    bucket_id = 'inbox'
    and band_pass_ok((storage.foldername(name))[1], (storage.foldername(name))[2])
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function _require_pass(b text, p text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not band_pass_ok(b, p) then
    raise exception using errcode = '42501', message = 'wrong band password';
  end if;
end $$;

create or replace function _slugify(t text) returns text
language sql immutable as
$$ select trim(both '-' from regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]+', '-', 'g')) $$;

create or replace function _song_id(b text, f text) returns uuid
language sql stable security definer set search_path = public as
$$ select id from songs where band = b and folder = f $$;

-- One song as the JSON shape index.html's normalize() expects.
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
               'name', v.name, 'src', v.src,
               'date', coalesce(to_char(v.date, 'YYYY-MM-DD'), ''),
               'changelog', v.changelog, 'changes', v.changes)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Read RPCs
-- ---------------------------------------------------------------------------
create or replace function get_library(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return (select jsonb_build_object(
    'slug', bd.slug,
    'title', coalesce(bd.title, bd.slug),
    'songs', coalesce((
      select jsonb_agg(_song_json(s) order by s.position, s.created_at desc)
      from songs s where s.band = bd.slug and s.trashed_at is null), '[]'::jsonb))
  from bands bd where bd.slug = lower(b));
end $$;

-- Passwordless: just enough for a ?p= visitor to be shown the right gate.
create or replace function get_project_meta(proj text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', pr.slug, 'name', pr.name, 'band', pr.band,
                            'band_title', coalesce(bd.title, bd.slug))
  from projects pr join bands bd on bd.slug = pr.band
  where pr.slug = proj
$$;

create or replace function get_project(proj text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr projects;
begin
  select * into pr from projects where projects.slug = proj;
  if not found then return null; end if;
  perform _require_pass(pr.band, p);
  return jsonb_build_object(
    'slug', pr.slug, 'name', pr.name, 'band', pr.band,
    'band_title', (select coalesce(title, slug) from bands where slug = pr.band),
    'songs', coalesce((
      select jsonb_agg(_song_json(s) order by ord.i)
      from unnest(pr.songs) with ordinality ord(f, i)
      join songs s on s.band = pr.band and s.folder = ord.f
      where s.trashed_at is null), '[]'::jsonb));
end $$;

-- Passwordless single-mix share link (?b&s&v): exactly one song with exactly
-- one version, or null. Guessing needs band slug + exact folder + exact
-- version name; only that version's metadata is exposed.
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
    'song', jsonb_build_object(
      'folder', sg.folder, 'id', sg.comment_key, 'title', sg.title,
      'artist', sg.artist, 'album', sg.album, 'cover', sg.cover,
      'versions', jsonb_build_array(jsonb_build_object(
        'name', vr.name, 'src', vr.src,
        'date', coalesce(to_char(vr.date, 'YYYY-MM-DD'), ''),
        'changelog', vr.changelog, 'changes', vr.changes))));
end $$;

-- Server-side band-name fuzzy match (the library is no longer public, so the
-- client can't scan a manifest). Exposes at most ONE band name per query.
create or replace function resolve_band(q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare qq text := regexp_replace(lower(coalesce(q, '')), '[^a-z0-9]', '', 'g');
        best_slug text; best_title text; best_score real := 0; r record; cand text; score real;
begin
  if qq = '' then return jsonb_build_object('kind', 'empty'); end if;
  select slug, coalesce(title, slug) into best_slug, best_title from bands
    where slug = qq or regexp_replace(lower(coalesce(title, '')), '[^a-z0-9]', '', 'g') = qq
    limit 1;
  if found then
    return jsonb_build_object('kind', 'exact', 'slug', best_slug, 'title', best_title);
  end if;
  for r in select slug, coalesce(title, slug) as title from bands loop
    foreach cand in array array[r.slug, regexp_replace(lower(r.title), '[^a-z0-9]', '', 'g')] loop
      continue when cand is null or cand = '';
      score := 1 - levenshtein(qq, cand)::real / greatest(length(qq), length(cand));
      if score > best_score then
        best_score := score; best_slug := r.slug; best_title := r.title;
      end if;
    end loop;
  end loop;
  if best_score >= 0.6 then
    return jsonb_build_object('kind', 'suggest', 'slug', best_slug, 'title', best_title);
  end if;
  return jsonb_build_object('kind', 'none');
end $$;

create or replace function get_trash(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return jsonb_build_object(
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object('folder', s.folder, 'title', s.title,
               'versions', (select count(*) from versions v where v.song_id = s.id))
             order by s.trashed_at desc)
      from songs s where s.band = lower(b) and s.trashed_at is not null), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('folder', s.folder, 'song', s.title, 'name', v.name)
             order by v.trashed_at desc)
      from versions v join songs s on s.id = v.song_id
      where s.band = lower(b) and s.trashed_at is null and v.trashed_at is not null), '[]'::jsonb));
end $$;

create or replace function get_comments(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.created_at)
    from comments c where c.song_id like lower(b) || '/%'), '[]'::jsonb);
end $$;

-- Service-role-only helper for the import-inbox Edge Function: shift a song's
-- stack down one slot so a new version can take position 0.
create or replace function shift_versions_down(sid uuid) returns void
language sql security definer set search_path = public as
$$ update versions set position = position + 1 where song_id = sid $$;
revoke execute on function shift_versions_down(uuid) from public, anon, authenticated;
grant execute on function shift_versions_down(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Mutation RPCs (every one re-checks the band password)
-- ---------------------------------------------------------------------------
create or replace function add_comment(b text, p text, sid text, time_s real,
                                       txt text, who text, ver text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out comments;
begin
  perform _require_pass(b, p);
  if sid not like lower(b) || '/%' then
    raise exception using errcode = '42501', message = 'comment outside this band';
  end if;
  insert into comments (song_id, time_s, text, name, version)
    values (sid, time_s, txt, coalesce(who, ''), coalesce(ver, ''))
    returning * into row_out;
  return to_jsonb(row_out);
end $$;

create or replace function delete_comment(b text, p text, cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from comments where id = cid and song_id like lower(b) || '/%';
end $$;

create or replace function rename_song(b text, p text, f text, new_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update songs set title = new_title where band = lower(b) and folder = f;
end $$;

create or replace function reorder_songs(b text, p text, folders text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update songs s set position = ord.i - 1
    from unnest(folders) with ordinality ord(f, i)
    where s.band = lower(b) and s.folder = ord.f;
end $$;

create or replace function rename_version(b text, p text, f text,
                                          old_name text, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update versions set name = new_name
    where song_id = _song_id(lower(b), f) and name = old_name;
end $$;

create or replace function reorder_versions(b text, p text, f text, names text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update versions v set position = ord.i - 1
    from unnest(names) with ordinality ord(n, i)
    where v.song_id = _song_id(lower(b), f) and v.name = ord.n;
end $$;

-- Stack: from-song's versions land on TOP of into-song's stack; the from-song
-- row disappears. Audio objects don't move — src is per-version.
create or replace function stack_songs(b text, p text, from_f text, into_f text) returns void
language plpgsql security definer set search_path = public as $$
declare from_id uuid := _song_id(lower(b), from_f);
        into_id uuid := _song_id(lower(b), into_f);
        n int;
begin
  perform _require_pass(b, p);
  if from_id is null or into_id is null or from_id = into_id then
    raise exception 'song not found';
  end if;
  -- de-dupe: a moved version with a name that already exists in the target
  -- replaces the target's copy (same semantics as re-uploading a version)
  delete from versions t where t.song_id = into_id
    and t.name in (select name from versions where song_id = from_id);
  select count(*) into n from versions where song_id = from_id;
  update versions set position = position + n where song_id = into_id;
  update versions v set song_id = into_id, position = t.rn - 1
    from (select id, row_number() over (order by position, created_at desc) rn
          from versions where song_id = from_id) t
    where v.id = t.id;
  delete from songs where id = from_id;
end $$;

create or replace function unstack_version(b text, p text, f text,
                                           ver_name text, new_title text) returns void
language plpgsql security definer set search_path = public as $$
declare src_id uuid := _song_id(lower(b), f);
        vid uuid; nf text; base text; i int := 1; new_id uuid;
begin
  perform _require_pass(b, p);
  select id into vid from versions where song_id = src_id and name = ver_name limit 1;
  if vid is null then raise exception 'version not found'; end if;
  base := coalesce(nullif(_slugify(new_title), ''), 'song');
  nf := base;
  while exists (select 1 from songs where band = lower(b) and folder = nf) loop
    i := i + 1; nf := base || '-' || i;
  end loop;
  insert into songs (band, folder, title, comment_key, position)
    values (lower(b), nf, new_title, nf,
            coalesce((select min(position) - 1 from songs where band = lower(b)), 0))
    returning id into new_id;
  update versions set song_id = new_id, position = 0 where id = vid;
  -- unstacking the only version empties the source song — remove the shell
  delete from songs s where s.id = src_id
    and not exists (select 1 from versions where song_id = s.id);
end $$;

create or replace function trash_song(b text, p text, f text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update songs set trashed_at = now() where band = lower(b) and folder = f;
end $$;

create or replace function restore_song(b text, p text, f text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update songs set trashed_at = null where band = lower(b) and folder = f;
end $$;

create or replace function trash_version(b text, p text, f text, ver_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update versions set trashed_at = now()
    where song_id = _song_id(lower(b), f) and name = ver_name;
end $$;

create or replace function restore_version(b text, p text, f text, ver_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update versions set trashed_at = null
    where song_id = _song_id(lower(b), f) and name = ver_name;
end $$;

create or replace function upsert_project(b text, p text, proj text,
                                          proj_name text, folders text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  insert into projects (slug, band, name, songs)
    values (proj, lower(b), proj_name, folders)
    on conflict (slug) do update set name = excluded.name, songs = excluded.songs
    where projects.band = lower(b);
end $$;

create or replace function delete_project(b text, p text, proj text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from projects where projects.slug = proj and projects.band = lower(b);
end $$;

-- ---------------------------------------------------------------------------
-- PHASE-4 LOCKDOWN — run these three lines ONLY AFTER the new index.html
-- (which uses get_comments/add_comment/delete_comment) is live on Pages.
-- Old cached pages still talk to the comments table directly until then.
-- ---------------------------------------------------------------------------
-- drop policy if exists "anyone can read comments"   on comments;
-- drop policy if exists "anyone can add comments"    on comments;
-- drop policy if exists "anyone can delete comments" on comments;
