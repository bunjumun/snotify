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
      kick: false,            // rising edge of thrust — one tail beat per press
      boost: false,
      interact: false,        // buffered press — stays live until consumed or stale
      lamp: { x: 0, y: 0 },   // aim offset, -1..1
    };

    // Adapters write here; the bus reduces it into `intent` each frame.
    this.raw = { steer: { x: 0, y: 0 }, thrust: 0, boost: false, interact: false, lamp: { x: 0, y: 0 } };

    this.adapters = [];
    // Whichever way up someone learned to fly things, they are sure it's the
    // right way up. Applied HERE rather than in each adapter so one setting
    // covers the keyboard, the stick and the thumbstick at once, and so the
    // "positive is nose up" contract stays true everywhere upstream of it.
    this.invertPitch = false;

    this.activeDevice = 'keyboard';
    this._prevInteract = false;
    this._prevThrust = false;
    this._interactAt = -Infinity;   // when `use` was last pressed; see update()
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
    i.steer.y = curve(clamp1(r.steer.y)) * (this.invertPitch ? -1 : 1);
    i.thrust = Math.min(1, Math.max(0, r.thrust));
    i.boost = r.boost;
    i.lamp.x = clamp1(r.lamp.x);
    i.lamp.y = clamp1(r.lamp.y);

    // "Use" is buffered rather than edge-triggered. Pressing it is a decision
    // made a frame or two before the game agrees you are in range, and consuming
    // it on exactly the frame it went down threw that decision away in silence:
    // press E just short of a bong's radius and nothing happened, which reads as
    // a broken button rather than as being early. The press now stays live for
    // bufferMs, so the game can still find something for it to have meant.
    //
    // Whoever acts on it must call consumeInteract(). Without that the one press
    // fires again on every frame left in the window.
    if (r.interact && !this._prevInteract) this._interactAt = performance.now();
    this._prevInteract = r.interact;
    i.interact = performance.now() - this._interactAt <= CFG.input.bufferMs;

    // Thrust is read as both a level and an edge, because swim is two verbs on
    // one button: hold it to cruise, tap it to kick. The threshold is what lets
    // an analogue trigger count as a press at all.
    const pressed = i.thrust > 0.5;
    i.kick = pressed && !this._prevThrust;
    this._prevThrust = pressed;
  }

  /**
   * Spend the buffered `use` press. Called by whatever acted on it — the buffer
   * is a window, not a queue, and a window nobody closes is a press that fires
   * every frame until it expires.
   */
  consumeInteract() {
    this._interactAt = -Infinity;
    this.intent.interact = false;
  }

  dispose() {
    for (const a of this.adapters) if (a.detach) a.detach();
    this.adapters.length = 0;
  }
}

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
