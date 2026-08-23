-- S'notify v33 — music folders (QUEUE, top line, 22 Aug).
--
-- A folder is a personal way to group songs on the music page, and nothing
-- more. Deliberately kept apart from the two groupings that already exist so
-- neither gets muddled with it: `songs.album` is the record's own
-- band -> album -> song -> version hierarchy that the progress bars key on
-- (see the "WHAT AN ALBUM IS HERE" comment in music.html), and `projects` is
-- the throwaway share-link feature ("Erics special link"). A music folder
-- drives neither. It is just a named bucket a song can sit in or not, shown
-- as a collapsed row that opens onto the stack of songs inside it, and a song
-- moves in and out of one freely without anything else on the site noticing.
--
-- Same RLS posture as lore_docs (v19): enabled, no policies, every access
-- goes through a security definer function below, so there is no path to
-- this table that skips the band password.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists music_folders (
  id          uuid primary key default gen_random_uuid(),
  band        text not null references bands(slug),
  name        text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

alter table music_folders enable row level security;

-- A song not in a folder (the default, and every song today) behaves exactly
-- as it always has — this is additive only. Deleting a folder must not take
-- its songs with it, so this is SET NULL rather than CASCADE: the songs just
-- fall back to the flat top-level list they would show in had they never been
-- filed at all.
alter table songs add column if not exists music_folder_id uuid
  references music_folders(id) on delete set null;

-- ---------------------------------------------------------------------------
-- _song_json gains music_folder_id. Additive key, so normalize() on every
-- other page that reads this payload keeps working unchanged; only
-- music.html looks for it.
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
    'kind',   s.kind,
    'link',   s.linked_folder,
    'reference', s.reference,
    'lyrics', s.lyrics_url,
    'music_folder_id', s.music_folder_id,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'src', v.src,
               'date', coalesce(to_char(v.date, 'YYYY-MM-DD'), ''),
               'changelog', v.changelog, 'changes', v.changes,
               'peaks', v.peaks,
               'reference', v.reference,
               'stars', coalesce((select jsonb_agg(st.name order by st.created_at)
                                  from version_stars st where st.version_id = v.id), '[]'::jsonb),
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- get_library gains a sibling 'folders' array beside 'songs'. Empty for every
-- band until one is created, so this is a no-op for anyone who never touches
-- the feature.
-- ---------------------------------------------------------------------------
create or replace function get_library(b text, p text, k text default 'audio') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return (select jsonb_build_object(
    'slug', bd.slug,
    'title', coalesce(bd.title, bd.slug),
    'folders', coalesce((
      select jsonb_agg(jsonb_build_object('id', mf.id, 'name', mf.name)
             order by mf.position, mf.created_at)
      from music_folders mf where mf.band = bd.slug), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(_song_json(s) order by s.position, s.created_at desc)
      from songs s
      where s.band = bd.slug and s.trashed_at is null
        and s.kind = coalesce(k, 'audio')), '[]'::jsonb))
  from bands bd where bd.slug = lower(b));
end $$;

-- ---------------------------------------------------------------------------
-- create_music_folder — get-or-create by name, so uploading the same folder
-- of files twice (or adding more songs to one already made) files into the
-- same folder instead of minting "Demos", "Demos 2", "Demos 3"... Returns the
-- id either way.
-- ---------------------------------------------------------------------------
create or replace function create_music_folder(b text, p text, fname text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid; nextpos int;
begin
  perform _require_pass(b, p);
  select id into fid from music_folders where band = lower(b) and name = fname;
  if fid is not null then return fid; end if;
  select coalesce(max(position), -1) + 1 into nextpos from music_folders where band = lower(b);
  insert into music_folders (band, name, position) values (lower(b), fname, nextpos)
    returning id into fid;
  return fid;
end $$;

create or replace function rename_music_folder(b text, p text, fid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update music_folders set name = new_name where id = fid and band = lower(b);
end $$;

-- Never touches the songs inside — they fall back to the flat list via the
-- FK's own ON DELETE SET NULL above.
create or replace function delete_music_folder(b text, p text, fid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from music_folders where id = fid and band = lower(b);
end $$;

-- set_song_folder — file a song into a folder, or clear it (fid null = back
-- to the flat list). f is the song's own stable key, same as every other
-- song-scoped call on this page (rename_song, trash_song, and so on). The fid
-- subquery guard stops a song being filed into another band's folder.
create or replace function set_song_folder(b text, p text, f text, fid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update songs set music_folder_id = fid
    where band = lower(b) and folder = f
      and (fid is null or fid in (select id from music_folders where band = lower(b)));
end $$;
