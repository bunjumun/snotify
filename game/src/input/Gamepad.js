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
    raw.steer.y += ly;
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

  /** Rumble where supported — silently a no-op everywhere else. */
  rumble(strength = 0.5, ms = 180) {
    const p = this.pad;
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', {
      duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6,
    }).catch(() => {});
  }
}
