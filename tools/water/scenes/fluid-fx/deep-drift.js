/* scenes/fluid fx/deep-drift.js - dim caustics, marine snow, vignette; fauna are bioluminescent.
   Negative space: lanterns - the deep is black and only lit around the creatures, marine snow included. */
FluidFX.registerScene({
  id: 3, key: 'deep-drift', name: 'Deep', category: 'fluid fx',
  space: 'lanterns',
  waterline: false,
  fauna: { fish: 10, jelly: 6, manta: 0, angler: 1 },
  style: { snow: 1, vignette: 1, caustic: 0.5, fauna: 'bioluminescent' },
});
