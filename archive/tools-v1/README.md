# tools v1: Visualizer and VJ mixer

Frozen and off the site, with no door. Both were replaced by one unified
`tools/visualizer.html` (two decks, a crossfader, all eleven scenes, gamepad,
keyboard and MIDI).

- `visualizer.html`: single-scene, gamepad-played, per-channel audio routing.
- `vj-mixer.html`: two generators with a crossfader, mic reactive, MIDI learn.

They still run if you serve the repo root (`python3 -m http.server`) and open
`/archive/tools-v1/<file>`. The two shared-chrome links were repointed at
`../../tools/`; the "back to Sn'Album" link in the top bar still resolves
relative to `tools/`, so it will not land anywhere from here.

`tools/vj-mixer.html` is now a one-line redirect to the unified tool, kept so
an old link or a saved Tools-menu entry does not 404.
