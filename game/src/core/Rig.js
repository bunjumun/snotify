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

/** How far above the seabed the wide pull camera is kept. See update(). */
const CAMERA_CLEARANCE = 3;

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
    this.orbitPhase = 0;    // radians the pull already carried the angle through
    // 0 = the usual orbit, tight on her. 1 = the wide pull framing, which is a
    // bigger radius around a point that is NOT her: see orbitCenter.
    this.orbitWide = 0;
    // What to circle, when it should not be the kelpie herself. The pull orbits
    // the whole tableau — her, the riders behind her and the bong she is being
    // drawn into — so the game hands the midpoint in. Null means orbit her, as
    // every other phase does.
    this.orbitCenter = null;
    // Optional terrain probe, (x, z) => floor height. Only consulted while the
    // camera is pulled wide, because a 40-unit radius reaches ground the usual
    // 21-unit one never did. Left off the normal orbit deliberately rather than
    // by oversight: that path has shipped for weeks and this is not the change
    // to quietly alter it in.
    this.floorAt = null;

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
    //
    // The same circle serves the bong pull, just bigger and around something
    // else: `orbitWide` opens the radius out and `orbitCenter` moves what is
    // being circled from her to the whole tableau. One orbit rather than two
    // means the pull can hand over to the hold without a cut — the angle runs
    // straight on through `orbitPhase`, and only the distance changes.
    const w = smoothstep(THREE.MathUtils.clamp(this.orbitWeight, 0, 1));
    if (w > 0.0001) {
      const T = CFG.trip;
      const wide = THREE.MathUtils.clamp(this.orbitWide, 0, 1);
      const centre = this.orbitCenter || target.position;
      const radius = THREE.MathUtils.lerp(T.orbitRadius, T.pullRadius, wide);
      // The near-orbit elevation breathes with the sweep; the pull's is steady,
      // because during the pull `orbitProgress` is still 0 and that formula
      // would sit it at its lowest point for the whole circuit.
      const elev = THREE.MathUtils.lerp(
        T.orbitElevation * (0.6 + 0.4 * Math.sin(this.orbitProgress * Math.PI)),
        T.pullElevation,
        wide,
      );
      const a = this.orbitPhase + this.orbitProgress * Math.PI * 2 * T.orbitRevolutions;
      this._orbitPos.set(
        centre.x + Math.cos(a) * radius,
        centre.y + elev,
        centre.z + Math.sin(a) * radius,
      );
      // A 40-unit radius reaches ground the 21-unit one never did, so the wide
      // framing gets a floor and the normal orbit is left exactly as it was.
      if (wide > 0.0001 && this.floorAt) {
        const floor = this.floorAt(this._orbitPos.x, this._orbitPos.z) + CAMERA_CLEARANCE;
        if (this._orbitPos.y < floor) this._orbitPos.y = floor;
      }
      this._pos.copy(this._followPos).lerp(this._orbitPos, w);
      this._look.copy(this._followLook).lerp(centre, w);
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

  /**
   * Hold trauma at a floor for as long as a condition lasts. For ongoing states
   * — leaning on the boundary, a gale blowing — rather than for events.
   *
   * This exists because the obvious approach does not work, and did not work in
   * shipped code for a while without anyone noticing. Topping trauma up a little
   * every frame (`addShake(rate * dt)`) reads as the right way to express a
   * continuous source, and it cannot be: decay here is LINEAR, so a rate under
   * `shake.decay` is cancelled to nothing every frame and a rate over it climbs
   * until it hits the clamp. There is no stable middle to tune towards. The
   * boundary cue was written that way at 0.9 against a decay of 1.2 and measured
   * a peak camera offset of 0.0001 world units, which is to say none at all.
   *
   * A floor gives back the middle: the shake sits at exactly `level` while the
   * source holds, and decay takes it away on its own once the source lets go, so
   * nothing has to remember to switch it off. Take the max rather than add,
   * because two continuous sources are one situation and not two, and because
   * accumulating a per-frame value is the exact mistake above. One-shots still
   * add on top through addShake(), so a hit during a gale still lands.
   *
   * @param {number} level 0..1, the trauma to hold while this lasts
   */
  sustain(level) { if (level > this.trauma) this.trauma = Math.min(1, level); }

  /** Drop the camera straight into place — used on spawn and on retry. */
  snapTo(target) {
    this.trauma = 0;
    this._shakeRoll = 0;
    // A retry must not inherit the last run's pull framing for even one frame.
    this.orbitWide = 0;
    this.orbitPhase = 0;
    this.orbitCenter = null;
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
