# Underwater projection

> Picking this up in a new session or on another machine? Read `HANDOFF.md` first (mechanics, frame pipeline, how to extend).

WebGL2 visuals for a video projector. Light on black: a projector adds light, it cannot darken, so
"underwater" is moving caustics, glints, bubble rims, froth and creatures over a tinted wash.
Plain classic `<script>` tags, no build step, no dependencies. Open `index.html` (or serve the folder).

## Layout

```
index.html                  host page: panel markup + script tags (load order matters)
engine/
  util.js                   constants, helpers; creates the FluidFX namespace
  params.js                 parameter schema, validation, defaults
  physics.js                level cycle, orientation, bubble formulas, wave field
  sim.js                    bubbles, froth, wetness, pop ripples
  fauna.js                  fish schools, jellyfish, rays, anglerfish
  scenes.js                 scene registry + shader composition
  shaders/                  common (wave field, ripples, fold perspective), water (shared water look), room (ceiling + floor),
                            space (negative-space pass), creatures, passes
  engine.js                 runtime: state, ports, GL passes, loop, panel, fold handles, keys
scenes/
  fluid fx/                 one file per scene
    caustics.js  god-rays.js  deep-drift.js  rising-liquid.js  line-art.js
```

## Adding a scene

Create `scenes/<category>/<name>.js`, add a `<script>` tag before `engine/engine.js`:

```js
FluidFX.registerScene({
  id: 6, key: 'my-scene', name: 'Mine', category: 'fluid fx',   // id = `mode` value and number key
  waterline: true,            // has a surface (level cycle, froth, wet film)
  mono: false,                // line-art output
  space: 'pools',             // signature negative space: off | pools | curtains | drops | lanterns
  fauna: { fish: 20, jelly: 2, manta: 0, angler: 0 },           // counts at Amount = 1
  style: { rays: 0, snow: 0, vignette: 0, caustic: 1, fauna: 'translucent' },  // lit | silhouette | bioluminescent | translucent
  // glsl: `vec3 scene_my_scene(vec2 p, float t, vec3 Ld){ ... }`  // optional: replaces the shared water shader
});
```

A custom `glsl` can use everything in `engine/shaders/common.js` and `water.js`
(`fieldH`, `surfaceY`, `caustic`, `foamLayer`, `isoline`, `maskUV`, ...). See `scenes/fluid fx/line-art.js`.

## On a stage: negative space

A projector can only add light, so the dark is the composition. Left alone, a full-field scene lights every pixel (the
caustic, rays and deep scenes measured 0-0.2% true black, no empty 32 px block anywhere): it washes the performers and
the backdrop and shows the projector's rectangle. One pass (`shaders/space.js`) decides where no light is emitted, and
every other pass obeys it. Each scene picks a signature composition; the `space` parameter overrides it.

| Composition | Look | Default for |
|---|---|---|
| Pools | patches of light drift over an unlit floor; their edges ripple with the waves and pop rings | Caustics, Lines |
| Curtains | light only inside shafts that fan down from above, dark corridors between | Rays |
| Drops | the scene lives inside drifting drops that merge and pinch apart; glass rim, lens at the edge | Liquid |
| Lanterns | the dark is black except around creatures; each is a lamp, marine snow shows only in its light | Deep |

Parameters (group *Negative space*, all ports): `space` (Scene default / Off / the four), `spaceAmt` Darkness (share of the
frame left dark), `spaceSoft` edge softness, `spaceDrift` speed, `blackPoint` (crushes the dim wash to true black, 0 =
off), `edgeFade` (dissolves the frame edge so the image floats instead of showing a lit rectangle). Bubbles obey the dark
too. Inverted line art opts out (the compositor would turn the dark white).

True black at default settings, share of pixels at 0-2/255 (before -> after; empty 32 px blocks in brackets):
Caustics 0 -> 49% (0 -> 30%), Rays 0.2 -> 54% (0 -> 31%), Deep 0 -> 89% (0 -> 78%), Liquid at level 0.5
45 -> 74% (43 -> 60%) and at level 0.9 2 -> 55% (0 -> 44%), Lines 87 -> 96% (22 -> 68%).

## Room: wall, ceiling, floor

A short-throw projector can hit the back wall and the ceiling (and floor) with one frame. Level the projection, then
mark where the corners fall in the frame; the page draws what each surface should show:

- **wall** (between the two lines): the normal side-on underwater scene, the surface at its top edge.
- **ceiling** (above `horizon`): the water surface seen from below. Ripples are squeezed toward the corner by perspective,
  a bright Snell's window sits overhead, the surface turns to a dim silvery mirror toward the horizon, and bubbles that
  reach the corner pop into froth and rings on the ceiling.
- **floor** (below `floorLevel`): the seabed seen from above, with the caustic network landing at full strength.

| Port | Meaning |
|---|---|
| `horizon` 0.3..1 | wall top as a fraction of the frame height up from the bottom. 1 = no ceiling |
| `floorLevel` 0..0.5 | wall bottom, same measure. 0 = no floor. The wall keeps at least 0.25 between the two |
| `lookUp` 0..1 | perspective strength: 0 = flat plan view, 1 = strong squeeze toward the corners |
| `snell` 0..1 | Snell's window / mirror contrast on the ceiling |

