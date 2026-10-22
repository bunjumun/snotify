/* engine/fauna.js - creature simulation (fish schools, jellyfish, rays, anglerfish) */
(function (FX) {
'use strict';
const { TAU, clamp, smooth, flowVel, FV } = FX;

/* ============================== FAUNA (schooling fish, jellyfish, rays, anglerfish) ============================== */
// Creature counts per scene come from the scene file (c.profile = [fish, jellyfish, ray, angler] at Amount = 1).
const POOL = { fish: 96, jelly: 12, manta: 3, angler: 2 };
const KINDS = ['fish', 'jelly', 'manta', 'angler'];
const CREATURE_STRIDE = 11, MAX_CREATURES = POOL.fish + POOL.jelly + POOL.manta + POOL.angler;

// Instance record: x, y, size, pitch | kind, dir, phase, alpha | aux1, aux2 | depth (0 front of the floor plane .. 1 back; rebuilt every sim step; GL reads the last one).
function createFauna() {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fish = Array.from({ length: POOL.fish }, (_, i) => ({ x: 0, y: 0, vx: 0, vy: 0, base: rnd(0.026, 0.042), ph: rnd(0, TAU), life: 0, dir: 1, pitch: 0, school: i & 1, seed: Math.random(), placed: false }));
  const jelly = Array.from({ length: POOL.jelly }, () => ({ x: 0, y: 0, vx: 0, vy: 0, base: rnd(0.03, 0.055), period: rnd(2.2, 3.6), life: 0, seed: Math.random(), placed: false }));
  const manta = Array.from({ length: POOL.manta }, () => ({ x: -1, y: 0.6, dir: 1, base: 0.1, v: 0.06, ph: rnd(0, TAU), life: 0, seed: Math.random(), wait: rnd(0, 6), alive: false }));
  const angler = Array.from({ length: POOL.angler }, () => ({ x: 0, y: 0.25, dir: 1, base: 0.07, ph: rnd(0, TAU), life: 0, seed: Math.random(), placed: false }));
  const out = new Float32Array(MAX_CREATURES * CREATURE_STRIDE);
  const counts = { fish: 0, jelly: 0, manta: 0, angler: 0 };
  let n = 0, tNow = 0, c_depth = 0;

  function emit(kind, x, y, size, pitch, dir, ph, alpha, a, b, zSeed) {
    if (alpha < 0.01 || n >= MAX_CREATURES) return;
    const z = c_depth * (0.5 + 0.5 * Math.sin(tNow * 0.045 + zSeed * 50));   // wanders front <-> back of the floor plane
    size *= 1 - 0.35 * z;                                                   // and shrinks with distance
    const o = n++ * CREATURE_STRIDE;
    out[o] = x; out[o + 1] = y; out[o + 2] = size; out[o + 3] = pitch;
    out[o + 4] = kind; out[o + 5] = dir; out[o + 6] = ph; out[o + 7] = alpha; out[o + 8] = a; out[o + 9] = b; out[o + 10] = z;
    counts[KINDS[kind]]++;
  }

  function step(dt, c) {
    const { t, A, hasSurface, surfBase } = c;
    const top = hasSurface ? surfBase - 0.045 : 1.02;          // creatures stay under the waterline
    const vis = hasSurface ? smooth(0.1, 0.3, surfBase) : 1;   // and fade out as the water drains away
    const lo = 0.07, hi = Math.max(top, lo + 0.05);
    const prof = c.profile;
    const want = (k, mul) => Math.min(POOL[KINDS[k]], Math.round(prof[k] * c.fauna * mul));
    const sp = c.faunaSpeed, sz = c.faunaSize;

    // object avoidance: push away from detected boxes (logical coords); creatures swimming at the back pass behind
    // the object instead, so the push fades with depth just like the blocking and shadows do
    const obs = c.obstacles || [], AV = { x: 0, y: 0 };
    const avoid = (x, y, size, seed) => {
      AV.x = 0; AV.y = 0;
      if (!(c.avoid > 0) || !obs.length) return AV;
      const w = c.avoid * (1 - 0.9 * c.depth * (0.5 + 0.5 * Math.sin(t * 0.045 + seed * 50)));
      const reach = c.avoidMargin + size * 1.5;
      for (const b of obs) {
        const dx = x - clamp(x, b.x0, b.x1), dy = y - clamp(y, b.y0, b.y1);
        let d = Math.hypot(dx, dy), ux = dx, uy = dy;
        if (d < 1e-4) { ux = x - (b.x0 + b.x1) / 2; uy = y - (b.y0 + b.y1) / 2; d = 0; }
        const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
        if (d >= reach) continue;
        const k = ((1 - d / reach) ** 2 + (d === 0 ? 1 : 0)) * 24 * w;
        AV.x += ux * k; AV.y += uy * k;
      }
      return AV;
    };
    tNow = t; c_depth = c.depth;
    n = 0; counts.fish = counts.jelly = counts.manta = counts.angler = 0;

    // --- schooling fish: separation / alignment / cohesion + a wandering goal per school ---
    const nf = want(0, c.mulFish), live = [];
    const goals = [0, 1].map((s) => ({
      x: A * (0.5 + 0.34 * Math.sin(t * (0.043 + 0.017 * s) + s * 2.1)),
      y: lo + (hi - lo) * (0.5 + 0.38 * Math.sin(t * (0.031 + 0.013 * s) + s * 1.3)),
    }));
    for (let i = 0; i < POOL.fish; i++) {
      const f = fish[i], on = i < nf;
      f.life += ((on ? 1 : 0) - f.life) * Math.min(1, dt * 1.5);
      if (!on && f.life < 0.01) { f.placed = false; continue; }
      if (on && !f.placed) {
        const g = goals[f.school], a = rnd(0, TAU);
        f.x = clamp(g.x + rnd(-0.15, 0.15), 0.05, A - 0.05); f.y = clamp(g.y + rnd(-0.1, 0.1), lo, hi);
        f.vx = Math.cos(a) * 0.12; f.vy = Math.sin(a) * 0.06; f.placed = true;
      }
      live.push(f);
    }
    const SEP = 0.04, ALI = 0.12, COH = 0.2;
    for (const f of live) {
      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, na = 0, nc = 0;
      for (const g of live) {
        if (g === f || g.school !== f.school) continue;
        const dx = g.x - f.x, dy = g.y - f.y, d = Math.hypot(dx, dy);
        if (d < COH) { cx += g.x; cy += g.y; nc++; }
        if (d < ALI) { ax += g.vx; ay += g.vy; na++; }
        if (d < SEP && d > 1e-5) { const w = (1 - d / SEP) / d; sx -= dx * w; sy -= dy * w; }
      }
      const goal = goals[f.school];
      let accX = sx * 0.9 + (goal.x - f.x) * 0.35 + Math.sin(t * 1.3 + f.seed * 40) * 0.04;
      let accY = sy * 0.9 + (goal.y - f.y) * 0.35 + Math.cos(t * 1.1 + f.seed * 31) * 0.03;
      if (na) { accX += (ax / na - f.vx) * 1.4; accY += (ay / na - f.vy) * 1.4; }
      if (nc) { accX += (cx / nc - f.x) * 0.9; accY += (cy / nc - f.y) * 0.9; }
      if (f.x < 0.06) accX += (0.06 - f.x) * 8; else if (f.x > A - 0.06) accX -= (f.x - (A - 0.06)) * 8;
      if (f.y < lo + 0.03) accY += (lo + 0.03 - f.y) * 14; else if (f.y > hi - 0.03) accY -= (f.y - (hi - 0.03)) * 14;
      const av = avoid(f.x, f.y, f.base * sz, f.school * 0.37 + 0.15 * f.seed);
      f.vx += (accX + av.x) * dt; f.vy += (accY + av.y) * dt;
      const spd = Math.hypot(f.vx, f.vy), maxS = 0.2 * sp * (0.85 + 0.3 * f.seed), minS = 0.07 * sp;
      const k = spd > maxS ? maxS / spd : spd < minS && spd > 1e-6 ? minS / spd : 1;
      f.vx *= k; f.vy *= k;
      f.x = clamp(f.x + f.vx * dt, 0.02, A - 0.02); f.y = clamp(f.y + f.vy * dt, lo, hi);
      if (Math.abs(f.vx) > 0.015) f.dir = f.vx > 0 ? 1 : -1;
      f.pitch = f.dir * clamp(Math.atan2(f.vy, Math.max(Math.abs(f.vx), 1e-3)) * 0.7, -0.6, 0.6);
      f.ph += dt * (5 + Math.hypot(f.vx, f.vy) * 28);
      emit(0, f.x, f.y, f.base * sz, f.pitch, f.dir, f.ph, f.life * vis, 0, 0, f.school * 0.37 + 0.15 * f.seed);
    }

    // --- jellyfish: pulse-driven thrust, slow sink, drift with the water flow ---
    const nj = want(1, c.mulJelly);
    for (let i = 0; i < POOL.jelly; i++) {
      const j = jelly[i], on = i < nj;
      j.life += ((on ? 1 : 0) - j.life) * Math.min(1, dt * 0.8);
      if (!on && j.life < 0.01) { j.placed = false; continue; }
      if (on && !j.placed) { j.x = rnd(0.1, A - 0.1); j.y = rnd(lo + 0.1, Math.max(lo + 0.15, top - 0.15)); j.vx = 0; j.vy = 0; j.placed = true; }
      const pulse = Math.sin(TAU * (t * sp / j.period + j.seed * 10));
      const nearTop = smooth(top - 0.2, top - 0.05, j.y);
      flowVel(j.x, j.y, t);
      j.vy += (Math.max(0, pulse) * 0.16 * sp * (1 - nearTop) - 0.04 - 0.8 * j.vy + (j.y < lo + 0.08 ? (lo + 0.08 - j.y) * 3 : 0)) * dt;
      j.vx += (FV.x * 0.6 + Math.sin(t * 0.2 + j.seed * 9) * 0.01 - 0.6 * j.vx) * dt;
      const jav = avoid(j.x, j.y, j.base * sz, j.seed);
      j.vx += jav.x * dt; j.vy += jav.y * dt;
      j.x = clamp(j.x + j.vx * dt, 0.05, A - 0.05); j.y = clamp(j.y + j.vy * dt, lo, hi);
      emit(1, j.x, j.y, j.base * sz, 0, 1, t + j.seed * 20, j.life * vis, pulse, j.seed, j.seed);
    }

    // --- rays: slow flybys that enter and leave off-screen, then wait ---
    const nm = want(2, c.mulManta);
    for (let i = 0; i < POOL.manta; i++) {
      const m = manta[i], on = i < nm;
      if (!m.alive) {
        if (!on) continue;
        m.wait -= dt;
        if (m.wait <= 0) {
          m.dir = Math.random() < 0.5 ? 1 : -1; m.x = m.dir > 0 ? -0.4 : A + 0.4;
          m.y = rnd(0.38, Math.max(0.45, top - 0.2)); m.base = 0.1 * rnd(0.85, 1.15); m.v = rnd(0.05, 0.085); m.life = 1; m.alive = true;
        }
        continue;
      }
      m.life += ((on ? 1 : 0) - m.life) * Math.min(1, dt * 1.2);
      m.x += m.dir * m.v * sp * dt; m.ph += dt * (1.6 + 1.4 * sp);
      const mav = avoid(m.x, m.y, m.base * sz * 1.5, m.seed);
      m.x += mav.x * dt * 0.08; m.y += mav.y * dt * 0.08;
      if ((m.dir > 0 && m.x > A + 0.45) || (m.dir < 0 && m.x < -0.45) || (!on && m.life < 0.01)) { m.alive = false; m.wait = rnd(6, 20); continue; }
      const yy = Math.min(m.y + 0.04 * Math.sin(t * 0.3 + m.seed * 9), top - 0.12);
      emit(2, m.x, yy, m.base * sz, 0.05 * Math.sin(m.ph * 0.5), m.dir, m.ph, m.life * vis, 0, 0, m.seed);
    }

    // --- anglerfish: lazy cruising near the bottom, jaw opening and closing ---
    const na = want(3, c.mulAngler);
    for (let i = 0; i < POOL.angler; i++) {
      const a = angler[i], on = i < na;
      a.life += ((on ? 1 : 0) - a.life) * Math.min(1, dt * 0.7);
      if (!on && a.life < 0.01) { a.placed = false; continue; }
      if (on && !a.placed) { a.x = rnd(0.2 * A, 0.8 * A); a.y = rnd(0.15, 0.35); a.placed = true; }
      const tx = A * (0.5 + 0.32 * Math.sin(t * 0.035 * sp + a.seed * 7)), ty = clamp(0.2 + 0.12 * Math.sin(t * 0.05 * sp + a.seed * 3), lo + 0.05, hi - 0.1);
      const dx = tx - a.x;
      a.x += dx * 0.4 * dt; a.y += (ty - a.y) * 0.4 * dt; a.ph += dt * 1.5;
      const aav = avoid(a.x, a.y, a.base * sz, a.seed);
      a.x += aav.x * dt * 0.08; a.y += aav.y * dt * 0.08;
      if (Math.abs(dx) > 0.01) a.dir = dx > 0 ? 1 : -1;
      emit(3, a.x, a.y, a.base * sz, 0, a.dir, a.ph, a.life * vis, 0.5 + 0.5 * Math.sin(t * 0.45 + a.seed * 5), 0, a.seed);
    }
  }

  function fill(buf) { buf.set(out.subarray(0, n * CREATURE_STRIDE)); return n; }
  const snapshot = () => Array.from({ length: n }, (_, i) => ({ kind: out[i * CREATURE_STRIDE + 4], x: out[i * CREATURE_STRIDE], y: out[i * CREATURE_STRIDE + 1], size: out[i * CREATURE_STRIDE + 2], alpha: out[i * CREATURE_STRIDE + 7] }));
  return { step, fill, snapshot, counts: () => ({ ...counts, total: n }) };
}
Object.assign(FX, { POOL, KINDS, CREATURE_STRIDE, MAX_CREATURES, createFauna });
})(window.FluidFX);
