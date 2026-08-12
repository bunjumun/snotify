// The exhale.
//
// A bong hit leaves a cloud hanging in the water where it happened, and the pair
// drag a trail of it behind them for as long as the trip lasts — thinning as
// uTrip decays, so the comedown is something you can watch drift off over your
// shoulder rather than only a grade on the lens.
//
// Same shape as Bubbles: one fixed pool of Points, recycled, one draw call, the
// buffer uploaded once a frame. What makes it smoke rather than dots is that it
// SWELLS. A sprite that only fades reads as a light going out; a sprite that
// grows while it fades reads as something dispersing into water, and that one
// difference is the entire effect.
//
// It also does not plume. Smoke released underwater has nowhere to go: it hangs,
// spreads, and drifts up at a crawl. Anything faster looks like a campfire.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const MAX = 460;   // a hit alone spends a couple of hundred of these

const VERT = `
  attribute float aSize; attribute float aLife; attribute float aSeed;
  attribute float aSpin;
  varying float vLife; varying float vSeed; varying float vSpin;
  uniform float uScale; uniform float uTime; uniform float uSpread;
  void main(){
    vLife = aLife; vSeed = aSeed;
    // Each puff turns on its own axis at its own rate, and slows as it grows —
    // conservation of angular momentum, near enough for the eye. This is the
    // cheapest thing on the list and it does the most: a lumpy sprite that
    // never turns is a decal, and once a hundred of them are all decals the
    // cloud looks painted onto the screen.
    vSpin = aSpin * uTime * (0.35 + aLife * 0.65);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // aLife runs 1 -> 0, so (2.0 - aLife) grows from 1 to 2 across the sprite's
    // life. That's the swell, and it costs nothing.
    // uSpread is what makes this smoke rather than dust. A puff has to cover
    // real screen area and overlap its neighbours to read as one volume; at the
    // 60.0 the bubbles use, a cloud at arm's length draws as five-pixel specks.
    gl_PointSize = clamp(aSize * (2.0 - aLife) * uScale * uSpread
                         / max(0.001, -mv.z) * 60.0, 2.0, 420.0);
  }
`;

const FRAG = `
  precision mediump float;
  varying float vLife; varying float vSeed; varying float vSpin;
  uniform float uTrip;

  // Cheap value noise. Three taps of it is enough structure to break a sprite
  // into something with wisps in it, and it costs no texture and no lookup.
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main(){
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    // Spin the sprite about its own centre before anything reads from it, so
    // the lump pattern and the internal wisps turn together as one puff.
    float cs = cos(vSpin), sn = sin(vSpin);
    p = mat2(cs, -sn, sn, cs) * p;
    // A lumpy edge instead of a circle. Two harmonics and a per-sprite phase is
    // all it takes to stop a point sprite reading as a disc.
    float ang = atan(p.y, p.x) + vSeed * 6.28318;
    float lump = 1.0 - 0.22 * sin(ang * 3.0) - 0.11 * sin(ang * 7.0 + 1.7);
    float r = length(p) / max(0.35, lump);
    if (r > 1.0) discard;
    // Fades in over the first sliver of life and out across the rest, so nothing
    // ever pops into being at full opacity.
    float fade = smoothstep(1.0, 0.86, vLife) * smoothstep(0.0, 0.5, vLife);
    // Two octaves of curdle across the face of the sprite. It thins as the puff
    // ages, so a young one is dense and knotted and an old one has come apart
    // into rags — which is the part that reads as smoke actually dispersing
    // rather than a disc being turned down.
    vec2 np = p * 1.7 + vSeed * 40.0;
    float wisp = vnoise(np) * 0.62 + vnoise(np * 2.3 + 7.0) * 0.38;
    float curdle = mix(1.0, 0.35 + wisp * 1.15, 0.55 + 0.45 * (1.0 - vLife));
    float a = pow(1.0 - r, 1.7) * fade * 0.4 * curdle;
    if (a < 0.004) discard;
    // Lit slightly from the noise too, so the knots read as thicker smoke and
    // not just as holes punched in it.
    vec3 col = vec3(0.60, 0.69, 0.67) * (0.86 + wisp * 0.28);
    // Through the trip it takes the same rainbow everything else is wearing.
    if (uTrip > 0.001) {
      vec3 tint = vec3(
        0.5 + 0.5 * sin(vSeed * 6.28318),
        0.5 + 0.5 * sin(vSeed * 6.28318 + 2.094),
        0.5 + 0.5 * sin(vSeed * 6.28318 + 4.188));
      col = mix(col, tint, uTrip * 0.45);
    }
    gl_FragColor = vec4(col, a);
  }
`;