With a ceiling the surface is pinned to its corner, so the rise/drain cycle is off (it is still there with `horizon` = 1).
On the page, two dashed lines with grab tabs (*horizon*, *floor*) can be dragged to the real corners; they hide with the
panel (`H`), when the cursor goes idle, and in `?embed=1`. `rotation` / `flipH` / `flipV` apply to the whole room.
The same lines for a host that draws its own handles: `getLayout()` or `water:layout`, returning
`{wall:{top,floor}, hasCeiling, hasFloor, folds:{horizon:[x0,y0,x1,y1], floorLevel:[...]}}` in 0..1 screen coordinates
from the top-left.

## Fauna depth, blocking and shadows

Each creature roams between the front of the floor plane (depth 0) and the back (1), and shrinks a little as it goes back.
Near creatures block the light behind them and cast a shadow on the background, offset away from the light; both the
blocking and the shadow fade to nothing toward the back, as if the creature passed behind the objects on the stage.
Ports (group *Fauna*): `faunaDepth` (how far back they roam; 0 keeps everyone in front), `shadow` (strength; 0 = off).
Shadows are drawn in the shared water scenes; the Lines scene has no shadow. Shadows land on the wall, and, when the room has a
floor (`floorLevel` > 0), as footprints on the seabed: depth 0 maps to the frame's bottom edge and depth 1 to the wall/floor fold,
with the same `lookUp` squeeze as the floor itself, so a creature swimming back shrinks and slides toward the fold. Footprints are
flattened (seen from above) and share `shadow` strength; no floor, no footprints. Checked on/off in Caustics; the footprint of a
creature far back is small and faint by design.

## Object avoidance (camera / detector input)

The host sends detected objects and the elements steer around them, like repelling magnets: no push at the `Clearance`
distance, growing as an element gets closer. Creatures and bubbles avoid; creatures swimming at the very back (see depth)
pass behind instead, so the push fades with depth like the blocking and shadows.

- `setObstacles([{x, y, w, h}, ...])` or `postMessage {type: 'water:obstacles', boxes: [...]}`. Coordinates are 0..1 of the
  output frame from the top-left; `{x, y, r}` is a centre + radius (fraction of frame height). Call it on every detection
  frame; `[]` clears. Up to 32 boxes. `getObstacles()` returns the current list. Rotation, flips and the room layout are
  applied here, so send what the camera saw mapped to the projected frame.
- Parameters (group *Avoidance*, all ports): `avoid` creature strength (0 = off), `avoidMargin` clearance, `avoidBubbles`,
  `avoidHold` seconds an object is kept after detection drops out, `avoidSmooth` smoothing of box jitter, `avoidShow`
  draws the boxes on the page for calibration (page overlay only, not in the canvas output).
- Keep-out hole: `keepOut` (0 = off, default; 1 = no light at all inside a detected box) and `keepOutSoft` (edge feather, fraction
  of frame height). Applied last, in the composite pass, so it darkens everything (water, creatures, bubbles, bloom) and is in
  the canvas output. Uses the smoothed/held boxes, so it follows `avoidHold` and `avoidSmooth`. In inverted line art the hole
  comes out white (the unlit colour). Verified in Caustics with one box; not tried with a real detector.

## Ports (extension points)

Everything a host needs is on `window.WaterProjection` and `postMessage`. Every control above, and every slider on the
page, is a parameter in the manifest: a host can hide the page's panel (`?embed=1`) and build the same controls
wherever it likes from `getManifest()` (`group` and `label` are meant for that), then drive them with `setNormalized`.
Dragging the page's own handles calls the same path, so a host's controls stay in step through `subscribe` / `water:state`.

| Port | What |
|---|---|
| `params` / `getManifest()` | every parameter: `id`, `address` (`/water/<id>`), `label`, `group`, `type` (float/int/enum/bool), `min`, `max`, `step`, `default`, `options` |
| `getState()` / `setState({id: value})` | real units, validated and clamped |
| `getNormalized()` / `setNormalized({id: 0..1})` | 0..1 for every parameter (bools 0/1, enums stepped); values round-trip without drift |
| `send('/water/hue', 0.5)` | OSC / MIDI-bridge style, normalised; `/water/hue/raw` takes real units |
| `subscribe(fn)` | called with the new state on every change; returns an unsubscribe |
| `getLayout()` | where the wall/ceiling and wall/floor corners sit on screen (see Room) |
| `scenes` | `{id, key, name, category, waterline, mono, space}` for every registered scene |
| `setMode(id)`, `setLevel(0..1)`, `pause()`, `resume()` | transport |
| `onframe` | `{t, level, bubbles}` once per frame |
| `canvas` | the output; `canvas.captureStream()` for another tool |

`postMessage` in: `water:set {state}`, `water:setn {values}`, `water:get`, `water:schema`, `water:layout`, `water:pause`, `water:resume`.
Out: `water:ready {schema, scenes, state, normalized, layout}` (on load, when framed), `water:state {state, normalized, layout}`,
`water:schema`, `water:layout {layout}`.
URL: `?embed=1` hides the panel; `?mode=4&hue=190` (or `#mode=4&hue=190`) sets parameters.

Not built here, intended for the host through these ports: audio reactivity (drive `setNormalized` each frame),
keystone / projection mapping (take `canvas`), multi-display handling, bubble coalescence.

## Keys

`1`-`9` scene, `F` fullscreen, `H` hide panel, `Space` pause, `Up`/`Down` level, `R` restart cycle, `L` line style.
