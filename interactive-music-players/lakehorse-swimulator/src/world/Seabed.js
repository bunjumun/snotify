// The lake floor.
//
// A displaced plane with a hand-rolled value noise — no noise library, because
// pulling one in for ~40 lines of code would be the only dependency in a repo
// that deliberately has none.
//
// Two shaping passes on top of the noise do the level design: a broad bowl that
// keeps the playfield readable from anywhere, and a trench running under the
// wreck so the debris trail has somewhere to spill into. Vertex colours darken
// the low ground, which reads as depth far more cheaply than a texture.

import * as THREE from 'three';
import { CFG } from '../../config.js';

/** 2D value noise, seeded. Smoothstep-interpolated; fine for terrain at this scale. */
function makeNoise(rng) {
  const perm = new Uint8Array(512);
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [src[i], src[j]] = [src[j], src[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = src[i & 255];

  const grad = (h, x, y) => {
    const u = (h & 1) ? x : -x;
    const v = (h & 2) ? y : -y;
    return u + v;
  };
  const fade = (t) => t * t * (3 - 2 * t);

  return function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = THREE.MathUtils.lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = THREE.MathUtils.lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return THREE.MathUtils.lerp(x1, x2, v) * 0.5;
  };
}

export class Seabed {
  /** @param {import('../core/Rng.js').Rng} rng */
  constructor(rng) {
    const W = CFG.world;
    const size = W.radius * 2.4;
    const segs = 120;

    this.noise = makeNoise(rng);
    this.group = new THREE.Group();

    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(CFG.palette.silt);
    const deep = new THREE.Color(0x141d1c);
    const c = new THREE.Color();

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
    // Second pass so the colour ramp uses the terrain's real range rather than
    // guessed constants — keeps the look stable if the shaping is retuned.
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) - minY) / Math.max(0.001, maxY - minY), 0, 1);
      c.copy(deep).lerp(base, Math.pow(t, 0.7));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.0, flatShading: false,
    }));
    this.group.add(this.mesh);

    this._scatterRocks(rng);
  }

  /** Authoritative terrain height — physics and prop placement both read this. */
  heightAt(x, z) {
    const W = CFG.world;
    const n = this.noise;
    let h = 0;
    h += n(x * 0.008, z * 0.008) * 16;
    h += n(x * 0.021, z * 0.021) * 6.5;
    h += n(x * 0.061, z * 0.061) * 1.8;

    // Broad bowl: the middle is the stage, the rim rises to close the world off
    // without needing a wall.
    const d = Math.hypot(x, z) / W.radius;
    h += Math.pow(Math.max(0, d), 2.2) * 26;

    // Trench under the wreck for the debris to spill into.
    const trench = Math.exp(-Math.pow((x - 10) / 46, 2)) * Math.exp(-Math.pow((z + 5) / 120, 2));
    h -= trench * 13;

    return W.floorY + h;
  }

  _scatterRocks(rng) {
    // Instanced — a few hundred boulders should be one draw call, not one each.
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a3330, roughness: 0.95, flatShading: true });
    const count = 220;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const { x, z } = rng.inDisc(CFG.world.radius * 1.05);
      p.set(x, this.heightAt(x, z) - 0.3, z);
      e.set(rng.float(0, 6.28), rng.float(0, 6.28), rng.float(0, 6.28));
      q.setFromEuler(e);
      const sc = rng.float(0.5, 2.6);
      s.set(sc, sc * rng.float(0.5, 0.9), sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.rocks = mesh;
    this.group.add(mesh);
  }

  /** Keeps the kelpie from swimming through the floor. */
  clampAbove(position, margin = 1.6) {
    const h = this.heightAt(position.x, position.z) + margin;
    if (position.y < h) {
      position.y = h;
      return true;
    }
    return false;
  }
}
