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

/**
 * Smooth pseudo-random wobble in -1..1, for shake.
 *
 * Two sines at incommensurate rates, so it never visibly repeats over the tenth
 * of a second any shake actually lasts. Deliberately not Math.random(): the point
 * is a continuous signal sampled by time rather than a fresh number per frame,
 * because the latter shakes at the frame rate and looks like a different effect
 * on a 60Hz screen than on a 144Hz one. Deliberately not Perlin either, which
 * would be a table and a lookup to buy smoothness this already has.
 */
const wobble = (t, seed) => Math.sin(t + seed) * 0.6 + Math.sin(t * 1.7 + seed * 2.3) * 0.4;

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
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this.trauma = 0;      // 0..1; the offset is this SQUARED, see update()
    this._shakeT = 0;     // walks the noise, so the shake is time-based not frame-based
    this._shakeRoll = 0;
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

    // ---- Ride pose ----
    // The diver's eyeline, expressed in the kelpie's own frame so the camera
    // rolls with a banked turn instead of staying stubbornly world-up. Her frame
    // rather than his actual chain position, because he is a rope simulation and
    // a camera bolted to one of those is unusable.
    this._back.set(0, c.rideHeight, c.rideBack).applyQuaternion(target.quaternion);
    this._v.copy(target.position).add(this._back);

    const k = approach(c.followSpring, dt);
    this._followPos.lerp(this._v, k);

    // Look OUT PAST her head, not at her — she sits in the lower frame and the
    // water ahead gets the middle of it. Plus a bias into velocity, which reads
    // as anticipation and makes fast movement legible instead of a smear.
    this._v.set(0, c.rideLookHeight, -c.rideLookAhead)
      .applyQuaternion(target.quaternion)
      .add(target.position)
      .addScaledVector(target.velocity, c.lookAhead * 0.02);
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
    //
    // Two things here are deliberate. The offset is trauma SQUARED, so the curve
    // spends its time at the ends rather than in a permanent mushy middle. And
    // the noise is smooth rather than per-frame random: white noise shakes at
    // whatever the frame rate happens to be, so the same impact looks like static
    // on a 144Hz screen and like a rattle on a 60Hz one. This walks a continuous
    // signal at a fixed rate, so a hit looks the same everywhere.
    if (this.trauma > 0.0001) {
      const s = CFG.camera.shake;
      this._shakeT += dt * s.frequency;
      const amp = this.trauma * this.trauma;
      this._shake.set(
        wobble(this._shakeT, 0) * s.maxOffset * amp,
        wobble(this._shakeT, 17.3) * s.maxOffset * amp,
        wobble(this._shakeT, 41.7) * s.maxOffset * amp,
      );
      this._pos.add(this._shake);
      this._shakeRoll = wobble(this._shakeT, 63.1) * s.maxRoll * amp;
      this.trauma = Math.max(0, this.trauma - s.decay * dt);
    } else {
      this._shakeRoll = 0;
    }

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);

    // Roll the camera a little with the kelpie's bank. Subtle, but it's most of
    // why a turn feels like a turn rather than a pan. The Euler is a reused
    // scratch field: this runs every frame, and the note above about handing the
    // GC a stutter applies to it as much as to the vectors.
    if (w < 0.99) {
      this._euler.setFromQuaternion(target.quaternion, 'YXZ');
      this.camera.rotateZ(this._euler.z * 0.35 * (1 - w));
    }
    // Shake rolls too. A camera that only ever translates under impact reads as
    // the whole world sliding; a little roll is what makes it read as the mount
    // being knocked.
    if (this._shakeRoll) this.camera.rotateZ(this._shakeRoll);
  }

  /**
   * Add trauma, 0..1, and let it decay on its own.
   *
   * Accumulates rather than taking the maximum. Two things going wrong at once
   * ought to feel worse than the worse of them alone, which a max() can never
   * express — under it, a knock during a bigger shake is simply swallowed.
   */
  addShake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  /** Drop the camera straight into place — used on spawn and on retry. */
  snapTo(target) {
    this.trauma = 0;
    this._shakeRoll = 0;
    const c = CFG.camera;
    this._back.set(0, c.rideHeight, c.rideBack).applyQuaternion(target.quaternion);
    this._followPos.copy(target.position).add(this._back);
    this._followLook.set(0, c.rideLookHeight, -c.rideLookAhead)
      .applyQuaternion(target.quaternion)
      .add(target.position);
    this._pos.copy(this._followPos);
    this._look.copy(this._followLook);
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
  }
}
