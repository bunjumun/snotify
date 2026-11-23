# Port handoff: bring the 2026-11-22 Guber Eats changes into the last uploaded build

Audience: the agent that owns the Lakehorse Radio box / SD copy (or whoever holds the last uploaded build). Source of truth: `esp music v1/guber-eats/index.html` (single file). Read `HANDOFF.md` beside it for the full story. Nothing here is committed or pushed. Do not commit or push unless the user says so.

## STATUS 2026-11-23: PORTED to the box (192.168.0.38), nothing left to do unless the source changes again
Done: `/game/guber-eats/index.html` + `.gz` pushed, byte-identical to source plus the injected `<script>window.LAKEHORSE_BOX = true;</script>` before the import map (the only box edit; `theme.sources` is not edited, `LAKEHORSE_BOX` switches the soundtrack to `/api/sd`). Vendor three and Content-Type were already correct. Cold load: 0 console errors, year 1200, `hCover` present, `charge('building',24)` on Struggle paid = bill (90). Re-push pattern: build one folder holding only `guber-eats/index.html` (+ `.gz`) with the marker injected, then `python3 lakehorse-radio/tools/push_game.py 192.168.0.38 <folder>`.

Also on the box now, beyond the list below: touch controls and phone layout (already there), iOS audio fix (one reused `<audio>` element, tap/key/touch retries `play()`, `navigator.audioSession.type='playback'`), dropout log `GuberEats.game.audio.stalls`, and the LKEHRSE plate no longer clips.

Verified 2026-11-23 on the box: night eras, plate, CEO and distracted-pedestrian paths, charge maths. Still not verified: iPhone 8 audio and play, shadow frame cost on a real client, money balance over a real run. Swimulator's phone-lag fix is separate (see `game/PROGRESS.md`).

---

## Do this
1. **Find the box-specific edits first.** Diff the uploaded copy against the source and list every difference that is NOT in the change list below. At minimum expect `GameConfig.theme.sources` (points at the SD audio file) and possibly import paths for `../vendor/three.module.min.js`. Write the list down before touching anything.
2. **Replace the uploaded `index.html` with the source file, then re-apply exactly those box-specific edits.** A whole-file replace is far safer than hand-merging: the changes touch ~15 places (world builder, van, economy, HUD, pedestrians, game hooks).
3. Confirm `../vendor/three.module.min.js` is on the target at the path the import map expects. No new dependencies were added.
4. Confirm the server sends correct Content-Type for `.html` and `.js`.
5. Cold-load `/guber-eats/?mute`. It must start by itself with no console errors. Then verify the checklist below. Report what changed, which box edits you kept, and anything you could not verify.

## What changed since the last upload

**Look and world** (all in `CityBuilder.build`, `Game`)
- Sun shadows following the van (desktop only; `LOW`/phones skip them).
- Crossings at every junction painted as dazzle panels, with an accent stop line (`BoxBatch.quad`).
- ~100 instanced street lamps (not solid), night light pools, sidewalk paving joints, rooftop plant rooms and antennas, drifting clouds in day eras.
- "HELL IS REAL" billboard: 2 solid in plazas, 3 on tall roofs.

**Van** (`buildVan`, `fadedBlack`, `sprayText`, `plateCanvas`)
- Faded black cargo van, "lakehorse" spray-painted on both flanks, plate LKEHRSE front and back, side windows rolled down partway with smoke leaking at all times (`Game.fumes`, `carFx`).
- Steered front wheels, brake lights brighten on brake, night headlight pool, camera leans into corners (`ChaseCamera.roll`), pedestrian walk bob.

**Money** (`GameConfig`, `Difficulties`, `Economy`, `Game`, `Pedestrians`, `HUD`)
- `GameConfig.year.seconds` 180 to 1200 (20 min = 1 year). Rent is a monthly lump (`rentShare`), insurance premium is quarterly, tax yearly. `depressionYears` 3 to 1.
- `Economy.charge(kind, speed, flat)` bills crashes: building (1 s cooldown), traffic, props, pedestrians. Config: `GameConfig.repair`, `severity`, `insuranceSurcharge`, `ceo`.
- Per-difficulty `insurance: { cover, deductible, premium }`: Nepo 85%, Middle 55%, Struggle 0%.
- CEO pedestrian (top hat, gold beam): hit him and premiums stop accruing for 120 s, no repair charge, respawns after 90 s.
- `hCover` HUD line (new `<div id="hCover">` under `hQuota`), crash callouts, rent and premium banners, estate screen rows for repairs, covered and premiums.

## Verify (after the port)
- Faded black van with the spray tag on both sides and LKEHRSE plates, smoke from the cab.
- Dazzle-panel crossings, billboard with rose H, lamps, shadows on desktop.
- Hit a wall once: one "REPAIRS" callout, then a 1 s gap. Struggle pays the full bill; Middle shows "INSURANCE COVERED".
- HUD shows `Insured 55%` (Middle). Hit the CEO: `PREMIUMS WAIVED` countdown appears.
- Console check: `GuberEats.Economy` exists and `new GuberEats.Economy(GuberEats.Difficulties.struggle, GuberEats.Decades.list[8]).charge('building', 24)` returns `paid` equal to `bill`.

## Known untested
Frame cost with shadows on a real client, phones (iPhone 8 audio and touch), and all money numbers (first guesses, tune after real play). Night eras and the distracted-pedestrian and CEO hits were checked on 2026-11-23. The SD copy lags this file again after any further change.
