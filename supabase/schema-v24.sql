-- S'notify v24 - a mix gets an address of its own, and a public link stops
-- handing out the whole stack.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent; additive over v3-v23.
--
-- ASCII ONLY, deliberately, and please keep it that way. The dashboard is
-- driven through the browser and the file gets there via the clipboard, which
-- hands macOS pasteboard text to the page as MacRoman: every em dash, arrow and
-- emoji arrives as mojibake and the whole buffer stops matching the file. It is
-- caught by hashing the editor against the file before pressing Run, but the
-- cheaper fix is to give it nothing to mangle.
--
-- Three requests, one migration, because they all land in the same two
-- functions and shipping them apart would mean rewriting get_shared twice.
--
-- CR-18 - A SINGLE MIX GETS ITS OWN TOKEN.
--   v23 gave a token to an album, a song and the library, and left the single
--   mix on the link it already had: ?b=<band>&s=<song>&v=<mix name>. v23 argued
--   at length that a token beats a slug because an unshared thing should have
--   no public address at all, and then the one item that predated the argument
--   kept its guessable one. Three short names, all enumerable by anyone who has
--   seen a single link, is exactly the case that argument was against.
--
--   It also fixes something the UI had to apologise for. Because ?b&s&v does
--   not gate, the "band link" option for a mix could not point AT the mix - it
--   dropped the version and opened the song, so a bandmate landed on whatever
--   sits on top of the stack rather than on the mix that was sent. With an
--   address of its own the mix can be shared as itself either way.
--
--   ?b&s&v keeps working, served by get_shared_version, and is not deprecated
--   here. Links already sent must not die for a change nobody asked them about.
--
-- CR-19 - A PUBLIC LINK CARRIES ONE MIX PER SONG.
--   His words: "I'd like a public link to the entire album to only send the
--   latest or most starred mix (if there is one). use upload date as a tie
--   breaker if needed." The rule, in order: most stars wins; on a tie, or with
--   no stars anywhere, the one the stack calls LATEST; if that ties too, newest
--   by upload date.
--
--   "Latest" is read as STACK POSITION and not as the upload clock, and that is
--   a decision. Position is his - the player's LATEST badge sits on whatever he
--   dragged to the top, and reading "latest" off created_at would quietly
--   disagree with the word on his own screen. Upload date stays where he put
--   it, as the tie-break.
--
--   The trim is here and not in the page. A payload that carries every mix has
--   already handed out every audio URL; a client-side filter hides them from
--   the interface and from nobody else.
--
--   Applied to a public song and a public library link too, not only an album.
--   Otherwise the link on a song hands out the whole stack while the link on the
--   album next to it does not, which is the same inconsistency CR-16 was about.
--   A logged-in bandmate is unaffected: get_library and get_project still carry
--   everything, because the trim is about strangers, not about mixes.
--
-- CR-20/21 - THE HAND-PICKED SHARE TOOL grows per-song choices and a picture.
--   projects.picks says, per song, which mixes travel; projects.cover is a
--   thumbnail. Both nullable, and a project with neither behaves exactly as it
--   did, which is what keeps every ?p= link ever sent working.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table versions add column if not exists share_token text;

-- Partial unique index, same shape as v23's three: many rows sit at null (the
-- normal, unshared state) while a live token is unique across the table.
create unique index if not exists versions_share_token
  on versions (share_token) where share_token is not null;

-- picks: ordered, one entry per song in the project.
--   [{"folder":"currency","mode":"auto"},
--    {"folder":"snowmelt","mode":"all"},
--    {"folder":"tomorrow","mode":"pick","versions":["<version uuid>", ...]}]
-- null means "no configuration", which is every project made before today, and
-- those keep resolving through projects.songs exactly as they always have.
-- songs[] is still written alongside picks rather than replaced by it: it is
-- what get_project_meta and the older read paths walk, and a jsonb column is a
-- poor thing to put a foreign key's worth of ordering in twice.
alter table projects add column if not exists picks jsonb;

-- Bucket path or absolute URL, the same shape songs.cover has carried since v3,
-- so publicUrl() in core.js needs no new branch to render it.
alter table projects add column if not exists cover text;

-- ---------------------------------------------------------------------------
-- The automatic pick (CR-19)
-- ---------------------------------------------------------------------------
-- Stars are counted, not summed from a cached tally, because version_stars is
-- one row per person per mix and there is no counter column to drift out of
-- step with it. The ordering after the star count mirrors _song_json's own
-- (position, then created_at desc) so "first by the stack's order" means the
-- same thing here as it does everywhere else on the page.
--
-- Returns null for a song with no live versions, and every caller treats that
-- as "no mixes travel", not as an error: a song whose whole stack is in the
-- trash should appear empty rather than break the album around it.
create or replace function _auto_version(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select v.id
  from versions v
  where v.song_id = sid and v.trashed_at is null
  order by (select count(*) from version_stars st where st.version_id = v.id) desc,
           v.position, v.created_at desc
  limit 1
$$;

-- _song_json, with a filter on which versions travel.
--
-- vids null  -> every live version, byte for byte what _song_json returns
-- vids array -> only those, in the stack's own order, and unknown ids are simply
--              absent rather than an error (a mix trashed after a link was
--              configured must not break the link)
--
-- The shape is _song_json's exactly, including the star names and the peaks,
-- because the client's normalize() and renderList() then need no new branch: a
-- public album renders through the code path a logged-in one does. Nothing is
-- added to it, share_token least of all - whether a mix has a public link is
-- the owner's business and reaches the page through get_share, which takes a
-- password.
create or replace function _song_json_sel(s songs, vids uuid[]) returns jsonb
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
      from versions v
      where v.song_id = s.id and v.trashed_at is null
        and (vids is null or v.id = any(vids))), '[]'::jsonb))
