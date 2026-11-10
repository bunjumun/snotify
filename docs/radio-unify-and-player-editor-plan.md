# Plans held at the ceiling (2026-11-10)

Neither is built. Each needs something the loop may not do alone (the M4 machine, or a new page plus a new database surface).

## 1. Unify Lakehorse Radio builds (CR-120 follow-up)

Facts: schema v40 and the Release Builder radio toggle are live. The M4 Mac mini holds 7 commits on its `lakehorse-radio` branch (path `/Volumes/STUDIOBUNJ/studiobunj/claude m4/esp music v1`, not mounted here). Commit `b1dafb3` there is a second copy of the toggle. The box's refresh button calls `game_tracks` instead of `radio_tracks`.

Steps, in order:
1. On the M4 (his hands or a session run there): `git log --oneline` the 7 commits, push the branch to a new remote branch `lakehorse-radio` (no force, nothing deleted).
2. Here: diff that branch against main. Keep this repo's toggle, drop `b1dafb3`'s copy (same RPC contract).
3. Change the box page's refresh to `radio_tracks`.
4. Write the ownership rule into both CLAUDE.md files: this repo owns database + Release Builder; the M4 project owns only the box player and flasher, reaching data through `radio_tracks` (radio) and `game_tracks` (game).
Stop-and-ask: any force push or branch delete. Needs from him: the M4 session, or the branch pushed.

## 2. Interactive music player editor

Ask: a new box on the Interactive music players hub ("interactive music player editor"). First step picks which player to edit, then shows that player's settings with save and revert.
Why held: it is a new page and needs a store for settings (a table or `site_text` keys) plus an admin gate.
Proposal: one page `interactive-music-players/editor/`, band-password gate (as the Jupiter Gold timeline admin). Player list is a registry in the page (Jupiter Gold, This Is War, Swimulator). Settings: reuse the `site_text` key/value RPC (`jg.tl.*` pattern, no schema change); each player reads its overrides on load; Revert = delete keys, Save = set keys. First version edits only what Jupiter Gold's timeline admin already edits (so the existing admin moves into it), and the Swimulator gets nothing until he says which of its tunables he wants editable.
Questions for him: which settings per player, and does the editor replace the in-player "admin" button.
