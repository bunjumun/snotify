# S'nart — brief for planning

Standalone context for planning the image-review spinoff. Written before a
`/clear`, so it assumes no memory of the conversation that produced it.

## What it is

S'nart is a sibling page to S'notify (`~/claude/music-player/index.html`, live at
`bunjumun.github.io/snotify/`): the same tool, but for **artwork instead of
audio**. Upload version updates of an image, comment on them, resolve the
comments. Same band, same login, same library-of-versions shape.

The one structural difference: a comment isn't pinned to a *timestamp*, it's
pinned to a **region of the image** — the commenter drags a resizable box over
the part of the art they're talking about, and the comment hangs off that box.

## Requirements as stated

- A separate page, "basically the same tool" but for images.
- Upload and comment on **version updates of images** (art revisions stack the
  way mixes do).
- Comment on a specific part of the art by highlighting an area with a
  **sizable box**.
- **Same comment nesting** as S'notify (replies).
- **Same link sharing.**
- A **button on a band's music page** that opens S'nart. Placement was left to
  me — the header, next to the existing library buttons, is the intended spot.
- Named **S'nart** (rhymes with the S'notify naming).

## Hard constraint from the user

> "reuse as much of the structure of snotify as possible"

This is the governing decision. S'nart should not be a fresh build that happens
to look similar — it should reuse S'notify's actual tables, RPCs, CSS, and auth
wherever the shape allows, and only add what images genuinely need.

## What already exists to reuse (all verified working as of this brief)

Repo: `~/claude/music-player` (GitHub `bunjumun/snotify`, Pages-hosted, no build
step — a single vanilla-JS `index.html`). Supabase project `twgukeyoayfqldnojrkg`.

**Auth / gate** — `bands` table (bcrypt-hashed `pass` since schema-v5),
`band_pass_ok(b,p)`, `resolve_band(q)` fuzzy lookup, the two-step gate modal in
`index.html`, and `mp_auth_v1` in localStorage holding `{band: password}`.
Reusable as-is; S'nart should share the same login so one band password opens
both pages.

**Access model** — every table is RLS-on with *zero* anon policies; all reads and
writes go through `SECURITY DEFINER` Postgres functions called as RPCs
(`POST /rest/v1/rpc/<fn>`, args in the body so passwords never hit a URL).
Client helpers in `index.html`: `rpc(fn,args)`, `libRpc(fn,args)` (auto-fills
band + password), `supaFetch`, `edgeFn(name,body)`.

**Comment threading — reuse the tables directly.** `schema-v6.sql` just shipped
and gives `comments` these columns: `id`, `song_id` (a text key, *not* a real
FK — currently `'<band>/<comment_key>'`), `time_s`, `text`, `name`, `version`
(version name at post time), `created_at`, `parent_id` (one-level replies),
`version_id` (FK to `versions`, the mix it originated on), `edited_at`,
`resolved`, `resolved_at`, `resolved_by`. Plus `comment_dismissals
(comment_id, version_id)` for "not relevant to this one version".

RPCs: `get_comments`, `add_comment`, `edit_comment`, `resolve_comment`,
`set_comment_dismissed`, `delete_comment`.

The generic thing to notice: `song_id` is already an opaque text subject key, so
art can key into the same pool under a different prefix. The open design
question for planning is whether to (a) reuse `comments` verbatim and add
nullable region columns, or (b) generalise `version_id` — it currently FKs to
`versions`, which is audio-specific. Resolve that during planning.

**Carry-forward semantics (worth copying exactly).** An unresolved comment
automatically appears on every version made *after* the one it was posted on,
until it's resolved; resolving stops the forward carry but leaves it visible
where it already showed; a per-version dismiss overrides on a whim. Computed
client-side in `commentRelevantTo(c, song, ver)` — needs each version's `id` and
`created_at`, which `_song_json` now returns.

**Editing is honor-system** — the server lets any bandmate edit any comment (same
trust level delete always had); the client just confirms first when the
comment's self-reported name isn't the name you post under
(`confirmEditingOthers`). No timer, no device token. The user chose this
explicitly over a 20-minute/device-locked scheme: *"band mates must trust each
other a little."* Keep the same posture in S'nart.

