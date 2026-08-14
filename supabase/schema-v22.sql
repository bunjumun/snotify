-- S'notify v22 — a reference at three levels, and a section to play from.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v21.
--
-- v10 put a reference on the SONG and said, in as many words, that it belongs
-- there and not to a mix. That was half right. A song reference is what the
-- song is chasing and it does stay put across the stack — but two other things
-- kept wanting one and had nowhere to put it:
--
--   the MIX VERSION   what *this* mix was aiming at, which is not always what
--                     the song is aiming at, and changes as the stack grows
--   the COMMENT       evidence in one argument. "the hats should sit like
--                     this" is a different claim with the track attached
--
-- So: three slots, and NO CROSSTALK between them. A version with nothing
-- attached shows nothing attached; it never borrows the song's, and a comment
-- never borrows either. Each is set and cleared on its own. That is a decision
-- and not an oversight — inheritance would mean you could never say "this mix
-- was chasing nothing in particular", and the empty state is information.
--
-- Same jsonb shape in all three, so one validator and one client renderer:
--
--   {kind:'url',   src:'https://…/track.mp3', title:'…'}   a link to audio
--   {kind:'embed', src:'https://…',           title:'…'}   someone else's player
--   {kind:'file',  src:'<band>/<folder>/_ref/x.mp3', title:'…'}  uploaded here
--
-- and optionally, on any of them, the section to play from:
--
--   {…, in: 41.5, out: 68.2, loop: true}                   seconds, from the start
--
-- in/out are advisory rather than enforced. For a file or a direct link the
-- client owns the audio element and honours them exactly. For an embed it can
-- only ask: YouTube's player takes start/end, SoundCloud takes a start, Spotify
-- and Bandcamp take neither. The client says which of those you are in rather
-- than pretending they are equal.

alter table versions add column if not exists reference jsonb;
alter table comments add column if not exists reference jsonb;

-- ---------------------------------------------------------------------------
-- One validator, three call sites.
--
-- v10 checked the shape inline inside set_song_reference. Three copies of that
-- check would have drifted the first time one of them learned something, so it
-- comes out here and set_song_reference is redefined below to call it.
--
-- Deliberately permissive about in/out beyond ordering: durations are not known
-- here, so an out point past the end of a track is the client's problem to clamp
-- and not a reason to refuse the row.
-- ---------------------------------------------------------------------------
-- CASE rather than a chain of ANDs on purpose: AND is not guaranteed to
-- short-circuit in SQL, so `jsonb_typeof(…) = 'number' and (…)::numeric >= 0`
-- can still reach the cast on a string and raise instead of returning false —
-- turning "that reference is malformed" into an error nobody can read. CASE
-- does short-circuit, so each arm only runs once its guard has passed.
create or replace function _valid_reference(r jsonb) returns boolean
language sql immutable as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and coalesce(r->>'kind', '') in ('url', 'embed', 'file')
    and coalesce(btrim(r->>'src'), '') <> ''
    and length(r->>'src') <= 2000
    and coalesce(length(r->>'title'), 0) <= 200
    -- in/out, when present, are numbers, not negative, and in that order
    and case when r->'in' is null then true
             when jsonb_typeof(r->'in') <> 'number' then false
             else (r->>'in')::numeric >= 0 end
    and case when r->'out' is null then true
             when jsonb_typeof(r->'out') <> 'number' then false
             else (r->>'out')::numeric > 0 end
    and case when r->'in' is null or r->'out' is null then true
             when jsonb_typeof(r->'in') <> 'number'
               or jsonb_typeof(r->'out') <> 'number' then false
             else (r->>'out')::numeric > (r->>'in')::numeric end
    and (r->'loop' is null or jsonb_typeof(r->'loop') = 'boolean')
  )
$$;

-- ---------------------------------------------------------------------------
-- The song's own, restated.
--
-- Same signature and same behaviour as v10, so nothing that calls it changes.
-- The only difference is that the shape check now lives in one place, and that
-- in/out are accepted here too: a song reference can be a section as much as a
-- comment's can.
-- ---------------------------------------------------------------------------
create or replace function set_song_reference(b text, p text, f text, ref jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if not _valid_reference(ref) then
    raise exception 'a reference needs a kind of url, embed or file, and a src';
  end if;
  update songs set reference = ref where band = lower(b) and folder = f;
end $$;

-- ---------------------------------------------------------------------------
-- The mix version's.
--
-- Band-scoped through the join to songs, the same guard star_version uses in
-- v15: a right password for one band cannot reach into another's stack.
-- ---------------------------------------------------------------------------
create or replace function set_version_reference(b text, p text, vid uuid, ref jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if not _valid_reference(ref) then
    raise exception 'a reference needs a kind of url, embed or file, and a src';
  end if;
  if not exists (select 1 from versions v join songs s on s.id = v.song_id
                  where v.id = vid and s.band = lower(b)) then
    raise exception 'no such mix in this band';
  end if;
  update versions set reference = ref where id = vid;
end $$;

-- ---------------------------------------------------------------------------
-- The comment's.
--
-- Scoped by song_id's band prefix, which is how every other comment function
-- here checks its ground (see set_comment_tags in v16).
-- ---------------------------------------------------------------------------
create or replace function set_comment_reference(b text, p text, cid uuid, ref jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if not _valid_reference(ref) then
    raise exception 'a reference needs a kind of url, embed or file, and a src';
  end if;
  update comments set reference = ref
   where id = cid and song_id like lower(b) || '/%';
end $$;

-- ---------------------------------------------------------------------------
-- One song as the JSON shape the clients expect. Overridden again so each
-- version carries its own reference, beside the stars added in v15.
--
-- get_comments needs no change: it returns to_jsonb(c) and so picks the new
-- column up for free, the same way region and tags arrived.
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

notify pgrst, 'reload schema';
