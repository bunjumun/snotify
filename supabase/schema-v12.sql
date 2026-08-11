-- S'notify v12 — a link to where the words actually live.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v10.
--
-- v9 built lyrics into the site: drafts, suggestions, a whole review loop. It
-- works, but the band already writes words somewhere else — a shared doc, a
-- notes app, whatever the person holding the pen prefers — and the honest
-- answer to "where are the lyrics" is usually a URL.
--
-- So: one link per SONG, alongside the reference and the linked artwork.
-- Any http(s) address; nothing here is specific to one provider.

alter table songs add column if not exists lyrics_url text;

-- One song as the JSON shape the clients expect. Overridden again here to
-- carry the lyrics link beside the kind (v7), the art link (v7) and the
-- reference (v10).
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
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- Set or clear it. Null or blank removes the link. Only http(s) — a javascript:
-- or data: address in a link the whole band clicks is not something to leave to
-- the client's good manners.
create or replace function set_song_lyrics_url(b text, p text, f text, url text) returns void
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  perform _require_pass(b, p);
  u := nullif(trim(coalesce(url, '')), '');
  if u is not null then
    if u !~* '^https?://' then
      raise exception 'a lyrics link has to start with http:// or https://';
    end if;
    if length(u) > 2000 then
      raise exception 'that address is too long';
    end if;
  end if;
  update songs set lyrics_url = u where band = lower(b) and folder = f;
end $$;

notify pgrst, 'reload schema';