$$;

-- One song as a stranger sees it: the automatic pick, and nothing else.
create or replace function _song_json_auto(s songs) returns jsonb
language sql stable security definer set search_path = public as $$
  select _song_json_sel(s, array_remove(array[_auto_version(s.id)], null))
$$;

-- Which version ids a project's picks say should travel for one song, or null
-- for "all of them". Split out because get_project and get_shared both need it
-- and neither should be the place the format is understood.
create or replace function _project_vids(pk jsonb, fold text, sid uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when pk is null then null
    else (
      select case e->>'mode'
        when 'all'  then null::uuid[]
        when 'pick' then coalesce(
          (select array_agg(t.v::uuid)
             from jsonb_array_elements_text(e->'versions') as t(v)), '{}'::uuid[])
        -- 'auto', and the default for anything unrecognised. array_remove with
        -- NULL is the documented way to drop a null element (IS NOT DISTINCT
        -- FROM semantics), and it is what turns "this song has no live mixes"
        -- into an empty selection rather than array[null], which would match
        -- nothing and read as a bug.
        else array_remove(array[_auto_version(sid)], null)
      end
      from jsonb_array_elements(pk) e
      where e->>'folder' = fold
      limit 1)
  end
$$;

-- ---------------------------------------------------------------------------
-- Minting, revoking and reading a token - now for a mix as well (CR-18)
-- ---------------------------------------------------------------------------
-- kind='version' takes the version's uuid as its ref rather than a name. A name
-- is not unique across a band, and the client has the id in hand at every call
-- site because _song_json has carried it since v15.
--
-- Idempotent in the same way v23's are: asking twice returns the SAME token, so
-- pressing "copy public link" again cannot quietly break a link already sent.
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

  elsif kind = 'version' then
    -- The join to songs is the band scope: a right password for one band must
    -- not mint a link to another band's mix.
    select v.share_token into tok
      from versions v join songs s on s.id = v.song_id
      where v.id = ref::uuid and s.band = lower(b)
        and v.trashed_at is null and s.trashed_at is null;
    if not found then raise exception 'no such mix in this band'; end if;
    if tok is null then
      tok := _new_share_token();
      update versions set share_token = tok where id = ref::uuid;
    end if;

  elsif kind = 'band' then
    select share_token into tok from bands where slug = lower(b);
    if not found then raise exception 'no such band'; end if;
    if tok is null then
      tok := _new_share_token();
      update bands set share_token = tok where slug = lower(b);
    end if;

  else
    raise exception 'share kind must be project, song, version or band';
  end if;
  return tok;
end $$;

create or replace function clear_share(b text, p text, kind text, ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if kind = 'project' then
    update projects set share_token = null where slug = ref and band = lower(b);
  elsif kind = 'song' then
    update songs set share_token = null where band = lower(b) and folder = ref;
  elsif kind = 'version' then
    update versions set share_token = null where id = ref::uuid
      and song_id in (select id from songs where band = lower(b));
  elsif kind = 'band' then
    update bands set share_token = null where slug = lower(b);
  else
    raise exception 'share kind must be project, song, version or band';
  end if;
end $$;

create or replace function get_share(b text, p text, kind text, ref text) returns text
language plpgsql stable security definer set search_path = public as $$
declare tok text;
begin
  perform _require_pass(b, p);
  if kind = 'project' then
    select share_token into tok from projects where slug = ref and band = lower(b);
  elsif kind = 'song' then
    select share_token into tok from songs where band = lower(b) and folder = ref;
  elsif kind = 'version' then
    select v.share_token into tok from versions v join songs s on s.id = v.song_id
      where v.id = ref::uuid and s.band = lower(b);
  elsif kind = 'band' then
    select share_token into tok from bands where slug = lower(b);
  end if;
  return tok;
end $$;

-- ---------------------------------------------------------------------------
-- The one public read, rewritten (CR-18 + CR-19)
-- ---------------------------------------------------------------------------
-- Still no password, still nothing but the token, so a caller cannot ask about
-- an item it does not already hold a link to. What changed:
--
--   - a fourth branch, 'version', for a single mix
--   - album, song and library now carry ONE mix per song, chosen by
--     _auto_version, unless the album's picks say otherwise
--   - the album branch honours picks, so a hand-configured link sends exactly
--     what was configured and the automatic rule never overrides a choice
--
-- Comments stay private in every case; no payload here carries them.
-- A trashed song is not served and a trashed version never appears, so trashing
-- something is still a way to pull it out of a public page.
create or replace function get_shared(tok text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr projects; sg songs; bd bands; vr versions;
begin
  if coalesce(btrim(tok), '') = '' then return null; end if;

  select * into pr from projects where share_token = tok;
  if found then
    return jsonb_build_object(
      'kind', 'project',
      'slug', pr.slug, 'name', pr.name, 'band', pr.band, 'cover', pr.cover,
      'band_title', (select coalesce(title, slug) from bands where slug = pr.band),
      'songs', coalesce((
        select jsonb_agg(_song_json_sel(s, coalesce(_project_vids(pr.picks, s.folder, s.id),
                                                    case when pr.picks is null
                                                      then array_remove(array[_auto_version(s.id)], null)
                                                      else null end))
                         order by ord.i)
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
      'songs', jsonb_build_array(_song_json_auto(sg)));
  end if;

  -- A mix on its own. The song is still the wrapper, because the client renders
  -- a song with a stack of one and needs no new shape for this.
  select * into vr from versions where share_token = tok and trashed_at is null;
  if found then
    select * into sg from songs where id = vr.song_id and trashed_at is null;
    if not found then return null; end if;
    return jsonb_build_object(
      'kind', 'version',
      'band', sg.band,
      'band_title', (select coalesce(title, slug) from bands where slug = sg.band),
      'name', sg.title,
      'songs', jsonb_build_array(_song_json_sel(sg, array[vr.id])));
  end if;

  select * into bd from bands where share_token = tok;
  if found then
    return jsonb_build_object(
      'kind', 'band',
      'band', bd.slug,
      'band_title', coalesce(bd.title, bd.slug),
      'name', coalesce(bd.title, bd.slug),
      'songs', coalesce((
        select jsonb_agg(_song_json_auto(s) order by s.position, s.created_at desc)
        from songs s
        where s.band = bd.slug and s.trashed_at is null
          and s.kind = 'audio'), '[]'::jsonb));
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- The gated album read, honouring picks (CR-20)
-- ---------------------------------------------------------------------------
-- A bandmate opening a hand-configured link sees what was configured, not the
-- whole stack. That is not a privacy rule - it is what "share these three mixes"
-- means, and it would be strange for the same link to say different things
-- depending on who opened it. The password still decides WHETHER you may see it.
--
-- Projects with no picks are untouched: every version, exactly as before.
create or replace function get_project(proj text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr projects;
begin
  select * into pr from projects where projects.slug = proj;
  if not found then return null; end if;
  perform _require_pass(pr.band, p);
  return jsonb_build_object(
    'slug', pr.slug, 'name', pr.name, 'band', pr.band, 'cover', pr.cover,
    'band_title', (select coalesce(title, slug) from bands where slug = pr.band),
    'picks', pr.picks,
    'songs', coalesce((
      select jsonb_agg(_song_json_sel(s, _project_vids(pr.picks, s.folder, s.id))
                       order by ord.i)
      from unnest(pr.songs) with ordinality ord(f, i)
      join songs s on s.band = pr.band and s.folder = ord.f
      where s.trashed_at is null), '[]'::jsonb));
end $$;

-- Meta gains the cover so the gate itself can wear the picture rather than
-- making a visitor log in to find out what they were sent.
create or replace function get_project_meta(proj text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', pr.slug, 'name', pr.name, 'band', pr.band,
                            'cover', pr.cover,
                            'band_title', coalesce(bd.title, bd.slug))
  from projects pr join bands bd on bd.slug = pr.band
  where pr.slug = proj
$$;

-- ---------------------------------------------------------------------------
-- Writing a project, with picks and a cover (CR-20 + CR-21)
-- ---------------------------------------------------------------------------
-- The old five-argument form is dropped and replaced rather than overloaded:
-- two functions of the same name, one with defaults, is ambiguous to resolve
-- and PostgREST would pick by argument names in a way that is not worth
-- reasoning about. The new arguments default to null, so a cached older page
-- calling with five arguments still resolves and still works - it simply
-- writes no picks and no cover.
--
-- coalesce on update, not assignment: passing null for cover means "leave it
-- alone", which is what an edit that only reorders songs wants. Clearing a
-- cover is clear_project_cover below, so that "unset it" reads as the
-- deliberate act it is rather than as an omission.
drop function if exists upsert_project(text, text, text, text, text[]);
create or replace function upsert_project(b text, p text, proj text,
                                          proj_name text, folders text[],
                                          picks jsonb default null,
                                          cover text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  insert into projects (slug, band, name, songs, picks, cover)
    values (proj, lower(b), proj_name, folders, picks, cover)
    on conflict (slug) do update set
      name  = excluded.name,
      songs = excluded.songs,
      picks = coalesce(excluded.picks, projects.picks),
      cover = coalesce(excluded.cover, projects.cover)
    where projects.band = lower(b);
end $$;

create or replace function clear_project_cover(b text, p text, proj text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update projects set cover = null where slug = proj and band = lower(b);
end $$;

notify pgrst, 'reload schema';
