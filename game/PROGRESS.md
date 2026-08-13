# Lakehorse Swimulator V 2 — progress

The continuity document. Anything decided here survives a session ending; anything not written here did not happen.

**Started:** 2026-08-12, forked from `game/` at that date.
**Lives at:** `game/`. It took that path over from the original on 2026-08-13; see **V1 archived** below. "V2" now survives only in this document and in the `lakehorse.v2.*` save keys, nowhere a player can see.
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

The page-weight baseline deserves its own note. Three.js is vendored once at `vendor/` in the repo root rather than shipped per build, so this build's own cost is measured on what it adds past that shared file: roughly **448K of source, and zero image, mesh or audio files**. Every mesh or texture proposal is measured against that zero.

---

## Where we are

**Phase 1 of 8, and 1b is done** (aaabench phase order: 0 pillars, 1 metrics, 2 blockout, 3 greybox, 4 set dressing, 5 lighting, 6 audio and effects, 7 optimization, 8 polish). The feel pass and the audio pass have both landed. **What now stands between here and Phase 2 is the gate itself: freezing the `config.js` movement numbers.** Nothing else.

The hard ordering rule: **movement metrics must be settled and frozen before world layout work begins.** Changing how far the kelpie travels per second invalidates every distance, sightline and placement built against it. Phase 2 does not start until Phase 1 is gated.

Worth being precise about what the gate covers, because 1b did move numbers: `stash.pickupRadius` and `logPages.pickupRadius` grew, and those are *placement* numbers rather than *movement* ones. Nothing about how far she travels per second changed. The gate is still clean.

### Posted live, 2026-08-13

Merged to `main` as `f9c532f` and served at `https://bunjumun.github.io/snotify/game-v2/`, **which is no longer the address**: it moved to `/game/` the same day, one section down. The merge cost the frozen build nothing: `game/` came through byte-identical to what was already deployed, and the only existing file touched was `index.html`, for the door. The V1 handoff commit was already on `main` under a different hash, so the merge carried no duplicate of it.

Verified on the live origin rather than locally, because the one thing worth proving in production was the save separation: a dive on the deployed page wrote `lakehorse.v2.progress` at one run while `lakehorse.progress` sat untouched at eleven, with a lighter and a claim on it. 60 fps, 53 requests, 361K over the wire, no console errors, and the boot bail net stayed down.

**Being live does not close Phase 1.** The door is up so the build can be played, not because it is finished.

### Phase 1b: audio, 2026-08-13

The spine of it: `Game.js` handed `AudioDirector.update()` six values every frame and the method read **two**. `position`, `panic`, `belowThermo` and `speed` had been computed and thrown away since the fork, which is exactly why the lake had no direction, the heart never raced, the cold layer was silent and going fast sounded like drifting. All four answer for themselves now, and the JSDoc names what each is for. **If a value arrives in that method, something in it is accountable for the value.**

- **Spatialisation, and the listener is the kelpie.** Pillar 2 decides it, and it is also the steadier answer: the rig is a spring behind her and `Rig.update()` runs *after* the audio call, so listening from the camera would pan against a pose that is both laggy and a frame stale. Hand-rolled from a gain, a lowpass and a stereo panner rather than a `PannerNode`, whose listener API is split across browsers (`positionX` as an AudioParam on some, the deprecated `setPosition` on others) on a game whose whole distribution property is working first time in a phone's in-app browser. `sfx()` points its local `out` at the head, so **every case in the switch got placed without the switch changing**.
  - **No `at` means centred and unattenuated**, and that default is the meaningful one: the sound is happening *to* you rather than near you. The tail beat is her own fluke, the warning is your own lungs, the chest chord is a reward being handed over.
  - **Only the diver is placed.** He is the one thing in the lake that persists at a distance and makes noise, so "go back for him" is now a direction as well as an instruction. The fish deliberately are not: their lines arrive with on-screen dialogue addressed to you, and panning a voice against its own subtitle reads as a bug.
  - Measured: pan caps at ±0.75, gain is flat inside 14 units, and a sound at the fog line (130) is silent and filtered to 700 Hz. **Known limit:** directly behind pans to 0, same as directly ahead. That is inherent to stereo without HRTF and was accepted rather than missed.
