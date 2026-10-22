/* engine/engine.js - runtime: state, API, GL passes, loop, panel, input */
(function (FX) {
'use strict';
const {
  MAX_BUBBLES, MAX_RINGS, FOAM_N, WET_N, FIXED_DT, MAX_STEPS, MAX_FRAME_DT, SURF_OFFSET, SURF_RANGE, STORAGE_KEY, clamp, smooth,
  levelAt, orientation, terminalVelocity, oblateAspect, pressureRadius,
  createSim, createFauna, CREATURE_STRIDE, MAX_CREATURES,
} = FX;
const GLSL = FX.glsl;

// scenes register themselves from scenes/**/*.js before this file loads
const scenes = FX.scenes.list();
if (!scenes.length) {
  const m = document.getElementById('msg');
  m.textContent = 'No scenes registered. Check the <script> tags in index.html.'; m.style.display = 'flex';
  return;
}
const sceneOf = (mode) => FX.scenes.byId(mode);
const defaultScene = scenes.find((s) => s.default) || scenes[0];
const { SPECS, SPEC_BY_KEY, DEFAULTS, normalize } = FX.buildParams(scenes[scenes.length - 1].id, defaultScene.id);
const monoScene = scenes.find((s) => s.mono);

/* ============================== BOOT: state, persistence, API ============================== */
const params = new URLSearchParams(location.search);
const isEmbed = params.get('embed') === '1';
const canvas = document.getElementById('gl');
const msgEl = document.getElementById('msg');
document.body.classList.toggle('nopanel', isEmbed || params.get('ui') === '0');

function readInitialState() {
  let s = normalize({}, DEFAULTS);
  if (!isEmbed) {
    try { s = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), s); } catch (e) { /* storage unavailable or corrupt: use defaults */ }
  }
  s = normalize(Object.fromEntries(new URLSearchParams(location.hash.slice(1))), s);
  return normalize(Object.fromEntries(params), s);
}

let state = readInitialState();
let paused = false, simT = 0, cycleT = 0, nsT = 0, curLevel = state.level, persistTimer = 0;   // nsT: negative-space clock, integrates Drift speed so changing it never jumps the shapes
const listeners = new Set();

/* ---- room: where the wall sits in the frame (defined early: the framed `water:ready` message needs them) ---- */
const MIN_WALL = 0.25;   // the wall keeps at least this share of the frame between its two folds
function roomOf() {
  const top = state.horizon, floor = clamp(state.floorLevel, 0, Math.max(0, top - MIN_WALL));
  return { top, floor, hasCeiling: top < 0.999, hasFloor: floor > 0.001 };
}
// With a ceiling the surface is pinned to the fold at the wall's top (the room is underwater); otherwise it follows the level cycle
function surfaceFor(scene) {
  return roomOf().hasCeiling ? { hasSurface: true, surfBase: 1.0 } : { hasSurface: scene.waterline, surfBase: SURF_OFFSET + SURF_RANGE * curLevel };
}
const ceilK = (lookUp) => 0.35 * Math.pow(40 / 0.35, 1 - lookUp);   // 40 = plain plan view .. 0.35 = strong squeeze toward the fold
// Fold lines on screen as [x0, y0, x1, y1], 0..1 from the top-left. One source for the page's own handles and for a host's (getLayout).
function foldLines(cw, ch) {
  const room = roomOf(), o = orientation(state.rotation, state.flipH, state.flipV, cw, ch, room.top, room.floor);
  const line = (y) => {
    const pt = (x) => [(o.l2s[0] * x + o.l2s[3] * y + o.l2s[6] + 1) / 2, (1 - (o.l2s[1] * x + o.l2s[4] * y + o.l2s[7])) / 2];
    return [...pt(0), ...pt(o.A)];
  };
  return { horizon: line(1), floorLevel: line(0) };
}
// frame fraction (up from the bottom, in output orientation) under a screen point: what a dragged fold handle sets
function frameFractionAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect(), o = orientation(state.rotation, state.flipH, state.flipV, r.width, r.height, 1, 0);
  const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
  return clamp(o.s2l[1] * nx + o.s2l[4] * ny + o.s2l[7], 0, 1);
}
/* ---- object avoidance: boxes detected by the host (camera + detector), screen coords 0..1 from the top-left ----
   Each is {x, y, w, h} (top-left corner + size) or {x, y, r} (centre + radius as a fraction of the frame height).
   They are held for `avoidHold` seconds after the last call (detectors drop out), smoothed per index, then turned into
   logical-frame boxes that the fauna and bubble sims steer around. */
let obstacleRaw = [], obstacleT = -1e9, obstacleSmooth = [], curBoxes = [];
function cleanObstacle(o) {
  if (!o || typeof o !== 'object') return null;
  const f = (v) => (Number.isFinite(Number(v)) ? clamp(Number(v), 0, 1) : null);
  if (o.r !== undefined) {
    const x = f(o.x), y = f(o.y), r = f(o.r);
    if (x === null || y === null || r === null) return null;
    const rx = r * (canvas.clientHeight || 1) / (canvas.clientWidth || 1);
    return { x: x - rx, y: y - r, w: 2 * rx, h: 2 * r };
  }
  const x = f(o.x), y = f(o.y), w = f(o.w), h = f(o.h);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}
