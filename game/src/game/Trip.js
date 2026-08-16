// The bong sequence.
//
// This owns the clock for the whole moment, and everything else reads from it:
// the post shader's hue and glow, the sparkle spawn rate, the audio phaser's wet
// mix, the lowpass sweep, the camera orbit, the kelpie's bioluminescence. One
// value, so picture and sound cannot drift apart — they aren't synchronised, they
// are the same number.
//
// Four phases:
//   RISE   1.5s   everything blooms in, on a smootherstep
//   HOLD   10s    exactly one camera revolution at full intensity
//   TAPER  60s    colour and phaser bleed out slowly...
//   ...but the camera comes home in the first ~1.2s of the taper. A minute-long
//   orbit would be unplayable, and the point of the taper is that the *world*
//   stays altered long after you've got control back.

import { CFG } from '../../config.js';

export const TripPhase = { IDLE: 'idle', RISE: 'rise', HOLD: 'hold', TAPER: 'taper' };

const CAMERA_RETURN = 1.2; // seconds into the taper before the rig is fully back
const easeInOut = (t) => t * t * (3 - 2 * t);
// Smootherstep, for the rise only. Smoothstep is flat at its ends but its
// SECOND derivative is not, so the acceleration into the bloom arrives as a
// step — which is exactly the moment the picture is doing the most and the
// moment he says needs smoothing. This one is flat in both, so the sequence
// eases out of nothing rather than being switched into.
const easeSmoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class Trip {
  constructor() {
    this.phase = TripPhase.IDLE;
    this.t = 0;

    this.value = 0;          // uTrip 0..1 — the spine
    this.orbitWeight = 0;    // how much of the orbit camera pose to apply
    this.orbitProgress = 0;  // 0..1 around the circle

    this.onStart = null;
    this.onHoldEnd = null;   // camera is coming home; taper begins
    this.onEnd = null;
  }

  get active() { return this.phase !== TripPhase.IDLE; }
  /** True only while the camera is off the player — input is ignored here. */
  get cinematic() { return this.phase === TripPhase.RISE || this.phase === TripPhase.HOLD; }

  start() {
    if (this.active) return false;
    this.phase = TripPhase.RISE;
    this.t = 0;
    this.orbitProgress = 0;
    if (this.onStart) this.onStart();
    return true;
  }

  update(dt) {
    if (this.phase === TripPhase.IDLE) return;
    const T = CFG.trip;
    this.t += dt;

    switch (this.phase) {
      case TripPhase.RISE: {
        const k = Math.min(1, this.t / T.riseTime);
        this.value = easeSmoother(k);
        // The camera stays on the softer curve. It has a spring of its own on the
        // far side of this, and stacking smootherstep on top of that made the
        // swing out feel like it was being held back rather than let go.
        this.orbitWeight = easeInOut(k);
        if (this.t >= T.riseTime) { this.phase = TripPhase.HOLD; this.t = 0; }
        break;
      }

      case TripPhase.HOLD: {
        this.value = 1;
        this.orbitWeight = 1;
        // Linear, so the revolution is exactly one revolution in exactly ten
        // seconds. Easing it would look nicer for half a second and then be
        // visibly wrong for the other nine and a half.
        this.orbitProgress = Math.min(1, this.t / T.holdTime);
        if (this.t >= T.holdTime) {
          this.phase = TripPhase.TAPER;
          this.t = 0;
          if (this.onHoldEnd) this.onHoldEnd();
        }
        break;
      }

      case TripPhase.TAPER: {
        // Colour drains across the full minute...
        const k = Math.min(1, this.t / T.taperTime);
        this.value = 1 - easeOutCubic(k);
        // ...but control comes back almost immediately.
        this.orbitWeight = Math.max(0, 1 - easeInOut(Math.min(1, this.t / CAMERA_RETURN)));
        if (this.t >= T.taperTime) {
          this.phase = TripPhase.IDLE;
          this.value = 0;
          this.orbitWeight = 0;
          this.t = 0;
          if (this.onEnd) this.onEnd();
        }
        break;
      }
    }
  }

  cancel() {
    this.phase = TripPhase.IDLE;
    this.value = 0;
    this.orbitWeight = 0;
    this.orbitProgress = 0;
    this.t = 0;
  }
}
