/* scenes/fluid fx/caustics.js - light-only caustic network on black; fauna are lit translucent shapes.
   Negative space: pools - patches of caustic light drift across an unlit floor. */
FluidFX.registerScene({
  id: 1, key: 'caustics', name: 'Caustics', category: 'fluid fx',
  space: 'pools',
  waterline: false,
  fauna: { fish: 36, jelly: 3, manta: 0, angler: 0 },
  style: { caustic: 1, fauna: 'lit' },
});