export class Smoke {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.life = new Float32Array(MAX);   // 1 -> 0; drives both alpha and swell
    this.decay = new Float32Array(MAX);
    this.seed = new Float32Array(MAX);
    this.spin = new Float32Array(MAX);
    this.cursor = 0;
    this.active = MAX;                   // lowered by setQuality
    this._acc = 0;
    this._t = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1));
    geo.setDrawRange(0, MAX);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // never cull

    this.uniforms = {
      uScale: { value: 1 },
      uTrip: { value: 0 },
      uTime: { value: 0 },
      uSpread: { value: CFG.smoke.spread },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT, fragmentShader: FRAG,
      // Normal, not additive: smoke is something you see less through, not a
      // light. Additive smoke over dark water is just fog with extra steps.
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    }));
    this.geo = geo;
    this.group = this.points;
  }

  /**
   * One puff. `spread` is the outward shove it gets at birth — high for a fresh
   * cloud that has to look like it was pushed out of something, near zero for
   * the trail, which should just appear where the diver was.
   */
  spawn(x, y, z, size = 1, spread = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.active;
    const i3 = i * 3;
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    this.pos[i3] = x + (Math.random() - 0.5) * 0.4;
    this.pos[i3 + 1] = y + (Math.random() - 0.5) * 0.4;
    this.pos[i3 + 2] = z + (Math.random() - 0.5) * 0.4;
    this.vel[i3] = Math.sin(b) * Math.cos(a) * spread;
    this.vel[i3 + 1] = Math.cos(b) * spread * 0.6 + 0.3;
    this.vel[i3 + 2] = Math.sin(b) * Math.sin(a) * spread;
    this.size[i] = size * (0.7 + Math.random() * 0.9);
    this.life[i] = 1;
    const [lo, hi] = CFG.smoke.life;
    this.decay[i] = 1 / (lo + Math.random() * (hi - lo));
    this.seed[i] = Math.random();
    // Signed, so a cloud turns both ways at once instead of shearing one way.
    this.spin[i] = (Math.random() - 0.5) * CFG.smoke.spin;
  }

  /** The cloud a hit leaves behind. */
  puff(x, y, z, count = CFG.smoke.puff, size = 1.4) {
    for (let i = 0; i < count; i++) this.spawn(x, y, z, size, 1.6 + Math.random() * 1.4);
  }

  /** A steady stream, rate-limited independent of framerate. */
  trail(dt, x, y, z, perSecond, size = 0.9) {
    this._acc += perSecond * dt;
    while (this._acc >= 1) { this.spawn(x, y, z, size, 0.25); this._acc -= 1; }
  }

  update(dt) {
    // Water eats the ejection velocity within a second or so; what's left is the
    // slow rise. One exponential handles both.
    const damp = Math.pow(0.55, dt);
    const rise = CFG.smoke.rise;
    this._t += dt;
    const t = this._t;
    const sw = CFG.smoke.swirl;

    for (let i = 0; i < this.active; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];

      // A standing flow field, sampled at the particle's own position. Because
      // it's a function of WHERE the particle is rather than which particle it
      // is, neighbours get near-identical pushes and the cloud folds as a sheet
      // instead of every dot wandering off on its own errand. That coherence is
      // the whole difference between billowing and fizzing.
      //
      // Three sines is not a real curl field and doesn't need to be — it's
      // divergence-free enough at this scale, and nothing here is being graded
      // on incompressibility.
      const f = sw * (0.35 + this.life[i] * 0.65);
      this.vel[i3]     += Math.sin(y * 0.55 + t * 0.42) * f * dt;
      this.vel[i3 + 1] += Math.sin(z * 0.48 - t * 0.31) * f * 0.55 * dt;
      this.vel[i3 + 2] += Math.sin(x * 0.61 + t * 0.37) * f * dt;

      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.vel[i3] *= damp;
      this.vel[i3 + 2] *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp + rise * (1 - damp);
      this.life[i] -= this.decay[i] * dt;
      if (this.life[i] < 0) this.life[i] = 0;
    }
    this.uniforms.uTime.value = t;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSeed.needsUpdate = true;
    this.geo.attributes.aSpin.needsUpdate = true;
    // aSize has to be re-uploaded too, and leaving it out was not a small bug:
    // the buffer is all zeros when the first frame draws, so without this it
    // uploads once, empty, and every sprite spawned afterwards keeps a GPU-side
    // size of 0. gl_PointSize then clamps to its 2px floor and the entire smoke
    // system renders as a haze of single dots. It was never smoke.
    this.geo.attributes.aSize.needsUpdate = true;
  }

  setTrip(v) { this.uniforms.uTrip.value = v; }

  /** Wipe the pool — a retry shouldn't start inside last run's cloud. */
  clear() {
    this.life.fill(0);
    this._acc = 0;
    this.geo.attributes.aLife.needsUpdate = true;
  }

  setQuality(level) {
    const s = CFG.quality.levels[level]?.particleScale ?? 1;
    this.active = Math.max(32, Math.floor(MAX * s));
    this.cursor = 0;
    this.geo.setDrawRange(0, this.active);
  }
}
