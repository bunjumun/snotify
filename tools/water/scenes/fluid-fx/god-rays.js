/* scenes/fluid fx/god-rays.js - caustics plus swaying light shafts; fauna are backlit silhouettes.
   Negative space: curtains - the water is only lit inside the shafts, dark corridors between them. */
FluidFX.registerScene({
  id: 2, key: 'god-rays', name: 'Rays', category: 'fluid fx',
  space: 'curtains',
  waterline: false,
  fauna: { fish: 40, jelly: 0, manta: 1, angler: 0 },
  style: { rays: 1, caustic: 1, fauna: 'silhouette' },
});