function setObstacles(list) {
  obstacleRaw = (Array.isArray(list) ? list : []).slice(0, 32).map(cleanObstacle).filter(Boolean);
  obstacleT = performance.now();
  return obstacleRaw.length;
}
function updateObstacles(wallDt) {
  const live = performance.now() - obstacleT < state.avoidHold * 1000 ? obstacleRaw : [];
  if (obstacleSmooth.length !== live.length) obstacleSmooth = live.map((r) => ({ ...r }));
  else { const k = 1 - Math.pow(state.avoidSmooth, wallDt * 60); live.forEach((r, i) => { for (const key of ['x', 'y', 'w', 'h']) obstacleSmooth[i][key] += (r[key] - obstacleSmooth[i][key]) * k; }); }
  const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1, room = roomOf();
  const o = orientation(state.rotation, state.flipH, state.flipV, cw, ch, room.top, room.floor), m = o.s2l;
  curBoxes = obstacleSmooth.map((r) => {
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([sx, sy]) => {
      const nx = sx * 2 - 1, ny = 1 - sy * 2;
      return [m[0] * nx + m[3] * ny + m[6], m[1] * nx + m[4] * ny + m[7]];
    });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  drawObstacleBoxes(cw, ch);
}
const boxEls = [];
function drawObstacleBoxes(cw, ch) {   // debug overlay on the page only (not in the canvas output)
  const show = state.avoidShow ? obstacleSmooth : [];
  while (boxEls.length < show.length) { const d = document.createElement('div'); d.className = 'obstacle'; document.body.append(d); boxEls.push(d); }
  boxEls.forEach((d, i) => {
    const r = show[i]; d.style.display = r ? 'block' : 'none';
    if (r) d.style.cssText = 'display:block;left:' + r.x * cw + 'px;top:' + r.y * ch + 'px;width:' + r.w * cw + 'px;height:' + r.h * ch + 'px';
  });
}

function layout() {
  const room = roomOf();
  return { wall: { top: room.top, floor: room.floor }, hasCeiling: room.hasCeiling, hasFloor: room.hasFloor, folds: foldLines(canvas.clientWidth || 1, canvas.clientHeight || 1) };
}

function persist() {
  if (isEmbed) return;
  const diff = Object.fromEntries(Object.entries(state).filter(([k, v]) => v !== DEFAULTS[k]));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(diff)); } catch (e) { /* private mode: ignore */ }
  try { history.replaceState(null, '', '#' + new URLSearchParams(Object.entries(diff).map(([k, v]) => [k, String(v)]))); } catch (e) { /* ignore */ }
}
function broadcast() {
  const payload = { type: 'water:state', state: { ...state }, normalized: normalizedState(), layout: layout() };
  if (window.parent !== window) window.parent.postMessage(payload, '*');
  listeners.forEach((fn) => fn(state));
}

const api = {
  version: '1.0',
  canvas,
  onframe: null,
  getState: () => ({ ...state, level: curLevel }),
  setState(partial) {
    const p = { ...(partial || {}) };
    if (p.auto === false && state.auto && p.level === undefined) p.level = curLevel;   // freeze at the current level
    const next = normalize(p, state);
    if (!Object.keys(next).some((k) => next[k] !== state[k])) return api.getState();
    state = next;
    if (p.auto === true) cycleT = 0;
    clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250);
    broadcast();
    return api.getState();
  },
  setMode: (n) => api.setState({ mode: n }),
  setLevel: (v) => api.setState({ auto: false, level: v }),
  pause() { paused = true; },
  resume() { paused = false; },
  _test: { levelAt, orientation, terminalVelocity, oblateAspect, pressureRadius, normalize, DEFAULTS, sample: () => sim.sample(), foam: () => sim.foam, rings: () => sim.rings.length, fauna: () => fauna.counts(), faunaSnapshot: () => fauna.snapshot(),
    // headless helpers: time one GPU render, or fast-forward the sim without waiting in real time
    renderOnce: () => { const t0 = performance.now(); render(); gl.finish(); return performance.now() - t0; },
    ns: () => readNs(),
    shadow: () => readNs('shadow'),
    advance: (seconds) => { updateObstacles(0); const n = Math.min(Math.round(seconds / FIXED_DT), 36000); for (let i = 0; i < n; i++) stepOnce(FIXED_DT * state.speed); return simT; } },
};
window.WaterProjection = api;

