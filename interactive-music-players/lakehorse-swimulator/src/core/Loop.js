// Fixed-step update, variable-rate render.
//
// Physics runs on a fixed dt so the kelpie's spring-damped handling and the
// diver's verlet chain behave identically at 30fps and 144fps. Rendering happens
// once per frame with an interpolation factor, so a 144Hz display still looks
// smooth against a 60Hz simulation.
//
// The accumulator is clamped: after a tab has been backgrounded, requestAnimation
// Frame delivers one enormous dt, and without a clamp the loop tries to catch up
// with hundreds of steps at once, freezes for a second, and usually launches the
// player through the seabed. Dropping that time is always the right call.
//
// Hit-stop scales how much real time reaches the accumulator, never the step
// itself. That distinction is the whole reason it is safe: the simulation still
// advances in fixed 1/60 ticks and every spring in the game behaves identically,
// there are simply fewer ticks per real second while the stop is running. Scaling
// STEP instead would quietly change the behaviour of everything tuned against it.

const STEP = 1 / 60;
const MAX_STEPS = 5; // beyond this we deliberately drop simulated time

export class Loop {
  /**
   * @param {(dt:number)=>void} update fixed-step simulation
   * @param {(alpha:number, dt:number)=>void} render alpha = 0..1 between steps
   */
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._stopFor = 0;    // real seconds of hit-stop left to run
    this._stopScale = 1;
    this._tick = this._tick.bind(this);
  }

  /**
   * Freeze all but a sliver of the simulation for a moment, so an impact reads
   * as something that happened to a body rather than as a number changing.
   *
   * Two to six frames is the entire useful range. Past that it stops reading as
   * weight and starts reading as a dropped frame, which is the one thing it must
   * never be mistaken for.
   *
   * Takes the longest stop rather than the newest, so a big hit is never cut
   * short by a small one landing a frame later.
   *
   * @param {number} seconds real time to hold for
   * @param {number} scale   fraction of normal speed during the hold
   */
  hitStop(seconds, scale = 0.05) {
    if (seconds <= 0) return;
    this._stopFor = Math.max(this._stopFor, seconds);
    this._stopScale = scale;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() { this.running = false; }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = STEP; // tab was hidden; treat as a single normal frame

    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0; this._fpsFrames = 0;
    }

    // The stop's own timer runs on real time. Ticking it with scaled time would
    // make a stop at 5% speed take twenty times as long to expire as asked for.
    let sim = dt;
    if (this._stopFor > 0) {
      this._stopFor = Math.max(0, this._stopFor - dt);
      sim = dt * this._stopScale;
    }

    this.acc += sim;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0; // gave up catching up; don't spiral

    this.render(this.acc / STEP, dt);
  }
}

export const FIXED_STEP = STEP;
