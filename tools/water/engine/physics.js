/* engine/physics.js - pure logic: level cycle, orientation, bubble physics, wave field */
(function (FX) {
'use strict';
const { REST_SECONDS, WAVES, WAVE_ROT, WAVE_OMEGA, clamp, smooth } = FX;

/* ============================== PURE LOGIC ============================== */
// Level 0..1 over a rise / hold / drain / rest cycle. Degenerate input returns 0.
function levelAt(cycleT, rise, hold, drain, rest = REST_SECONDS) {
  const r = Math.max(0, +rise || 0), h = Math.max(0, +hold || 0), d = Math.max(0, +drain || 0), z = Math.max(0, +rest || 0);
  const total = r + h + d + z;
  if (!(total > 0) || !Number.isFinite(cycleT) || cycleT < 0) return 0;
  let t = cycleT % total;
  if (t < r) return smooth(0, 1, t / r);
  t -= r;
  if (t < h) return 1;
  t -= h;
  if (t < d) return 1 - smooth(0, 1, t / d);
  return 0;
}

// Screen NDC <-> logical frame (height 1, width A, y up, after rotation + flips).
const ROT = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]];
// `top` and `floor` are fractions of the frame height measured up from the bottom: the wall (logical y 0..1) fills
// floor..top and the rest of the frame is floor (y < 0) and ceiling (y > 1). Defaults: the wall fills the frame.
function orientation(rot, flipH, flipV, W, H, top = 1, floor = 0) {
  const odd = (rot & 1) === 1;
  const Hl = odd ? W : H, Wl = odd ? H : W;
  const U = Hl * (top - floor), A = Wl / U;                  // U: pixels per logical unit
  const yMin = -floor / (top - floor), yMax = (1 - floor) / (top - floor), yc = (yMin + yMax) / 2;
  const [a, b, c, d] = ROT[rot & 3];
  const fx = flipH ? -1 : 1, fy = flipV ? -1 : 1;
  const m = [fx * a, fx * b, fy * c, fy * d];
  const s2l = new Float32Array([
    m[0] * W / (2 * U), m[2] * W / (2 * U), 0,
    m[1] * H / (2 * U), m[3] * H / (2 * U), 0,
    A / 2, yc, 1]);
  const kx = 2 * U / W, ky = 2 * U / H;
  const l2s = new Float32Array([
    kx * a * fx, ky * b * fx, 0,
    kx * c * fy, ky * d * fy, 0,
    -kx * (a * fx * A / 2 + c * fy * yc), -ky * (b * fx * A / 2 + d * fy * yc), 1]);
  return { s2l, l2s, A, top: yMax, bottom: yMin, px: 1 / U };
}

const G = 9.81, NU = 1.0e-6;
function terminalVelocity(rMm) {                      // m/s: Stokes for tiny, saturating to ~0.24-0.3 m/s
  const d = 2 * rMm / 1000;
  const vs = G * d * d / (18 * NU);
  if (!(vs > 0)) return 0;
  const vt = 0.24 + 0.01 * 2 * rMm;
  return 1 / (1 / vs + 1 / vt);
}
function oblateAspect(rMm, v) {                        // minor/major axis ratio from Weber number
  const we = 1000 * v * v * (2 * rMm / 1000) / 0.072;
  return Math.max(0.45, 1 / (1 + 0.14 * we));
}
function pressureRadius(r0Mm, depth0M, depthM) {      // bubble swells as ambient pressure falls
  return r0Mm * Math.cbrt((1 + depth0M / 10.3) / (1 + Math.max(depthM, 0) / 10.3));
}

const WS = { h: 0, gx: 0 };                            // scratch result (avoids per-call allocation)
function waveH(x, y, t, scale) {
  let h = 0, gx = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const [a0, kb, amp, off] = WAVES[i];
    const ang = a0 + WAVE_ROT * Math.sin(t * 0.05 + i);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const k = kb / scale, om = WAVE_OMEGA * Math.sqrt(k);
    const ph = k * (dx * x + dy * y) - om * t + off;
    h += amp * Math.sin(ph);
    gx += amp * k * Math.cos(ph) * dx;
  }
  WS.h = h; WS.gx = gx;
  return WS;
}
const FV = { x: 0, y: 0 };
function flowVel(x, y, t) {                            // same spatial pattern as the GLSL flowDisp()
  FV.x = 2 * (0.010 * Math.sin(7 * y + 0.6 * t) + 0.006 * Math.sin(13 * y - 0.9 * t + 1.7 * x));
  FV.y = 2 * (0.008 * Math.sin(6 * x + 0.5 * t + 2) + 0.005 * Math.sin(11 * x + 0.8 * t));
  return FV;
}
Object.assign(FX, { levelAt, orientation, terminalVelocity, oblateAspect, pressureRadius, waveH, flowVel, FV });
})(window.FluidFX);
