// A school of fish.
//
// One InstancedMesh per school, so forty fish are one draw call and a matrix
// upload. Classic boids — separation, alignment, cohesion — plus two rules the
// lake needs: a pull back toward the school's home water, so the bowl doesn't
// slowly empty out into the fog, and a hard shove away from the kelpie, so a
// school breaks and scatters when you plough through it. That scatter is the
// single best thing in the file: it's the moment the water stops being scenery.
//
// Body geometry faces -Z, matching Object3D.lookAt, which points -Z at its
// target. Building a fish that faces +Z and then wondering why the whole school
// swims backwards is a mistake this project has already made once, with a horse.
//
// The tail beat is in the vertex shader off a per-instance phase attribute, not
// gl_InstanceID — an InstancedBufferAttribute is plain WebGL1-era machinery that
// works everywhere, and the phase is what stops forty fish flapping in unison.

import * as THREE from 'three';
import { CFG } from '../../config.js';

/** Stretched, pinched sphere. At fog distance the silhouette is the whole read. */
function bodyGeometry(sp) {
  const long = sp.eel ? 4.2 : 1.7;
  const g = new THREE.SphereGeometry(0.5, sp.eel ? 8 : 10, sp.eel ? 6 : 8);
  g.scale(sp.eel ? 0.34 : 0.52, sp.eel ? 0.38 : 0.74, long);

  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    // Taper toward the tail, which is +Z now that the head faces -Z.
    if (z > 0) {
      const t = Math.max(sp.eel ? 0.3 : 0.12, 1 - (z / long) * (sp.eel ? 0.7 : 1.1));
      p.setX(i, p.getX(i) * t);
      p.setY(i, p.getY(i) * t);
    }
  }
  g.computeVertexNormals();

  const tail = new THREE.ConeGeometry(0.34 * sp.size, 0.55, 4);
  tail.rotateX(-Math.PI / 2);           // point it aft
  tail.scale(0.26, 1, 1);
  tail.translate(0, 0, long * 0.52);

  const merged = mergeSimple([g, tail]);
  merged.scale(sp.size, sp.size, sp.size);
  return merged;
}

/**
 * Concatenate two non-indexed geometries. BufferGeometryUtils lives in
 * examples/jsm, which this build deliberately doesn't vendor, and the general
 * case isn't needed — two position/normal buffers is the whole requirement.
 */
