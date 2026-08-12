# Lakehorse Swimulator V 2 — progress

The continuity document. Anything decided here survives a session ending; anything not written here did not happen.

**Started:** 2026-08-12, forked from `game/` at that date.
**Lives at:** `game-v2/`, the fifth door on the album page. The original stays live and unchanged at `game/`.
**Working under:** the standards in [aaabench](https://github.com/ukanwat/aaabench), applied to a browser game. See `.claude/skills/ATTRIBUTION.md`.

---

## Pillars

Three statements that constrain every decision below. They are read out of what the original code already documents about itself, not invented for the rebuild.

1. **The lake is bigger than you.** The boundary is current, not a wall. Fog is simultaneously the mood and the draw budget, which makes art direction and performance the same decision. You are a guest here.
2. **You steer an animal, not a camera.** Mass, drag, banking, a heading that lags the stick on a spring. The fins bite rather than teleport.
3. **The album plays straight through.** Mood is an effect over whatever track is playing, never stems. The game is a way to hear the record.

Pillar 3 overrules the vendored `audio-design` pack wherever it recommends adaptive layered music.

---

## Budgets

Both are gates, not aspirations. Everything added answers to them.

| Budget | Target | Baseline at fork |
|---|---|---|
| Frame rate, desktop | 60 fps | to be measured |
| Frame rate, mid phone in an in-app browser | 30 fps floor | to be measured |
| Page weight | no hard cap yet; every addition justified | **1.18 MB** total, of which 740K is Three.js |

The page-weight baseline deserves its own note. V2 shares `game/vendor/three.module.min.js` with the original rather than shipping a second copy, so V2's own cost is measured on what it adds past that shared file: roughly **448K of source, and zero image, mesh or audio files**. Every mesh or texture proposal is measured against that zero.

---

## Where we are

**Phase 1 of 8, in progress** (aaabench phase order: 0 pillars, 1 metrics, 2 blockout, 3 greybox, 4 set dressing, 5 lighting, 6 audio and effects, 7 optimization, 8 polish).

The hard ordering rule: **movement metrics must be settled and frozen before world layout work begins.** Changing how far the kelpie travels per second invalidates every distance, sightline and placement built against it. Phase 2 does not start until Phase 1 is gated.

### Done

- **Fork and separation.** `game-v2/` created, sharing the original's vendored Three.js through the import map. All six localStorage keys namespaced to `lakehorse.v2.*` behind a single registry in `src/core/Keys.js`, which also fixes the upstream problem that six keys were spelled out as literals across five files with no owner, so `Progress.reset()` only ever cleared its own blob. Verified: playing V2 writes `lakehorse.v2.progress` and leaves `lakehorse.progress` untouched.
- **Fifth door** on the album page, reusing `.door.game` styling so the two builds read as the same place. `gameTally()` parameterised so each door reports its own save.
- **One button, two gears.** Replaces the original scheme where holding was a resting cruise and tapping was the fast option.
  - **Tap** fires a single tail beat. This is the slow, precise gear: you pick your way along the wreck one beat at a time.
  - **Hold** past `CFG.kelpie.holdToBoost` (0.22 s) commits to the boost. The dedicated boost input (Shift, shoulder buttons, the touch button) still works and skips the wait.
  - A press fires its kick on the rising edge before the hold timer runs, so every boost opens with a real beat. This needed no input-layer change; the existing edge detection already gave it.
  - Releasing zeroes the timer, so a rapid series of taps can never accumulate into a sprint.
- **Every beat costs air.** `Breath.spend()` added alongside the existing per-second rates: a rate bills you for a state you are in, a spend bills you for a thing you just did. `CFG.breath.kickCost` is 0.35 s per beat, and the bubble puff at the fluke is deliberately the receipt for it, so the tank never drops for a reason the player did not watch happen.
  - Measured: ten deliberate beats over ten seconds costs **13.5 s** of air against **21.0 s** for ten seconds of holding. Slow travel is the cheap option, which is the point. Mashing costs more than holding, also deliberately.
  - Verified: taps never trip the boost, the hold engages on the first frame past 0.22 s, release resets, `spend()` takes exactly `kickCost`, and an emptied tank fires `onEmpty` exactly once.

### Next, in order

1. Rest of Phase 1: input buffering (80–120 ms) on `interact`, use-grace of ~100 ms, hit-stop via a `timeScale` hook on `Loop`, the trauma-model camera shake and its missing call sites, seabed impact response, the kick SFX, SFX pitch variation.
2. Phase 1b audio: spatialization, the four parameters `Game.js` sends to `AudioDirector.update()` every frame that it never reads (including the thermocline muffle that a comment promises and nothing implements), playlist preload, ducking, heartbeat scaling.
3. **Gate:** freeze `config.js` movement numbers. Only then Phase 2.

---

## Decisions worth not relitigating

- **Unreal is not the runtime, and cannot be.** Epic dropped HTML5 export at 4.24; UE5's only browser path is Pixel Streaming, a GPU server per concurrent player. The game's distribution property is that a fan taps a link from an in-app browser and is playing in seconds. Unreal may still be used offline as a lookdev reference or an asset bakery, gated on the page-weight budget.
- **No build step, ever.** `git push` is the whole deploy.
- **`game/vendor/` is now load-bearing for two pages.** The two folders are removed together or not at all.
- **The original is frozen.** It stops receiving fixes; known bugs stay live behind its door. Improvements to it are handed off separately in `docs/v1-handoff.md`. Record here anything that lands there, so the two can be reconciled rather than silently drifting.
- **Not adopted from aaabench:** its `HARNESS-RULES.md` operator-blindness rules, which exist to keep an unassisted benchmark run clean and are the opposite of a working session.

---

## House style, non-negotiable

Every module opens with a prose header explaining why it is shaped the way it is, often naming what was tried and what broke. Comment density is high, spelling is British, comments justify rather than restate. Every tunable lives in `config.js` with its own rationale. Frame-rate independence via `1 - Math.exp(-rate * dt)`. Shaders inline, always paired with `customProgramCacheKey`. **No em dashes in player-facing copy:** rewrite the sentence, do not swap in a comma.