/* ---- ports: parameter manifest, 0..1 access, OSC-style addresses, subscriptions, scene list ---- */
const MANIFEST = Object.freeze(SPECS.map((s) => Object.freeze({
  id: s.k, address: '/water/' + s.k, label: s.label, group: s.group,
  type: s.type === 'bool' ? 'bool' : s.opts ? 'enum' : s.type === 'int' ? 'int' : 'float',
  min: s.min, max: s.max, step: s.step, default: s.def, ...(s.opts ? { options: s.opts } : {}),
})));
const toNorm = (s, v) => (s.type === 'bool' ? (v ? 1 : 0) : clamp((v - s.min) / (s.max - s.min), 0, 1));
// real value from 0..1, rounded to a precision derived from the step so round trips do not drift
const fromNorm = (s, n) => {
  if (s.type === 'bool') return n >= 0.5;
  const decimals = Math.max(0, Math.ceil(-Math.log10(s.step))) + 2;
  return +(s.min + clamp(Number(n), 0, 1) * (s.max - s.min)).toFixed(decimals);
};
function normalizedState() {
  const st = api.getState();
  return Object.fromEntries(SPECS.map((s) => [s.k, +toNorm(s, st[s.k]).toFixed(6)]));
}
Object.assign(api, {
  params: MANIFEST,
  scenes: Object.freeze(scenes.map(({ id, key, name, category, waterline, mono, space }) => Object.freeze({ id, key, name, category, waterline, mono, space }))),
  getManifest: () => JSON.parse(JSON.stringify(MANIFEST)),
  getNormalized: normalizedState,
  getLayout: layout,
  setObstacles,
  getObstacles: () => obstacleRaw.map((o) => ({ ...o })),
  setNormalized(values) {
    const raw = {};
    for (const [k, n] of Object.entries(values || {})) {
      const s = SPEC_BY_KEY[k];
      if (s && Number.isFinite(Number(n))) raw[k] = fromNorm(s, n);
    }
    return api.setState(raw);
  },
  // OSC / MIDI-bridge style: "/water/hue" 0.5 (normalised 0..1) or "/water/hue/raw" 190 (real units)
  send(address, value) {
    const m = /^\/water\/([A-Za-z0-9_]+)(\/raw)?$/.exec(String(address));
    if (!m || !SPEC_BY_KEY[m[1]]) return false;
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    if (!Number.isFinite(v)) return false;
    if (m[2]) api.setState({ [m[1]]: v }); else api.setNormalized({ [m[1]]: v });
    return true;
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
});
if (window.parent !== window) {
  window.parent.postMessage({ type: 'water:ready', version: api.version, schema: api.getManifest(), scenes: api.scenes, state: api.getState(), normalized: normalizedState(), layout: layout() }, '*');
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'water:set' && d.state && typeof d.state === 'object') api.setState(d.state);
  else if (d.type === 'water:setn' && d.values && typeof d.values === 'object') api.setNormalized(d.values);
  else if (d.type === 'water:schema' && e.source) e.source.postMessage({ type: 'water:schema', version: api.version, schema: api.getManifest(), scenes: api.scenes }, '*');
  else if (d.type === 'water:pause') paused = true;
  else if (d.type === 'water:resume') paused = false;
  else if (d.type === 'water:get' && e.source) e.source.postMessage({ type: 'water:state', state: api.getState(), normalized: normalizedState(), layout: layout() }, '*');
  else if (d.type === 'water:obstacles') setObstacles(d.boxes);
  else if (d.type === 'water:layout' && e.source) e.source.postMessage({ type: 'water:layout', layout: layout() }, '*');
});

/* ============================== GL ============================== */
const sim = createSim();
const fauna = createFauna();
let gl = null, progs = null, targets = null, texFoam = null, texWet = null, bubbleVao = null, bubbleBuf = null, creatureVao = null, creatureBuf = null, floatOk = false;
const instances = new Float32Array(MAX_BUBBLES * 6), ringBuf = new Float32Array(MAX_RINGS * 4);
const creatureData = new Float32Array(MAX_CREATURES * CREATURE_STRIDE);
const locCache = new WeakMap();
const loc = (p, name) => {
  let m = locCache.get(p);
  if (!m) { m = new Map(); locCache.set(p, m); }
  if (!m.has(name)) m.set(name, gl.getUniformLocation(p, name));
  return m.get(name);
};
const u1f = (p, n, v) => gl.uniform1f(loc(p, n), v);
const u1i = (p, n, v) => gl.uniform1i(loc(p, n), v);
const u2f = (p, n, a, b) => gl.uniform2f(loc(p, n), a, b);
const u3f = (p, n, a, b, c) => gl.uniform3f(loc(p, n), a, b, c);

