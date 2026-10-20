# tools v1: Visualizer and VJ mixer

Frozen, but back on the Snalbum tools menu as **V.1** (the VJ mixer, 10 Aug
11:08) and **V.2** (the visualizer, 10 Aug 12:33), in order of the commit that
first put each on the site. **V.3** is the unified `tools/visualizer.html` and
**V.4** is `visualizer-fx.html` here, frozen as it stood on 11 Oct 2026 (the last build before the relabel); the live `tools/visualizer-fx.html` is now **V.5**. Both originals were replaced by one unified
`tools/visualizer.html` (two decks, a crossfader, all eleven scenes, gamepad,
keyboard and MIDI).

- `visualizer.html`: single-scene, gamepad-played, per-channel audio routing.
- `vj-mixer.html`: two generators with a crossfader, mic reactive, MIDI learn.
- `visualizer-fx.html`: V.4, the effects stage, frozen (commit `3e313d6`'s build).

They run from `/archive/tools-v1/<file>`. The two shared-chrome links point at
`../../tools/`, and `tools/tool.js` now works the "back to Sn'Album" link out from
its own location, so the top bar lands on the album from here too. Only the
`<title>` (which names the version in the top bar) and the `tool.js` cache key
(`?v=3`) differ from the originals.

`tools/vj-mixer.html` is now a one-line redirect to the unified tool, kept so
an old link or a saved Tools-menu entry does not 404.
