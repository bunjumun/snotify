# Visualizer FX: taking in a new effect, scene or layer

For a session handed a folder built elsewhere ("here is a new effect, take it into the visualizer"). Written 2026-10-23 from what the underwater Scene layer needed (CR-153 to CR-159). The file is `tools/visualizer-fx.html`, one page, vanilla JS, one IIFE; read the prose header above whatever you touch first.

## What to ask him for

Almost nothing; read the folder. Its README or handoff says what it is. Only ask if it has no way to run on its own (then ask for the entry file) or needs a key, a server or a download.

Check before wiring: it runs from `file://` or a static server with no build step, needs no network, and says whether it is WebGL. Anything that needs a backend cannot ship on Pages.

## The three ways in

| It is | Where it goes | Pattern to copy |
|---|---|---|
| A **post effect** (reshapes the finished picture) | A new mode in the effects shader | `FX` list (`const FX = [...]`), a `fxName(px)` function and one more branch in `effect(mode, px)`; mind `grade()` and RAW being the last entry |
| A **deck scene** (a picture the two decks draw) | A new entry in `SCENES` | `{ name, viz, draw }` with a `drawName(D)` that paints `D.cx`; `D.q` holds the resolved parameters, `D.ms` the clock |
| A **layer** (its own picture, its own controls, mixed in) | Vendored beside the tool, run as it is | The Scene layer: `tools/water/` in a hidden same-origin iframe, `onframe` copies the canvas to `WATER.cv`, `compose()` mixes it after the decks, so every effect also processes it |

Prefer the layer route for anything that is already a page with its own engine; do not fold it into the one file. Prefer the effect route for a pure pixel function. A scene is for something the decks should cross-fade.

## Wiring checklist (what the Scene layer needed, in order)

1. **Vendor it**, untouched, under `tools/<name>/` (rename folders with spaces; fix its `<script>` paths). Keep its README and HANDOFF next to it. Remove `.DS_Store`.
2. **Scan it** for `fetch`, `XMLHttpRequest`, `eval`, `postMessage('*')`, outside URLs, storage. Say what you found. The water engine only used `localStorage` and a `postMessage` to its parent.
3. **Hook into the loop.** Layers: start/stop function, an `onframe` copy, a step in `compose()` (and `IDLE.g` times its alpha so idle fades it). Effects: add to the shader and the `UNIFORMS` list. Scenes: add to `SCENES` and check `OLD_SCENES` stays valid (saved looks store scene indexes; append, never insert).
4. **Controls.** Layers and effects that expose a manifest (the water engine has `getManifest()`) get their panel built from it (`buildSceneParams`), so new parameters appear without code. Otherwise add a `TARGETS` entry per thing that should be routable: then the Sound tab routes, MIDI, triggers and auto mode reach it for free. Resting levels go in `CONFIG`, never in `CONFIG.fx` (that rides in presets).
5. **Defaults off, venue-level.** A new layer ships switched off, as a rig setting (saved in `CONFIG`, not in presets), with an obvious switch (the big Water button is the model).
6. **Persist and validate.** Clamp everything read back from `localStorage` in `load()`. A saved config from the old build must still load.
7. **`?nogl`** still loads. State plainly whether the new thing works there.

## Release routine (every shipped change)

- Ledger row in `change requests/LEDGER.md` before code (next free CR number from its tail).
- Named branch off `main`; pull first, another session may have shipped.
- Build number up by one (`<title>`, `core.js` menu label, archive README line, `core.js?v=` across the 8 pages; BSD `sed -i ''`). Freeze the previous build as `archive/tools-v1/visualizer-fx-vN.html`: the two shared-chrome links become `../../tools/`, and a layer's `src` becomes `../../tools/<name>/index.html`.
- Test cold in a browser at 1280x800: load the URL, touch nothing, confirm it runs itself; then toggle it, drive it, reload and confirm it comes back; every effect over it; `?nogl`; no console errors. A background browser pane stops animation: front it before judging a frame.
- Commit, merge, push, confirm on https://bunjumun.github.io/snotify/tools/visualizer-fx.html (add `?v=N` if the browser serves a cached copy), then ledger, Apple Note COMPLETED entry and the memory build number.
- Say what was *not* checked: a real projector, a real band, his pad in his hand.
