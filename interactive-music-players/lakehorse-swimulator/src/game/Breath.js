// The tank.
//
// This is the game's clock and therefore the source of most of its tension. It
// drains faster when you boost, faster below the thermocline, and faster while
// the diver is adrift — so every choice that makes you faster or bolder also
// makes you shorter of time, which is the whole shape of the loop.
//
// The tank empties two ways, and the difference matters. A RATE bills you for a
// state you are in: being deep, being adrift, swimming hard. A SPEND bills you
// for a thing you just did, and right now that means a boosted tail beat. The
// split exists because taxing the boost purely as a rate charged the wrong verb:
// the kelpie's speed comes from tapping, so a rider gliding on a full surge was
// paying the same as one hammering the button. Effort you can see now costs air
// you can see leave, at the moment it happens.
//
// Warnings escalate across three senses at once rather than one: the bar changes
// colour, the vignette closes, the audio filter tightens, and a heartbeat comes
// up underneath. Any one of them alone is a UI element; together they're dread.

import { CFG } from '../../config.js';

export const BreathState = { OK: 'ok', WARN: 'warn', PANIC: 'panic', EMPTY: 'empty' };

export class Breath {
  /** @param {import('./Difficulty.js').Difficulty} difficulty */
  constructor(difficulty) {
    this.difficulty = difficulty;
    this.max = difficulty.tank;
    this.value = this.max;
    this.state = BreathState.OK;
    this.onState = null;   // (newState, oldState)
    this.onEmpty = null;
  }

  reset() {
    this.max = this.difficulty.tank;
    this.value = this.max;
    this._setState(BreathState.OK);
  }

  get fraction() { return Math.max(0, this.value / this.max); }
  get empty() { return this.value <= 0; }

  /** 0..1 — how far into the panic band we are. Drives vignette and filter. */
  get panic() {
    const p = CFG.breath.panicAt;
    if (this.value > p) return 0;
    return Math.min(1, (p - this.value) / p);
  }

  /**
   * @param {{boosting:boolean, belowThermo:number, diverAdrift:boolean}} ctx
   */
  update(dt, ctx) {
    if (this.empty) return;

    let rate = ctx.boosting ? CFG.breath.boostDrain : CFG.breath.idleDrain;
    // The cold layer bites proportionally to how deep into it you are, so
    // skimming the boundary is cheap and committing to the deep is not.
    if (ctx.belowThermo > 0) {
      rate *= 1 + (this.difficulty.thermoMult - 1) * ctx.belowThermo;
    }
    if (ctx.diverAdrift) rate *= CFG.diver.adriftDrainMult;

    this.value = Math.max(0, this.value - rate * dt);

    const next = this.value <= 0 ? BreathState.EMPTY
      : this.value <= CFG.breath.panicAt ? BreathState.PANIC
        : this.value <= CFG.breath.warnAt ? BreathState.WARN
          : BreathState.OK;
    this._setState(next);

    if (next === BreathState.EMPTY && this.onEmpty) { this.onEmpty(); this.onEmpty = null; }
  }

  /**
   * A discrete charge for something you just did, as opposed to the per-second
   * rates in update(). Boosted tail beats are billed through here.
   *
   * Empties the tank the same way a rate can, including firing onEmpty, because
   * a sprint that runs you out on the last beat has to end the run exactly as
   * drifting out of air does — anything else and the fail state depends on which
   * arithmetic got you there.
   */
  spend(seconds) {
    if (this.empty || seconds <= 0) return;
    this.value = Math.max(0, this.value - seconds);
    this._reevaluate();
    if (this.empty && this.onEmpty) { this.onEmpty(); this.onEmpty = null; }
  }

  /** Baggies top up; the bong refills outright. Never overfills the tank. */
  add(seconds) {
    this.value = Math.min(this.max, this.value + seconds);
    this._reevaluate();
  }

  fill() {
    this.value = this.max;
    this._reevaluate();
  }

  _reevaluate() {
    const next = this.value <= 0 ? BreathState.EMPTY
      : this.value <= CFG.breath.panicAt ? BreathState.PANIC
        : this.value <= CFG.breath.warnAt ? BreathState.WARN
          : BreathState.OK;
    this._setState(next);
  }

  _setState(next) {
    if (next === this.state) return;
    const old = this.state;
    this.state = next;
    if (this.onState) this.onState(next, old);
  }
}
