# Lakehorse band site — project context

Static site for the band Lakehorse. No build step, no bundler. **`git push` is the whole deploy**, and every decision here protects that.

Pages are peers, each with a door on the album page (`index.html`): music, art, band assets, and two games.

## Where things are

| Path | What |
|---|---|
| `game/` | **Lakehorse Swimulator V1. Frozen.** Live, people have links to it. Do not change it without being asked. |
| `game-v2/` | **V2. This is where active game work happens.** |
| `game-v2/PROGRESS.md` | **Read this first for any game work.** Pillars, budgets, what phase we are in, what landed, what is next. |
| `docs/v1-handoff.md` | The scoped list of safe changes for the frozen V1. |
| `.claude/skills/` | 13 vendored game-dev skill packs (MIT, from aaabench). Numbers and reasoning transfer; the code samples are GDScript/C# and do not. |
| `supabase/` | Schema. Lore, art and mixes are all "stacked by version, one marked live". |

Both games are vanilla ES modules plus a vendored Three.js. No TypeScript, no tests, no package.json.

## Things that will bite you

- **`game-v2/` imports Three.js from `../game/vendor/`.** That shared copy is 740K of a 1.18 MB payload. It also means `game/vendor/` is load-bearing for two pages: they are removed together or not at all. See the archive checklist in `PROGRESS.md`.
- **The two games must not share localStorage.** V2 namespaces everything to `lakehorse.v2.*` through `game-v2/src/core/Keys.js`. Add keys there, never as literals at the use site. `index.html`'s door tallies read these keys directly.
- **Unreal cannot ship this.** Epic dropped HTML5 export at 4.24 and UE5's only browser path is Pixel Streaming, a GPU server per player. Unreal is usable offline for lookdev or baked assets, never as the runtime.
- **The lore the game speaks is the draft marked LIVE in Band assets**, fetched over the wire. Not the newest draft, and not the RTF. The tables compiled into the game are an offline fallback that drifts silently.

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

Serve from the repo root so relative paths resolve as in production. `?debug` on either game adds an fps and draw-call overlay. `?seed=<word>` fixes the world layout.

Note: in a headless browser the tab reports `visibilityState: hidden`, so the game auto-pauses and cannot be driven through its render loop. Import the modules and exercise them directly instead.
