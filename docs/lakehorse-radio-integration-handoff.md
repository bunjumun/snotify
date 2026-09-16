# Lakehorse Radio release-selection — integration handoff

Written 2026-09-16. Scoped to one thing: getting CR-120's release-radio
feature (commit `b1dafb3` on branch `lakehorse-radio`) actually live on
Sn'Album and the band site. The code is written, tested and already flashed
to the physical box where that's possible — two steps outside this session's
reach are what's left.

## What this feature is

Release Builder gets a 📻 checkbox per release ("On Lakehorse Radio"), any
number at once, completely independent of the swim game's per-mix `game_ok`
flag. Ticked releases' tracks — with cover art — are what the jukebox's
"Load the band library" button in `flasher.html` pulls and pushes to the box.
The box's player now also shows that art and paints itself with the same
dazzle-camo generator the rest of the site uses.

Full design reasoning is in the session that built this; the short version is
in the commit message for `b1dafb3`.

## Why it isn't live yet — two blockers, both outside this session

**1. `supabase/schema-v40.sql` has never run.** This session had no Supabase
MCP tool available at all — not connected, not even in the deferred tool
list — so the migration could only be written, not applied. Until it runs:

- `release-builder.html`'s new checkbox will error (no `releases.on_radio`
  column, no `set_release_radio` RPC).
- `flasher.html`'s "Load the band library" will error (no `radio_tracks`
  RPC).

**Fix:** open the Supabase SQL editor for project `twgukeyoayfqldnojrkg` and
run `supabase/schema-v40.sql` verbatim. It is additive and idempotent — safe
to run even if partially applied already. After running, verify with:

```sql
select column_name from information_schema.columns
  where table_name = 'releases' and column_name = 'on_radio';
select proname from pg_proc
  where proname in ('set_release_radio', 'radio_tracks');
select radio_tracks();  -- should return [] until a release is ticked
```

Or, in a future session, reconnect the Supabase MCP connector (`/mcp` or the
connector settings) and a session can run `apply_migration` directly, the way
`CLAUDE.md` describes — that path just wasn't available this time.

**2. Three commits are local-only, not pushed.** `gh auth login` was never
run in this environment and the git remote has no stored credentials:

```
$ git push -u origin lakehorse-radio
fatal: could not read Username for 'https://github.com': Device not configured
```

**Fix:** run `gh auth login` in an interactive terminal (or otherwise
authenticate `origin`, which is `https://github.com/bunjumun/snotify.git`),
then either push the branch for review or merge it — a future Claude session
can do the actual `git push` once auth exists, per this repo's own "the push
is Claude's" rule; it just couldn't authenticate itself into existence here.

Commits waiting, in order: `d82f27a`, `8a204ea`, `b1dafb3`. The first two are
the earlier CR-120 Wi-Fi fix (already verified on hardware, see
`lakehorse-radio/HANDOFF.md`); `b1dafb3` is this feature.

## What's already done and verified

- Schema migration written: `supabase/schema-v40.sql`.
- `release-builder.html`: checkbox + grid badge, wired to `set_release_radio`,
  reads `on_radio` back from `get_releases`.
- `flasher.html`: `loadLibrary()` calls `radio_tracks` instead of
  `game_tracks`, carries `cover` through into the pushed playlist.
- `lakehorse-radio/data/`: `dazzle.js` (new, self-contained generator copy),
  `app.js` renders track art with a graceful placeholder fallback, `style.css`
  wires up the dazzle background and art thumbnail.
- No firmware C++ changed — `playlist_validate.cpp` only checks `title`/`url`
  and `playlist_store.cpp` writes the raw JSON through untouched, confirmed by
  reading both, so the new `cover` field needed no validator change.
- Build clean (`pio run -e radio -t buildfs`), native tests 19/19
  (`pio test -e native`).
- **The physical box is already running the new player** — reflashed this
  session, confirmed serving `dazzle.js` and the updated `index.html` over
  HTTP. Track art and the dazzle background will render as soon as a
  playlist with `cover` fields is pushed to it; nothing more to flash for
  that part.

## Verification, once both blockers are cleared

1. Run the migration, confirm with the three queries above.
2. In Release Builder, open a release with tracks that have cover art, tick
   "📻 On Lakehorse Radio", confirm the grid badge lights up.
3. In `flasher.html`, "Load the band library" → should list exactly that
   release's tracks (via `radio_tracks`, not `game_tracks`) → "Push playlist".
4. On the box (already flashed): refresh the player, confirm the pushed
   tracks appear with cover art, and the dazzle background is visible.
5. Untick the release, reload the library in the flasher, confirm the list
   goes back to empty (or to whatever else is still ticked).
6. Push the branch, confirmed live per the repo's own "confirm on the live
   site rather than believing git" rule.
