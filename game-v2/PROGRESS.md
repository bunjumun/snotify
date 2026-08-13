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

**Phase 1 of 8, in progress** (aaabench phase order: 0 pillars, 1 metrics, 2 blockout, 3 greybox, 4 set dressing, 5 lighting, 6 audio and effects, 7 optimization, 8 polish). The feel pass is complete; Phase 1b, the audio work, is what stands between here and the gate.

The hard ordering rule: **movement metrics must be settled and frozen before world layout work begins.** Changing how far the kelpie travels per second invalidates every distance, sightline and placement built against it. Phase 2 does not start until Phase 1 is gated.

### Posted live, 2026-08-13

Merged to `main` as `f9c532f` and served at `https://bunjumun.github.io/snotify/game-v2/`. The merge cost the frozen build nothing: `game/` came through byte-identical to what was already deployed, and the only existing file touched was `index.html`, for the door. The V1 handoff commit was already on `main` under a different hash, so the merge carried no duplicate of it.

Verified on the live origin rather than locally, because the one thing worth proving in production was the save separation: a dive on the deployed page wrote `lakehorse.v2.progress` at one run while `lakehorse.progress` sat untouched at eleven, with a lighter and a claim on it. 60 fps, 53 requests, 361K over the wire, no console errors, and the boot bail net stayed down.

**Being live does not close Phase 1.** The audio work below is still what stands between here and the gate. The door is up so the build can be played, not because it is finished.

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

- **Phase 1 feel pass** (commit `29b290b`), all numbers from aaabench's `systems.md` and the `game-feel` pack:
  - **Hit-stop** on `Loop`, scaling what reaches the accumulator rather than `STEP`, so the fixed 1/60 tick is untouched and every spring tuned against it still behaves identically. Verified 60 steps/sec normally against 31 with a half-second stop at 5%. The stop's timer runs on real time, or a 5% stop would take twenty times as long to expire as asked.
  - **Trauma-model shake.** Offset is trauma squared (measured: half the trauma throws exactly a quarter as far), decay 1.2/s, smooth time-walked noise instead of per-frame `Math.random()`, roll added, accumulates rather than taking a max, cleared by `snapTo`. Also killed the per-frame `Euler` allocation the file's own comment warned against.
  - **Seabed impact.** `clampAbove()` always reported whether it moved her and the report was discarded, so a full-speed nose-dive into silt produced nothing. Now one closing-speed number scales absorption, trauma, silt, rumble, a thud, and hit-stop for the hard half of the range only.
  - **`Bounds.strain` finally read.** Computed since the boundary was written, commented as being for cues at the edge, never used by anything until now. **Correction: it was read and it still did nothing.** See the `Rig.sustain()` note below.
  - **Buffered use, 110 ms**, plus a 100 ms grace after drifting out of range. Verified live for 117 ms, consumed exactly once, a hold is one press. The tail beat deliberately does not get this: a buffered kick banks credit against the cooldown, and mashing is meant to hit a ceiling.
  - **The kick has a sound**, the floor has a thud, and every one-shot detunes a few percent per fire. `chest` opts out.

- **Phase 1 closed out: the weather and the cold layer announce themselves.**
  - **Gale onset.** `Weather.onStart` had sat unassigned since the file was written. It is the leading edge now: one knock of 0.35 trauma and a pad rumble, because fog and light take the whole 8 s ramp to become legible and until then the lake had already turned with nothing saying so. `onEnd` is deliberately left unwired, since a gale letting go is an absence rather than an event and the ramp out already reads as one.
  - **Gale buffet**, held for as long as it blows and read off the current's actual magnitude rather than off `intensity`, so the shake and the shove are the same water. Measured in a live run: the camera breathes between **0.003 and 0.032 world units** across a gust cycle, against 0.140 for a hard seabed hit. Calm water measures nothing.
  - **Thermocline crossing.** `Thermocline.crossing()` returns +1 going down, -1 coming back up, 0 otherwise. Latched at 0.80 and 0.15 of the submersion ramp, so the 3.25 units of water between the two thresholds have to be genuinely swum before it re-arms. The latch starts `null` and adopts whichever side she spawned on, which is not hypothetical: the first live run spawned at -56.7, below the layer, and correctly opened with no knock. Down knocks 0.40 and plays `cold_in`, up 0.20 and `cold_out`. Verified: 17 cases green driving the class directly, and in the running game exactly one event per genuine crossing, with 600 frames of hovering at the boundary producing none.

