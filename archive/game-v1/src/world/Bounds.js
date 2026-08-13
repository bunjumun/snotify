// The edge of the world, as current rather than a wall.
//
// Invisible walls tell you the map stopped. A current that leans on you tells you
// the lake keeps going and you probably shouldn't. It costs one vector and it's
// the difference between a level and a place.
//
// Also caps the ceiling: the kelpie can rise toward the light but not breach, so
// the surface stays a thing you look up at.

import * as THREE from 'three';
import { CFG } from '../../config.js';

export class Bounds {
  constructor() {
    this.push = new THREE.Vector3();
    this._flat = new THREE.Vector3();
    this.strain = 0; // 0..1, for HUD/audio cues at the boundary
  }

  /** @returns {THREE.Vector3} force to add to the kelpie this frame */
  force(position) {
    const W = CFG.world;
    this.push.set(0, 0, 0);

    const dist = Math.hypot(position.x, position.z);
    const start = W.radius - W.boundarySoftness;
    if (dist > start) {
      const t = THREE.MathUtils.clamp((dist - start) / W.boundarySoftness, 0, 1);
      this.strain = t;
      // Eased so the turn-around is a nudge that becomes a shove, never a wall.
      const mag = t * t * W.boundaryForce;
      this._flat.set(-position.x, 0, -position.z).normalize();
      this.push.addScaledVector(this._flat, mag);
    } else {
      this.strain = 0;
    }

    // Ceiling. Approaching the surface pushes back gently.
    const ceiling = W.surfaceY - 8;
    if (position.y > ceiling) {
      this.push.y -= (position.y - ceiling) * 2.4;
    }

    return this.push;
  }
}