**To-do list** — `#todoModal` + `renderTodo()`: GitHub-Issues-style Open/Resolved
tabs with counts, sort by newest/oldest/most-replies, status dots, reply counts,
and per-version chips showing which versions each note applies to. Directly
portable.

**Versions stack** — `songs` (with a frozen `comment_key` so comments survive
renames) + `versions` (`position`, `trashed_at`, `changelog`, `changes`).
Art revisions want the same shape; decide during planning whether to add a
`kind` discriminator to these tables or create parallel `artworks`/`art_versions`.

**Upload path** — browser PUTs into the `inbox` storage bucket at
`inbox/<band>/<pass>/<name>/…`, then calls the `import-inbox` Edge Function
(`supabase/functions/import-inbox/`, deployed `--no-verify-jwt`) which moves
objects into the public-but-unlistable `tracks` bucket and inserts the version
rows. `library-admin` is the second Edge Function (deletes storage objects).
Images can ride the same path; the WAV→MP3 compression step obviously doesn't
apply.

**Share links** — `?b=<band>&s=<song>&v=<version>` is an ungated single-version
view backed by `get_shared_version` (passwordless, returns exactly one item);
`?p=<slug>` is a password-gated project link. Both forms are worth mirroring.

**Modal/drawer CSS** — `.modal-back`/`.modal`/`.btn`/`.actions`/`.hint`/
`.status.err`/`.linky`, and the comment drawer (`.drawer`, `.clist`, `.cmt`,
`.cthread`, `.creplies`, `.cactions`, `.cedit`, `.cbadge`, `.chip`,
`.todo-*`). Copy rather than reinvent so the two pages look like one product.

## Files worth reading when planning

- `index.html` — the whole client. Comment code starts around the
  "Comments (timestamped, per song)" section; gate around `showGate`/`gateNext`;
  upload in `doUpload`; `normalize()` maps server JSON to the client shape.
- `supabase/schema-v3.sql` — tables, RLS posture, every core RPC.
- `supabase/schema-v6.sql` — the threading/resolve/dismiss layer to mirror.
- `supabase/DEPLOY.md` — deploy steps, numbered; S'nart adds the next section.
- `supabase/functions/import-inbox/index.ts` — the upload→library path.

## Things to decide during planning (not yet decided)

1. Separate page file (`art.html`) vs. a mode inside `index.html`. Separate file
   is the stated ask ("a separate page") but shared code has to be duplicated in
   a no-build single-file setup — worth weighing.
2. Whether `comments` is reused verbatim (add nullable `region` +
   generalise/relax `version_id`) or forked. Reuse is strongly preferred per the
   constraint above.
3. How the region box is stored — normalised 0–1 `{x,y,w,h}` is the obvious
   choice so it survives different display sizes and image dimensions.
4. Whether art versions reuse `songs`/`versions` with a `kind` column or get
   their own tables.
5. Where exactly the S'nart button goes in the header, and whether S'nart links
   back.

## Deploy notes (learned the hard way)

- Supabase SQL Editor: paste long SQL by setting the Monaco model directly —
  `window.monaco.editor.getModels()[0].setValue(sql)` — via the
  `mcp__claude-in-chrome__*` tools (the user's real Chrome, which has the
  authenticated dashboard session). Simulating keystrokes corrupts the
  indentation badly on anything long.
- Multi-statement scripts run in one implicit transaction; an error partway
  rolls back everything before it.
- `pgcrypto` lives in the `extensions` schema on this project, so any function
  using `crypt()`/`gen_salt()` must declare
  `set search_path = public, extensions` — `public` alone silently breaks it.
- **Never name a PL/pgSQL parameter the same as a column of a table the function
  queries** — it raises "column reference is ambiguous". This has bitten twice
  (`admin_create_band`'s `slug`, `add_comment`'s `parent_id`/`time_s`). Shadow
  with a local (`pid uuid := parent_id`) to keep the RPC's argument names.
- GitHub Pages caches hard; append a cache-busting query param when verifying a
  fresh deploy in the browser.
- Convention: commit as work lands, but only `git push` when the user says so.
