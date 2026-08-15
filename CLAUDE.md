# Lakehorse band site — project context

Static site for the band Lakehorse. No build step, no bundler. **`git push` is the whole deploy**, and every decision here protects that.

Pages are peers, each with a door on the album page (`index.html`): music, art, band assets, and the game.

## Start here

You are reading step one. For game work, then read, in order:

1. **`game/PROGRESS.md`** — the continuity document. Pillars, budgets, which of the eight phases we are in, what landed and what is next. Anything decided that is not written there did not happen.
2. **`docs/session-brief.md`** — the tree and the deploy state. It carries a date because that part goes stale faster than anything else here.

Whatever the session is about, **read the change requests notebook at the start of it** and again whenever a task finishes. See the section below.

**Start sessions from this directory**, so this file loads on its own and so git operations land in the repo. The `games/` sibling has its own `CLAUDE.md` saying the same thing from the other side; it holds reference art and no code.

## Where things are

| Path | What |
|---|---|
| `game/` | **Lakehorse Swimulator, and where active work happens.** On this branch it is V2, which took the path over from V1 so every link anyone has shared still lands on a game. What is *deployed* at that path may be the older shape; see the caveat below. |
| `game/PROGRESS.md` | Pillars, budgets, what phase we are in, what landed, what is next. |
| `docs/session-brief.md` | Orientation for a cold session: read order, the two directories, and what is deployed versus what is only on a branch. |
| `vendor/` | Three.js, at the repo root and owned by neither build. Both import maps point here. |
| `archive/game-v1/` | **V1. Frozen and off the site**, with no door. Still runs if you serve it. |
| `docs/v1-handoff.md` | The scoped list of safe changes made to V1 before it was archived. |
| `../games/` | **Outside this repo, and no code in it.** Art direction reference: wreck and diving-suit photography, the kelpie, cover art. Its `lakehorse lore.rtf` is stale; see the lore note below. |
| `.claude/skills/` | 13 vendored game-dev skill packs (MIT, from aaabench). Numbers and reasoning transfer; the code samples are GDScript/C# and do not. |
| `supabase/` | Schema. Lore, art and mixes are all "stacked by version, one marked live". |
| `change requests/LEDGER.md` | Claude's side of the notebook, which is the Apple Note "Snalbum ideas & outbox". Deliberately untracked, so it exists on one disk only. Read the note at session start and at every idle point; see below. |

Both games are vanilla ES modules plus a vendored Three.js. No TypeScript, no tests, no package.json.

## The change requests notebook

This project's three pieces, one instance of a convention meant for all of them:

| Piece | Here |
|---|---|
| Notebook, both directions | Apple Note **"Snalbum ideas & outbox"** |
| Ledger | `change requests/LEDGER.md` |
| Manager | scheduled task `manager-snalbum`, daily at 07:09, silent |

**One note, not two.** It began as a pair — "Snalbum feature ideas" for his
capture and "Snalbum waiting on you" for the outbox — and they were folded
together on 2026-08-14, in line with the user-level convention. Neither old name
exists any more, and asking for one raises `Invalid index (-1719)` rather than
returning empty, which reads like a broken connector rather than a renamed note.

`/brief` is a user-level skill, so it works in any project and learns the note
names from this table rather than from a hardcoded string.

The notebook is the **Apple Note "Snalbum ideas & outbox"**. It exists so an idea
can be written down the moment it arrives, from the phone or the desk, without
derailing whatever is being built: rather than interrupting, he writes it there
and it gets picked up at the next natural gap. `change requests/LEDGER.md` is
Claude's side, one row per item with a status and the reading it was built on.

**The note has two halves and the separator between them is the boundary.**
Everything above the last `—` is his capture zone. Everything at or below it is
Claude's: the `OUTBOX — waiting on you` table, then the dated `COMPLETED` log.

