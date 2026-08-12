# Vendored skill packs

These thirteen skill packs come from [aaabench](https://github.com/ukanwat/aaabench) by ukanwat, MIT licensed. They are copied unmodified, including the upstream `SOURCES.txt`.

aaabench is a benchmark that has an AI agent build an open-world game in Unreal Engine 5. Its engine is irrelevant to this repo, but these particular packs are engine-agnostic: the code samples in them are GDScript and C#, while the numbers, curves and workflows apply to any real-time game, including a browser one built on Three.js.

**Vendored (engine-agnostic):** audio-design, camera-systems, dialogue-systems, game-ai, game-feel, game-ui-ux, input-systems, level-design, performance-optimization, physics-tuning, procedural-gen, save-systems, shader-programming.

**Deliberately not vendored:** the six `unreal-*` packs and `reference-images`. The first six are engine-specific and would only ever mislead here; the last is large and serves a city, not a lake.

## Reading them here

Take the numbers and the reasoning, not the snippets. Two upstream positions are explicitly overruled for this project:

- **`audio-design` on adaptive layered music.** Lakehorse plays the band's record straight through and applies mood as an effect over whatever track is running. Stems would break that. See the header of `game-v2/src/audio/AudioDirector.js`.
- **`metrics.md`-style human dimensions** (1.8 m human, 3.5 m traffic lanes). This is a horse in a lake. The rule those numbers exist to serve, never hardcode a dimension twice, is already honoured by `config.js`.

The wider standards those packs sit alongside upstream, `docs/workflow/phases.md`, `metrics.md`, `detail-density.md` and `systems.md`, are summarised where they are applied in `game-v2/PROGRESS.md`.
