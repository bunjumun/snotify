/* engine/sim.js - bubbles, froth, wetness, pop ripples */
(function (FX) {
'use strict';
const { TAU, MAX_BUBBLES, FOAM_N, WET_N, MAX_RINGS, N_SITES, RADIUS_PER_MM, FOAM_MAX, POP_THICK, FOAM_DIFFUSE, WET_HALF_LIFE, clamp, smooth, waveH, flowVel, FV, terminalVelocity, oblateAspect, pressureRadius } = FX;

/* ============================== PHYSICS (bubbles, foam, wetness, pop ripples) ============================== */
// The sim loop uses in-place typed arrays on purpose (2000 bubbles at 60 Hz); the foam map is double-buffered.
function createSim() {
  const bx = new Float32Array(MAX_BUBBLES), by = new Float32Array(MAX_BUBBLES);
  const br0 = new Float32Array(MAX_BUBBLES), bd0 = new Float32Array(MAX_BUBBLES), bph = new Float32Array(MAX_BUBBLES);
  const bR = new Float32Array(MAX_BUBBLES), bAsp = new Float32Array(MAX_BUBBLES), bTilt = new Float32Array(MAX_BUBBLES);
  const boost = new Float32Array(MAX_BUBBLES), nxt = new Int32Array(MAX_BUBBLES);
  let n = 0;
  let foam = new Float32Array(FOAM_N * 2), foamB = new Float32Array(FOAM_N * 2);
  const decay = new Float32Array(FOAM_N);
  const wet = new Float32Array(WET_N * 2);
  const rings = [];
  const CELL = 0.04;
  let head = new Int32Array(1);
  const gap = () => -Math.log(1 - Math.random());
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(TAU * Math.random());
  const raw = Array.from({ length: N_SITES }, () => 0.5 + Math.random());
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const sites = raw.map((w, i) => ({ u: (i + 0.5 + (Math.random() - 0.5) * 0.5) / N_SITES, w: w / rawSum, acc: 0, th: gap() }));
  let prevSurf = 0, foamCell = 0.008;   // smoothed thickness-weighted mean bubble radius -> one froth cell size

  function addFoam(x, rDisp, A, gain) {
    if (!(gain > 0)) return;
    const f = clamp(x / A, 0, 1) * (FOAM_N - 1), i0 = Math.round(f);
    const add = gain * 5.0 * rDisp;
    for (let d = -3; d <= 3; d++) {
      const i = i0 + d;
      if (i < 0 || i >= FOAM_N) continue;
      const a = add * 0.45 * Math.exp(-(d * d) / 4.5);
      const th = foam[2 * i], total = th + a;
      foam[2 * i] = Math.min(FOAM_MAX, total);
      foam[2 * i + 1] = total > 0 ? (foam[2 * i + 1] * th + rDisp * a) / total : rDisp;
    }
  }

  function pushRing(x, y, t, amp) {
    if (rings.length >= MAX_RINGS) rings.shift();
    rings.push({ x, y, t0: t, amp });
  }

  function remove(i) {
    n--;
    bx[i] = bx[n]; by[i] = by[n]; br0[i] = br0[n]; bd0[i] = bd0[n]; bph[i] = bph[n];
    bR[i] = bR[n]; bAsp[i] = bAsp[n]; bTilt[i] = bTilt[n]; boost[i] = boost[n];
  }

  function step(dt, c) {
    const { t, A, scale, tank, hasSurface, surfBase } = c;
    const surfAt = (x) => (hasSurface ? surfBase + waveH(x, clamp(surfBase, 0, 1), t, scale).h : 3);
    const water = hasSurface ? surfBase > 0.05 : true;

    // nucleation sites emit Poisson chains
    const rateTotal = 110 * Math.pow(c.bubbles, 1.3);
    if (water && rateTotal > 0) {
      for (const s of sites) {
        s.acc += rateTotal * s.w * (0.65 + 0.35 * Math.sin(t * 0.31 + s.u * 17)) * dt;
        while (s.acc >= s.th) {
          s.acc -= s.th; s.th = gap();
          if (n >= MAX_BUBBLES) continue;
          const i = n++;
          bx[i] = clamp(s.u * A + gauss() * 0.004, 0.01, A - 0.01); by[i] = 0.008;
          br0[i] = clamp(Math.exp(Math.log(0.8 * c.bubbleSize) + 0.5 * gauss()), 0.2, 5);
          bd0[i] = (hasSurface ? Math.max(surfBase, 0) : 1) * tank;
          bph[i] = Math.random() * TAU; bR[i] = br0[i] * RADIUS_PER_MM; bAsp[i] = 1; bTilt[i] = 0; boost[i] = 0;
        }
      }
    }

    // wake drafting: a bubble just below another gets a speed boost (streams bunch into chains)
    const gx = Math.ceil(A / CELL) + 3, gy = Math.ceil(1.2 / CELL) + 3;
    if (head.length < gx * gy) head = new Int32Array(gx * gy);
    head.fill(-1, 0, gx * gy);
    for (let i = 0; i < n; i++) {
      const cx = clamp(Math.floor(bx[i] / CELL) + 1, 0, gx - 1), cy = clamp(Math.floor(by[i] / CELL) + 1, 0, gy - 1);
      nxt[i] = head[cy * gx + cx]; head[cy * gx + cx] = i;
    }
    for (let i = 0; i < n; i++) {
      const cx = clamp(Math.floor(bx[i] / CELL) + 1, 0, gx - 1), cy = clamp(Math.floor(by[i] / CELL) + 1, 0, gy - 1);
      let b = 0;
      for (let yy = cy; yy <= Math.min(cy + 1, gy - 1); yy++) {
        for (let xx = Math.max(cx - 1, 0); xx <= Math.min(cx + 1, gx - 1); xx++) {
          for (let j = head[yy * gx + xx]; j >= 0; j = nxt[j]) {
            if (j === i) continue;
            const dy = by[j] - by[i], lim = Math.min(8 * bR[j], 0.08);
            if (dy > 0 && dy < lim && Math.abs(bx[j] - bx[i]) < 2.2 * bR[j]) b += 0.15 * (1 - dy / lim);
          }
        }
      }
      boost[i] = b;
    }

    // detected objects: bubbles slip sideways around them (boxes in logical coords)
    const obs = c.obstacles || [], mg = c.avoidMargin * 0.5;
    const sidestep = (x, y, dt) => {
      if (!(c.avoidBubbles > 0)) return 0;
      let dx = 0;
      for (const b of obs) {
        if (y < b.y0 - mg || y > b.y1 + mg || x < b.x0 - mg || x > b.x1 + mg) continue;
        const cx = (b.x0 + b.x1) / 2, half = (b.x1 - b.x0) / 2 + mg;
        dx += Math.sign(x - cx || 1) * (1 - Math.min(Math.abs(x - cx) / half, 1) * 0.7) * 0.35 * c.avoidBubbles * dt;
      }
      return dx;
    };

    // integrate: buoyancy / drag terminal speed, pressure swell, wobble, flow advection, surface arrival
    for (let i = 0; i < n;) {
      const x = bx[i], y = by[i];
      const depthM = Math.max(hasSurface ? surfAt(x) - y : 1 - y, 0) * tank;
      const rM = pressureRadius(br0[i], bd0[i], depthM);
      const v = terminalVelocity(rM);
      const vU = (v / tank) * (1 + Math.min(boost[i], 0.3));
      const rD = rM * RADIUS_PER_MM;
      const amp = rD * smooth(0.5, 1.5, rM);
      const dph = TAU * (vU * dt) / (24 * rD + 1e-6);
      const dxw = amp * (Math.sin(bph[i] + dph) - Math.sin(bph[i]));
      bph[i] += dph;
      flowVel(x, y, t);
      const nx = x + dxw + FV.x * dt + sidestep(x, y, dt), ny = y + (vU + FV.y) * dt;
      bx[i] = nx; by[i] = ny; bR[i] = rD; bAsp[i] = oblateAspect(rM, v);
      bTilt[i] = clamp(Math.atan2(dxw, Math.max(vU * dt, 1e-6)) * 0.8, -0.6, 0.6);
      if (hasSurface && ny + 0.35 * rD >= surfAt(nx)) { addFoam(nx, rD, A, c.foam); remove(i); continue; }
      if ((!hasSurface && ny > 1.08) || nx < -0.05 || nx > A + 0.05) { remove(i); continue; }
      i++;
    }

    // foam height map: whitecaps seed, lateral diffusion, drainage; each drained slice pops
    const tau = (water ? c.foamLife : 0.3) / Math.LN2, kdr = 1 - Math.exp(-dt / tau);
    let drained = 0, foamSum = 0, radSum = 0;
    for (let i = 0; i < FOAM_N; i++) {
      const l = foam[2 * Math.max(i - 1, 0)], r = foam[2 * Math.min(i + 1, FOAM_N - 1)], th = foam[2 * i];
      let nth = th + (l + r - 2 * th) * FOAM_DIFFUSE;
      if (hasSurface && water && c.foam > 0 && (i & 3) === 0) {
        const slope = Math.abs(waveH((i / (FOAM_N - 1)) * A, clamp(surfBase, 0, 1), t, scale).gx);
        if (slope > 0.09) nth += (slope - 0.09) * 0.35 * dt * c.foam;
      }
      const dec = nth * kdr;
      nth = Math.min(FOAM_MAX, nth - dec);
      decay[i] = dec; drained += dec; foamSum += nth;
      foamB[2 * i] = nth;
      foamB[2 * i + 1] = (th > 0 || nth > 0) ? (foam[2 * i + 1] || 0.006) : 0;
      radSum += nth * foamB[2 * i + 1];
    }
    const swap = foam; foam = foamB; foamB = swap;
    if (foamSum > 1e-4) foamCell += (radSum / foamSum - foamCell) * 0.05;
    const pops = drained / POP_THICK;
    let k = Math.floor(pops); if (Math.random() < pops - k) k++;
    for (k = Math.min(k, 3); k > 0 && drained > 0; k--) {
      let pick = Math.random() * drained, i = 0;
      while (i < FOAM_N - 1 && (pick -= decay[i]) > 0) i++;
      const x = (i / (FOAM_N - 1)) * A;
      pushRing(x, surfAt(x), t, 0.0025 + 0.004 * Math.random());
    }
    while (rings.length && t - rings[0].t0 > 6) rings.shift();

    // vertical wetness profile (wet film lingers after draining) + cling foam left on the wall
    const meanFoam = foamSum / FOAM_N, receding = surfBase < prevSurf - 1e-5;
    const kw = Math.exp(-dt * Math.LN2 / WET_HALF_LIFE), kc = Math.exp(-dt / (c.foamLife * 1.2 + 1));
    for (let j = 0; j < WET_N; j++) {
      const y = (j + 0.5) / WET_N;
      if (hasSurface && y < surfBase + 0.02) wet[2 * j] = 1; else wet[2 * j] *= kw;
      wet[2 * j + 1] *= kc;
      if (hasSurface && receding && Math.abs(y - surfBase) < 0.012) {
        wet[2 * j + 1] = Math.max(wet[2 * j + 1], clamp(meanFoam * 30 * c.foam, 0, 1));
      }
    }
    prevSurf = surfBase;
  }

  function fillInstances(buf) {
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      buf[o] = bx[i]; buf[o + 1] = by[i]; buf[o + 2] = bR[i]; buf[o + 3] = bAsp[i]; buf[o + 4] = bTilt[i]; buf[o + 5] = bph[i];
    }
    return n;
  }
  function fillRings(buf) {
    buf.fill(0);
    rings.forEach((r, i) => { buf[i * 4] = r.x; buf[i * 4 + 1] = r.y; buf[i * 4 + 2] = r.t0; buf[i * 4 + 3] = r.amp; });
  }
  // test hook: live bubble radius / height / aspect for the physics check
  function sample() { return Array.from({ length: n }, (_, i) => ({ y: by[i], r: bR[i] / RADIUS_PER_MM, asp: bAsp[i] })); }
  return { step, fillInstances, fillRings, sample, get count() { return n; }, get foam() { return foam; }, get foamCell() { return foamCell; }, wet, get rings() { return rings; } };
}
Object.assign(FX, { createSim });
})(window.FluidFX);
