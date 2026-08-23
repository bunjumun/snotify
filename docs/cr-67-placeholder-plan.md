# CR-67 — placeholder songs: build plan

Not built. Written 23 Aug, manager pass, after his "Go" in the OUTBOX table.
Sized rather than coded because it crosses the session ceiling: a schema
migration (the `songs.kind` check constraint) plus a real double-digit list
of client touch-points that currently assume every song has at least one
version. Read the code before starting, this plan is the map, not a
substitute.

## What he asked for (his words, redesigned mid-thread from the original ask)

> Maybe instead of adding a new song without file attached I can have the
> option to add a 'placeholder' which will be a song title in the stack
> without the play functions. This is a new class, different than songs.
> For now the placeholder will appear only as a song title in the stack
> with a grey flat wave bar. Placeholders do not have comments or other
> advanced features that songs have.

Answered since: a placeholder converts to a regular song once a file is
attached.

## Schema

`songs.kind` has a check constraint: `kind = ANY (ARRAY['audio','art'])`.
Widen it to include `'placeholder'`:

```sql
ALTER TABLE public.songs DROP CONSTRAINT songs_kind_check;
ALTER TABLE public.songs ADD CONSTRAINT songs_kind_check
  CHECK (kind = ANY (ARRAY['audio'::text, 'art'::text, 'placeholder'::text]));
```

No other table change. A placeholder is a `songs` row with zero `versions`
rows — already legal at the schema level once the constraint allows the new
`kind`.

New RPC, `create_placeholder_song(b, p, title)`: inserts a `songs` row with
`kind = 'placeholder'`, no version. Mirrors the shape of the existing
`create_music_folder` RPC.

## The touch-points that break on a versionless song

Grepped `music.html` for code that indexes into `s.versions` without a
length check. Every one of these needs a `kind === 'placeholder'` guard
that renders the grey flat bar and returns before reaching the version
logic:

- **List rendering:** `music.html:2494` (`Array.isArray(s.versions) &&
  s.versions.length` — the one existing guard, everything below assumes it
  passed), `2530-2531` (`versions[0].src` used to build the id/title
  fallback — crashes on an empty array today), `3230` (`s.versions.length`
  used directly), `3681` (`${s.versions.length} version${...}` badge).
- **Player/selection state:** `3520`, `3532` (`s.versions[0]` for the
  now-playing source), `3890` (`activeVer =
  Math.min(Math.max(0, startVer), s.versions.length - 1)` — this is `-1`
  for zero versions, which is an invalid index the rest of the player
  trusts), `4196`, `5322` (`activeSong.versions.length - 1`).
- **Stack/delete/trash flow:** `3598`, `3631`, `3642`, `3805-3843` (all the
  "how many mixes does this song have" copy and branching in the delete
  confirmation modal).
- **Progress panel:** `6366`, `6383` (`$('pVerCount').textContent =
  s.versions.length`).
- **Comments/keyboard:** `7076` (`song.versions.find(...) ||
  song.versions[0]`), `7733` (number-key version switch).

None of these are hard individually — each becomes "if placeholder, render
the flat bar and stop" — but there are ~15 of them across list rendering,
the player, the trash modal and the comment panel, and a couple (`3890`)
are silent-failure bugs today if hit with zero versions rather than loud
crashes, which makes them easy to miss in a quick pass.

## Promotion: placeholder to real song

He's already answered this: attaching a file converts it to a regular song.
The upload path is the `import-inbox` edge function (`edgeFn('import-inbox',
{ band, pass, song, kind })`), which today always creates a fresh `songs`
row for a new title. It needs one new step: before creating, look up
whether a `placeholder`-kind song already exists in this band (matched on
folder/title, the same key `rename_song` and friends already use) — if so,
attach the new version to that existing song's id and flip its `kind` to
`'audio'` instead of inserting a second row. If no match, behavior is
unchanged.

## UI

One new control near the existing "add track" affordances: a "+
Placeholder" action that prompts for a title and calls
`create_placeholder_song`. No new page. The manual progress-field editing
he asked for needs nothing new — `progress_set` / `progress_item_add` are
already keyed by `ref` (folder/title), not by version, so they work on a
placeholder's row unchanged once it exists.

## What "done" looks like

- Migration applied (constraint widened), verified with `list_tables`.
- New RPC deployed and reachable.
- Every touch-point above guarded; a placeholder renders as a title + flat
  grey bar, no play button, no comment affordance, and doesn't throw in the
  console.
- Progress fields editable on a placeholder exactly as on a real song.
- Uploading a file against a placeholder's title promotes it in place —
  same song id, same progress history, `kind` flips to `audio` — rather
  than creating a duplicate.
- Verified live the same way every other CR here is: hash the touched pages
  off `bunjumun.github.io/snotify` against the repo after push.

## Sizing

Past a session's work on its own terms — the migration is small, but the
touch-point count and the import-inbox promotion logic (which has to get
the "is this the same song or a new one" match right, or it silently
duplicates or silently merges the wrong titles) both want a dedicated pass
with room to test the player against an actual placeholder rather than
reasoning about it from the diff.
