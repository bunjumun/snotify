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
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// Where the journey through the bong changes, as fractions of `pullThrough`.
// The path's stem leg ends at PIPE_ENDS and the vortex up the tube takes over
// there, so the two have to be the same number — see PIPE_LEG in Game.js.
const PIPE_ENDS = 0.42;
const CHAMBER_FADE = 0.2;
// After this she comes back to full size on her way out of the mouth. Late on
// purpose: she is still down inside the bore at 0.86, so growing from there
// pushed her flanks through the glass for the last third of a second. At 0.94
// she is level with the hole before she is anything like full size again.
const CHAMBER_ENDS = 0.94;
const AIM_DONE = 0.8;        // nose fully up the tube by here, and held there

export class Trip {
  constructor() {
    this.phase = TripPhase.IDLE;
    this.t = 0;

    this.value = 0;          // uTrip 0..1 — the spine
    this.orbitWeight = 0;    // how much of the orbit camera pose to apply
    this.orbitProgress = 0;  // 0..1 around the circle
    // The pull is two moves in one phase, because they are one continuous
    // journey: in through the bowl, then up the glass and out of the top.
    this.pullIn = 0;         // 0..1 reeled from wherever she was to the bowl
    this.pullThrough = 0;    // 0..1 from the bowl, through the throat, to the mouth
    this.sweepT = 0;         // 0..1 linear across the WHOLE pull — the camera's own clock
    this.stretch = 0;        // 0..1 how far she is drawn out while being reeled in
    // How far the bong has her. `inside` is the whole time it holds her, from
    // the bowl to the mouth, and drives the shrink and the reeled-in rope.
    // `chamber` says which part of it she is in: 0 down the stem, 1 up the
    // tube, which picks her size and puts her on the vortex.
    this.inside = 0;
    this.chamber = 0;
    // 0..1 how far she has been turned to face straight up the tube, so she is
    // pointing out of the top hole by the time she is fired through it.
    this.aim = 0;
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
  get orbitPhase() { return this.sweepT * Math.PI * 2 * CFG.trip.pullRevolutions; }

  get active() { return this.phase !== TripPhase.IDLE; }
  /** True only while the camera is off the player — input is ignored here. */
  get cinematic() {
    return this.phase === TripPhase.PULL || this.phase === TripPhase.RISE || this.phase === TripPhase.HOLD;
  }

  start() {
    if (this.active) return false;
    this.phase = TripPhase.PULL;
    this.t = 0;
    this.pullIn = this.pullThrough = this.sweepT = 0;
    this.stretch = this.inside = this.chamber = this.aim = 0;
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
        // wrong for the rest of it. Her body moves on EASED curves below, so
        // she is drawn in and fed through on curves while the camera circles at
        // a constant rate.
        const k = Math.min(1, this.t / T.pullTime);
        this.sweepT = k;
        this.wideness = 1;

        // Two moves, back to back. Reeled to the bowl first, then fed up the
        // glass — she is at the bowl for the whole of the second, which is the
        // part he asked to see more of.
        const fIn = T.pullInFraction;
        if (k <= fIn) {
          // easeOutCubic, NOT easeInOut. The bong grabs them at full speed the
          // moment it goes off; an S-curve spent its first tenths barely moving,
          // which is the lull he saw before they "found their way around".
          this.pullIn = easeOutCubic(k / fIn);
          this.pullThrough = 0;
        } else {
          this.pullIn = 1;
          this.pullThrough = easeInOut((k - fIn) / (1 - fIn));
        }

        // Drawn out on the way in and snapping back as she reaches the bowl, so
        // the stretch is a yank rather than a state she stays in.
        this.stretch = Math.sin(this.pullIn * Math.PI);

        // The shape. She narrows over the end of the approach so there is
        // something small enough to go into the bowl, stays small the whole way
        // through the stem and up the vortex, and comes back to herself only as
        // she leaves the mouth.
        const th = this.pullThrough;
        if (th <= 0) {
          // Still on the way in: she narrows over the last of the approach so
          // there is something small enough to go into the bowl at all.
          const from = fIn * 0.62;
          this.inside = k < from ? 0 : easeInOut((k - from) / (fIn - from));
          this.chamber = 0;
        } else {
          // Held small the whole way through, and let go only as she leaves the
          // mouth. `chamber` crosses over where the stem meets the tube.
          const outOfMouth = clamp01((th - CHAMBER_ENDS) / (1 - CHAMBER_ENDS));
          this.inside = 1 - easeInOut(outOfMouth);
          this.chamber = easeInOut(clamp01((th - PIPE_ENDS) / CHAMBER_FADE));
        }

        // She turns to face the way she is about to go. Unlike the shrink this
        // does NOT fade back out at the end — it has to be finished and held
        // when the launch fires, because the whole point is that the top hole
        // is dead ahead of her at that moment.
        this.aim = easeInOut(clamp01((this.pullThrough - PIPE_ENDS) / (AIM_DONE - PIPE_ENDS)));
        // The swing out happens here now, over the front of the pull, rather
        // than over the rise where it used to live. Same easeInOut and the same
        // reasoning: the rig has a spring on the far side of this, so a softer
        // curve reads as being let go rather than held back.
        // Over the first fifth now rather than the first two fifths: the pull is
        // more than twice as long as it was, and the same fraction of it would
        // have spent over a second swinging out.
        this.orbitWeight = easeInOut(Math.min(1, this.t / (T.pullTime * 0.18)));
        if (this.t >= T.pullTime) {
          // Land these exactly rather than a frame short, so she leaves from the
          // mouth at full size and the camera's angle is where the hold expects.
          this.sweepT = 1;
          this.pullIn = 1;
          this.pullThrough = 1;
          this.stretch = 0;
          this.inside = 0;
          this.chamber = 0;
          this.aim = 1;   // held: she leaves the mouth pointing the way she is fired
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
    this.pullIn = this.pullThrough = this.sweepT = 0;
    this.stretch = this.inside = this.chamber = this.aim = 0;
    this.wideness = 0;
    this.t = 0;
  }
}
