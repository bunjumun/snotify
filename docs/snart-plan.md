# S'nart — implementation plan

Answers the five open questions in `snart-brief.md` and lays out the build
order. Branch: `snart`.

Governing constraint (user's words): *"reuse as much of the structure of
snotify as possible."* Every decision below is the option that adds the least
new machinery.

---

## Decisions

### D1 — `art.html`, with the shared code pulled out into plain `core.js` / `core.css`

The ask is a separate page; the constraint forbids duplicating 800 lines of
gate + RPC + modal CSS to get one. Neither "one big mode switch inside
index.html" nor "copy-paste art.html" is acceptable, and there is a third
option that costs almost nothing on a no-build static site:

- `core.js` — a **classic** `<script>` (not a module), loaded before each
  page's own inline script. Everything it declares stays a global, exactly as
  today, so nothing in `index.html` has to be rewritten to import anything.
- `core.css` — `<link>`ed by both pages.
- Both pages keep their own inline page-specific script, as now.

Moved into `core.js` (verbatim, no behaviour change):
`SUPA_URL`/`SUPA_KEY`, `supaFetch`, `rpc`, `libRpc`, `edgeFn`, the whole auth
block (`AUTH_KEY`, `auths`, `bandPass`, `isAuthed`, `grantAuth`, `clearAuth`,
`isAuthErr`, `bandSlugOf`, `resolveBand`, gate step/show/next/go + its
listeners), and the small helpers both pages need (`$`, `esc`, `slug`,
`fmt`, `timeago`, `publicUrl`, `pageBase`).

`libRpc` reads the globals `curBand`/`bandPass`; both pages declare `curBand`,
so it keeps working unchanged in each.

Moved into `core.css`: `.modal-back`, `.modal`, `.btn`, `.actions`, `.hint`,
`.status`, `.linky`, `.drawer`, `.clist`, `.cmt`, `.cthread`, `.creplies`,
`.cactions`, `.cedit`, `.cbadge`, `.chip`, `.todo-*`, header/`.addbtn`, and
the gate modal's rules.

The gate modal markup itself is duplicated in `art.html` (a dozen lines of
HTML); duplicating markup is cheap, duplicating logic is not.

Cache-bust with `core.js?v=1` — Pages caches hard (see brief).

**Risk note:** this refactor touches a working, live page. It is Phase 0 and
ships behind a verification step: load the live site, log in, play, comment,
before any S'nart code exists.

### D2 — reuse `comments` verbatim; add two nullable columns

`song_id` is already an opaque text subject key. Art keys into the same pool
as `'<band>/art/<comment_key>'`. `add_comment`'s guard (`sid like
lower(b)||'/%'`) still passes untouched, and `get_comments` still returns the
whole band's pool in one call — each page filters by the `art/` prefix
client-side.

New columns (both nullable, both no-ops for audio):

- `region jsonb` — the box, normalised (see D3). Null = a note about the whole
  image, rendered as a general note at the top of the drawer.
- nothing else. `time_s` stays `0` for art comments; `version`/`version_id`,
  `parent_id`, `resolved*`, `edited_at` and `comment_dismissals` all carry over
  with their exact current meaning.

`add_comment` gains one defaulted `reg jsonb default null` argument, and a
reply inherits its parent's region the same way it already inherits
`time_s`/`version`/`version_id`. Carry-forward
(`commentRelevantTo`) is copied as-is — same rule, same code.

### D3 — region stored as normalised `{x, y, w, h}`, 0–1

Fractions of the displayed image rect, so a box survives window resizes,
different screens, and a revision exported at a different pixel size. Clamped
to 0–1 and to a minimum size on write. Validated server-side in `add_comment`
only for shape (four numeric keys in range) — same trust posture as everything
else.

### D4 — reuse `songs`/`versions` with a `kind` discriminator

A parallel `artworks`/`art_versions` pair would mean forking ~15 working RPCs
(rename/reorder/stack/unstack/trash/restore/share/import) and would break
`comments.version_id`'s FK, which points at `versions`. So:

- `songs.kind text not null default 'audio'`, check in `('audio','art')`.
- `versions` unchanged — `src` is just an object path in the `tracks` bucket.
- `get_library` gains `k text default 'audio'` and filters on it. Adding a
  parameter means `drop function` + `create` (same dance v6 did for
  `add_comment`), not `create or replace`.
- Everything else (`rename_song`, `reorder_songs`, `rename_version`,
  `reorder_versions`, `trash_*`, `restore_*`, `unstack_version`,
  `stack_songs`, `get_trash`) works on art untouched. `unstack_version`
  inherits `kind` from the source song via one added column in its insert.
- `get_shared_version` is already kind-agnostic — **art share links work with
  the existing RPC, no change**. Only the page that renders them differs.
- `unique (band, folder)` now spans both kinds: an art piece and a song can't
  share a folder name in one band. Acceptable, arguably correct — one storage
  namespace under `tracks/<band>/<folder>/`.

### D5 — a 🎨 button in the S'notify header; 🎵 back on the art page

`index.html` header, after 🔗/🎞 and before ✏️:
`<a class="addbtn" id="artBtn" href="art.html?b=<band>">🎨 Art</a>` — visible
only when logged in (`body.authed`), hidden in the single-mix view exactly as
Add is. `art.html` carries the mirror button back to `index.html?b=<band>`.
Same origin ⇒ the same `mp_auth_v1` entry ⇒ one band password opens both.

---

## Build order

Each phase ends in a working, committed state. Commit as work lands; push only
when asked (repo convention).

**Phase 0 — extract the shared core.** Create `core.js` + `core.css`, cut the
listed blocks out of `index.html`, link them. No functional change. Verify
S'notify still logs in, lists, plays, comments, uploads.

**Phase 1 — `supabase/schema-v7.sql`.** `songs.kind`; `comments.region`;
`get_library(b,p,k)`; `add_comment(..., reg)`; `unstack_version` carries
`kind`. Idempotent and additive, same house style as v6. Watch the two known
traps: never name a parameter after a column of a table the function queries
(shadow with a local), and anything touching `crypt()` needs
`set search_path = public, extensions` (nothing here does).

**Phase 2 — `import-inbox` accepts images.** Add `kind` to the request body
(default `'audio'`); `IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|tiff?)$/i` with
its MIME map; the version name is still the filename base; set `kind` on the
song row it creates. Audio path untouched. The `.changelog.md` sidecar keeps
working for art (a revision note). No compression step — images upload as-is,
subject to the same fixed 50 MB inbox ceiling, with a clear error over it.

**Phase 3 — `art.html`.** In order:
1. Shell: header, gate markup, list of artworks (thumbnail + revision count),
   `?b=` routing, logout. Reuses `core.*`.
2. Viewer: click a piece → image fills the stage; revision switcher mirrors the
   version stack UI (newest at top, name + date + changelog drawer).
3. Region layer: drag on the image to draw a box → inline compose → post.
   Existing boxes render as numbered pins; hover highlights the matching
   comment, clicking a comment highlights and scrolls to its box. Boxes are
   `position:absolute` in percentages over the image's rect, so no redraw math
   on resize.
4. Comments drawer: `renderComments` ported with the timestamp column replaced
   by the pin number, and `seekTo` replaced by "highlight this box". Threading,
   resolve, dismiss, edit-with-`confirmEditingOthers`, carry-forward and the
   text export all come over unchanged.
5. To-do modal: `renderTodo` ported as-is (it is already time-agnostic apart
   from one label).
6. Upload modal: the `doUpload` path minus compression.
7. Share links: `art.html?b&s&v` (ungated single revision, existing
   `get_shared_version`) and `?p=` reusing `projects` only if it comes for
   free; otherwise skip project links for art in v1.

**Phase 4 — cross-links.** The 🎨/🎵 header buttons (D5).

**Phase 5 — deploy.** Run `schema-v7.sql` via the SQL Editor by setting the
Monaco model directly (`window.monaco.editor.getModels()[0].setValue(sql)`)
through the Chrome tools — never simulated keystrokes. Deploy the Edge
Function (`supabase functions deploy import-inbox --no-verify-jwt`). Push.
Verify on the live site with a cache-busting query param. Append the S'nart
section to `supabase/DEPLOY.md`.

## Out of scope for v1

Zoom/pan on the image, side-by-side revision compare, drawing anything other
than a rectangle, and project (`?p=`) links for art unless free.

---

## What actually shipped (2026-08-10)

Built on branch `snart`, in this order. Everything below is committed; nothing
is pushed and the database migration has NOT been run yet.

- **Phase 0 — `core.js` + `core.css`.** The shared layer: Supabase access, the
  band gate, routing, helpers, and later the site-admin panel (injected once
  rather than pasted into three pages). Verified against the live database
  before any S'nart code existed.
- **Phase 1/2 — `supabase/schema-v7.sql` + image-aware `import-inbox`.** As
  planned, plus two things the plan didn't anticipate (below).
- **Phase 3/4 — `art.html`, cross-links.** As planned.

### Added mid-build, at the user's request

1. **Sn'Album is now the front door.** `index.html` became the band landing
   page (two doors: 🎵 S'notify, 🎨 S'nart) and the player moved to
   `music.html`. Old share links still work: the landing page forwards
   anything carrying a song/version/project to the player untouched. All three
   pages carry links to the other two, plus ⚙ admin, at the top.
2. **Drafted edit suggestions.** A comment can carry a drawing over the image —
   `comments.sketch`, stored as strokes in 0–1 coordinates for the same reasons
   the region box is. `set_comment_sketch` allows a redraw or a wipe.
3. **Art can be linked to a song** — `songs.linked_folder` + `set_song_link`.
4. **Per-band themes.** `BAND_THEME` in core.js sets `body[data-theme]`;
   `theme-dazzle.css` is Lakehorse's WWI ship camouflage. Other bands keep the
   original look. The waveform reads as water: white caps only on the played
   side, and a dazzle boat riding the playhead on the real peak data.

### Still to do

- **Deploy** (Phase 5, unchanged): run `schema-v7.sql` in the SQL editor, run
  `supabase functions deploy import-inbox --no-verify-jwt`, push, verify live
  with a cache-busting param, and append the S'nart section to `DEPLOY.md`.
  Until the migration runs, the art page correctly reports that
  `get_library(b, p, k)` doesn't exist and the Sn'Album art tally stays blank.
- **Not built, deliberately:** edit mode and trash on the art page (the player
  has both; art has neither yet), art in project (`?p=`) links, and a 🎨 marker
  on player rows whose song has art linked to it — the link is currently only
  visible from the art side.