- **`Rig.sustain()`, and why the boundary cue was inert.** Phase 1 recorded `Bounds.strain` as finally read. It was read, and it still did nothing, while looking entirely correct in the source.
  - Trauma decays **linearly**, at 1.2/s. Topping it up per frame with `addShake(rate * dt)` therefore cannot hold a level at all: any rate under 1.2 is cancelled to zero every single frame, and any rate over it climbs until it hits the clamp at 1. There is no stable middle to tune towards. The boundary was written at 0.9 against that 1.2 and measured a peak camera displacement of **0.0001 world units**, which is to say none.
  - `sustain(level)` raises trauma to a floor instead. It takes the max rather than accumulating, and decay removes it on its own once the source stops, so nothing has to remember to switch it off. One-shots still add on top: a seabed hit during a gale lands at gale plus hit, verified.
  - **`world.strainTrauma` retuned 0.9 to 0.40**, because as a floor the number means something different. It now measures 0.095 units at full strain, about two thirds of a hard seabed hit, and squared trauma does the rest: half the strain is a quarter of the throw. `weather.galeTrauma` is 0.26, deliberately under it. The two take the larger rather than the sum, so being blown against the edge of the lake is the worst place to be without ever being worse than the edge alone.
  - Worth generalising: **any continuous cue goes through `sustain()`, and any `addShake(x * dt)` is a bug.** These two were the only instances.

### V1, in parallel

All seven items from `docs/v1-handoff.md` landed on the original build in commit `f28d750`. **The two builds have now diverged deliberately**, and the overlap is not free:

- V1 got the **playlist preload fix**. V2 has not: it is still listed under Phase 1b below and must be done here separately.
- Both got input buffering and the kick sound, arrived at independently rather than shared.

### Next, in order

1. Phase 1b audio: spatialization, the four parameters `Game.js` sends to `AudioDirector.update()` every frame that it never reads (including the thermocline muffle a comment promises and nothing implements, which is now the last of the layer's three cues still missing), **the playlist preload V1 already has**, ducking, heartbeat scaling.
2. **Gate:** freeze `config.js` movement numbers. Only then Phase 2.

---

## When V1 is archived

The plan is to archive the original once V2 is stable and posted. Four things have to happen in the right order, and the first one is not optional.

1. **Deal with `game/vendor/` first.** V2's import map points at `../game/vendor/three.module.min.js`. Archiving the folder breaks V2 immediately, with a bare-specifier failure and a blank canvas. Either move `vendor/` to the repo root and repoint both import maps, or copy it back into `game-v2/` and accept the 740K. Do this **before** touching `game/`, and confirm V2 still boots, or the archive takes the live game down with it.
2. **Redirect `game/`, do not delete it.** That path is the one people have already shared, and it is the reason both builds stayed up in the first place. A one-line meta-refresh or a stub `index.html` pointing at the new path costs nothing and keeps every existing link alive. Deleting it turns them all into 404s.
3. **Decide about `lakehorse.v2.*`.** The prefix exists to stop two builds sharing one save. With V1 gone it is vestigial but harmless, and renaming it would wipe everyone's progress unless migrated. Leaving it alone is the safe default. If V2 should instead *adopt* a player's V1 progress, that is a deliberate one-time migration and belongs with the Phase 8 save-versioning work, not before it.
4. **Rename the door.** V2 becomes plain "Lakehorse Swimulator", the old door comes out of `index.html`, and `gameTally()` drops back to a single call. The `door.gameV2.*` site_text keys should be retired or repointed at the same time.

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