- **The cold layer muffles the lake, not the record.** Its filter is wired across ambience and SFX only; music skips it entirely. Reusing the existing lowpass would have collided head-on with the drowning cue, which is the one thing `config.js` is emphatic about: *when you hear the record go muffled, you are drowning.* Two states cannot share one signal. Measured at full submersion: lake 20000 → 1101 Hz, bed to 0.46, **music bus unmoved at 0.85**, and the choke still lands on 381 Hz at an empty tank exactly as before. This was the last of the layer's three cues.
- **The heart speeds up.** Was a fixed 900 ms interval at fixed pitch and level, so the first moment of panic and the last breath were identical, and it ran on the wall clock rather than the audio clock. A self-rescheduling timeout reads panic at the top of each beat. Measured **54 / 93 / 132 bpm** across the band.
- **Speed has a sound**, squared so drifting is properly silent and the rush has to be earned. On the ambience bus, so it is the lake rather than the animal and the cold layer muffles it with everything else.
- **Ducking**, as volume automation, because Web Audio's compressor has no sidechain input to key off. `chest`, `page`, `warn` and `grip_lost` dip the record to 0.55 and it recovers. **`kick` emphatically does not**, and that omission is the whole difference between ducking that works and ducking that ruins the album: it fires several times a second at the rate people actually swim. Verified `kick` and `thud` leave the music bus at 1.000.
- **Playlist preload**, ported from V1 at last, and it carried a bug V1 had already fixed and this build had not: `ended`/`error` were ungated, so a **draining** deck reaching its own natural end advanced a second time and cut the incoming track off after one crossfade. Both gate on `live()` now.
- **Phaser `maxWet` 0.85 → 0.6.** At 0.85 the sweep ate the mids for the whole hold, and washing out the band's own record for ten seconds is the opposite of what pillar 3 asks for.
- **Rumble, rebuilt.** One `CFG.input.rumble.scale` over every one-shot rather than five retuned call sites, because what those encode is their weight *relative* to each other and that judgement was worth keeping. Plus the record in your hands, driven by the analyser's onset rather than its level so it lands on the beat instead of buzzing through loud passages. **A one-shot owns the motors outright while it plays**, because `playEffect` replaces the running effect instead of mixing with it, and without that arbitration a music re-arm would cut a seabed slam in half.
- **The bong is a visualiser.** `Post` read `uTrip` and a clock, so the most psychedelic ten seconds in the game were indifferent to the track playing underneath them. `uReact` and `uKick` are gated **inside the existing `uTrip` branches**, so a game that is not tripping pays nothing at all. Sparkles burst on the beat through the accumulator that was already there. Verified live at uReact 0.87 and uKick 0.79 mid-sequence.

### Bigger things to aim for, 2026-08-13

- **The stash is mason jars.** A baggie was half a unit tall inside a pickup radius of 2.6, so the collision was five times the size of the thing drawn. Jars are about 2.2 units and the radius moved with them to 4.0: grab range is now 3.6× the object's half-size where it was 10.4×. Log slates got the same treatment and are now about the size of a board a diver would actually have written on.
  - **Glass earns back what size gives away.** A jar is harder to spot at distance than a baggie, being mostly transparent and taking the fog's colour, and easier to spot with the lamp, because glass throws a highlight back where a pouch just goes pale. Opacity rides the glint alongside emissive, since brightening a transparent thing alone only makes a pale shape paler. Finding them is still an act of looking.
  - **The lighter deliberately did not grow.** It looks like it belongs on the list until you check how it is acquired: a fish carries it over and hands it into the diver's glove, so it is never aimed at. Scaling it would only have put a giant lighter in his hand.
  - Cost: one extra mesh per jar, three rather than two, all sharing one geometry set. Measured with 14 jars: 74 draw calls, 51K triangles, 60 fps median.
- **E to smoke is gone, and this retires a Phase 1 feature.** There were two ways to do one thing and the unused one was the one being advertised: the prompt sat on screen during exactly the approach that was already about to trigger contact. Verified live: 18.6 units out with a lit bowl shows no prompt, and 2.0 units fires the sequence with no key pressed.
  - **`useGraceMs` and the coyote grace went with it.** Phase 1 recorded them as landed and verified, and this reverses that deliberately rather than by accident: the grace only ever existed to forgive a *press*, so with no press there was nothing left for it to do.
  - The touch USE button came off too. On a phone a control you can press and get no answer from reads as the game being broken rather than the button being spare. BOOST moved into the corner it vacated, which is the easier one-handed reach anyway.
  - **`input.bufferMs` survives with nothing consuming it**, annotated as such at its declaration. The machinery is correct and tested and the next thing worth pressing a button at will want it. If nothing arrives, it and the `InputBus` interact plumbing should be removed together rather than one at a time.

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

