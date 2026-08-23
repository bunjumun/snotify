# CR-77: spaceship wrecks — build plan

Written 23 Aug 2026, manager-snalbum pass, after he answered "Go, use the
image attached to 'Jupiter Gold' for inspiration" in the OUTBOX. Not built
yet — sized past a session's work per CLAUDE.md's ceiling, so this plan
stands in place of code for this pass. Whoever builds it should read this
first, then pull the Jupiter Gold cover art (Supabase, Band assets, song
"Jupiter Gold") for the dazzle-camo direction before touching geometry.

## Scope, as answered

Literally replace the wreck's ship-ness with spaceship-ness. Not an
environmental change: same clue system, same landmark mechanic, same
number of features on the wreck. Bow, boiler and mast become spaceship
parts, in shape and in name, and the whole hull wears a dazzle camo skin
from the existing generator (art-tools.html's dazzle tool).

## Where the geometry lives

`game/src/world/Wreck.js` (278 lines) is the entire wreck: a parametric
hull built from stern-to-bow stations (`_buildHull` around line 62), a
`boiler` group (~line 193-218, currently a cylinder cluster read as a
ship's boiler), and a `mast` (~line 249-266, a fallen cylinder + yard).
Each has a `_mark(...)` call that registers it as a named, clickable
landmark for the clue system — the rename has to happen at both the mesh
and the mark string, together, or the landmark name and the object it
points at will disagree.

Suggested part mapping, open to a better read of the reference image:
- bow → prow / nose cone (keep the hull taper, the "entry sharpens" logic
  already does most of the work of a nose cone)
- boiler → reactor core / drive core (keep the cylinder cluster silhouette,
  it already reads as a large cylindrical engine)
- mast (fallen, per the comment "a standing mast would read as a ship at
  anchor") → snapped antenna mast / sensor boom, same "fallen, not
  standing" logic carries over unchanged

## Dazzle skin

`art-tools.html`'s dazzle generator already produces a pattern usable as a
texture. Wreck.js currently uses flat materials (`this.woodMat` etc. —
check current material list before writing code). The task is to generate
or reuse a dazzle texture and apply it as the hull's material map, not to
build a new generator. If the generator's output is canvas-based, it will
need to run once (build time or load time) and hand Three.js a
`CanvasTexture` or a pre-baked image asset — decide which by checking
whether the generator is client-side JS already reachable from the game
bundle or needs porting.

## Text that has to move together with the geometry

These files reference bow/boiler/mast as narrative landmarks, clue text,
or audio cues, and the vocabulary swap has to land in all of them in the
same change or the game will narrate the old ship mid-dive about a
spaceship wreck:

| File | Hits | What it's doing with the words |
|---|---|---|
| `game/src/world/Wreck.js` | 13 | the geometry and its `_mark()` labels |
| `game/src/game/Trip.js` | 10 | trip/dive narration referencing landmarks |
| `game/src/audio/AudioDirector.js` | 10 | audio cue triggers keyed to landmark names |
| `game/src/entities/Bong.js` | 10 | bong placement/flavour text near landmarks |
| `game/src/core/Game.js` | 10 | wiring, likely just passes the strings through |
| `game/src/game/Clues.js` | 3 | clue text naming the landmarks |
| `game/src/entities/School.js` | 2 | probably incidental, check before assuming |
| `game/src/entities/Kelpie.js` | 2 | probably incidental, check before assuming |
| `game/src/ui/Logbook.js` | 1 | logbook copy |
| `game/src/world/Species.js` | 1 | check before assuming relevant |
| `game/src/world/Shoals.js` | 1 | check before assuming relevant |

Grep for `boiler`, `mast`, `\bbow\b` fresh before starting — this table is
a snapshot from 23 Aug and the count will drift.

## What stays sea

Per the answer, this is a skin/vocabulary swap, not new environment: keep
the seabed, the water, the diver, the clue mechanic, the dive structure
all exactly as they are. A spaceship wreck sitting on a sea floor being
explored by a diver is the intended, slightly absurd image — do not
"fix" that by changing the setting.

## Sizing, why this stopped for a plan

Real geometry/material work (new hull silhouette read, texture pipeline
for the dazzle skin) plus a vocabulary swap touching at least 11 files and
some number of narrative/clue strings that can't be found by grep alone
(prose that describes the shape without using the literal words "bow",
"boiler" or "mast"). That combination is what the CLAUDE.md ceiling means
by "more than about a session's work," not any single piece of it.

## Before shipping

- Reproduce the house style: every touched module's prose header should
  say what changed and why, matching the existing header on Wreck.js.
- Confirm the clue system still resolves correctly — a landmark whose
  `_mark()` label changed has to still match whatever string the clue
  text or audio trigger looks it up by.
- Verify live the same way CR-79 was: hash the deployed game files against
  the repo after push, don't trust git alone.