**Never write above that separator unless he asks in that session, and then only
to the legend, never to an item line.** The tool replaces a note whole, so a
stray write while he is typing on a phone loses text; that risk is the reason,
and it does not go away just because a write was invited. Say the risk out loud
before writing. The outbox and the completed log below the separator are Claude's
to rewrite freely — but a rewrite still means reading the whole note first and
copying his half back verbatim, because whole-note replacement does not care
which half you meant to touch.

When an item ships, append a dated line to `COMPLETED`. If the line it came from
sits above the separator, say so in chat and leave it: striking it through would
mean writing into his half.

**The marker is `<`, and writing it back is a trap that has now drawn blood
twice.** It was `#game` until 2026-08-14, when he wrote "You keep removing my
hashtags on this list" into BUGS. He was right, and it was Claude: a hashtag
typed on a phone is a real Apple Notes tag object, `get_note_content` does not
return it, so every whole-note rewrite typed his half back without it. He chose
`>` that day and moved to `<` within hours, growing it into a routing scheme:
`<game`, `<snotify`, `<musicplayer`, `<songplayer`, `<snalbum`. Follow him; do
not migrate it back.

**Write `<` as `&lt;`, with the semicolon.** On 2026-08-14 a rewrite put bare
`<` characters into the note and Apple Notes parsed `<snotify` as an unknown
HTML tag and swallowed it — all thirteen of his markers vanished in one write.
The note takes HTML, so `<` opens a tag whatever you meant by it. This is the
same wound as the hashtags with a different weapon, and it is why the rule below
matters more than it looks.

**Reading and writing are not symmetric, which is the whole trap.**
`get_note_content` returns entities with the semicolon *stripped* — `&lt;` comes
back as `&lt`, `&gt;` as `&gt`, `&quot;` as `&quot`, `&` as `&amp`. So the
reader's output is never safe to write back verbatim: it renders as the literal
text `&lt`. Repair on the way in, escape on the way out:

| In the note | Reader returns | Write back as |
|---|---|---|
| `<` | `&lt` | `&lt;` |
| `>` | `&gt` | `>` (bare `>` is safe; it opens nothing) |
| `&` | `&amp` | `&` |
| `"` `“` `”` `’` | `&quot` or the character | the real curly character |

**Always read the note back after writing it** and confirm his markers survived.
Both losses were caught that way and only that way.

Tags are `[bug]` and `[?]` only. Both legends live in the note and the ledger.

**The outbox is the other direction.** His phone is too old for Remote Control,
so a push can never reach him and the manager is silent by design; the note is
therefore the only channel out. Write it only when something changed, and read it
immediately before writing so anything he typed is in hand. An entry earns its
place only if it needs a human: his ear, his login, his push, or an answer only
he has. Each carries what happens if he ignores it, so ignoring it stays a real
option and the note never becomes a pile of obligations.

The Notes tools are deferred, so load them before the first read:

```
ToolSearch  select:mcp__Read_and_Write_Apple_Notes__get_note_content
```

then `get_note_content` with `note_name: "Snalbum ideas & outbox"`. **If the Notes
connector is not available in a session, say so out loud rather than quietly
skipping the check** — a silent skip looks exactly like an empty notebook, and
the whole arrangement rests on him trusting that what he writes gets seen.

Read it **at the start of every session** and **every time a task finishes**, and
open with one line on what is new. Match against the quoted snippets in the ledger
to tell a new item from a tracked one; give anything new a row before acting.

Its four headings are the treatment. `BUGS` reproduced and fixed on sight.
`QUEUE` worked top to bottom, act-first. `LATER` never auto-built but designed
around. `WISH LIST` items whose meaning was not clear enough to act on: ask the
one question in the ledger row and move it up once answered, never guess. Order
in the note is the order of work, so reordering lines there reorders the work.

At an idle point, do not wait to be asked. Pick the next item and start it, saying
which one and why first, so a reply can redirect it before much is spent. Order:
anything tagged `[next]`, then `BUGS`, then `QUEUE` top to bottom. If the notebook
has nothing open, fall back to the next step in `game/PROGRESS.md`.

