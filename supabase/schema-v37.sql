-- S'notify v37 — Release Builder, populated (CR-79, 23 Aug).
--
-- CR-76 (22 Aug) built the empty door: a page with nothing behind it, at his
-- word ("left empty for now"). This populates it. His answers to the two
-- open questions on the outbox row: a song can sit in multiple releases,
-- behaving as aliases of the one master song (no duplication); and a
-- release needs its own completion percentage, rolled up from its tracks'
-- existing completion data.
--
-- WHY THE ROLLUP NEEDS NO SQL AT ALL. A release's percentage is the plain
-- average of its songs' own songPct — the same number music.html already
-- shows per song, computed client-side in progress.js from progress_all,
-- progress_shape and get_comments (for the to-do swing). release-builder.html
-- loads those same RPCs, already public to a logged-in band, and calls
-- PROGRESS.songPct itself (see progress-ui.js, which does exactly this for
-- the read-only bars on index.html/art.html). No new percentage machinery,
-- no second copy of the maths to drift from the first.
--
-- WHY release_songs POINTS AT songs.id, NOT A COPY. "Aliases of the one
-- master song" means literally that: editing a song anywhere — versions,
-- title, comments, progress — is instantly correct in every release it sits
-- in, because there is only one row. Deleting a song leaves its releases
-- with one fewer track rather than a dangling reference (on delete cascade).
--
-- WHY DELETE IS PLAIN, NOT SOFT. Songs and versions soft-delete (trashed_at)
-- because the audio itself is expensive to lose. A release is only a named
-- grouping of songs that still exist everywhere else — deleting one destroys
-- no audio, no comments, no progress. A plain delete behind a client-side
-- confirm() is enough; the 🗑 Trash modal (comments/songs/versions) is not
-- extended to cover this.

create table if not exists releases (
  id         uuid primary key default gen_random_uuid(),
  band       text not null references bands(slug),
  title      text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists releases_band on releases (band, position);

create table if not exists release_songs (
  release_id uuid not null references releases(id) on delete cascade,
  song_id    uuid not null references songs(id) on delete cascade,
  position   int  not null default 0,
  primary key (release_id, song_id)
);
create index if not exists release_songs_release on release_songs (release_id, position);

-- RLS on, zero anon policies — same posture as songs/versions/projects.
-- Every access flows through the password-checked RPCs below.
alter table releases      enable row level security;
alter table release_songs enable row level security;

-- ---------------------------------------------------------------------------
-- RPCs — same _require_pass(b, p) pattern as every other mutation in v3.
-- ---------------------------------------------------------------------------

-- One call for the whole builder: every release for the band, each carrying
-- its songs as an ordered array of folders (the same stable key songPct
-- already keys off). Trashed songs are excluded so a release doesn't quietly
-- keep counting a song that no longer shows anywhere else.
create or replace function get_releases(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title,
        'songs', coalesce((
          select jsonb_agg(s.folder order by rs.position)
          from release_songs rs join songs s on s.id = rs.song_id
          where rs.release_id = r.id and s.trashed_at is null), '[]'::jsonb))
      order by r.position, r.created_at)
    from releases r where r.band = lower(b)), '[]'::jsonb);
end $$;

create or replace function create_release(b text, p text, title_in text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform _require_pass(b, p);
  insert into releases (band, title, position)
    values (lower(b), title_in,
            coalesce((select max(position) + 1 from releases where band = lower(b)), 0))
    returning id into rid;
  return rid;
end $$;

create or replace function rename_release(b text, p text, rid uuid, new_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update releases set title = new_title where id = rid and band = lower(b);
end $$;

create or replace function reorder_releases(b text, p text, ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update releases r set position = ord.i - 1
    from unnest(ids) with ordinality ord(id, i)
    where r.id = ord.id and r.band = lower(b);
end $$;

create or replace function delete_release(b text, p text, rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from releases where id = rid and band = lower(b);
end $$;

create or replace function add_release_song(b text, p text, rid uuid, f text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid := _song_id(lower(b), f);
begin
  perform _require_pass(b, p);
  if sid is null then raise exception 'song not found'; end if;
  if not exists (select 1 from releases where id = rid and band = lower(b)) then
    raise exception 'release not found';
  end if;
  insert into release_songs (release_id, song_id, position)
    values (rid, sid, coalesce((select max(position) + 1 from release_songs where release_id = rid), 0))
    on conflict (release_id, song_id) do nothing;
end $$;

create or replace function remove_release_song(b text, p text, rid uuid, f text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from release_songs
    where release_id = rid and song_id = _song_id(lower(b), f)
      and exists (select 1 from releases where id = rid and band = lower(b));
end $$;

create or replace function reorder_release_songs(b text, p text, rid uuid, folders text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update release_songs rs set position = ord.i - 1
    from unnest(folders) with ordinality ord(f, i)
    where rs.release_id = rid and rs.song_id = _song_id(lower(b), ord.f)
      and exists (select 1 from releases where id = rid and band = lower(b));
end $$;