function showMessage(text) { msgEl.textContent = text; msgEl.style.display = 'flex'; }

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function program(name, vs, fs, attribs) {
  const p = gl.createProgram();
  try {
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  } catch (err) { throw new Error(name + ': ' + err.message); }
  (attribs || []).forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ' link: ' + gl.getProgramInfoLog(p));
  return p;
}
function makeTarget(w, h, hdr) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  return { tex, fbo, w, h, ok };
}
function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
function dataTexture(n) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, n, 1, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function initGL() {
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { showMessage('WebGL2 is not available in this browser.\nTry a current Chrome, Safari or Firefox.'); return false; }
  floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  try {
    progs = {
      scene: program('scene', GLSL.fullscreenVS, FX.scenes.composeFragmentShader()),
      bubble: program('bubble', GLSL.bubbleVS, GLSL.bubbleFS, ['aA', 'aB']),
      creature: program('creature', GLSL.creatureVS, GLSL.creatureFS, ['aA', 'aB', 'aC', 'aD']),
      space: program('space', GLSL.fullscreenVS, GLSL.spaceFS),
      bright: program('bright', GLSL.fullscreenVS, GLSL.brightFS),
      blur: program('blur', GLSL.fullscreenVS, GLSL.blurFS),
      comp: program('composite', GLSL.fullscreenVS, GLSL.compositeFS),
    };
  } catch (err) {
    console.error(err);
    showMessage('Shader error (see console):\n' + String(err.message).slice(0, 600));
    return false;
  }
  bubbleBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bubbleBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instances.byteLength, gl.DYNAMIC_DRAW);
  bubbleVao = gl.createVertexArray();
  gl.bindVertexArray(bubbleVao);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  creatureBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, creatureBuf);
  gl.bufferData(gl.ARRAY_BUFFER, creatureData.byteLength, gl.DYNAMIC_DRAW);
  creatureVao = gl.createVertexArray();
  gl.bindVertexArray(creatureVao);
  const cs = CREATURE_STRIDE * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, cs, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, cs, 16); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, cs, 32); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, cs, 40); gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);
  texFoam = dataTexture(FOAM_N); texWet = dataTexture(WET_N);
  targets = null;
  return true;
}

function ensureTargets(w, h) {
  if (targets && targets.scene.w === w && targets.scene.h === h) return;
  if (targets) { freeTarget(targets.scene); freeTarget(targets.a); freeTarget(targets.b); freeTarget(targets.mask); freeTarget(targets.ns); freeTarget(targets.shadow); }
  let scene = makeTarget(w, h, floatOk);
  if (!scene.ok) { freeTarget(scene); scene = makeTarget(w, h, false); }
  const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
  targets = { scene, a: makeTarget(bw, bh, false), b: makeTarget(bw, bh, false), mask: makeTarget(w, h, false), ns: makeTarget(w, h, false), shadow: makeTarget(w, h, false) };
}

// Lanterns: one light per creature, sized by kind [fish, jelly, ray, angler]; Darkness shrinks every pool
const LAMP_RADIUS = [4.0, 6.0, 3.2, 5.0], LAMP_GAIN = [0.55, 1.0, 0.8, 1.4];   // radius in body sizes, strength
const lampData = new Float32Array(MAX_CREATURES * 4);
function packLamps(n, darkness) {
  const reach = 1.7 - darkness;
  for (let i = 0; i < n; i++) {
    const o = i * CREATURE_STRIDE, k = creatureData[o + 4] | 0, size = creatureData[o + 2];
    lampData[i * 4] = creatureData[o] + (k === 3 ? creatureData[o + 5] * size * 0.5 : 0);   // the angler's lamp sits toward its lure
    lampData[i * 4 + 1] = creatureData[o + 1];
    lampData[i * 4 + 2] = size * LAMP_RADIUS[k] * reach;
    lampData[i * 4 + 3] = LAMP_GAIN[k] * creatureData[o + 7];
  }
}

// headless check of the negative-space pass: share of the frame that is lit, and its mean reveal
function readNs(which = 'ns') {
  if (!targets) return null;   // nothing rendered yet
  const { w, h, fbo } = targets[which], buf = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let lit = 0, sum = 0;
  for (let i = 0; i < buf.length; i += 4) { sum += buf[i]; if (buf[i] > 127) lit++; }
  return { lit: lit / (w * h), mean: sum / (255 * w * h) };
}

// 'Scene default' (0) takes the scene's own composition; other options map onto SPACE_MODES order.
// Inverted line art has nothing to fade to (the compositor would turn the dark white), so it opts out.
const SPACE = FX.SPACE_MODES;
const spaceMode = (scene, isLine) => (isLine && state.lineInvert ? SPACE.off : state.space === 0 ? scene.spaceMode : state.space - 1);

function fullscreenPass(prog, target, vw, vh) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, vw, vh);
  gl.useProgram(prog);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
function uploadData(unit, tex, n, data) {
  bindTex(unit, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RG, gl.FLOAT, data);
}

