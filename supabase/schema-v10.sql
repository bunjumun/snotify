-- S'notify v10 — reference tracks.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v9.
--
-- The thing you are chasing. A reference belongs to the SONG, not to a mix and
-- not to the album: it is what this track is trying to sound like, and it stays
-- the same whichever version you happen to be listening to.
--
-- Three ways to attach one, all stored in the same column:
--   {kind:'url',   src:'https://…/track.mp3', title:'…'}   a link to audio
--   {kind:'embed', src:'https://…',           title:'…'}   someone else's player
--   {kind:'file',  src:'<band>/<folder>/_ref/x.mp3', title:'…'}  uploaded here
--
-- Only 'url' and 'file' can be driven by this site — an embedded widget is
-- someone else's player in someone else's iframe, so pausing it is best effort
-- and its volume is its own. That limit is in the interface, not hidden.

alter table songs add column if not exists reference jsonb;

-- One song as the JSON shape the clients expect. Overridden here to carry the
-- reference alongside the kind and the art link added in v7.
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
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'src', v.src,
               'date', coalesce(to_char(v.date, 'YYYY-MM-DD'), ''),
               'changelog', v.changelog, 'changes', v.changes,
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- Set or clear it. `ref` null removes the reference. Named `ref` rather than
-- after the column it lands in, for the usual ambiguity reason.
create or replace function set_song_reference(b text, p text, f text, ref jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if ref is not null then
    if jsonb_typeof(ref) <> 'object'
       or coalesce(ref->>'kind', '') not in ('url', 'embed', 'file')
       or coalesce(trim(ref->>'src'), '') = '' then
      raise exception 'a reference needs a kind of url, embed or file, and a src';
    end if;
    if length(ref->>'src') > 2000 then
      raise exception 'that address is too long';
    end if;
  end if;
  update songs set reference = ref where band = lower(b) and folder = f;
end $$;

notify pgrst, 'reload schema';
