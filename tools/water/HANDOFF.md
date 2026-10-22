# HANDOFF - read this first (for a Claude session on another machine)

Underwater projection page: WebGL2, plain classic `<script>` tags, no build step, no dependencies, no git.
Open `index.html` by double-click, or serve the folder (`python3 -m http.server 8771`) and visit http://localhost:8771.
`README.md` is the user-facing reference (ports, parameters, keys); this file is the "how it works and where to change it" guide.
Last worked 2026-10-22.

## What it is for

A video projector hits a back wall plus ceiling (+ floor) in a room. A projector can only ADD light, so the dark is the composition:
everything is light on black. The page is meant to be embedded in the user's larger "compilation" tool, which owns controls,
audio reactivity, keystone/projection mapping and multi-display. **Do not build those here** (see rules below).

## Rules the user set (keep following them)

- Every new control goes in the `SCHEMA` in `engine/params.js` so it appears in the manifest. The host places controls where it likes;
  the page's own panel is generated from the same schema. Ports are the integration surface ("ports" = extension points).
- Out of scope on purpose: audio reactivity, keystone/projection warps, multi-display management, bubble coalescence.
  Extend the ports/docs instead of building these.
- Be terse in chat. Verify visually (screenshot) before claiming a visual feature works; a `file://` preview pane may not run scripts,
  so serve over http for checks.
- Read-back pixel values of the WebGL canvas return black (no `preserveDrawingBuffer`): verify with screenshots, not `getImageData`.
- Test a new check on degenerate input first (silence / empty) - an all-zero readback looks like a pass.

## Layout

```
index.html                host page: panel markup + script tags (LOAD ORDER MATTERS; scenes before engine.js)
engine/
  util.js                 constants, helpers, creates the FluidFX namespace (window.FluidFX)
  params.js               SCHEMA: every parameter (group, id, type, default, min, max, step, label); validation, defaults
  physics.js              level cycle (rise/hold/drain/rest), orientation matrices, bubble formulas, wave field (JS side)
  sim.js                  bubbles (typed arrays, 2000), froth map, wet film, pop ripple rings
  fauna.js                creatures: fish schools, jellyfish, rays (manta), anglerfish; depth, avoidance, instance records
  scenes.js               scene registry + composes the scene fragment shader (dispatch on uMode, room branches)
  shaders/common.js       GLSL shared by all programs: hashes, wave field, ripple rings, surface, foldPlane() perspective
  shaders/water.js        shared water look (waterScene): refraction, caustics, specular, rays, snow, shadows, fauna styling
  shaders/room.js         ceilingScene (surface seen from below, Snell's window) and floorScene (seabed from above)
  shaders/space.js        negative-space pass (where NO light is emitted)
  shaders/creatures.js    creature SDF sprites (mask pass) + shadow/footprint vertex logic
  shaders/passes.js       bubble program, bloom (bright/blur), composite (tone map, black point, dither, keep-out hole)
  engine.js               runtime: state, ports/API, GL setup, frame passes, loop, panel, fold handles, keys
scenes/fluid fx/          one file per scene, each calls FluidFX.registerScene({...})
  caustics.js  god-rays.js  deep-drift.js  rising-liquid.js  line-art.js
```

Modules attach to the `FluidFX` namespace (IIFEs taking `FX`); there is no import system. Add new scene files as `<script>` tags in
`index.html` before `engine/engine.js`.

## Frame pipeline (engine.js, render function, in order)

1. **Sim step** (fixed timestep): level cycle, bubbles, foam, wet film, pop rings, creatures (`stepOnce`).
2. **Fauna mask pass** -> `targets.mask`: each creature is an instanced quad whose fragment shader evaluates an SDF. Channels (MAX-blended):
   r coverage, g dome (0 edge .. 1 deep), b glow, a opacity.
3. **Shadow pass** -> `targets.shadow` (only if `shadow` > 0): same creatures drawn again, offset away from the light on the wall, with
   strength fading to nothing toward the back (depth 1). If the room has a floor, they are drawn a second time (`uFloorSh` = 1) as
   footprints on the seabed (see Floor shadows).
