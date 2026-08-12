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
    this._tick = this._tick.bind(this);
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

    this.acc += dt;
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
