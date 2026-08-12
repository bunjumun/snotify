-- S'music v18 — the game plays the top of the stack, always.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent; additive over v3–v17.
--
-- game/music.json pins a filename, which means the game plays whichever mix was
-- newest on the day that file was written. Ship a better mix and the game keeps
-- playing the old one until someone remembers to edit a JSON file by hand. That
-- is a bug with a long fuse, and it has already gone off once.
--
-- This is the fix: one public, password-free function that returns the CURRENT
-- top version of each song the band has put in the game. Upload a new mix and
-- the game is playing it on the next page load, with nothing to remember.
--
-- Opt-in is per SONG, not per version, and that split is the whole safety story.
-- The band decides once which songs are in the game; after that every new mix of
-- those songs goes public the moment it's uploaded. A function that served the
-- newest version of *everything* would publish the entire unreleased library,
-- because the key that calls it ships inside a public web page.
--
-- What this exposes, for flagged songs only: title, version name, storage path.
-- No changelog, no comments, no other versions, no way to list the library.
--
-- Nothing breaks if this is never applied. game_tracks() simply won't exist, the
-- game gets a 404, and it falls back to the static list in game/music.json —
-- see loadMusic() in game/src/audio/AudioDirector.js.

alter table songs add column if not exists game_ok boolean not null default false;

create index if not exists songs_game on songs (band)
  where game_ok and trashed_at is null;

-- ---------------------------------------------------------------------------
-- game_tracks — the running order, live.
--
-- Deliberately NOT password-gated: the game is a public page and cannot hold a
-- band password without handing it to anyone who views source. The flag is what
-- keeps it safe, not a secret.
--
-- Version ordering matches _song_json exactly (position, then newest first), so
-- "what the game plays" and "what's at the top of the stack on the music page"
-- can never disagree. Song ordering matches the library too — reorder the
-- library and you have reordered the record.
-- ---------------------------------------------------------------------------
create or replace function game_tracks(b text default 'lakehorse')
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.t order by x.pos, x.created_at desc), '[]'::jsonb)
  from (
    select s.position as pos,
           s.created_at,
           jsonb_build_object(
             'title',   coalesce(nullif(s.title, ''), s.folder),
             'version', v.name,
             'src',     v.src) as t
    from songs s
    cross join lateral (
      select vv.name, vv.src
      from versions vv
      where vv.song_id = s.id and vv.trashed_at is null
      order by vv.position, vv.created_at desc
      limit 1
    ) v
    where s.band = lower(b)
      and s.kind = 'audio'
      and s.game_ok
      and s.trashed_at is null
  ) x
$$;

revoke all on function game_tracks(text) from public;
grant execute on function game_tracks(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Putting songs in the game.
--
-- Look before you flag — folder and title are not the same string, and one of
-- these is called "Currency (No Main Vox)":
--
--   select folder, title, position from songs
--   where band = 'lakehorse' and kind = 'audio' and trashed_at is null
--   order by position;
--
-- Then flag by folder, which is the stable key:
--
--   update songs set game_ok = true
--   where band = 'lakehorse'
--     and folder in ('Mango Tree World', 'Jupiter Gold', 'Currency (No Main Vox)');
--
-- Take one back out at any time:
--
--   update songs set game_ok = false where band = 'lakehorse' and folder = 'Currency (No Main Vox)';
--
-- And confirm exactly what the game will stream, before anyone plays it:
--
--   select jsonb_pretty(game_tracks('lakehorse'));
-- ---------------------------------------------------------------------------