function hueRgb(h) {
  const f = (n) => { const k = (n + h / 60) % 6; return 1 - 0.6 * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

function render() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(2, Math.round(canvas.clientWidth * dpr * state.res)), H = Math.max(2, Math.round(canvas.clientHeight * dpr * state.res));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ensureTargets(W, H);
  const room = roomOf();
  const o = orientation(state.rotation, state.flipH, state.flipV, W, H, room.top, room.floor);
  const scene = sceneOf(state.mode), isLine = scene.mono, hasSurface = scene.waterline;
  const { surfBase } = surfaceFor(scene);
  const space = spaceMode(scene, isLine);
  // the floor is lit by the water above it: with a drained tank the seabed goes dark too (a ceiling pins the surface, so it stays lit)
  const floorLit = room.hasCeiling || !scene.waterline ? 1 : smooth(0, 0.15, curLevel);

  sim.fillRings(ringBuf);
  // surfaceOn: the bubble pass stops bubbles at the surface even in scenes whose own look has none (they pop on the ceiling fold)
  const common = (p, surfaceOn = hasSurface) => {
    u1f(p, 'uT', simT); u1f(p, 'uScale', state.scale); u1f(p, 'uSurf', surfBase); u1f(p, 'uA', o.A); u1f(p, 'uPx', o.px);
    u1f(p, 'uTop', o.top); u1f(p, 'uBot', o.bottom); u1f(p, 'uCeilK', ceilK(state.lookUp));
    u1f(p, 'uHasSurface', surfaceOn ? 1 : 0); gl.uniform4fv(loc(p, 'uRing'), ringBuf);
  };

  // fauna mask pass: creatures as SDF sprites (coverage, dome, glow, opacity), MAX-blended
  const nCreatures = state.fauna > 0 ? fauna.fill(creatureData) : 0;
  if (nCreatures > 0) {
    const pf = progs.creature;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.mask.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pf);
    common(pf);
    gl.uniformMatrix3fv(loc(pf, 'uL2S'), false, o.l2s);
    gl.bindBuffer(gl.ARRAY_BUFFER, creatureBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, creatureData, 0, nCreatures * CREATURE_STRIDE);
    gl.bindVertexArray(creatureVao);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform3f(loc(pf, 'uShadow'), 0, 0, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nCreatures);
    // shadows: the same creatures pushed away from the light; the offset and strength both shrink to zero at the back
    if (state.shadow > 0) {
      const la = state.lightAngle * Math.PI / 180 + 0.4 * Math.sin(simT * 0.07);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.shadow.fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform3f(loc(pf, 'uShadow'), -Math.cos(la) * 0.07, -Math.sin(la) * 0.07, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nCreatures);
      if (room.hasFloor) {   // the seabed shows each creature's footprint too, placed by its depth in the floor plane
        gl.uniform1f(loc(pf, 'uFloorSh'), 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nCreatures);
      }
    }
    gl.uniform1f(loc(pf, 'uFloorSh'), 0);
    gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    gl.bindVertexArray(null);
  }

  // negative space: where the projector stays dark (r reveal, g rim light, b/a lens offset), read by every later pass
  const pn = progs.space;
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets.ns.fbo);
  gl.viewport(0, 0, W, H);
  gl.useProgram(pn);
  common(pn);
  u2f(pn, 'uRes', W, H); gl.uniformMatrix3fv(loc(pn, 'uS2L'), false, o.s2l);
  u1i(pn, 'uNsMode', space); u1f(pn, 'uNsT', nsT); u1f(pn, 'uNsAmt', state.spaceAmt); u1f(pn, 'uNsSoft', state.spaceSoft);
  u1f(pn, 'uEdge', isLine && state.lineInvert ? 0 : state.edgeFade);
  u1f(pn, 'uLightAng', state.lightAngle); u1f(pn, 'uFauna', nCreatures > 0 ? 1 : 0);
  if (space === SPACE.lanterns && nCreatures > 0) { packLamps(nCreatures, state.spaceAmt); gl.uniform4fv(loc(pn, 'uLamp'), lampData); }
  u1i(pn, 'uNLamp', space === SPACE.lanterns ? nCreatures : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // scene
  const ps = progs.scene;
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene.fbo);
  gl.viewport(0, 0, W, H);
  gl.useProgram(ps);
  common(ps);
  u2f(ps, 'uRes', W, H); gl.uniformMatrix3fv(loc(ps, 'uS2L'), false, o.s2l);
  u1i(ps, 'uMode', state.mode); u1i(ps, 'uBase', state.base); u1i(ps, 'uLineStyle', state.lineStyle);
  u1f(ps, 'uBright', state.brightness); u1f(ps, 'uContrast', state.contrast); u1f(ps, 'uHue', state.hue);
  u1f(ps, 'uDistort', state.distortion); u1f(ps, 'uDisp', state.dispersion); u1f(ps, 'uWet', state.wetness);
  u1f(ps, 'uGloss', state.gloss); u1f(ps, 'uSpark', state.sparkle); u1f(ps, 'uLightAng', state.lightAngle); u1f(ps, 'uWash', state.wash);
  u1f(ps, 'uSnell', state.snell); u1f(ps, 'uFloorLit', floorLit);
  u1f(ps, 'uLineCount', state.lineCount); u1f(ps, 'uLineThick', state.lineThick); u1f(ps, 'uLineAmp', state.lineAmp);
  u1f(ps, 'uLineIndex', state.lineIndex); u1f(ps, 'uLineTone', state.lineTone); u1f(ps, 'uFoamCell', sim.foamCell);
  uploadData(0, texFoam, FOAM_N, sim.foam); uploadData(1, texWet, WET_N, sim.wet);
  u1i(ps, 'uFoam', 0); u1i(ps, 'uWetTex', 1);
  bindTex(2, targets.mask.tex); u1i(ps, 'uMask', 2);
  bindTex(3, targets.ns.tex); u1i(ps, 'uNS', 3);
  gl.uniformMatrix3fv(loc(ps, 'uL2S'), false, o.l2s);
  u1f(ps, 'uLineMode', isLine ? 1 : 0); u1f(ps, 'uFauna', nCreatures > 0 ? 1 : 0); u1f(ps, 'uFaunaGlow', state.faunaGlow);
  bindTex(4, targets.shadow.tex); u1i(ps, 'uShadowT', 4); u1f(ps, 'uShadowAmt', state.shadow);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // bubbles (additive)
  const count = sim.fillInstances(instances);
  if (count > 0) {
    const pb = progs.bubble;
    gl.useProgram(pb);
    common(pb, hasSurface || room.hasCeiling);
    gl.uniformMatrix3fv(loc(pb, 'uL2S'), false, o.l2s);
    const [tr, tg, tb] = hueRgb(state.hue);
    u3f(pb, 'uTint', tr, tg, tb);
    u1f(pb, 'uLightAng', state.lightAngle); u1f(pb, 'uLineMode', isLine ? 1 : 0); u1f(pb, 'uWet', state.wetness);
    u1f(pb, 'uBright', state.brightness); u1f(pb, 'uLineThick', state.lineThick);
    bindTex(3, targets.ns.tex); u1i(pb, 'uNS', 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, bubbleBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances, 0, count * 6);
    gl.bindVertexArray(bubbleVao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // bloom: bright-pass at 1/4 resolution, two separable blur iterations
  const bloomAmt = isLine ? state.lineBloom : state.bloom;
  if (bloomAmt > 0) {
    const t = targets;
    bindTex(0, t.scene.tex);
    gl.useProgram(progs.bright); u1i(progs.bright, 'uTex', 0); u2f(progs.bright, 'uTexel', 1 / t.a.w, 1 / t.a.h);
    u1f(progs.bright, 'uThresh', isLine ? 0.55 : 0.6);
    fullscreenPass(progs.bright, t.a, t.a.w, t.a.h);
    for (let i = 0; i < 2; i++) {
      bindTex(0, t.a.tex); gl.useProgram(progs.blur); u1i(progs.blur, 'uTex', 0); u2f(progs.blur, 'uDir', 1, 0);
      fullscreenPass(progs.blur, t.b, t.b.w, t.b.h);
      bindTex(0, t.b.tex); u2f(progs.blur, 'uDir', 0, 1);
      fullscreenPass(progs.blur, t.a, t.a.w, t.a.h);
    }
  }

  // composite to screen
  const pc = progs.comp;
  gl.useProgram(pc);
  bindTex(0, targets.scene.tex); bindTex(1, targets.a.tex);
  u1i(pc, 'uScene', 0); u1i(pc, 'uBloom', 1); u2f(pc, 'uRes', W, H);
  u1f(pc, 'uBloomAmt', bloomAmt > 0 ? bloomAmt * 1.3 : 0); u1f(pc, 'uLine', isLine ? 1 : 0);
  u1f(pc, 'uInvert', state.lineInvert ? 1 : 0); u1f(pc, 'uT', simT); u1f(pc, 'uBlack', state.blackPoint);
  const holes = state.keepOut > 0 ? obstacleSmooth : [];
  const boxData = new Float32Array(128);
  holes.forEach((r, i) => boxData.set([r.x, r.y, r.x + r.w, r.y + r.h], i * 4));
  gl.uniform1i(loc(pc, 'uNBox'), holes.length); gl.uniform4fv(loc(pc, 'uBox[0]'), boxData);
  u1f(pc, 'uKeep', state.keepOut); u1f(pc, 'uKeepSoft', state.keepOutSoft);
  fullscreenPass(pc, null, W, H);
  return { count, A: o.A };
}

/* ============================== MAIN LOOP ============================== */
let lastTs = performance.now(), acc = 0, fpsAcc = 0, fpsFrames = 0, lastLogicalA = 1.78;

function stepOnce(dtSim) {
  simT += dtSim; cycleT += dtSim; nsT += dtSim * state.spaceDrift;
  curLevel = state.auto ? levelAt(cycleT, state.rise, state.hold, state.drain) : state.level;
  const scene = sceneOf(state.mode), { hasSurface, surfBase } = surfaceFor(scene);
  sim.step(dtSim, {
    t: simT, A: lastLogicalA, scale: state.scale, tank: state.tank, hasSurface, surfBase,
    bubbles: state.bubbles, bubbleSize: state.bubbleSize, foam: state.foam, foamLife: state.foamLife,
    obstacles: curBoxes, avoidBubbles: state.avoidBubbles, avoidMargin: state.avoidMargin,
  });
  fauna.step(dtSim, {
    t: simT, A: lastLogicalA, hasSurface, surfBase,
    profile: [scene.fauna.fish, scene.fauna.jelly, scene.fauna.manta, scene.fauna.angler],
    fauna: state.fauna, faunaSize: state.faunaSize, faunaSpeed: state.faunaSpeed,
    depth: state.faunaDepth, obstacles: curBoxes, avoid: state.avoid, avoidMargin: state.avoidMargin,
    mulFish: state.fish, mulJelly: state.jellies, mulManta: state.manta, mulAngler: state.angler,
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!gl || gl.isContextLost()) return;
  const wall = Math.max((now - lastTs) / 1000, 0);
  const real = Math.min(wall, MAX_FRAME_DT);
  lastTs = now;
  updateObstacles(wall);
  if (!paused) {
    acc += real;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS) { stepOnce(FIXED_DT * state.speed); acc -= FIXED_DT; steps++; }
    if (steps === MAX_STEPS) acc = 0;
  } else if (!state.auto) curLevel = state.level;
  const info = render();
  lastLogicalA = info.A;
  fpsAcc += wall; fpsFrames++;
  if (fpsAcc >= 0.5) {
    ui.updateStat(Math.round(fpsFrames / fpsAcc) + ' fps · ' + info.count + ' bubbles · ' + canvas.width + '×' + canvas.height);
    fpsAcc = 0; fpsFrames = 0;
    ui.updateLevel(curLevel);
  }
  if (typeof api.onframe === 'function') {
    try { api.onframe({ t: simT, level: curLevel, bubbles: info.count }); } catch (e) { console.error('onframe', e); }
  }
}

/* ============================== UI ============================== */
const ui = (() => {
  const panel = document.getElementById('panel');
  const refs = {};
  const modeNames = scenes.map((s) => s.name);
  const modeBtns = [];
  let statEl = null;
  const el = (tag, attrs = {}, kids = []) => {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'text' ? (e.textContent = v) : e.setAttribute(k, v)));
    kids.forEach((c) => e.append(c));
    return e;
  };
  const decimals = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const fmt = (s, v) => (s.type === 'num' ? Number(v).toFixed(decimals(s.step)) : String(v));

  function addRow(parent, s) {
    const row = el('div', { class: 'row' + (s.type === 'bool' ? ' bool' : '') });
    row.append(el('label', { text: s.label }));
    if (s.type === 'bool') {
      const inp = el('input', { type: 'checkbox' });
      inp.addEventListener('change', () => api.setState({ [s.k]: inp.checked }));
      row.append(inp); refs[s.k] = { inp, s };
    } else if (s.opts) {
      const sel = el('select', {}, s.opts.map((t, i) => el('option', { value: i, text: t })));
      sel.addEventListener('change', () => api.setState({ [s.k]: Number(sel.value) }));
      row.append(sel); refs[s.k] = { inp: sel, s };
    } else {
      const inp = el('input', { type: 'range', min: s.min, max: s.max, step: s.step });
      const out = el('output');
      inp.addEventListener('input', () => api.setState({ [s.k]: Number(inp.value) }));
      row.append(inp, out); refs[s.k] = { inp, out, s };
    }
    parent.append(row);
  }

  function build() {
    panel.append(el('h1', {}, [el('span', { text: 'Underwater projection' }), el('span', { text: 'H hides' })]));
    const modeRow = el('div', { class: 'btns' });
    modeNames.forEach((n, i) => {
      const b = el('button', { text: scenes[i].id + ' ' + n, title: scenes[i].category + ' / ' + scenes[i].key });
      b.addEventListener('click', () => { api.setMode(scenes[i].id); b.blur(); });
      modeBtns.push(b); modeRow.append(b);
    });
    panel.append(modeRow);
    const groups = [...new Set(SPECS.map((s) => s.group))];
    groups.forEach((g, gi) => {
      const d = el('details', gi < 3 ? { open: '' } : {}, [el('summary', { text: g })]);
      SPECS.filter((s) => s.group === g && s.k !== 'mode').forEach((s) => {
        addRow(d, s);
        if (s.k === 'hue') {
          const sw = el('div', { class: 'btns' });
          [[190, 'Aqua'], [215, 'Deep blue'], [150, 'Green'], [170, 'Teal'], [265, 'Violet']].forEach(([h, name]) => {
            const b = el('button', { class: 'sw', title: name, style: 'background:hsl(' + h + ',75%,55%)' });
            b.addEventListener('click', () => { api.setState({ hue: h }); b.blur(); });
            sw.append(b);
          });
          d.append(sw);
        }
      });
      if (g === 'Output') {
        const b = el('div', { class: 'btns' });
        const fs = el('button', { text: 'Fullscreen (F)' }); fs.addEventListener('click', () => { toggleFullscreen(); fs.blur(); });
        const rs = el('button', { text: 'Reset' }); rs.addEventListener('click', () => { api.setState(DEFAULTS); rs.blur(); });
        const cm = el('button', { text: 'Copy params JSON' }); cm.addEventListener('click', () => { copyText(JSON.stringify(api.getManifest(), null, 2), 'Params JSON'); cm.blur(); });
        const cl = el('button', { text: 'Copy link' }); cl.addEventListener('click', () => { copyText(shareUrl(), 'Link'); cl.blur(); });
        b.append(fs, rs, cm, cl); d.append(b);
      }
      panel.append(d);
    });
    statEl = el('div', { id: 'stat' }); panel.append(statEl);
  }

  function sync(s) {
    Object.values(refs).forEach(({ inp, out, s: spec }) => {
      if (spec.type === 'bool') inp.checked = !!s[spec.k]; else inp.value = s[spec.k];
      if (out) out.textContent = fmt(spec, s[spec.k]);
    });
    modeBtns.forEach((b, i) => b.classList.toggle('on', scenes[i].id === s.mode));
  }
  function updateStat(t) { if (statEl) statEl.textContent = t; }
  function shareUrl() {
    const diff = Object.entries(api.getState()).filter(([k, v]) => k !== 'level' && v !== DEFAULTS[k]).map(([k, v]) => [k, String(v)]);
    return location.href.split('#')[0].split('?')[0] + '?' + new URLSearchParams(diff);
  }
  function copyText(text, label) {
    const done = () => updateStat(label + ' copied');
    const fail = () => { updateStat(label + ': clipboard blocked, see console'); console.info(text); };
    try { navigator.clipboard.writeText(text).then(done, fail); } catch (err) { fail(); }
  }
  function updateLevel(l) {
    if (!state.auto || !refs.level) return;
    refs.level.inp.value = l; refs.level.out.textContent = l.toFixed(2);
  }
  build(); sync(state);
  listeners.add(sync);
  return { updateStat, updateLevel };
})();

