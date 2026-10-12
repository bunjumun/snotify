// Bluetooth controllers, via the Gamepad API.
//
// Xbox, DualSense and 8BitDo pads all report the W3C "standard" mapping over
// Bluetooth, so one layout covers essentially every controller anyone will pair
// with a phone or laptop:
//
//   left stick   steer          right stick  aim the lamp
//   RT / R2      swim           LB / L1      boost
//   A / cross    use            RB / R1      boost (either shoulder, less to learn)
//   Start        pause
//
// There is no event to poll — the spec requires reading navigator.getGamepads()
// fresh every frame, because the returned objects are snapshots and go stale.

import { CFG } from '../../config.js';

const A = { LX: 0, LY: 1, RX: 2, RY: 3 };
const B = { A: 0, LB: 4, RB: 5, LT: 6, RT: 7, START: 9 };

export class Gamepad_ {
  constructor() {
    this.index = null;
    this.onPause = null;
    this._prevStart = false;
    this._onConnect = this._onConnect.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
  }

  attach() {
    addEventListener('gamepadconnected', this._onConnect);
    addEventListener('gamepaddisconnected', this._onDisconnect);
    // A pad paired before the page loaded won't fire connect, so take a look now.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) { this.index = p.index; break; }
  }

  detach() {
    removeEventListener('gamepadconnected', this._onConnect);
    removeEventListener('gamepaddisconnected', this._onDisconnect);
  }

  _onConnect(e) { this.index = e.gamepad.index; }
  _onDisconnect(e) { if (this.index === e.gamepad.index) this.index = null; }

  get pad() {
    if (this.index === null || !navigator.getGamepads) return null;
    const p = navigator.getGamepads()[this.index];
    return p && p.connected ? p : null;
  }

  contribute(raw) {
    const p = this.pad;
    if (!p) return;
    const dz = CFG.input.gamepadDeadzone;
    const ax = (i) => {
      const v = p.axes[i] ?? 0;
      return Math.abs(v) < dz ? 0 : v;
    };
    const btn = (i) => {
      const b = p.buttons[i];
      return b ? (typeof b === 'object' ? b.value : b) : 0;
    };

    const lx = ax(A.LX), ly = ax(A.LY);
    const rx = ax(A.RX), ry = ax(A.RY);
    // Triggers are analog on a standard pad, so swimming is proportional — you
    // can idle forward instead of only ever being stopped or flat out.
    const rt = btn(B.RT);
    const a = btn(B.A);

    raw.steer.x += lx;
    raw.steer.y -= ly;   // stick up is negative; nose up is positive
    raw.lamp.x += rx;
    raw.lamp.y += ry;
    if (rt > 0.04) raw.thrust = Math.max(raw.thrust, rt);
    if (btn(B.LB) > 0.5 || btn(B.RB) > 0.5) raw.boost = true;
    if (a > 0.5) raw.interact = true;

    const start = btn(B.START) > 0.5;
    if (start && !this._prevStart && this.onPause) this.onPause();
    this._prevStart = start;

    if (this.bus && (Math.abs(lx) + Math.abs(ly) + rt + a) > 0.1) this.bus.markActive('gamepad');
  }

  /**
   * Rumble where supported — silently a no-op everywhere else.
   *
   * Every call site is scaled by CFG.input.rumble.scale on the way through
   * rather than being retuned individually. What the call sites encode is their
   * weight RELATIVE to each other, and a seabed slam at 0.8 against a cold-layer
   * knock at 0.35 is a judgement worth keeping intact; they were simply all too
   * strong in absolute terms. One number fixes that without reopening any of it.
   *
   * A one-shot also takes the pad off the music for its duration. See _music().
   */
  rumble(strength = 0.5, ms = 180) {
    const R = CFG.input.rumble;
    this._quietUntil = performance.now() + ms + R.musicYieldMs;
    this._play(strength * R.scale, ms);
  }

  /** The actual call, unscaled, shared by one-shots and the music rumble. */
  _play(strength, ms) {
    const p = this.pad;
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', {
      duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6,
    }).catch(() => {});
  }

  /**
   * The record, in your hands.
   *
   * Driven by the analyser's `kick` — the onset — rather than `low`, the level,
   * for the same reason the analyser itself gives: a level makes things glow and
   * an onset makes them hit, and a hand reads a beat far better than it reads a
   * volume. On a level the pad would just buzz continuously through a loud
   * passage, which is noise rather than music.
   *
   * Two things make this awkward and both are handled here rather than at the
   * call site. Gamepad haptics have no sustain primitive, so a continuous effect
   * is really a series of short overlapping ones: the effect has to outlast the
   * gap after it or the rumble strobes. And playEffect REPLACES whatever is
   * running instead of mixing with it, so re-arming on top of a seabed slam
   * would cut that slam in half. Hence _quietUntil: a one-shot owns the motors
   * outright until it has finished, and the music waits its turn.
   *
   * @param {number} kick 0..1 onset strength from AudioDirector.react
   */
  music(kick) {
    const R = CFG.input.rumble;
    const now = performance.now();
    if (now < (this._quietUntil || 0)) return;
    if (now < (this._nextMusicAt || 0)) return;
    this._nextMusicAt = now + R.musicEveryMs;
    const m = Math.min(1, Math.max(0, kick)) * R.musicMax;
    // Below this the motors either do nothing or click rather than hum, so it is
    // cheaper and quieter to simply not ask.
    if (m < 0.02) return;
    this._play(m, R.musicHoldMs);
  }
}
