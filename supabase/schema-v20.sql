-- S'music v20 — the game flag moves from the song to the MIX.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent; additive over v3–v19.
--
-- v18 put the flag on the song, so the game always played whatever was at the
-- top of that song's stack. The upside was that a new mix went into the game the
-- moment it was uploaded, with nothing to remember. The downside is the one that
-- actually bit: the top of the stack is wherever the band last dragged it, so
-- the game ended up playing a version called "vocal mute idea" — an experiment,
-- published to the public game, because it happened to be on top.
--
-- So the flag moves to the version. A mix is in the game because someone ticked
-- that mix. Nothing is published by accident, and nothing changes under you when
-- you reorder a stack.
--
-- ONE ticked mix per song, enforced by a unique index and by the setter, which
-- clears the others first. The checkbox therefore behaves like a radio button
-- within a stack: ticking a new mix is how you swap which one the game plays,
-- and the running order can never contain the same song twice.
--
-- The existing state is carried over rather than reset: every song currently
-- flagged has its top version ticked, which is exactly what the game is playing
-- today. Applying this does not change a note.

alter table versions add column if not exists game_ok boolean not null default false;

create unique index if not exists versions_one_game_ok
  on versions (song_id) where game_ok and trashed_at is null;

-- ---------------------------------------------------------------------------
-- Carry v18's song-level flags over to the mix that is playing right now, so
-- the running order survives the migration untouched. Runs once — after this
-- the partial index makes a second run a no-op.
-- ---------------------------------------------------------------------------
update versions v set game_ok = true
where v.id in (
  select distinct on (s.id) vv.id
  from songs s
  join versions vv on vv.song_id = s.id and vv.trashed_at is null
  where s.game_ok and s.trashed_at is null and s.kind = 'audio'
  order by s.id, vv.position, vv.created_at desc
)
and not exists (
  select 1 from versions o
  where o.song_id = v.song_id and o.game_ok and o.trashed_at is null
);

-- ---------------------------------------------------------------------------
-- game_tracks — the running order, live. Public, no password: see v18 for why.
--
-- Reads the ticked MIX now rather than the top of a flagged song's stack. Song
-- order still follows the library, so reordering the library reorders the
-- record; reordering a stack no longer changes anything the game plays.
-- ---------------------------------------------------------------------------
create or replace function game_tracks(b text default 'lakehorse')
returns jsonb
language sql stable security definer set search_path = public as $BODY$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title',   coalesce(nullif(s.title, ''), s.folder),
             'version', v.name,
             'src',     v.src)
           order by s.position, s.created_at desc), '[]'::jsonb)
  from songs s
  join versions v on v.song_id = s.id
  where s.band = lower(b)
    and s.kind = 'audio'
    and s.trashed_at is null
    and v.game_ok
    and v.trashed_at is null
$BODY$;

revoke all on function game_tracks(text) from public;
grant execute on function game_tracks(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- game_flags — which mixes are ticked, for drawing the checkboxes.
-- Band-gated: what's in the game is public, but the shape of the library is not.
-- ---------------------------------------------------------------------------
create or replace function game_flags(b text, p text)
returns jsonb
language plpgsql security definer set search_path = public as $BODY$
declare out_json jsonb;
begin
  perform _require_pass(b, p);
  select coalesce(jsonb_agg(v.id), '[]'::jsonb) into out_json
  from songs s
  join versions v on v.song_id = s.id
  where s.band = lower(b) and s.trashed_at is null
    and v.game_ok and v.trashed_at is null;
  return out_json;
end $BODY$;

-- ---------------------------------------------------------------------------
-- The checkbox. Ticking one mix unticks the others in its stack, so the index
-- can't be tripped and the running order can't grow a duplicate.
-- ---------------------------------------------------------------------------
create or replace function set_version_game_ok(b text, p text, vid uuid, on_ boolean)
returns boolean
language plpgsql security definer set search_path = public as $BODY$
declare sid uuid;
begin
  perform _require_pass(b, p);
  select v.song_id into sid
    from versions v join songs s on s.id = v.song_id
   where v.id = vid and s.band = lower(b) and s.trashed_at is null;
  if sid is null then
    raise exception using errcode = '42501', message = 'mix not in this band';
  end if;

  if on_ then
    update versions set game_ok = false where song_id = sid and game_ok;
    update versions set game_ok = true  where id = vid;
    -- Keep the song-level flag from v18 in step, so anything still reading it
    -- agrees with what the game is actually playing.
    update songs set game_ok = true where id = sid;
  else
    update versions set game_ok = false where id = vid;
    update songs set game_ok = exists (
      select 1 from versions where song_id = sid and game_ok and trashed_at is null
    ) where id = sid;
  end if;

  return on_;
end $BODY$;

revoke all on function game_flags(text, text)                            from public;
revoke all on function set_version_game_ok(text, text, uuid, boolean)    from public;
grant execute on function game_flags(text, text)                         to anon, authenticated;
grant execute on function set_version_game_ok(text, text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
