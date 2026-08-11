-- S'notify v13 — a mix carries its own waveform.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v12.
--
-- The library shows a ghost of each song's waveform behind its title. Working
-- that out means downloading and decoding the whole mix, which is a lot of
-- work to do in every bandmate's browser, over and over, for a thumbnail.
--
-- So it is done ONCE — by whoever uploads the mix, right after it lands — and
-- kept here. Everyone else just reads 240 numbers.
--
-- Older mixes have no peaks and never will unless someone opens the library:
-- the client still decodes those lazily and saves what it finds, so the pool
-- fills itself in as the band uses the site.

alter table versions add column if not exists peaks jsonb;

-- One song as the JSON shape the clients expect. Overridden again here so each
-- version carries its peaks alongside its changelog.
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
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- Store them. Bounded hard: this is a thumbnail, not an audio file, and there
-- is no reason for a client to be able to push a megabyte of numbers into the
-- row through a password-only endpoint.
create or replace function set_version_peaks(b text, p text, vid uuid, pk jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if pk is not null then
    if jsonb_typeof(pk) <> 'array' then
      raise exception 'peaks must be an array';
    end if;
    if jsonb_array_length(pk) > 1024 then
      raise exception 'that is far more peaks than a thumbnail needs';
    end if;
    if length(pk::text) > 20000 then
      raise exception 'those peaks are too big';
    end if;
  end if;
  -- band-scoped: a right password for one band cannot write another's rows
  update versions v set peaks = pk
    from songs s
   where v.id = vid and v.song_id = s.id and s.band = lower(b);
end $$;

notify pgrst, 'reload schema';
