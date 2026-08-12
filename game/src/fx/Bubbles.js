// Bubbles.
//
// A fixed pool of Points, recycled — never allocated per bubble. Positions are
// updated on the CPU because they have to spawn from a moving helmet and follow a
// wobble that isn't a pure function of time, and at a few hundred points that's
// far cheaper than it sounds. The buffer is uploaded once per frame.
//
// They're drawn as soft discs with a bright rim, which is what makes a flat
// circle read as a gas bubble rather than a dot.

import * as THREE from 'three';

const MAX = 420;

const VERT = `
  attribute float aSize;
  attribute float aLife;
  varying float vLife;
  uniform float uScale;
  void main(){
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective sizing, clamped so a bubble against the lens doesn't fill the
    // screen with one enormous quad.
    gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z) * 60.0, 1.0, 42.0);
  }
`;

const FRAG = `
  precision mediump float;
  varying float vLife;
  void main(){
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float edge = smoothstep(1.0, 0.55, r);
    // Rim highlight plus a small offset specular — the two cues that say "gas
    // bubble" instead of "white dot".
    float rim = smoothstep(0.55, 1.0, r) * 0.9;
    float spec = smoothstep(0.36, 0.0, length(p - vec2(-0.33, 0.33)));
    float a = (edge * 0.16 + rim * 0.5 + spec * 0.75) * vLife;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.80, 0.93, 0.95), a);
  }
`;

export class Bubbles {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.life = new Float32Array(MAX);   // 1 → 0; also drives alpha
    this.decay = new Float32Array(MAX);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setDrawRange(0, MAX);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // never cull the pool

    this.uniforms = { uScale: { value: 1 } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    }));
    this.geo = geo;
    this.group = this.points;

    this._emitAcc = 0;
  }

  /** Spawn one bubble. Oldest slot is reused, so bursts never starve the trickle. */
  spawn(x, y, z, size = 1, rise = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const i3 = i * 3;
    this.pos[i3] = x + (Math.random() - 0.5) * 0.3;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z + (Math.random() - 0.5) * 0.3;
    this.vel[i3] = (Math.random() - 0.5) * 0.35;
    this.vel[i3 + 1] = (0.9 + Math.random() * 0.8) * rise;
    this.vel[i3 + 2] = (Math.random() - 0.5) * 0.35;
    this.size[i] = size * (0.35 + Math.random() * 0.95);
    this.life[i] = 1;
    this.decay[i] = 0.055 + Math.random() * 0.075;
  }

  /** A steady stream, rate-limited independent of framerate. */
  emit(dt, x, y, z, perSecond, size = 1) {
    this._emitAcc += perSecond * dt;
    while (this._emitAcc >= 1) { this.spawn(x, y, z, size); this._emitAcc -= 1; }
  }

  burst(x, y, z, count, size = 1) {
    for (let i = 0; i < count; i++) this.spawn(x, y, z, size, 1.4);
  }

  update(dt, t) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      // Bubbles don't rise straight — they spiral. A per-bubble phase from its
      // index keeps neighbours from moving in lockstep.
      this.pos[i3] += (this.vel[i3] + Math.sin(t * 2.6 + i) * 0.45) * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += (this.vel[i3 + 2] + Math.cos(t * 2.2 + i * 1.3) * 0.45) * dt;
      this.vel[i3 + 1] += 0.55 * dt; // accelerate as they expand toward the surface
      this.life[i] -= this.decay[i] * dt;
      if (this.life[i] < 0) this.life[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }

  setQuality(level) {
    this.uniforms.uScale.value = level === 'low' ? 0.7 : 1;
  }
}
