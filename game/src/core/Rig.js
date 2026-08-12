// Camera rig: a spring-damped chase that can hand off to a full orbit and back
// without ever cutting.
//
// The rig does NOT run its own timer for the bong sequence. Trip.js owns the
// clock and drives `orbitWeight` (how much of the orbit pose to apply) and
// `orbitProgress` (where around the circle we are). That keeps the camera on the
// exact same curve as the post-processing, the phaser and the filter sweep —
// one value, one moment — instead of two systems each counting to ten and
// drifting apart by a frame or two.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const smoothstep = (t) => t * t * (3 - 2 * t);

/** Frame-rate independent exponential smoothing. */
const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export class Rig {
  constructor(aspect) {
    const c = CFG.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, aspect, c.near, c.far);

    // Driven externally by Trip.js.
    this.orbitWeight = 0;   // 0 = pure follow, 1 = pure orbit
    this.orbitProgress = 0; // 0..1 across the whole revolution

    this._pos = new THREE.Vector3(0, 5, 20);
    this._look = new THREE.Vector3();
    this._followPos = new THREE.Vector3(0, 5, 20);
    this._followLook = new THREE.Vector3();

    // Scratch vectors, reused every frame. Allocating Vector3s inside the render
    // loop is the classic way to hand the GC a stutter on mobile.
    this._v = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._orbitPos = new THREE.Vector3();
    this._shake = new THREE.Vector3();

    this.shakeAmount = 0;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {number} dt
   * @param {{position:THREE.Vector3, quaternion:THREE.Quaternion, velocity:THREE.Vector3}} target
   */
  update(dt, target) {
    const c = CFG.camera;

    // ---- Follow pose ----
    // Sit behind and above, in the kelpie's own frame so the camera rolls with a
    // banked turn instead of staying stubbornly world-up.
    this._back.set(0, c.followHeight, c.followDistance).applyQuaternion(target.quaternion);
    this._v.copy(target.position).add(this._back);

    const k = approach(c.followSpring, dt);
    this._followPos.lerp(this._v, k);

    // Look slightly ahead of where they actually are — reads as anticipation and
    // makes fast movement legible instead of a smear.
    this._v.copy(target.velocity).multiplyScalar(c.lookAhead * 0.06);
    this._v.add(target.position);
    this._followLook.lerp(this._v, approach(c.followSpring * 1.4, dt));

    // ---- Orbit pose ----
    // A full revolution around the pair, rising slightly, so you see the diver
    // swing past the horse for the whole sweep.
    const w = smoothstep(THREE.MathUtils.clamp(this.orbitWeight, 0, 1));
    if (w > 0.0001) {
      const a = this.orbitProgress * Math.PI * 2 * CFG.trip.orbitRevolutions;
      const elev = CFG.trip.orbitElevation * (0.6 + 0.4 * Math.sin(this.orbitProgress * Math.PI));
      this._orbitPos.set(
        target.position.x + Math.cos(a) * CFG.trip.orbitRadius,
        target.position.y + elev,
        target.position.z + Math.sin(a) * CFG.trip.orbitRadius,
      );
      this._pos.copy(this._followPos).lerp(this._orbitPos, w);
      this._look.copy(this._followLook).lerp(target.position, w);
    } else {
      this._pos.copy(this._followPos);
      this._look.copy(this._followLook);
    }

    // Shake decays on its own; callers just poke it and forget.
    if (this.shakeAmount > 0.0001) {
      this._shake.set(
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
      );
      this._pos.add(this._shake);
      this.shakeAmount *= Math.exp(-4.5 * dt);
    }

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);

    // Roll the camera a little with the kelpie's bank. Subtle, but it's most of
    // why a turn feels like a turn rather than a pan.
    if (w < 0.99) {
      const e = new THREE.Euler().setFromQuaternion(target.quaternion, 'YXZ');
      this.camera.rotateZ(e.z * 0.35 * (1 - w));
    }
  }

  addShake(amount) { this.shakeAmount = Math.max(this.shakeAmount, amount); }

  /** Drop the camera straight into place — used on spawn and on retry. */
  snapTo(target) {
    this._back.set(0, CFG.camera.followHeight, CFG.camera.followDistance)
      .applyQuaternion(target.quaternion);
    this._followPos.copy(target.position).add(this._back);
    this._followLook.copy(target.position);
    this._pos.copy(this._followPos);
    this._look.copy(this._followLook);
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
  }
}