4. **Negative-space pass** -> `targets.ns`: per pixel r = reveal (0 = true black), g = rim light, b/a = lens offset. Every later pass reads it.
5. **Scene pass** -> `targets.scene`: full-screen shader from `scenes.js`. Maps pixel -> logical coords `p` via `uS2L`, then dispatches:
   `p.y > 1` and a ceiling exists -> `ceilingScene`; `p.y < 0` and a floor exists -> `floorScene` (+ footprint shadow);
   else the active scene's function (`waterScene` or a custom `glsl`). Skipped where the negative-space reveal is zero.
6. **Bubbles** (additive instanced quads; obey the negative-space mask and the waterline).
7. **Bloom** (bright-pass + separable blur, half-res) unless disabled.
8. **Composite** to screen: scene + bloom, ACES tone map, **black point** (crush dim wash to true black), dither (never on black),
   and the **keep-out hole** (multiplies by a feathered box mask before tone map). Line-art mode bypasses tone map (optional invert).

Coordinates: "logical" space is the wall: x 0..aspect (`uA`), y 0..1 with the surface near the top; the ceiling is y > 1 up to `uTop`,
the floor is y < 0 down to `uBot`. `uS2L`/`uL2S` (3x3) convert screen<->logical and already include rotation / flipH / flipV and the
room's top/floor. Screen coordinates for the host API are 0..1 from the TOP-left of the output frame.

## Mechanics by feature

**Scenes** (`scenes/fluid fx/*.js`): `FluidFX.registerScene({id, key, name, category, waterline, mono, space, fauna:{fish,jelly,manta,angler},
style:{rays,snow,vignette,caustic,fauna}, glsl?})`. `id` = `mode` value and number key. `style.fauna` is lit | silhouette |
bioluminescent | translucent. Shared water scenes just supply `SceneCfg` numbers to `waterScene`; Line art supplies its own GLSL.
Caustics, God rays (Rays), Deep drift (Deep), Rising liquid (Liquid, the default), Line art (Lines).

**Level cycle / waterline** (`physics.js`): `levelAt(cycleT, rise, hold, drain, rest)` -> 0..1; the surface rises/holds/drains when `auto`.
`waterline` scenes have a surface (froth rafts, wet film, meniscus). With a ceiling the surface is pinned to the fold and the cycle is off.

**Bubbles / froth / wet** (`sim.js`): up to 2000 bubbles with terminal velocity, oblate shape, pressure-dependent radius; they pop at the
surface into froth (512 map, double-buffered), a wet film (256 map) and ripple rings (<= 12) that the shaders read (`uRing`, `uFoam`, `uWetTex`).

**Negative space** (`shaders/space.js`): compositions `pools` (drifting light patches, edges ripple), `curtains` (shafts from above),
`drops` (merging drops with glass rim + lens), `lanterns` (dark except a glow around each creature). Each scene sets a default; `space`
param overrides; `spaceAmt` darkness, `spaceSoft` edge, `spaceDrift` speed, `blackPoint`, `edgeFade`. Inverted line art opts out.

**Room: wall / ceiling / floor** (`common.js foldPlane`, `room.js`): `horizon` (wall top, fraction of height from the bottom; 1 = no ceiling)
and `floorLevel` (wall bottom; 0 = no floor), `lookUp` (perspective strength, `ceilK`), `snell`. A plane (ceiling or floor) is seen through
`foldPlane(x, d, len, n, Q)`: `n` runs 0 at the fold (far) .. 1 at the frame edge (near); `Q = (1+K)/(n+K)` is the horizontal squeeze;
plane z = `len*(1+K)*log((n+K)/K)`. Ceiling = water surface seen from below (ripples squeezed to the corner, Snell's window, silvery mirror
toward the horizon, bubbles that reach the corner pop on it). Floor = seabed from above (caustic network at full strength, sand grain).
Two draggable dashed lines (grab tabs "horizon", "floor") set the corners; `getLayout()` returns them for a host that draws its own.
The perspective constants are an artistic approximation - not verified on a real projector, the user must tune by eye.

**Fauna** (`fauna.js`, `shaders/creatures.js`): pools fish 96 / jelly 12 / manta 3 / angler 2, counts scaled by scene profile x `Amount`.
Each has a depth 0 (front of the floor plane) .. 1 (back) that wanders; far ones shrink slightly, block light less, shade less and
are pushed less by obstacles. Instance record stride 11 (x, y, size, pitch | kind, dir, phase, alpha | aux1, aux2 | depth).
Shadows: wall shadow = same sprite offset away from the light by `0.07*(1-depth)`; strength fades to nothing at the back.

