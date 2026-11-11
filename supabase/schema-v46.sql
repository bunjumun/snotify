-- schema-v46 (CR-199): choose which revision of an art piece is its track's art.
--
-- Until now a track's cover was always the NEWEST revision of the artwork
-- linked to it, so the only way to show an older revision you preferred was to
-- upload it again as a new one. This puts the choice on the art row: a pointer
-- at one of its own revisions. NULL means "no choice made", which keeps the old
-- behaviour (newest), so nothing changes for existing tracks until you pick.
--
-- `on delete set null`: deleting the chosen revision for good quietly falls
-- back to newest rather than blocking the delete or leaving a dangling id. A
-- trashed (not deleted) revision is handled by the client, which only honours
-- a pointer that is still in the live list.
--
-- Additive and idempotent. RLS on, zero anon policies, writes via a security
-- definer function gated on _require_pass, same as every other write.

alter table songs add column if not exists cover_version_id uuid references versions(id) on delete set null;

-- _song_json gains cover_version. Everything else is v34 verbatim.
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
    'cover_version', s.cover_version_id,
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

-- set_art_cover: pick (or, with a null vid, clear) the revision shown as the
-- track's art. Only artwork rows, and only a revision that belongs to that
-- same piece, so a stray id cannot point one piece at another's picture.
create or replace function set_art_cover(b text, p text, f text, vid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  perform _require_pass(b, p);
  select id into sid from songs
   where band = lower(b) and folder = f and coalesce(kind, 'audio') = 'art' and trashed_at is null;
  if sid is null then raise exception 'no such artwork'; end if;
  if vid is not null and not exists (
      select 1 from versions where id = vid and song_id = sid and trashed_at is null) then
    raise exception 'that revision is not part of this artwork';
  end if;
  update songs set cover_version_id = vid where id = sid;
end $$;
