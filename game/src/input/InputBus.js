// One intent, many devices.
//
// Every adapter writes into the same normalized struct and the game reads only
// that — it never asks what hardware is attached. Adding a device later is one
// new file and zero changes anywhere else, which is the whole point: keyboard,
// Bluetooth pad, touch and phone tilt all had to work, and they were never going
// to be added on the same day.
//
// Deadzone and response curve are applied here rather than per-adapter, so a
// stick, a tilt and a virtual thumbstick all feel like the same vehicle.

import { CFG } from '../../config.js';

/** Signed curve — fine control near centre, full authority at the edge. */
function curve(v) {
  const dz = CFG.input.deadzone;
  const a = Math.abs(v);
  if (a < dz) return 0;
  const t = (a - dz) / (1 - dz);
  return Math.sign(v) * Math.pow(t, CFG.input.responseCurve);
}

export class InputBus {
  constructor() {
    this.intent = {
      steer: { x: 0, y: 0 },  // yaw, pitch: -1..1
      thrust: 0,              // 0..1
      boost: false,
      interact: false,        // rising edge only, cleared after one frame
      lamp: { x: 0, y: 0 },   // aim offset, -1..1
    };

    // Adapters write here; the bus reduces it into `intent` each frame.
    this.raw = { steer: { x: 0, y: 0 }, thrust: 0, boost: false, interact: false, lamp: { x: 0, y: 0 } };

    this.adapters = [];
    this.activeDevice = 'keyboard';
    this._prevInteract = false;
    this._lastActivity = {};
  }

  add(adapter) {
    adapter.bus = this;
    this.adapters.push(adapter);
    if (adapter.attach) adapter.attach();
    return adapter;
  }

  /** Adapters call this when they see real input, so the HUD can show the right hints. */
  markActive(name) {
    const now = performance.now();
    this._lastActivity[name] = now;
    if (this.activeDevice !== name) this.activeDevice = name;
  }

  update(dt) {
    const r = this.raw;
    r.steer.x = 0; r.steer.y = 0; r.thrust = 0; r.boost = false; r.interact = false;
    r.lamp.x = 0; r.lamp.y = 0;

    for (const a of this.adapters) if (a.enabled !== false) a.contribute(r, dt);

    const i = this.intent;
    i.steer.x = curve(clamp1(r.steer.x));
    i.steer.y = curve(clamp1(r.steer.y));
    i.thrust = Math.min(1, Math.max(0, r.thrust));
    i.boost = r.boost;
    i.lamp.x = clamp1(r.lamp.x);
    i.lamp.y = clamp1(r.lamp.y);

    // Edge-trigger: "use" should fire once per press, not once per frame held.
    i.interact = r.interact && !this._prevInteract;
    this._prevInteract = r.interact;
  }

  dispose() {
    for (const a of this.adapters) if (a.detach) a.detach();
    this.adapters.length = 0;
  }
}

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
