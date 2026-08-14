# Lakehorse Swimulator — session brief

Orientation for a session starting cold. It does not repeat `CLAUDE.md` or `PROGRESS.md`; it tells you which of them to read, in what order, and what the tree actually looks like right now, which is the one thing neither of them can keep current on its own.

**Last updated: 2026-08-14.** If the git facts below disagree with `git log`, git is right and this file is stale. Re-derive rather than trust it.

---

## What this is

A browser game on the Lakehorse band site. You ride a kelpie through the wreck of the SS Enias while the band's album plays straight through. Vanilla ES modules plus a vendored Three.js. No bundler, no TypeScript, no tests, no `package.json`. **`git push` is the whole deploy**, and most of the architecture exists to protect that.

Site: `https://bunjumun.github.io/snotify/`. Repo: `github.com/bunjumun/snotify`, GitHub Pages served from `main`.

---

## Read in this order

1. **`music-player/CLAUDE.md`** — where files live, house style, the traps. Loads automatically if the session starts from `music-player/`.
2. **`music-player/game/PROGRESS.md`** — the continuity document. Pillars, budgets, which of the eight phases we are in, what landed and what is next. *Anything decided that is not written there did not happen.*
3. **This file** — the tree and deploy state.
4. `music-player/docs/v1-handoff.md` — only if you are touching the archived V1.

---

## Two directories, and only one of them has code

| Path | What it is |
|---|---|
| `/Users/bunj/claude/music-player` | **The repo. All work happens here.** |
| `/Users/bunj/claude/games` | Art reference only. Wreck and diving-suit photography, the kelpie reference, cover art. Nothing here is built or deployed. |

**Start sessions from `music-player/`**, so its `CLAUDE.md` loads on its own and so git operations land in the right repo. Starting from `games/` is how you end up doing repo work outside a repo.

`games/lakehorse sim/lakehorse lore.rtf` is out of date and is **not** the story the game tells. The live narrative is the lore draft carrying the LIVE badge in Band assets, fetched over the wire at runtime. Not the newest draft, and not the RTF.

---

## State of play, 2026-08-14

**The takeover has shipped.** What is deployed and what is on the working tree are now the same shape, which is the opposite of what this section said for the two days before it.

### Deployed (`origin/main`, currently `d51592a`)

```
vendor/            Three.js, 740K, at the repo root, owned by neither build
game/              V2, having taken the path over from V1   →  /game/
archive/game-v1/   V1, frozen, doorless, still served       →  /archive/game-v1/
```

Verified on 2026-08-14 against the live site rather than inferred from git: `/game/config.js` and `/game/index.html` match the working tree byte for byte, `/game-v2/` now returns 404, and the album page carries one game door instead of two.

The takeover is a takeover rather than a redirect on purpose: `/game/` is the address people already have, and a redirect is a hop that can rot.

Save keys stay separated even though only one build is live: V2 writes `lakehorse.v2.*`, and older V1 dives are parked under `lakehorse.*` and left alone. The album page's `gameTally()` reads them directly.

### Branch topology

`main` carries everything. No local branch is ahead of `origin/main`, so nothing is stranded. The ~20 local branches are finished work, already merged; ignore them unless you have a reason.

---

## The two builds

V1 and V2 diverged deliberately on 2026-08-13 and the divergence is **closed**. V1 is frozen and receives nothing. Do not port fixes back into it, and do not try to reconcile them.

Some things exist in both because they were arrived at independently, not shared: input buffering, the kick sound. The playlist preload fix went to V1 first and was ported to V2 later, carrying a deck-gating bug V1 had already fixed. That history is written up in `PROGRESS.md` under "V1, in parallel"; it is context, not a to-do.

---

## Hard rules

These are not preferences. Breaking any of them costs a player something.

- **No build step, ever.** Nothing that requires compiling, bundling or a CI job. `git push` deploys.
- **Do not rename save keys.** `lakehorse.v2.*` is a historical accident rather than a version number, and renaming it wipes everyone's progress. Keys live in `game/src/core/Keys.js`, never as literals at the use site.
- **Every tunable goes in `config.js`** as `CFG.<system>.<key>`, with a comment giving its rationale, read at the use site. Never hardcode a number twice.
- **Every module opens with a prose header explaining why it is shaped that way**, often naming what was tried and what broke. Comment density is high, spelling is British, comments justify rather than restate. This is the most distinctive thing about the codebase and the easiest to fail to match.
- **No em dashes in player-facing copy.** Rewrite the sentence; do not swap in a comma. Code comments are exempt and use them freely.
- **Movement metrics are gated.** Phase 2 does not begin until the `config.js` movement numbers are frozen, because every distance and sightline in the blockout will be built against them. Do not move kelpie speed, drag, turn rate, thrust or cooldown casually.
- **Watch the relative depth to `vendor/`.** Both import maps reach it by relative path. Moving any folder that contains an import map means fixing that path, and getting it wrong blanks the canvas with a bare-specifier failure.

---

## Running and verifying

```bash
python3 -m http.server 8899 --directory /Users/bunj/claude/music-player
```

Serve from the **repo root**, not from `game/`, so relative paths resolve the way they do in production. Then open `http://localhost:8899/game/`.

Two `launch.json` files can start that server, and they are not equivalent:

- `music-player/.claude/launch.json` has one entry, `snotify`, on port 8777. It has **no `autoPort`**, so a second session already holding 8777 will collide.
- `games/.claude/launch.json` has `lakehorse` (8899) and `lakehorse-v2` (8901), both with `autoPort`, both passing `--directory` at the music-player root explicitly. These are the safe ones to reuse.

Worth knowing why the second pair route through `sh -c` with `"${PORT:-8899}"`: `python3 -m http.server` takes its port positionally and ignores the `PORT` environment variable, so `autoPort` alone would silently drop the server on port 8000 instead of the reassigned one.

Query flags: `?debug` adds an fps and draw-call overlay, `?seed=<word>` fixes the world layout.

**In a headless browser the tab reports `visibilityState: hidden`**, so the game auto-pauses and cannot be driven through its render loop. Import the modules and exercise them directly instead of trying to play it.

Two more harness notes that have cost time before:

- The browser caches ES modules aggressively. After editing a module, bust it with `fetch(url, {cache:'reload'})` before reloading, or you will spend an hour debugging code that is not running.
- `AudioDirector` does not exist until the DIVE IN gesture unlocks audio. `G.audio` is `null` before that, and nothing about sound can be measured until you have dived in.

---

## Budgets

Gates, not aspirations. Everything added answers to them.

| Budget | Target |
|---|---|
| Frame rate, desktop | 60 fps |
| Frame rate, mid phone in an in-app browser | 30 fps floor |
| Page weight | 1.18 MB baseline, of which 740K is the shared Three.js |

The distribution property the whole project is built around: a fan taps a link inside a phone's in-app browser and is playing within seconds. Every proposal is measured against that. It is also why Unreal cannot ever be the runtime, which is settled and not worth relitigating; see `PROGRESS.md`.