**Floor shadows (new 2026-10-22)**: only when `floorLevel` > 0 and not in line-art. In the creature vertex shader with `uFloorSh = 1`,
a creature at depth `d` has `n = 1 - d` (depth 0 = frame bottom edge, depth 1 = wall/floor fold), screen x = `uA/2 + (x - uA/2 + r.x)/Q`,
screen y = `uBot*n + r.y*0.3/Q*(1+0.5*lift)` (flattened: seen from above; higher creatures give a slightly longer footprint). It is drawn
into the same shadow target; the scene dispatcher's floor branch multiplies the floor colour by `1 - 0.75*shadow*mask`. No new param
(uses `shadow`). Verified by on/off comparison in Caustics only; far creatures' footprints are small and faint on purpose.

**Object avoidance** (`engine.js` obstacles, `fauna.js`, `sim.js`): host sends boxes `{x,y,w,h}` or `{x,y,r}` (0..1, top-left origin) via
`setObstacles` / `postMessage water:obstacles`. They are held `avoidHold` s after the last call, smoothed per index (`avoidSmooth`), then mapped
into logical coords through the orientation matrix. Creatures (`avoid`) and bubbles (`avoidBubbles`) steer away within `avoidMargin`.
`avoidShow` draws the boxes on the page only (not in the canvas output).

**Keep-out hole (new 2026-10-22)**: `keepOut` (0 = off, default; 1 = fully dark) and `keepOutSoft` (feather, fraction of frame height).
Composite pass loops the smoothed/held boxes (<= 32, uniform `uBox[32]` in screen 0..1 top-left coords) and multiplies the colour by a
feathered rounded-box mask. Darkens everything including bloom and is in the canvas output. In inverted line art the hole is white.
Verified in Caustics with one box; not tried with a real detector.

**Ports** (`engine.js`, `window.WaterProjection`; full table in README): `params/getManifest`, `getState/setState`, `getNormalized/setNormalized`,
`send('/water/<id>', 0..1)`, `subscribe`, `getLayout`, `scenes`, `setMode/setLevel/pause/resume`, `onframe`, `canvas` (`captureStream()`),
`setObstacles/getObstacles`; `postMessage` in/out (`water:set|setn|get|schema|layout|pause|resume|obstacles`, out `water:ready|state|schema|layout`).
URL: `?embed=1` hides the panel, `?mode=4&hue=190` or `#mode=4&hue=190` sets params. Keys: 1-9 scene, F fullscreen, H hide panel,
Space pause, Up/Down level, R restart cycle, L line style.

## How to extend

- **New parameter**: add a row to `SCHEMA` in `params.js` (`[group, id, type, default, min, max, step, label]`), read `state.<id>` in `engine.js`,
  upload as a uniform. It then appears in the panel and the manifest automatically.
- **New scene**: new file in `scenes/<category>/`, register it, add the script tag before `engine/engine.js`. Custom GLSL can use everything
  in `shaders/common.js` and `water.js` (`fieldH`, `surfaceY`, `caustic`, `foamLayer`, `isoline`, `maskUV`, ...). See `line-art.js`.
- **New composite effect**: `shaders/passes.js` composite fragment shader (the keep-out hole is a small example) + uniform upload at the end of the render function.

## Open / next ideas (none started)

- Floor shadows verified only in one scene; check Rays/Deep/Liquid and with a ceiling + floor together.
- Wall shadows do not yet shade the ceiling; footprints ignore the light angle (always straight down).
- Keep-out hole is a feathered box; a detector mask/contour would need a new port (host-side, probably).
- Real-projector calibration (perspective constants `ceilK`, window angles) still to be tuned by eye on site.

## Gotchas

- Script load order in `index.html` matters (util, params, physics, sim, fauna, shaders/common, water, creatures, passes, room, space, then scenes.js, the scene files, and engine.js last).
- Redeclaring a uniform with a different precision in the vertex and fragment shaders breaks the link; use `highp` everywhere.
- Shader compile errors show in the browser console (and the page stays black); check the console after every GLSL edit.
- `preserveDrawingBuffer` is off, so `drawImage`/`getImageData` of the canvas returns black.
- This project is a hand-verified visual page with no test suite.
