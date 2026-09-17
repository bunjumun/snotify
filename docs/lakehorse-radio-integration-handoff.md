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

## Update, 2026-09-17 — one blocker cleared, one correction, one open question

Written by a different session (the XR18 measurement bench one, reached by
mistake when the Snalbum session went looking for whichever machine held
these commits). Appended rather than edited in above, so the original
session's account stays intact.

**Blocker 1 is cleared.** `supabase/schema-v40.sql` has been applied and
verified live against `twgukeyoayfqldnojrkg` — migration `20260917054649`,
confirmed present: `releases.on_radio`, `set_release_radio`, `radio_tracks`
(anon execute, public revoked, matching `game_tracks`'s posture),
`versions.game_ok` untouched at 4 rows. The live `get_releases` body was
diffed against this file's version and matched character-for-character
except the added `on_radio` key. **Do not run the migration again.** It is
additive and idempotent so a second run would be harmless, but it is
unnecessary.

**Commit count was wrong.** Seven commits sit on this branch ahead of
`origin/main`, not the three listed above. `merge-base(origin/main,
lakehorse-radio)` is `c126511`, exactly `origin/main`'s tip — a clean
fast-forward, zero divergence, no merge care needed. Full list, oldest
first: `f8a0107`, `8cc9b46`, `801f4b8`, `d82f27a`, `8a204ea`, `b1dafb3`,
`2de64d5`.

**Blocker 2 is still open.** The branch is still not on `origin`. A push
attempt from a differently-scoped session (the XR18 bench one) was refused
by its own permission classifier as out-of-place for that session's task —
not a credentials failure, it never reached the network. The push was
handed off to the session that actually owns this repo's ESP32 work, but
the handoff message expired waiting on approval and was never delivered.
**Still needs `git push -u origin lakehorse-radio` from a session working in
this repo, or by hand.**

**A real gap, found while answering an unrelated question, and corrected
once already — read the correction, not just the finding.** Two things
fetch a jukebox track list, and only one was switched:

```
flasher.html:221        fetch(.../rpc/radio_tracks, ...)      -- correct
lakehorse-radio/data/app.js:160  fetch(.../rpc/game_tracks, ...)  -- not switched
```

`app.js`'s "refresh from library" button — the box's own player page, run
on a visitor's phone — still calls `game_tracks`. `git show --stat
b1dafb3` shows `app.js` was touched only for cover art and CSS; the commit
message itself says only `flasher.html` was switched. Reads as an
oversight rather than a decision, but that is inference.

**What this is NOT, corrected after an initial overstatement:** it does
not touch the box's stored playlist. `refreshFromLibrary()` in `app.js`
sets its own in-memory `tracks` array (`tracks = fresh;`) and nothing
else — there is no `fetch('/api/playlist', {method: 'POST', ...})`
anywhere in the file, and it never sends the `X-Lakehorse-Key` header the
box requires to accept a playlist write, so it could not persist a change
even if it tried. Pressing the button shows the *game's* list to that one
phone for that one session; reloading the page restores the pushed radio
playlist. Wrong list on one screen, not data loss.

This has been logged as a decision for him rather than fixed silently —
leave it alone unless he says otherwise. If he does want it switched, it
is a one-line change: `game_tracks` → `radio_tracks` at `app.js:160`,
mirroring what `flasher.html:221` already does.

**Knock-on for step 4 of the verification list above:** load the box's
page and do *not* press refresh, or you are looking at the game's list
rather than testing the pushed radio playlist. Reload restores it either
way.