function mergeSimple(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;

  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

export class School {
  /**
   * @param {object} sp a row from world/Species.js
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('../world/Seabed.js').Seabed} seabed
   * @param {THREE.Vector3} home
   */
  constructor(sp, rng, seabed, home, count) {
    this.sp = sp;
    this.seabed = seabed;
    this.home = home.clone();
    this.count = count;
    this.radius = 7 + count * 0.32;
    this._t = 0;
    this._tighten = 0;
    this.active = true;

    const geo = bodyGeometry(sp);
    this.material = new THREE.MeshStandardMaterial({
      color: sp.color,
      roughness: 0.42,
      metalness: sp.eel ? 0.05 : 0.35,   // scales catch light; a lamprey doesn't
      emissive: sp.belly,
      emissiveIntensity: 0.06,
    });
    this._hookShader(this.material);

    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;   // the instances move; the bounds don't
    this.group = this.mesh;

    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = rng.float(0, Math.PI * 2);
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));

    // Per-fish state. Flat arrays of Vector3s rather than objects — every one of
    // these is touched every frame by every neighbour.
    this.pos = [];
    this.vel = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3(
        home.x + rng.float(-this.radius, this.radius),
        0,
        home.z + rng.float(-this.radius, this.radius),
      );
      p.y = this._preferredY(p.x, p.z, rng.float(0, 1));
      this.pos.push(p);
      this.vel.push(new THREE.Vector3(rng.float(-1, 1), rng.float(-0.2, 0.2), rng.float(-1, 1))
        .normalize().multiplyScalar(rng.float(sp.speed[0], sp.speed[1])));
    }

    this._dummy = new THREE.Object3D();
    this._sep = new THREE.Vector3();
    this._ali = new THREE.Vector3();
    this._coh = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._writeMatrices();
  }

  /** Height this species likes, given a 0..1 roll for where in its band it sits. */
  _preferredY(x, z, t) {
    const [lo, hi] = this.sp.hover;
    return this.seabed.heightAt(x, z) + lo + (hi - lo) * t;
  }

  /** Tail beat, amplitude growing toward the tail, phase per instance. */
  _hookShader(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSwim = { value: 0 };
      this._uniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPhase;
          uniform float uSwim;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Nothing at the nose, everything at the tail — a fish bends, it doesn't
          // slide sideways.
          float wag = smoothstep(-0.2, 1.4, transformed.z);
          transformed.x += sin(uSwim * 6.0 + aPhase + transformed.z * 1.6) * 0.16 * wag;`);
    };
    // Two schools of the same species share a program; a school with a different
    // shader must not silently reuse one, hence a key that names the injection.
    mat.customProgramCacheKey = () => 'school-wag';
  }

  /**
   * @param {THREE.Vector3} playerPos
   * @param {number} react 0..1 loudness — a loud passage pulls the school in tight
   */
  update(dt, playerPos, react = 0) {
    // Far schools stop thinking entirely. Past the fog you couldn't see them
    // moving anyway, and this is what keeps six schools affordable on a phone.
    const far = this.home.distanceTo(playerPos) > CFG.fish.cullDistance + this.radius;
    this.mesh.visible = !far;
    if (far) { this.active = false; return; }
    this.active = true;

    this._t += dt;
    if (this._uniforms) this._uniforms.uSwim.value = this._t;

    const F = CFG.fish;
    const W = F.weights;
    // Loud passages tighten the ball. This is the most visible thing the analyser
    // does to the world, so it's worth being generous with.
    this._tighten += (react * F.reactTighten - this._tighten) * Math.min(1, dt * 2.5);
    const cohesion = W.cohesion * (1 + this._tighten * 2.2);
    const separation = W.separation * (1 - this._tighten * 0.45);

    const n = this.count;
    const nr2 = F.neighbourRadius * F.neighbourRadius;
    const sep2 = F.separation * F.separation;

    for (let i = 0; i < n; i++) {
      const p = this.pos[i], v = this.vel[i];
      this._sep.set(0, 0, 0);
      this._ali.set(0, 0, 0);
      this._coh.set(0, 0, 0);
      let neighbours = 0;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const q = this.pos[j];
        const d2 = p.distanceToSquared(q);
        if (d2 > nr2) continue;
        neighbours++;
        this._ali.add(this.vel[j]);
        this._coh.add(q);
        if (d2 < sep2 && d2 > 1e-6) {
          // Weighted by 1/d, so the shove gets urgent only when it has to.
          this._tmp.copy(p).sub(q).multiplyScalar(1 / Math.sqrt(d2));
          this._sep.add(this._tmp);
        }
      }

      this._acc.set(0, 0, 0);
      if (neighbours > 0) {
        this._acc.addScaledVector(this._sep, separation);
        this._acc.addScaledVector(this._ali.divideScalar(neighbours).sub(v).normalize(), W.alignment);
        this._acc.addScaledVector(this._coh.divideScalar(neighbours).sub(p).normalize(), cohesion);
      }

      // Home water, and the depth band this species keeps to.
      this._tmp.copy(this.home).sub(p);
      this._tmp.y = 0;
      const homeDist = this._tmp.length();
      if (homeDist > this.radius) {
        this._acc.addScaledVector(this._tmp.divideScalar(homeDist), W.home * (homeDist / this.radius));
      }
      const wantY = this._preferredY(p.x, p.z, 0.5);
      this._acc.y += THREE.MathUtils.clamp((wantY - p.y) * 0.5, -2.2, 2.2);

      // The kelpie. Fish do not hold formation for a horse.
      this._tmp.copy(p).sub(playerPos);
      const pd = this._tmp.length();
      if (pd < F.avoidRadius && pd > 0.001) {
        this._acc.addScaledVector(
          this._tmp.divideScalar(pd),
          W.avoid * (1 - pd / F.avoidRadius) * (1 - (this._trip || 0) * 0.8),
        );
      }

      // Integrate, then clamp back into the species' speed range so nothing ends
      // up either stalled or leaving the lake.
      v.addScaledVector(this._acc, dt * F.turnRate);
      const sp = v.length();
      const [minS, maxS] = this.sp.speed;
      if (sp < minS) v.multiplyScalar(minS / Math.max(sp, 1e-4));
      else if (sp > maxS) v.multiplyScalar(maxS / sp);
      p.addScaledVector(v, dt);

      // Never through the floor.
      const floor = this.seabed.heightAt(p.x, p.z) + 0.6;
      if (p.y < floor) { p.y = floor; v.y = Math.abs(v.y) * 0.5; }
    }

    this._writeMatrices();
  }

  _writeMatrices() {
    const d = this._dummy;
    for (let i = 0; i < this.count; i++) {
      const p = this.pos[i];
      d.position.copy(p);
      this._look.copy(p).add(this.vel[i]);
      d.lookAt(this._look);      // -Z faces travel, which is how the body is built
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setTrip(v) {
    // Everything alive picks up a little glow through the sequence.
    this.material.emissiveIntensity = 0.06 + v * 0.7;
    // And they stop bolting. Sober, fish do not hold formation for a horse;
    // high, they let you come up through the middle of them — which is the
    // whole point of aiming the launch at a school, and it's the same rule the
    // clue system already runs on: while the bowl is working, the lake is
    // willing.
    this._trip = v;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
