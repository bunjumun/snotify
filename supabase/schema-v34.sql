-- S'notify v34 — exclude tracks/folders from the album percentage (CR-81, 23 Aug).
--
-- "Allow me to exclude or include tracks or whole folders from album
-- percentage in edit mode." albumPct() in progress.js averages
-- songPcts across every song IN THE ALBUM, deliberately, so a record with ten
-- songs and one finished reads as a tenth done rather than half. That is
-- right for "nobody has touched this yet" and wrong for "this track is a demo
-- / a bonus / not part of the record" — there was no way to say the second
-- thing without lying about the first, so this adds one.
--
-- Two flags, not one: a song can be excluded on its own, and a whole
-- `music_folders` row can be excluded to cover everything filed in it. His own
-- word on the one real design question here (does moving a song into an
-- excluded folder drop it out of the average automatically, or only songs
-- excluded at the moment you toggle it?) — "it would inherit the
-- characteristics of that parent folder" — settles it as dynamic: nothing is
-- copied onto the song, the client computes effective exclusion as
-- `song.excluded OR folder.excluded` at read time, off whichever folder the
-- song currently sits in. Move a song out of an excluded folder and it is
-- back in the average with no extra step.
--
-- Same posture as v33: RLS enabled, no policies, every write goes through a
-- security definer function gated on `_require_pass`.

alter table songs add column if not exists excluded boolean not null default false;
alter table music_folders add column if not exists excluded boolean not null default false;

-- ---------------------------------------------------------------------------
-- _song_json gains excluded. Additive key, same as music_folder_id was in v33.
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
    'excluded', s.excluded,
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
-- get_library's folders array gains excluded, same shape change as above.
-- ---------------------------------------------------------------------------
create or replace function get_library(b text, p text, k text default 'audio') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return (select jsonb_build_object(
    'slug', bd.slug,
    'title', coalesce(bd.title, bd.slug),
    'folders', coalesce((
      select jsonb_agg(jsonb_build_object('id', mf.id, 'name', mf.name, 'excluded', mf.excluded)
             order by mf.position, mf.created_at)
      from music_folders mf where mf.band = bd.slug), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(_song_json(s) order by s.position, s.created_at desc)
      from songs s
      where s.band = bd.slug and s.trashed_at is null
        and s.kind = coalesce(k, 'audio')), '[]'::jsonb))
  from bands bd where bd.slug = lower(b));
end $$;

-- set_song_excluded — same call shape as set_song_folder: keyed by the song's
-- stable folder key, not its id.
create or replace function set_song_excluded(b text, p text, f text, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update songs set excluded = on_ where band = lower(b) and folder = f;
end $$;

-- set_folder_excluded — same call shape as rename_music_folder.
create or replace function set_folder_excluded(b text, p text, fid uuid, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update music_folders set excluded = on_ where id = fid and band = lower(b);
end $$;
