# Phase 1b — audio

Working plan. Retires into `game-v2/PROGRESS.md` when the phase closes; that file
stays the continuity document and this one is scaffolding.

## The spine

`Game.js:571` sends six values to `AudioDirector.update()` every frame:

```js
{ position, breathFraction, panic, belowThermo, trip, speed }
```

The method reads **two**: `trip` and `breathFraction`. The other four have been
computed and handed over every frame since the fork and thrown away. The file's
own JSDoc lists `{panic, belowThermo, trip, speed}`, which is wrong in both
directions: it omits the two that are read and promises four that are not.

Phase 1b is those four, plus two items that are not about `update()` at all:
the playlist preload V1 already has, and ducking.

| # | Item | Driven by | State |
|---|---|---|---|
| 1 | Spatialisation | `position` | unread |
| 2 | Thermocline muffle | `belowThermo` | unread, and promised by `config.js:569` |
| 3 | Heartbeat scaling | `panic` | unread |
| 4 | Flow noise | `speed` | unread |
| 5 | Ducking | one-shots | absent |
| 6 | Playlist preload | — | V1 has it, V2 does not |

## Decisions

### 1. The listener is the kelpie, not the camera

Pillar 2 settles it: you steer an animal, not a camera. It is also the cheaper
and steadier answer. The camera rides a spring behind her, so listening from it
would smear every pan with the rig's lag, and `Rig.update()` runs *after* the
audio update anyway, so the camera pose available at that moment is a frame old.
`Kelpie.forward` is rebuilt from the quaternion every frame (`Kelpie.js:894`),
which is the second vector the maths needs.

**Hand-rolled, not `PannerNode`.** The 3D listener API is split across browsers:
`AudioListener.positionX` as an AudioParam on some, the deprecated
`setPosition()`/`setOrientation()` on others, and this game's distribution
property is that it works in a phone's in-app browser. A `StereoPannerNode` plus
a gain plus a lowpass, with the curves computed in JS, has no such split, is
testable without an AudioContext doing geometry behind us, and matches the file's
existing habit of synthesising rather than delegating.

**Shape:** `sfx()` builds a three-node head per one-shot and points its local
`out` at it, so every case in the switch is spatialised without touching one line
of the switch. Three extra nodes against the oscillators a shot already makes is
nothing.

- **Pan** from the lateral component against her right vector, capped at ±0.75.
  Nothing hard-pans: on headphones a hard pan is disorienting, and on the phone
  speaker most of this plays through it is thrown away.
- **Gain** falls off inverse-square-ish with a reference distance.
- **Muffle** rides distance too, because water eats the top end long before it
  eats the level. Interpolated in log space, for the reason the choke already
  documents: linear travel from 18 kHz spends its whole range inaudible.

**No `at` means centred and unattenuated.** A sound with no position is happening
*to* you rather than near you: the tail beat, the warning, the heartbeat, the
chest chord. Only the call sites that should carry a position change.

The diver is the real prize here. He is the one entity that persists at a
distance and makes noise, and `grip_lost` at his actual position tells you where
he went.

### 2. The thermocline muffles the lake, not the record

`config.js:569` promises "more muffled audio" below the layer and nothing
implements it. The trap is reaching for the existing lowpass, which would wreck
the one cue the config is emphatic about:

> When you hear the record go muffled, you're drowning.

Two different states cannot share one signal. So the cold layer gets its **own**
filter, on the **ambience and SFX buses only**, and the music bus stays clean
past it. Pillar 3 agrees from the other direction: the album plays straight
through, and it does not go dull because you swam deep. Below the layer the lake
goes quiet and dull around a record that carries on exactly as it was, which is
both a better scene and a cue that cannot be confused with drowning.

This is the last of the layer's three cues. The knock and `cold_in` mark the
crossing; this is the sustained state you are in afterwards.

### 3. The heart speeds up

Today it is `setInterval(…, 900)` at fixed volume and fixed pitch, so the first
moment of panic and the last breath sound identical, and the timer drifts against
the audio clock because it is wall-clock.

`panic` is already 0..1 across the panic band (`Breath.js:45`). Rate, level and
pitch all ride it. A self-rescheduling `setTimeout` replaces the interval, so the
delay can be recomputed from current panic on every beat.

`_beat(on)` keeps its contract with `duck()` — the pause menu still silences it
without clearing what panic wants.

### 4. Speed has a sound

Water rush on the ambience bus: one noise chain built at start, gain and cutoff
tracking `speed`. Quiet by design and under the bed rather than over it. The
boost has a beat per kick and no sense of water moving past, which is half of
"the fins bite" missing.

### 5. Ducking is automation, not sidechain

Web Audio's `DynamicsCompressorNode` has no sidechain input, so the `audio-design`
pack's no-middleware alternative is the only route: dip the music bus on the
one-shot and release it. The pack's release window (300–500 ms) transfers; its
10 ms attack does not, being written for dialogue over a loop rather than a band's
own record, where that fast a dip clicks. 45 ms in.

**Only the sounds that carry information duck:** `chest`, `page`, `warn`,
`grip_lost`. Emphatically **not** `kick` — it fires several times a second, and
ducking on it turns the record into a pumping mess. That single exclusion is the
whole difference between ducking that works and ducking that ruins the album.

`duck(on)` stays what it is, the pause menu's master dip. The new one is internal
and rides the music bus.

### 6. Preload, ported from V1

V1's arm-and-fire split (`game/src/audio/AudioDirector.js:380`) comes across with
`CFG.audio.playlist.preload = 20`. The port carries a bug fix V2 still has and V1
does not: V2's `ended` and `error` listeners are ungated, so a **draining** deck
reaching its own natural end fires `ended` and advances a second time, cutting
the incoming track off after one crossfade. V1 gates both on `live()`. The two
land together because the arm introduces a third deck state that makes the gap
worse, not because they are the same fix.

V2's WebKit `currentTime` try/catch stays; it postdates the fork on this side.

## Config

Every tunable to `CFG.audio`, each with its rationale at the declaration:
`playlist.preload`, `spatial`, `thermo`, `heartbeat`, `duck`, `flow`.

## Verifying

A headless tab reports `visibilityState: hidden` and the game auto-pauses, so
none of this can be driven through the render loop. Exercise `AudioDirector`
directly in a real page instead and read the node graph back: `pan.value`,
`gain.value`, `frequency.value` are all observable, and the curves are the thing
under test.

## Gate

Phase 1b does not close Phase 1. After it: freeze the `config.js` movement
numbers, and only then Phase 2.
