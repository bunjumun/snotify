// Fish.
//
// Phase 1 ships only the guide fish — the two scripted ones the opening needs.
// The full Lake Superior roster (trout, whitefish, sturgeon, burbot, smelt) and
// their boids flocking land in Phase 2; this file is where they'll go, and
// GuideFish already has the shape the procedural ones will reuse.
//
// A guide fish is deliberately not a quest marker. It hovers, it drifts, it turns
// to look at you when you get close, and it has a soft lure-light — so it reads
// as a creature that knows something rather than an icon that dispenses text.

import * as THREE from 'three';

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;

  // A fish shape from a stretched, pinched sphere. At fog distance the silhouette
  // is the entire read, so this is plenty.
  const body = new THREE.SphereGeometry(0.5, 12, 9);
  body.scale(0.55, 0.75, 1.6);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z < 0) { // taper toward the tail
      const t = 1 + z * 0.55;
      p.setX(i, p.getX(i) * Math.max(0.12, t));
      p.setY(i, p.getY(i) * Math.max(0.25, t));
    }
  }
  body.computeVertexNormals();

  const tail = new THREE.ConeGeometry(0.42, 0.6, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(0.28, 1, 1);

  SHARED = { body, tail };
  return SHARED;
}

export class GuideFish {
  /**
   * @param {THREE.Vector3} position
   * @param {{color?:number, scale?:number}} [opts]
   */
  constructor(position, opts = {}) {
    const S = shared();
    const color = opts.color ?? 0x7fd8c0;
    const scale = opts.scale ?? 1;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.scale.setScalar(scale);
    this.home = position.clone();

    this.bodyMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.45, metalness: 0.15,
      emissive: color, emissiveIntensity: 0.45,
    });
    this.mesh = new THREE.Mesh(S.body, this.bodyMat);
    this.group.add(this.mesh);

    this.tail = new THREE.Mesh(S.tail, this.bodyMat);
    this.tail.position.z = -0.95;
    this.group.add(this.tail);

    // Lure-light. The one thing that says "come here" without a UI element.
    // Physical units — see config.js. Enough to pool light on nearby silt.
    this.light = new THREE.PointLight(color, 42, 20, 1.6);
    this.light.position.set(0, 0.4, 0.6);
    this.group.add(this.light);

    this.phase = Math.random() * Math.PI * 2;
    this._tmp = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this.attention = 0;

    // Approach behaviour. A fish that swims over to you is a character; one that
    // waits at a fixed point for you to walk into its radius is a trigger volume.
    this.approach = false;
    this.approachFrom = 46;   // starts closing once you're this near
    this.standoff = 4.5;      // and holds station here
    this._pos = this.group.position;

    // Something it's bringing you.
    this.carried = null;
  }

  /** Parent an object to the fish so it visibly brings it over. */
  carry(obj3d) {
    this.carried = obj3d;
    obj3d.position.set(0, -0.55, 0.45);
    this.group.add(obj3d);
  }

  /** Hand it over: detach, keeping world transform, and return it. */
  release() {
    const c = this.carried;
    if (!c) return null;
    this.group.remove(c);
    this.carried = null;
    return c;
  }

  /** @param {THREE.Vector3} playerPos */
  update(dt, t, playerPos) {
    const wob = this.phase + t * 0.55;
    const dist = this._pos.distanceTo(playerPos);

    if (this.approach && dist < this.approachFrom) {
      // Close to standoff range, then hold and bob there. Eased, so it glides in
      // rather than snapping to a marker.
      this._tmp.copy(playerPos).sub(this._pos);
      const d = this._tmp.length() || 0.001;
      this._tmp.divideScalar(d);
      const want = d - this.standoff;
      const step = THREE.MathUtils.clamp(want, -6, 6) * Math.min(1, dt * 1.3);
      this._pos.addScaledVector(this._tmp, step);
      this._pos.y += Math.sin(wob * 1.7) * 0.5 * dt;
      this.home.copy(this._pos); // so it settles here if approach is switched off
    } else {
      // Idle drift around home so it never looks parked.
      this._pos.set(
        this.home.x + Math.sin(wob) * 1.9,
        this.home.y + Math.sin(wob * 1.7) * 0.7,
        this.home.z + Math.cos(wob * 0.8) * 1.9,
      );
    }

    const near = THREE.MathUtils.clamp(1 - (dist - 6) / 22, 0, 1);
    this.attention += (near - this.attention) * Math.min(1, dt * 3);

    // Turn to face the player as they approach; otherwise swim its own way.
    if (this.attention > 0.05 || this.approach) {
      this._look.copy(playerPos);
    } else {
      this._look.copy(this._pos).add(
        this._tmp.set(Math.cos(wob), 0, Math.sin(wob)),
      );
    }
    this.group.lookAt(this._look);

    // Tail beats faster when it's paying attention to you.
    this.tail.rotation.y = Math.sin(t * (5 + this.attention * 7) + this.phase) * 0.55;
    this.bodyMat.emissiveIntensity = 0.45 + this.attention * 0.9;
    this.light.intensity = 42 + this.attention * 70;
  }

  distanceTo(pos) { return this.group.position.distanceTo(pos); }

  setTrip(v) {
    this.light.distance = 18 * (1 + v * 0.6);
  }
}
