# Deploying S'notify v3 (Supabase-backed, no studio Mac required)

Run these in order. Steps 1–3 are one-time; after that the site is live and the
studio Mac plays no part in it.

## 1. Schema

Supabase dashboard → **SQL Editor** → paste `schema-v3.sql` → Run.

It is additive and idempotent: `bands`, `band_pass_ok` and the `inbox` bucket
from v2 are untouched. It adds the `songs` / `versions` / `projects` tables, the
public-but-unlistable `tracks` bucket, and every RPC the site calls.

Leave the three commented-out lines at the bottom alone for now — they drop the
old wide-open `comments` policies, and cached copies of the previous page still
rely on them. Come back to them at step 5.

## 2. Migrate the existing library

From `music-player/`, with the service key read straight out of the bridge
config (so it never lands in your shell history):

```sh
SUPABASE_SERVICE_KEY="$(python3 -c 'import json;print(json.load(open("/Users/bunj/claude/daw assistant/bridge/.supabase.json"))["service_key"])')" \
  node scripts/migrate-to-supabase.mjs
```

It uploads every audio file and cover into the `tracks` bucket, upserts the
song / version / project rows from `tracks.json` and `projects.json`, and then
verifies: a HEAD on each public URL (expect `200` and `accept-ranges: bytes`)
and a `get_library` smoke test per band. Safe to re-run.

Project slugs are preserved verbatim, so the existing `?p=M5ow3fGXsQ` link keeps
working. `comment_key` is derived with the same `slug()` the page uses, so
existing comments stay attached to their songs.

## 3. Edge Functions

Needs the Supabase CLI (`brew install supabase/tap/supabase`, then
`supabase login` and `supabase link --project-ref twgukeyoayfqldnojrkg`).

```sh
supabase functions deploy import-inbox   --no-verify-jwt
supabase functions deploy library-admin  --no-verify-jwt
```

`--no-verify-jwt` is required: callers authenticate with the band password
inside the request body, not with a Supabase JWT. Both functions check
`band_pass_ok` before doing anything and both answer `OPTIONS` for CORS.

## 4. Publish the page

Commit and push `index.html`. Once GitHub Pages has rebuilt, check in a private
window:

- `?b=…&s=…&v=…` — plays with no gate, and shows only that one mix.
- `?p=<slug>` — asks for the band password, then shows the project in order.
- `?b=<band>` — asks for the band password, then the whole library.
- A wrong password is refused by the server, not the page.
- `GET /rest/v1/songs` with the publishable key returns nothing, and listing the
  `tracks` bucket is denied — while a direct object URL returns `200`.

Then exercise, logged in: upload (WAV → compressed → imported → visible without
a reload), rename, reorder, stack/unstack, trash/restore/delete-forever, and a
project share link.

## 5. Lock down comments

Once the new page is live and you've reloaded it everywhere, run the three
`drop policy` lines at the bottom of `schema-v3.sql`. After that, comments are
reachable only through the password-checked RPCs.

## 6. Retire the old inputs

- `tracks.json`, `projects.json` and `generate-manifest.mjs` are no longer read
  by anything. Keep them a little while as a rollback, then move to `legacy/`.
- The in-repo `tracks/` audio is likewise unused once step 2 has verified —
  delete it after a grace period to get the repo size back.
- Rotate the Supabase service key when you're done: nothing needs it at runtime
  (Edge Functions get the service role injected).

## The studio-Mac bridge

`daw assistant/bridge/` is dormant. Nothing on the site depends on it, and its
current endpoints write `tracks.json`, which is no longer the source of truth —
so it stays off rather than silently writing to a dead path. When it comes back
it should push into Supabase through the same RPCs and inbox the browser uses,
as one more optional client for updating tracks from the studio.
