// The bong sequence.
//
// This owns the clock for the whole moment, and everything else reads from it:
// the post shader's hue and glow, the sparkle spawn rate, the audio phaser's wet
// mix, the lowpass sweep, the camera orbit, the kelpie's bioluminescence. One
// value, so picture and sound cannot drift apart — they aren't synchronised, they
// are the same number.
//
// Five phases:
//   PULL   0.45s  she's stretch-pulled to the bong's mouth; nothing blooms yet
//   RISE   1.5s   everything blooms in, on a smootherstep
//   HOLD   10s    exactly one camera revolution at full intensity
//   TAPER  60s    colour and phaser bleed out slowly...
//   ...but the camera comes home in the first ~1.2s of the taper. A minute-long
//   orbit would be unplayable, and the point of the taper is that the *world*
//   stays altered long after you've got control back.

import { CFG } from '../../config.js';

export const TripPhase = { IDLE: 'idle', PULL: 'pull', RISE: 'rise', HOLD: 'hold', TAPER: 'taper' };

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
    this.pullT = 0;          // 0..1 through the PULL beat, eased
    // How far the camera is pulled back off the normal orbit: 1 out at the wide
    // pull framing, 0 in on the usual one. Held at 1 for the whole pull, then
    // let go across the rise, so the shot dollies in as the picture blooms
    // rather than cutting between two distances.
    this.wideness = 0;

    this.onStart = null;     // contact — fires at the top of PULL
    this.onPullEnd = null;   // she's arrived at the bowl; RISE (and the launch) begins
    this.onHoldEnd = null;   // camera is coming home; taper begins
    this.onEnd = null;
  }

  /**
   * Where the pull has carried the orbit angle to, in radians, which the rig
   * adds to its own sweep. Held at its final value once the pull is over, so
   * the hold's revolution continues from where the pull's ended instead of
   * snapping back to zero.
   */
  get orbitPhase() { return this.pullT * Math.PI * 2 * CFG.trip.pullRevolutions; }

  get active() { return this.phase !== TripPhase.IDLE; }
  /** True only while the camera is off the player — input is ignored here. */
  get cinematic() {
    return this.phase === TripPhase.PULL || this.phase === TripPhase.RISE || this.phase === TripPhase.HOLD;
  }

  start() {
    if (this.active) return false;
    this.phase = TripPhase.PULL;
    this.t = 0;
    this.pullT = 0;
    this.orbitProgress = 0;
    if (this.onStart) this.onStart();
    return true;
  }

  update(dt) {
    if (this.phase === TripPhase.IDLE) return;
    const T = CFG.trip;
    this.t += dt;

    switch (this.phase) {
      case TripPhase.PULL: {
        // Linear through the circle, for the same reason the hold's revolution
        // is linear: an eased sweep looks better for a moment and then visibly
        // wrong for the rest of it. The EASED value is what moves her body
        // (pullT), so she is drawn in on a curve while the camera circles at a
        // constant rate.
        const k = Math.min(1, this.t / T.pullTime);
        this.pullT = easeInOut(k);
        this.wideness = 1;
        // The swing out happens here now, over the front of the pull, rather
        // than over the rise where it used to live. Same easeInOut and the same
        // reasoning: the rig has a spring on the far side of this, so a softer
        // curve reads as being let go rather than held back.
        this.orbitWeight = easeInOut(Math.min(1, this.t / (T.pullTime * 0.4)));
        if (this.t >= T.pullTime) {
          this.pullT = 1;             // land the angle exactly, not one frame short
          this.phase = TripPhase.RISE;
          this.t = 0;
          if (this.onPullEnd) this.onPullEnd();
        }
        break;
      }

      case TripPhase.RISE: {
        const k = Math.min(1, this.t / T.riseTime);
        this.value = easeSmoother(k);
        // Already swung out by the pull, so this no longer ramps from nothing.
        // Ramping it again would drag the camera back to her shoulder and then
        // push it out a second time, which is a cut in all but name.
        this.orbitWeight = 1;
        // What the rise moves instead is the distance: the wide pull framing
        // closes to the normal orbit as the picture blooms in.
        this.wideness = 1 - easeInOut(k);
        if (this.t >= T.riseTime) { this.phase = TripPhase.HOLD; this.t = 0; this.wideness = 0; }
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
    this.pullT = 0;
    this.wideness = 0;
    this.t = 0;
  }
}
