# tools v1: Visualizer and VJ mixer

Frozen, but back on the Snalbum tools menu as **V.1** (the VJ mixer, 10 Aug
11:08) and **V.2** (the visualizer, 10 Aug 12:33), in order of the commit that
first put each on the site. **V.3** is the unified `tools/visualizer.html` and
**V.4** was `tools/visualizer-fx.html`, which is now labelled **V.5** (19 Oct 2026). Both originals were replaced by one unified
`tools/visualizer.html` (two decks, a crossfader, all eleven scenes, gamepad,
keyboard and MIDI).

- `visualizer.html`: single-scene, gamepad-played, per-channel audio routing.
- `vj-mixer.html`: two generators with a crossfader, mic reactive, MIDI learn.

They run from `/archive/tools-v1/<file>`. The two shared-chrome links point at
`../../tools/`, and `tools/tool.js` now works the "back to Sn'Album" link out from
its own location, so the top bar lands on the album from here too. Only the
`<title>` (which names the version in the top bar) and the `tool.js` cache key
(`?v=3`) differ from the originals.

`tools/vj-mixer.html` is now a one-line redirect to the unified tool, kept so
an old link or a saved Tools-menu entry does not 404.
