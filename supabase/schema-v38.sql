-- S'notify v38 — Release Builder gets the same public/private link sharing
-- every other item on the site already has. His word: "I also want all of
-- the same link sharing abilities as the main music page with the public
-- and private links."
--
-- WHY THIS IS SMALL. set_share/clear_share/get_share already dispatch on a
-- `kind` string (project/song/version/band) — 'release' is a fifth branch
-- in the same three functions, not a new sharing system. get_shared(tok)'s
-- public read already returns a plain {kind, band, band_title, name, songs}
-- shape that music.html's ?t= handling renders through the SAME list/player
-- code no matter what kind of thing was shared (see its init(), which
-- branches on sh.kind only once, for 'version'). So a release needs no
-- player of its own: its public link opens music.html, not
-- release-builder.html, exactly the way a project's link already does.
--
-- WHY ONE MIX PER SONG. Every other public link trims each song down to its
-- starred-or-latest mix (_song_json_auto) rather than handing a stranger the
-- whole stack — see CR-19 in schema-v24.sql. A release link follows the
-- same rule for the same reason. Trashed songs are excluded, same as
-- get_releases already does for the private (band-password) view.
--
-- Function bodies below are the live definitions (pulled with
-- pg_get_functiondef and diffed against schema-v24.sql, byte-identical) with
-- one 'release' branch added to each, in the same position get_shared has
-- always added a new kind — after 'version', before the final fallthrough.

alter table releases add column if not exists share_token text;
create unique index if not exists releases_share_token
  on releases (share_token) where share_token is not null;

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

  elsif kind = 'release' then
    select share_token into tok from releases where id = ref::uuid and band = lower(b);
    if not found then raise exception 'no such release in this band'; end if;
    if tok is null then
      tok := _new_share_token();
      update releases set share_token = tok where id = ref::uuid and band = lower(b);
    end if;

  else
    raise exception 'share kind must be project, song, version, band or release';
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
  elsif kind = 'release' then
    update releases set share_token = null where id = ref::uuid and band = lower(b);
  else
    raise exception 'share kind must be project, song, version, band or release';
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
  elsif kind = 'release' then
    select share_token into tok from releases where id = ref::uuid and band = lower(b);
  end if;
  return tok;
end $$;

create or replace function get_shared(tok text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr projects; sg songs; bd bands; vr versions; rl releases;
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

  -- A release: its own row, not a song's. Ordered by release_songs.position —
  -- the same order the builder shows and reorders — one auto-picked mix per
  -- song, trashed songs dropped silently rather than breaking the link.
  select * into rl from releases where share_token = tok;
  if found then
    return jsonb_build_object(
      'kind', 'release',
      'band', rl.band,
      'band_title', (select coalesce(title, slug) from bands where slug = rl.band),
      'name', rl.title,
      'songs', coalesce((
        select jsonb_agg(_song_json_auto(s) order by rs.position)
        from release_songs rs join songs s on s.id = rs.song_id
        where rs.release_id = rl.id and s.trashed_at is null), '[]'::jsonb));
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
