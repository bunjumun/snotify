/* scenes/fluid fx/rising-liquid.js - waterline that rises and drains: refraction, froth, wet film, bubbles;
   fauna are translucent, refracted and wet-specular.
   Negative space: drops - the liquid lives inside drifting drops that merge and pinch apart, so the full-wall
   flood at the top of the cycle becomes a few lit drops instead. */
FluidFX.registerScene({
  id: 4, key: 'rising-liquid', name: 'Liquid', category: 'fluid fx', default: true,
  space: 'drops',
  waterline: true,
  fauna: { fish: 48, jelly: 3, manta: 1, angler: 0 },
  style: { rays: 0.3, caustic: 1, fauna: 'translucent' },
});
