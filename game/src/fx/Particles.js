// Suspended silt, and the trip's sparkles.
//
// Silt is the single cheapest thing that makes water feel like water: motes that
// drift in a box locked to the camera and wrap around when they leave it, so the
// player is always inside a cloud of them without ever simulating the whole lake.
//
// Sparkles share the same pool and shader and only differ in colour and lifetime,
// spawned at a rate driven by uTrip. Two systems, one draw call.
//
// One draw call is why the two populations are interleaved through the buffer
// instead of sitting in blocks. Quality thins the system by shortening the draw
// range, and a range can only ever be a prefix — so if the populations were
// blocked, a shortened prefix would take everything from the first and nothing
// from the second. Spread them, and any prefix holds both in proportion.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const SILT = 700;
const SPARK = 260;
const N = SILT + SPARK;

const VERT = `
  attribute float aSize; attribute float aLife; attribute vec3 aColor;
  varying float vLife; varying vec3 vColor;
  void main(){
    vLife = aLife; vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize / max(0.001, -mv.z) * 55.0, 1.0, 26.0);
  }
`;
const FRAG = `
  precision mediump float;
  varying float vLife; varying vec3 vColor;
  void main(){
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float a = (1.0 - r) * vLife;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class Particles {
  constructor() {
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.life = new Float32Array(N);
    this.decay = new Float32Array(N);
    this._acc = 0;

    // Which slots belong to which population.
    //
    // Silt used to own 0..699 and sparkles 700..959, which meant the low quality
    // setting — a draw range of floor(960 × 0.4) = 384 slots — stopped dead
    // inside the silt block: no sparkle was ever drawn on low quality, and 316
    // silt motes were simulated every frame without reaching the screen. Placing
    // one sparkle at every regular interval among the silt makes any prefix of
    // the buffer a proportional slice of both.
    this.siltIdx = new Uint16Array(SILT);
    this.sparkIdx = new Uint16Array(SPARK);
    for (let i = 0, silt = 0, spark = 0; i < N; i++) {
      // How many sparkles should exist by the end of slot i if they were spread
      // perfectly evenly. When that number moves, this slot is a sparkle.
      if (Math.floor(((i + 1) * SPARK) / N) > spark) this.sparkIdx[spark++] = i;
      else this.siltIdx[silt++] = i;
    }
    this.siltActive = SILT;
    this.sparkActive = SPARK;
    this.sparkCursor = 0;   // an index INTO sparkIdx, not into the buffer

    // Where the camera was last frame, so a quality change can wake silt around
    // the player rather than around the origin.
    this.cam = { x: 0, y: 0, z: 0 };

    // Silt: scattered through a box that will be re-centred on the camera.
    this.box = 46;
    this._seedSilt(0, SILT);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.geo = geo;
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.group = this.points;
    this.count = N;
  }

  /**
   * Scatter silt slots [from, to) through the box around the camera.
   *
   * Called for the whole population at construction, and again for slots a
   * quality increase brings back: those have not been simulated while they were
   * outside the draw range, and the wrap in update() only moves a mote one box
   * width per frame, so one left behind across the lake would take hundreds of
   * frames to walk home.
   */
  _seedSilt(from, to) {
    for (let n = from; n < to; n++) {
      const i = this.siltIdx[n];
      const i3 = i * 3;
      this.pos[i3] = this.cam.x + (Math.random() - 0.5) * this.box;
      this.pos[i3 + 1] = this.cam.y + (Math.random() - 0.5) * this.box;
      this.pos[i3 + 2] = this.cam.z + (Math.random() - 0.5) * this.box;
      this.vel[i3] = (Math.random() - 0.5) * 0.22;
      this.vel[i3 + 1] = (Math.random() - 0.5) * 0.1 - 0.04;
      this.vel[i3 + 2] = (Math.random() - 0.5) * 0.22;
      this.size[i] = 0.16 + Math.random() * 0.3;
      this.life[i] = 0.14 + Math.random() * 0.3;
      const g = 0.55 + Math.random() * 0.25;
      this.col[i3] = g * 0.8; this.col[i3 + 1] = g; this.col[i3 + 2] = g * 0.92;
    }
  }

  /** Rainbow motes around the pair during the trip. */
  spawnSparkle(centre, radius) {
    if (!this.sparkActive) return;
    const i = this.sparkIdx[this.sparkCursor];
    this.sparkCursor = (this.sparkCursor + 1) % this.sparkActive;
    const i3 = i * 3;
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.35 + Math.random() * 0.65);
    this.pos[i3] = centre.x + Math.sin(b) * Math.cos(a) * r;
    this.pos[i3 + 1] = centre.y + Math.cos(b) * r;
    this.pos[i3 + 2] = centre.z + Math.sin(b) * Math.sin(a) * r;
    this.vel[i3] = (Math.random() - 0.5) * 1.6;
    this.vel[i3 + 1] = 0.4 + Math.random() * 1.3;
    this.vel[i3 + 2] = (Math.random() - 0.5) * 1.6;
    this.size[i] = 0.3 + Math.random() * 0.55;
    this.life[i] = 1;
    this.decay[i] = 0.5 + Math.random() * 0.7;

    const h = Math.random();
    const c = new THREE.Color().setHSL(h, 0.95, 0.68);
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
  }

  update(dt, cameraPos, trip = 0) {
    this.cam.x = cameraPos.x; this.cam.y = cameraPos.y; this.cam.z = cameraPos.z;

    // Silt wraps around the camera so we're always inside the cloud. Only the
    // motes inside the draw range are stepped: what is simulated and what is
    // drawn are now the same set, which is where low quality gets its frames.
    const half = this.box / 2;
    for (let n = 0; n < this.siltActive; n++) {
      const i3 = this.siltIdx[n] * 3;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      for (let k = 0; k < 3; k++) {
        const c = k === 0 ? cameraPos.x : k === 1 ? cameraPos.y : cameraPos.z;
        let d = this.pos[i3 + k] - c;
        if (d > half) this.pos[i3 + k] -= this.box;
        else if (d < -half) this.pos[i3 + k] += this.box;
      }
    }

    // Sparkles.
    if (trip > 0.01) {
      this._acc += CFG.trip.sparkleRate * trip * dt;
      while (this._acc >= 1) { this._pendingCentre && this.spawnSparkle(this._pendingCentre, CFG.trip.sparkleRadius); this._acc -= 1; }
    }
    for (let n = 0; n < this.sparkActive; n++) {
      const i = this.sparkIdx[n];
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.life[i] = Math.max(0, this.life[i] - this.decay[i] * dt);
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    // As in Smoke.js and Bubbles.js: aSize uploads once, empty, and every
    // sparkle after that draws at the clamp floor without this.
    this.geo.attributes.aSize.needsUpdate = true;
  }

  /** Where sparkles should orbit — the kelpie, during a trip. */
  setSparkleCentre(v) { this._pendingCentre = v; }

  setQuality(level) {
    const s = CFG.quality.levels[level]?.particleScale ?? 1;
    const draw = Math.max(1, Math.floor(this.N * s));
    this.geo.setDrawRange(0, draw);

    // Both index lists ascend, so the active slots of each population are simply
    // the ones that fall inside the range. Counting them is what keeps the
    // simulation and the draw call describing the same particles.
    const silt = activeCount(this.siltIdx, draw);
    const spark = activeCount(this.sparkIdx, draw);

    // Slots coming back from dormancy still hold whatever they held when they
    // went quiet. A sparkle would resume mid-flight from some earlier trip, so
    // its life is cleared; silt has to be re-scattered, having done no drifting
    // or wrapping while it was outside the range.
    for (let n = this.sparkActive; n < spark; n++) this.life[this.sparkIdx[n]] = 0;
    if (silt > this.siltActive) this._seedSilt(this.siltActive, silt);

    this.siltActive = silt;
    this.sparkActive = spark;
    // The cursor walks the active window and must not be left outside it.
    if (this.sparkCursor >= spark) this.sparkCursor = 0;
  }
}

/** How many of an ascending index list fall inside the draw range. */
function activeCount(idx, draw) {
  let n = 0;
  while (n < idx.length && idx[n] < draw) n++;
  return n;
}
