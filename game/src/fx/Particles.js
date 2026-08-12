// Suspended silt, and the trip's sparkles.
//
// Silt is the single cheapest thing that makes water feel like water: motes that
// drift in a box locked to the camera and wrap around when they leave it, so the
// player is always inside a cloud of them without ever simulating the whole lake.
//
// Sparkles share the same pool and shader and only differ in colour and lifetime,
// spawned at a rate driven by uTrip. Two systems, one draw call.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const SILT = 700;
const SPARK = 260;

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
    const N = SILT + SPARK;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.life = new Float32Array(N);
    this.decay = new Float32Array(N);
    this.sparkCursor = SILT;
    this._acc = 0;

    // Silt: scattered through a box that will be re-centred on the camera.
    this.box = 46;
    for (let i = 0; i < SILT; i++) {
      const i3 = i * 3;
      this.pos[i3] = (Math.random() - 0.5) * this.box;
      this.pos[i3 + 1] = (Math.random() - 0.5) * this.box;
      this.pos[i3 + 2] = (Math.random() - 0.5) * this.box;
      this.vel[i3] = (Math.random() - 0.5) * 0.22;
      this.vel[i3 + 1] = (Math.random() - 0.5) * 0.1 - 0.04;
      this.vel[i3 + 2] = (Math.random() - 0.5) * 0.22;
      this.size[i] = 0.16 + Math.random() * 0.3;
      this.life[i] = 0.14 + Math.random() * 0.3;
      const g = 0.55 + Math.random() * 0.25;
      this.col[i3] = g * 0.8; this.col[i3 + 1] = g; this.col[i3 + 2] = g * 0.92;
    }

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

  /** Rainbow motes around the pair during the trip. */
  spawnSparkle(centre, radius) {
    const i = this.sparkCursor;
    this.sparkCursor = SILT + ((this.sparkCursor - SILT + 1) % SPARK);
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
    // Silt wraps around the camera so we're always inside the cloud.
    const half = this.box / 2;
    for (let i = 0; i < SILT; i++) {
      const i3 = i * 3;
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
    for (let i = SILT; i < this.N; i++) {
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
    this.geo.setDrawRange(0, Math.floor(this.N * s));
  }
}
