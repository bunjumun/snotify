# Lakehorse Swimulator V1 — improvement handoff

**Target:** the live game at `music-player/game/`, reachable from the album page as `🐴 Game`.
**Status of that build:** live, played by visitors now. Every change here must keep it shippable.
**Written:** 2026-08-12.

This document is self-contained. You do not need any prior conversation to execute it.

---

## Where these items come from

They are the subset of a survey of the game against [aaabench](https://github.com/ukanwat/aaabench) (MIT) that is **safe to land on a live build**. aaabench is an AI benchmark that builds an open-world game in Unreal Engine 5; its engine is irrelevant here, but two of its documents state production standards as hard numbers and those transfer directly:

- `docs/workflow/systems.md` ranks game feel by perceptual impact and gives timings: hit-stop 2–6 frames, **input buffering 80–120 ms**, coyote time ~100 ms, and audio feedback within **12 ms** of the action.
- `.claude/skills/game-feel/SKILL.md` gives the supporting curve values.

Where an item cites a number, that is its source. Where an item is simply a bug, it is marked as one.

A larger programme of work (world density, a second region, performance architecture, accessibility) is deliberately **not** here. It is going into a separate V2 build behind its own door on the album page. Do not pull it forward.

---

## Hard rules

1. **Do not change movement metrics.** No edits to kelpie speed, drag, turn rate, thrust or cooldown values in `config.js`. Distances, spawn placement and clue radii are all tuned against them.
2. **Do not change save keys.** The album page's `gameTally()` reads `localStorage['lakehorse.progress']` directly ([index.html:197-209](../index.html)). Renaming or restructuring it silently blanks the door's tally.
3. **Do not add a build step.** The game vendors Three.js and has no bundler. `git push` is the whole deploy, and that is the property the game is designed around.
4. **Match the house style.** Every module opens with a prose header explaining *why* it is shaped the way it is, comment density is high, spelling is British, and comments justify rather than restate. New tunables go in `config.js` with their own rationale, never hardcoded at the use site.
5. **No em dashes in player-facing copy.** If a sentence wants one, rewrite the sentence. Do not substitute a comma.

---

## 1. The playlist never buffers ahead

**Type:** bug, and the most audible problem in the game.
**Files:** `game/src/audio/AudioDirector.js`, `game/config.js`

`_pumpPlaylist()` (:422-427) opens the crossfade when the live deck has `crossfade` seconds left:

```js
if (el.duration - el.currentTime <= CFG.audio.playlist.crossfade) this._advance();
```

`CFG.audio.playlist.crossfade` is 6 (`config.js:548`). `_advance()` calls `_play()`, which assigns the incoming track's source **at that same instant** (:372) and immediately begins ramping its gain toward 1:

```js
next.el.src = track.url;
...
next.gain.gain.setTargetAtTime(1, now, Math.max(0.05, fade / 3));
```

So `el.preload = 'auto'` (:338) never has a chance to do anything. The incoming track starts downloading at the exact moment it starts fading in. On a phone on mobile data, every track transition fades up into a track that is still buffering, which is the worst possible moment for it.

**Fix.** Split `_play()` into *arm* and *fire*:

- **Arm:** set the idle deck's `src` roughly 20 seconds before the crossfade window, and let `preload = 'auto'` buffer it. Add `CFG.audio.playlist.preload: 20` with a comment explaining it must comfortably exceed `crossfade`.
- **Fire:** at crossfade time, only `play()` and ramp the gains. If the armed track is not the one being requested (a skip happened), fall back to today's behaviour of assigning `src` and playing immediately.

**Four guards must survive the split.** Each exists for a reason documented in the file:

| Guard | Where | Why it matters |
|---|---|---|
| `_advancing` latch | `_advance()` :396 | Stops a double-advance racing the crossfade. |
| `_fails` budget | `_trackFailed()` :409-416 | A playlist of dead URLs otherwise spins as fast as the network can refuse it. **An armed deck erroring before it is live must not spend the live track's budget.** |
| one-track `el.loop` | `_play()` :369 | Crossfading a song with a second copy of itself is worse than a clean loop. |
| WebKit `currentTime` throw | `_play()` :375 | Seeking before metadata throws on some WebKit builds, which would leave `_advancing` stuck true and stop the record for the session. |

`skip()` (:429) sets `_advancing = false` and advances. It must invalidate or re-arm the armed deck.

**Verify:** throttle the network to Slow 3G in devtools and listen across two transitions. Before the fix the incoming track is silent or stutters through its fade-in; after, it is already buffered.

---

## 2. The kick is silent

**Type:** missing feedback. Highest perceived-quality gain per line of code in this document.
**File:** `game/src/audio/AudioDirector.js`

Tapping to kick is the most frequent action in the game. `sfx()` (:538-555) has cases for `baggie`, `lighter`, `fish`, `warn`, `grip_lost`, `grip_regain`, `page`, `chest` and `bong`, and **none for the kick**. The most common thing a player does makes no sound.

`systems.md` puts sound timing third in its impact ranking and asks for feedback within **12 ms** of the action. The kelpie already sets `this.kicked` and `this.kickPulse = 1` on the frame of the beat (`Kelpie.js:900-905`), and `Game.js` already reads it to emit a bubble puff from `tailPoint()`, so there is an existing hook to call from.

**Fix.** Add a `kick` case built from the existing local `tone()` and `noise()` helpers. It wants to read as water displaced by a large animal rather than as a UI blip: a short low noise body with a fast decay, not a tone. Keep it quiet. It fires several times a second and must not fatigue.

---

## 3. Every SFX repeat is bit-identical

**Type:** polish.
**File:** `game/src/audio/AudioDirector.js`

Every case in `sfx()` uses hardcoded frequencies and durations, so picking up ten baggies plays the same waveform ten times. The ear reads exact repetition as synthetic immediately. The ambience and `_bong()` are already randomised; the one-shots are not.

**Fix.** Apply a small random pitch multiplier per invocation, on the order of ±5%, inside `tone()` and `noise()` so every case benefits without touching the switch. Exempt `chest`, whose chord is a fixed reward and should stay exact.

---

## 4. `interact` is dropped when pressed a frame early

**Type:** feel. `systems.md` — input buffering, **80–120 ms**.
**File:** `game/src/input/InputBus.js`

`update()` computes both action edges as pure one-frame rising edges (:79-88):

```js
i.interact = r.interact && !this._prevInteract;
i.kick     = pressed && !this._prevThrust;
```

An `interact` press is consumed on exactly the frame it goes down. Press E one frame before you cross into `useRadius` and the input is gone with no feedback, which reads as the button not working.

**Fix.** Buffer `interact`: record the timestamp of the rising edge, present `i.interact` as true while the stamp is within `CFG.input.bufferMs` (set it to 110), and clear the stamp when a consumer acts on it. The consumer must be able to consume it, or a single press fires repeatedly for the whole window.

### The judgment call on `kick` — read before touching it

It is tempting to buffer `kick` the same way. **The current behaviour is deliberate and documented.** `Kelpie.js:898-899`:

> A beat inside the cooldown is dropped rather than queued: mashing should hit a ceiling, not bank credit that spends itself later.

A naive 110 ms buffer against a 150 ms cooldown re-introduces exactly the banked credit that comment rejects. Do not do it on this build. If a kick buffer is wanted later, the defensible version is a window *well* under the cooldown (60–80 ms), framed as forgiveness for timing granularity rather than as queueing, and it should be play-tested against the mashing case specifically. Leave it for V2 where the movement metrics are being re-locked anyway.

---

## 5. Low quality draws zero sparkles

**Type:** bug. Affects every player on the low quality setting.
**File:** `game/src/fx/Particles.js`

The system packs two populations into one buffer: `SILT = 700` at indices 0-699 and `SPARK = 260` at indices 700-959, `N = 960`. `setQuality()` (:149-152) scales the draw range from the front:

```js
this.geo.setDrawRange(0, Math.floor(this.N * s));
```

At low quality `particleScale` is 0.4 (`config.js:584`), giving `floor(960 × 0.4) = 384`. That range stops at index 384, which is **entirely inside the silt block**. On low quality no sparkle is ever drawn, and 316 silt particles are simulated every frame without being rendered.

**Fix.** Scale each population independently. The system is one draw call by design, so a single contiguous range cannot express two scaled populations. Either place the two blocks so a scaled range covers a proportional slice of each, or scale by writing dead particles' sizes to zero rather than by shortening the range. Keep it to one draw call. The header comment at :8 states that property.

**Verify:** set quality to low, start a trip, and confirm sparkles appear.

---

## 6. The prompt erases itself

**Type:** bug with gameplay consequences.
**File:** `game/src/core/Game.js`, `game/src/ui/HUD.js`

`HUD.say()` (:106-112) is a single last-writer-wins slot with no queue and no priority. `Game.js:671` calls it **every frame** while the player is inside a bong's `useRadius`:

```js
this.hud.say('<kbd>E</kbd> to hit it', { seconds: 0.4 });
```

Because the 0.4-second timer is refreshed every frame, this prompt continuously overwrites anything else trying to speak: the low-breath warning at :729, fish dialogue, and pickup counts. A player circling a bong on low air can have the warning suppressed entirely.

**Fix.** The minimal safe version is to stop re-issuing an identical prompt: only call `say()` when the message changes or the previous one has expired. The fuller version is a priority argument on `say()` so a breath warning outranks a use prompt. Prefer the minimal version on this build, and leave the priority queue for V2.

---

## 7. The Recentre button does nothing and says it worked

**Type:** bug.
**Files:** `game/src/main.js`, `game/src/core/Game.js`

`main.js:210-213` wires the settings button:

```js
document.getElementById('btnRecentre').onclick = () => {
  game.tilt?.recentre();
  game.hud.say('Recentred.', { seconds: 1.5 });
};
```

`game.tilt` is never assigned. Tilt input is fully implemented in `src/input/Tilt.js`, including the hard parts (iOS permission, neutral capture, screen-orientation correction), but its registration is commented out in `Game._initInput()` (:311-312) and `CFG.input.tilt.enabled` is `false`. The optional chain swallows the call and the player is told it worked.

**Fix on V1: remove the button.** Telling someone an action succeeded when nothing happened is worse than not offering it. Wiring tilt on properly is a V2 job, since it needs its own play-test pass and a sensitivity setting (`CFG.input.tilt.sensitivity` is declared and never read).

---

## Out of scope for this handoff

Do not attempt these here. They are V2 work and they change how the game feels or how the world is laid out:

- Hit-stop and any `timeScale` hook on the loop.
- The trauma-model camera shake rewrite and its new call sites.
- Seabed impact response (`Seabed.clampAbove()` currently discards its return value and never touches velocity).
- Audio spatialization, thermocline occlusion, and the four parameters `Game.js` passes to `AudioDirector.update()` every frame that it never reads.
- Anything touching `Rng` streams, wreck placement, or world generation.
- Performance architecture: LOD, the boids inner loop, the adaptive quality sampler.
- Accessibility: `prefers-reduced-motion`, ARIA, keyboard navigation.

---

## Verification

Serve the site from its root so relative paths resolve as they do in production:

```bash
cd /Users/bunj/claude/music-player && python3 -m http.server 8899
```

Then open `http://localhost:8899/game/`.

1. **Console clean** on load and through a full run.
2. **`?debug`** appends an overlay with an fps readout. Record it before and after; none of these changes should cost frames, and item 5 should give a little back on low quality.
3. **Full playthrough:** intro, find the chest, run out of breath, claim the reward.
4. **Audio, throttled.** Set the network to Slow 3G and listen across two track transitions. This is the acceptance test for item 1.
5. **Low quality specifically**, for item 5.
6. **Phone-shaped viewport**, reloaded, since the audio fix exists for mobile data.
7. **The album page tally still reports.** Open `http://localhost:8899/` after a run and confirm the game door shows dive stats rather than "Not dived yet". This proves the save keys were not disturbed.

Commit on a branch off `main`, not on `main` directly.