/* ============================== FOLD HANDLES ============================== */
// Two draggable lines on the page (hidden with the panel and in embed mode): drag the horizon down until it sits on the
// real wall/ceiling corner, the floor line up to the wall/floor corner. The same values are ports (horizon, floorLevel).
(() => {
  const mk = (key, label) => {
    const line = document.createElement('div'), tab = document.createElement('div');
    line.className = 'fold foldui'; tab.className = 'foldtab foldui'; tab.textContent = label; tab.title = 'Drag to set ' + key;
    document.body.append(line, tab);
    tab.addEventListener('pointerdown', (e) => { tab.setPointerCapture(e.pointerId); e.preventDefault(); });
    tab.addEventListener('pointermove', (e) => {
      if (!tab.hasPointerCapture(e.pointerId)) return;
      const f = frameFractionAt(e.clientX, e.clientY);
      api.setState(key === 'horizon' ? { horizon: Math.max(f, state.floorLevel + MIN_WALL) } : { floorLevel: Math.min(f, state.horizon - MIN_WALL) });
    });
    return { key, line, tab };
  };
  const handles = [mk('horizon', 'horizon'), mk('floorLevel', 'floor')];
  const INSET = 16;   // px: keep the grab tab just inside the frame when its fold sits on the frame edge
  function place() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight, folds = foldLines(cw, ch);
    for (const { key, line, tab } of handles) {
      const [x0, y0, x1, y1] = folds[key], X0 = x0 * cw, Y0 = y0 * ch, dx = (x1 - x0) * cw, dy = (y1 - y0) * ch, len = Math.hypot(dx, dy) || 1;
      line.style.cssText = 'left:' + X0 + 'px;top:' + Y0 + 'px;width:' + len + 'px;transform:rotate(' + Math.atan2(dy, dx) + 'rad)';
      let nx = -dy / len, ny = dx / len;                                   // normal, flipped to point into the frame
      if (nx * (cw / 2 - (X0 + dx / 2)) + ny * (ch / 2 - (Y0 + dy / 2)) < 0) { nx = -nx; ny = -ny; }
      tab.style.left = X0 + dx / 2 + nx * INSET + 'px'; tab.style.top = Y0 + dy / 2 + ny * INSET + 'px';
    }
  }
  listeners.add(place);
  window.addEventListener('resize', place);
  place();
})();