**The default is to act, not to ask.** For an item in `QUEUE`, settle the
ambiguities on the most plausible reading, write that reading into the ledger so
the assumption is visible and arguable, and build it. Only `[plan]` and `[?]`
items come back for a yes first.

That default has a ceiling. **Show the plan and wait, tagged or not, if the item
turns out to need a schema migration, a new dependency, a new page, a background
process on his machine, or more than about a session's work.** A one-line note in
a notebook is cheap to write and gives no signal about size, so the size has to be
judged after reading the code rather than taken from how the item was phrased. The
ledger row goes in *before* the code either way, so a session that dies still
leaves the reading behind. Commits name the item: `CR-2: ...`.

Three things stay his even when work is running unattended: **`git push`**, which
is the whole deploy; **anything destructive to live Supabase data**, migrations
included; and **deleting or overwriting his files**. Work on a named branch, commit
freely, stop there.

## Things that will bite you

- **Three.js lives at `vendor/` in the repo root**, 740K of a 1.18 MB payload, and both import maps reach it by relative path: `../vendor/` from `game/`, `../../vendor/` from `archive/game-v1/`. It used to sit inside `game/`, which made a folder that was about to be frozen load-bearing for the live page. Moving anything containing an import map means fixing that depth.
- **`lakehorse.v2.*` is a historical accident, not a version.** The prefix was minted when two builds were live and had to stop overwriting each other's saves. Only one build is live now, but renaming the key would wipe everyone's progress, so it stays. Keys go in `game/src/core/Keys.js`, never as literals at the use site; `index.html`'s door tally reads them directly. Older V1 dives are still parked under `lakehorse.*` and are deliberately left alone.
- **Unreal cannot ship this.** Epic dropped HTML5 export at 4.24 and UE5's only browser path is Pixel Streaming, a GPU server per player. Unreal is usable offline for lookdev or baked assets, never as the runtime.
- **The lore the game speaks is the draft marked LIVE in Band assets**, fetched over the wire. Not the newest draft, and not the RTF sitting in `../games/lakehorse sim/`, which is old enough to mislead. The tables compiled into the game are an offline fallback that drifts silently.
- **This file describes the branch you have checked out, not necessarily the live site.** As of 2026-08-14 the two agree: the takeover shipped, `origin/main` is `d51592a`, and it serves V2 at `/game/` with V1 frozen at `/archive/game-v1/`. Every local branch is merged into `main`, so nothing newer is stranded. That agreement is a snapshot rather than a guarantee, so run `git log origin/main` before claiming anything about what a player currently sees. `docs/session-brief.md` carries the deploy state in full.

## House style, non-negotiable

- Every module opens with a **prose header explaining why it is shaped that way**, often naming what was tried and what broke. Match this. It is the most distinctive thing about the codebase.
- High comment density, British spelling, second person for the player. Comments justify decisions; they never restate the code.
- **Every tunable lives in `config.js`** as `CFG.<system>.<key>` with its own rationale, read at the use site. Never hardcode a number twice.
- Frame-rate independence via `1 - Math.exp(-rate * dt)`. Avoid allocation in hot paths; use the lazy scratch-field idiom already there.
- Shaders are inline template literals, always paired with `customProgramCacheKey`.
- **No em dashes in player-facing copy.** Rewrite the sentence; do not swap in a comma. (Code comments are exempt and use them freely.)

## Verifying

```bash
python3 -m http.server 8899 --directory /Users/bunj/claude/music-player
```

Serve from the repo root so relative paths resolve as in production. `?debug` adds an fps and draw-call overlay. `?seed=<word>` fixes the world layout.

Note: in a headless browser the tab reports `visibilityState: hidden`, so the game auto-pauses and cannot be driven through its render loop. Import the modules and exercise them directly instead.
