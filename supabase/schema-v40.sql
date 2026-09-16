-- S'notify v40 — a release-level flag for Lakehorse Radio (CR-120 follow-up).
--
-- The jukebox has, until now, played whatever the swim game plays: both read
-- versions.game_ok (schema-v20), one ticked mix per song. His word: this
-- should be its own thing, chosen at the RELEASE level — tick a release in
-- the builder, its songs go to the radio — and it should not share state
-- with the game at all. Multiple releases can be ticked at once; there is no
-- "only one" constraint the way a song's game_ok mix has one.
--
-- Additive: game_ok, game_tracks, game_flags and set_version_game_ok are
-- completely untouched. The radio is a second, independent reader of the
-- same songs/versions tables, the same shape release_songs already gives it.

alter table releases add column if not exists on_radio boolean not null default false;

-- ---------------------------------------------------------------------------
-- get_releases restated to carry the flag. Verbatim from v37 apart from the
-- one added key — same reasoning as _song_json_sel in v31: there is no way to
-- add a key to a function body in place, so the shape the builder reads is
-- defined here in full or not at all.
-- ---------------------------------------------------------------------------
create or replace function get_releases(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'on_radio', r.on_radio,
        'songs', coalesce((
          select jsonb_agg(s.folder order by rs.position)
          from release_songs rs join songs s on s.id = rs.song_id
          where rs.release_id = r.id and s.trashed_at is null), '[]'::jsonb))
      order by r.position, r.created_at)
    from releases r where r.band = lower(b)), '[]'::jsonb);
end $$;

-- The checkbox. No "only one" enforcement — unlike set_version_game_ok, any
-- number of releases can be on the radio together.
create or replace function set_release_radio(b text, p text, rid uuid, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update releases set on_radio = on_ where id = rid and band = lower(b);
  if not found then raise exception 'release not found'; end if;
end $$;

revoke all on function set_release_radio(text, text, uuid, boolean) from public;
grant execute on function set_release_radio(text, text, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- radio_tracks — what the jukebox actually fetches. Public, no password, same
-- posture as game_tracks and for the same reason: the box that calls this has
-- no login of its own. Auto-picked mix per song (_auto_version — starred or
-- latest, the same rule every other public read uses), plus cover art, which
-- game_tracks has never needed to carry.
--
-- distinct on (s.id): a song can sit in more than one radio-flagged release
-- (releases are "aliases of the one master song" — schema-v37), so this keeps
-- its first appearance by release/track order rather than listing it twice.
-- ---------------------------------------------------------------------------
create or replace function radio_tracks(b text default 'lakehorse')
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t.row order by t.rpos, t.spos), '[]'::jsonb)
  from (
    select distinct on (s.id)
      jsonb_build_object(
        'title',  coalesce(nullif(s.title, ''), s.folder),
        'artist', s.artist,
        'src',    v.src,
        'cover',  s.cover) as row,
      r.position as rpos, rs.position as spos
    from releases r
    join release_songs rs on rs.release_id = r.id
    join songs s on s.id = rs.song_id and s.trashed_at is null
    join versions v on v.id = _auto_version(s.id)
    where r.band = lower(b) and r.on_radio
    order by s.id, r.position, rs.position
  ) t
$$;

revoke all on function radio_tracks(text) from public;
grant execute on function radio_tracks(text) to anon, authenticated;

notify pgrst, 'reload schema';