/* ============================== INPUT ============================== */
function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  } catch (e) { console.warn('fullscreen unavailable', e); }
}
let wakeLock = null;
async function requestWake() {
  try {
    if (!wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { /* not granted: ignore */ }
}
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
}
['mousemove', 'pointerdown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
window.addEventListener('pointerdown', requestWake, { once: true });
window.addEventListener('keydown', (e) => {
  requestWake(); wake();
  const tag = (e.target && e.target.tagName) || '';
  if ((tag === 'INPUT' || tag === 'SELECT') && e.key.startsWith('Arrow')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (/^[1-9]$/.test(key) && scenes.some((s) => s.id === Number(key))) api.setMode(Number(key));
  else if (key === 'f') toggleFullscreen();
  else if (key === 'h') document.body.classList.toggle('nopanel');
  else if (key === ' ') { paused = !paused; e.preventDefault(); }
  else if (key === 'r') cycleT = 0;
  else if (key === 'l') api.setState({ lineStyle: (state.lineStyle + 1) % 3, ...(monoScene ? { mode: monoScene.id } : {}) });
  else if (e.key === 'ArrowUp') { api.setLevel(clamp(curLevel + 0.02, 0, 1)); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { api.setLevel(clamp(curLevel - 0.02, 0, 1)); e.preventDefault(); }
});
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showMessage('WebGL context lost - waiting to restore...'); });
canvas.addEventListener('webglcontextrestored', () => { msgEl.style.display = 'none'; initGL(); });

/* ============================== START ============================== */
if (initGL()) requestAnimationFrame(frame);
wake();
})(window.FluidFX);
