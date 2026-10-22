/* engine/util.js - shared constants and helpers; creates the FluidFX namespace */
(function () {
'use strict';
const FX = (window.FluidFX = window.FluidFX || {});

/* ============================== CONSTANTS ============================== */
const TAU = Math.PI * 2;
const RADIUS_PER_MM = 0.008;          // display radius (logical units) per mm of bubble radius
const MAX_BUBBLES = 2000;
const FOAM_N = 512, WET_N = 256, MAX_RINGS = 12, N_SITES = 9;
const FIXED_DT = 1 / 60, MAX_STEPS = 6, MAX_FRAME_DT = 0.1;
const SURF_OFFSET = -0.045, SURF_RANGE = 1.11;      // level 0..1 -> surface base height
const FOAM_MAX = 0.09, POP_THICK = 0.012, FOAM_DIFFUSE = 0.18, WET_HALF_LIFE = 10;
const REST_SECONDS = 2;
const STORAGE_KEY = 'waterProjection.v1';
// [angle0, baseWaveNumber, amplitude, phase] - shared by JS arrivals and the GLSL surface
const WAVES = [[0.9, 5.0, 0.016, 0.0], [2.6, 8.7, 0.010, 1.7], [4.3, 12.4, 0.006, 3.1], [5.9, 16.1, 0.0035, 4.6]];
const WAVE_OMEGA = 0.9, WAVE_ROT = 0.35;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

Object.assign(FX, { TAU, RADIUS_PER_MM, MAX_BUBBLES, FOAM_N, WET_N, MAX_RINGS, N_SITES, FIXED_DT, MAX_STEPS, MAX_FRAME_DT, SURF_OFFSET, SURF_RANGE, FOAM_MAX, POP_THICK, FOAM_DIFFUSE, WET_HALF_LIFE, REST_SECONDS, STORAGE_KEY, WAVES, WAVE_OMEGA, WAVE_ROT, clamp, smooth });
})();
