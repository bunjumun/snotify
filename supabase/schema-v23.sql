-- S'notify v23 — a public link for anything, granted one at a time.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v22.
--
-- Until now exactly one thing could be opened without the band password: a
-- single mix, through get_shared_version(b, s, v). Everything else — a song's
-- whole stack, an album, the library — went through _require_pass. So the
-- share button minted two different kinds of link depending on whether it had
-- a version in hand, and the ones without a version all landed a stranger on a
-- password gate. That asymmetry is what this fixes.
--
-- The grant is opt-in and per item, and it is keyed by a TOKEN, never by the
-- thing's own name. That distinction is the whole security argument:
--
--   by slug   an unshared album is one guess away from public, and a guess
--             costs nothing. Slugs are short, and a band's albums are
--             enumerable by anyone who knows how they are named.
--   by token  an unshared album has no public identity at all. There is no
--             string that reaches it, so there is nothing to guess. Sharing
--             mints the string; clearing it destroys every link ever sent.
--
-- Comments stay private in every case. They are for logged-in bandmates and
-- no public payload here carries them — get_comments still takes a password.

alter table projects add column if not exists share_token text;
alter table songs    add column if not exists share_token text;
alter table bands    add column if not exists share_token text;

-- Partial unique indexes: many rows may sit at null (the normal, unshared
-- state) while a live token is unique across its table.
create unique index if not exists projects_share_token
  on projects (share_token) where share_token is not null;
create unique index if not exists songs_share_token
  on songs (share_token) where share_token is not null;
create unique index if not exists bands_share_token
  on bands (share_token) where share_token is not null;

-- 32 hex characters out of gen_random_uuid(), which is already in use for
-- every primary key here, so this needs no extension that is not present.
-- Hyphens stripped so the token survives a URL, a text message and a
-- double-click-to-select without losing a piece of itself.
create or replace function _new_share_token() returns text
language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

-- ---------------------------------------------------------------------------
-- Minting and revoking. Both are owner actions and both re-check the band
-- password, the same as every other mutation since v3.
--
-- set_share is deliberately idempotent: asking twice for a link to the same
-- album returns the SAME token rather than rotating it, so clicking "copy
-- public link" a second time cannot quietly break the link you already sent.
-- Rotating is what clear_share followed by set_share is for, and that reads
-- as the deliberate act it is.
-- ---------------------------------------------------------------------------
create or replace function set_share(b text, p text, kind text, ref text) returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  perform _require_pass(b, p);
  if kind = 'project' then
    select share_token into tok from projects where slug = ref and band = lower(b);
    if not found then raise exception 'no such album in this band'; end if;
    if tok is null then
      tok := _new_share_token();
      update projects set share_token = tok where slug = ref and band = lower(b);
    end if;

  elsif kind = 'song' then
    select share_token into tok from songs
      where band = lower(b) and folder = ref and trashed_at is null;
    if not found then raise exception 'no such song in this band'; end if;
    if tok is null then
      tok := _new_share_token();
      update songs set share_token = tok
        where band = lower(b) and folder = ref and trashed_at is null;
    end if;

  elsif kind = 'band' then
    select share_token into tok from bands where slug = lower(b);
    if not found then raise exception 'no such band'; end if;
    if tok is null then
      tok := _new_share_token();
      update bands set share_token = tok where slug = lower(b);
    end if;

  else
    raise exception 'share kind must be project, song or band';
  end if;
  return tok;
end $$;

-- Clearing is the revoke. Every link handed out for that item dies at once,
-- which is the point: a public link you cannot take back is not a share, it
-- is a publication.
create or replace function clear_share(b text, p text, kind text, ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if kind = 'project' then
    update projects set share_token = null where slug = ref and band = lower(b);
  elsif kind = 'song' then
    update songs set share_token = null where band = lower(b) and folder = ref;
  elsif kind = 'band' then
    update bands set share_token = null where slug = lower(b);
  else
    raise exception 'share kind must be project, song or band';
  end if;
end $$;

-- Tells the share UI whether an item already has a public link, so the button
-- can read "copy public link" or "stop sharing" rather than guessing. Owner
-- only — knowing whether a thing is shared is itself information.
create or replace function get_share(b text, p text, kind text, ref text) returns text
language plpgsql stable security definer set search_path = public as $$
declare tok text;
begin
  perform _require_pass(b, p);
  if kind = 'project' then
    select share_token into tok from projects where slug = ref and band = lower(b);
  elsif kind = 'song' then
    select share_token into tok from songs where band = lower(b) and folder = ref;
  elsif kind = 'band' then
    select share_token into tok from bands where slug = lower(b);
  end if;
  return tok;
end $$;

-- ---------------------------------------------------------------------------
-- The one public read. No password, and it takes nothing but the token, so a
-- caller cannot ask about an item it does not already hold a link to.
--
-- It returns a 'kind' so the page knows what it is rendering, and otherwise
-- mirrors the shapes get_project / get_library / _song_json already produce.
-- That is deliberate: the client's normalize() and renderList() then need no
-- new branch, and a public album renders through exactly the code path a
-- logged-in one does.
--
-- A trashed song is not served, and a trashed version never appears, because
-- _song_json already filters them — so trashing something is also a way to
-- pull it out of a public page.
-- ---------------------------------------------------------------------------
create or replace function get_shared(tok text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr projects; sg songs; bd bands;
begin
  if coalesce(btrim(tok), '') = '' then return null; end if;

  select * into pr from projects where share_token = tok;
  if found then
    return jsonb_build_object(
      'kind', 'project',
      'slug', pr.slug, 'name', pr.name, 'band', pr.band,
      'band_title', (select coalesce(title, slug) from bands where slug = pr.band),
      'songs', coalesce((
        select jsonb_agg(_song_json(s) order by ord.i)
        from unnest(pr.songs) with ordinality ord(f, i)
        join songs s on s.band = pr.band and s.folder = ord.f
        where s.trashed_at is null), '[]'::jsonb));
  end if;

  select * into sg from songs where share_token = tok and trashed_at is null;
  if found then
    return jsonb_build_object(
      'kind', 'song',
      'band', sg.band,
      'band_title', (select coalesce(title, slug) from bands where slug = sg.band),
      'name', sg.title,
      'songs', jsonb_build_array(_song_json(sg)));
  end if;

  select * into bd from bands where share_token = tok;
  if found then
    return jsonb_build_object(
      'kind', 'band',
      'band', bd.slug,
      'band_title', coalesce(bd.title, bd.slug),
      'name', coalesce(bd.title, bd.slug),
      'songs', coalesce((
        select jsonb_agg(_song_json(s) order by s.position, s.created_at desc)
        from songs s
        where s.band = bd.slug and s.trashed_at is null
          and s.kind = 'audio'), '[]'::jsonb));
  end if;

  return null;
end $$;

notify pgrst, 'reload schema';