- V1 got the **playlist preload fix** first. This build has it now, ported in Phase 1b along with a deck-gating bug V1 did not have.
- Both got input buffering and the kick sound, arrived at independently rather than shared. The buffering has since been retired here and not there, which no longer matters: V1 is archived and receives nothing.

The divergence is closed as a live concern. Nothing needs reconciling in both directions any more, because only one of the two is still played.

### Next, in order

1. **Gate:** freeze the `config.js` movement numbers. This is the only thing left in Phase 1.
2. Phase 2, blockout, which the gate exists to protect.

Worth carrying forward rather than rediscovering:

- **Any continuous audio or camera cue goes through a floor, not an accumulation.** `Rig.sustain()` exists because trauma decays linearly and `addShake(rate * dt)` therefore cannot hold a level. The same instinct produced `_dip()` and the thermo filter: a state is a target to sit at, an event is something to add.
- **Two states must not share one signal.** The choke means drowning; the cold layer needed its own filter rather than a share of that one. Any future "muffle" proposal answers to this first.
- **Placement grew, movement did not.** If Phase 2 starts and something feels mis-spaced, the pickup radii moved on 2026-08-13 and the movement numbers did not.

---

## V1 archived, 2026-08-13

Done, and done in the order the checklist demanded. V2 did not redirect from the
original's path, it **took it over**: `/game/` now serves this build, so the links
already in people's hands open it with no hop and nothing to go stale.

1. **`vendor/` moved to the repo root first.** V2's import map pointed at `../game/vendor/`, so moving `game/` before dealing with that would have blanked the live canvas with a bare-specifier failure. Three.js now sits at `vendor/` owned by neither build, reached as `../vendor/` from `game/` and `../../vendor/` from the archive. Both files moved together, because `three.module.min.js` imports `./three.core.min.js` relatively. Verified V2 booted from the new path **before** any folder moved.
2. **`game/` was not redirected, it was replaced.** The original went to `archive/game-v1/`, then V2 moved into `game/`. Its import map was already correct at that depth. A stub was considered and is strictly worse: a redirect is a hop that can rot, and the point was that the shared link simply works.
3. **`lakehorse.v2.*` left exactly as it is.** With one build live the prefix is vestigial, but renaming it would wipe the progress of everyone who has played. Older V1 dives stay parked under `lakehorse.*`, untouched. Adopting them into V2 is still a deliberate one-time migration belonging with Phase 8 save versioning.
4. **One door.** The V2 door and its nav button came out; the surviving door keeps `href="game/"` and `gameTally()` is a single call reading `lakehorse.v2.progress`. **The `door.game.*` site_text keys were kept rather than retired**, which reverses what this checklist assumed: the band has their own wording stored against `door.game.blurb`, and renaming the key would have silently thrown their copy away. `door.gameV2.*` had no stored override, so retiring it cost nothing.

**The archive still runs.** It was repointed at the root `vendor/` rather than handed a private copy, so `archive/game-v1/` is a playable build if served rather than 740K of files that no longer resolve. It has no door and nothing links to it.

---

## Decisions worth not relitigating

- **Unreal is not the runtime, and cannot be.** Epic dropped HTML5 export at 4.24; UE5's only browser path is Pixel Streaming, a GPU server per concurrent player. The game's distribution property is that a fan taps a link from an in-app browser and is playing in seconds. Unreal may still be used offline as a lookdev reference or an asset bakery, gated on the page-weight budget.
- **No build step, ever.** `git push` is the whole deploy.
- **`vendor/` belongs to the repo, not to a build.** It sits at the root precisely so no build is load-bearing for another. Anything that moves a folder containing an import map has to fix the relative depth to it.
- **The original is frozen and archived.** It stops receiving fixes and no longer has a door. Its one post-freeze edit is the import map, which was forced by the vendor move and is annotated as such in its own `index.html`. What landed on it before the freeze is in `docs/v1-handoff.md`.
- **Not adopted from aaabench:** its `HARNESS-RULES.md` operator-blindness rules, which exist to keep an unassisted benchmark run clean and are the opposite of a working session.

---

## House style, non-negotiable

Every module opens with a prose header explaining why it is shaped the way it is, often naming what was tried and what broke. Comment density is high, spelling is British, comments justify rather than restate. Every tunable lives in `config.js` with its own rationale. Frame-rate independence via `1 - Math.exp(-rate * dt)`. Shaders inline, always paired with `customProgramCacheKey`. **No em dashes in player-facing copy:** rewrite the sentence, do not swap in a comma.
