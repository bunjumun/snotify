// Demo mode: the game plays itself so the record can be watched and listened to.
//
// It feeds the SAME intent struct the keyboard, pad and thumbstick feed through
// InputBus, so the swim physics, breath, stash, bongs and trip cannot tell it
// from a person. Goal order mirrors the real loop: bag baggies until the bowl is
// packable, then swim into a bong. Contact fires the bong (there is no button),
// and the cinematic takes the controls itself, so the autopilot only ever steers.

import { CFG } from '../../config.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Autopilot {
  constructor(game) {
    this.game = game;
    this.intent = { steer: { x: 0, y: 0 }, thrust: 1, kick: false, boost: false, interact: false, lamp: { x: 0, y: 0 } };
    this._first = true;
    this._still = 0;
    this._wander = 0;
    this.goal = null;
    this.goalKind = '';
  }

  /** Nearest thing worth swimming at right now, or null. */
  pick() {
    const g = this.game, p = g.kelpie.position;
    let best = null, bd = Infinity;
    const consider = (v, kind, dy = 0) => {
      const d = Math.hypot(v.x - p.x, v.y + dy - p.y, v.z - p.z);
      if (d < bd) { bd = d; best = { x: v.x, y: v.y + dy, z: v.z, kind }; }
    };
    if (!g.stash.canPack) {
      for (const b of g.stash.baggies) if (!b.taken) consider(b.group.position, 'baggie');
    } else if (g.progress.hasLighter) {
      for (const b of g.bongs) consider(b.position, 'bong', (b.useHeight || 0) * 0.5);
    }
    return best;
  }

  think(dt) {
    const g = this.game, k = g.kelpie, i = this.intent;
    const goal = this.goal = this.pick();
    this.goalKind = goal ? goal.kind : '';
    i.kick = this._first; this._first = false;
    i.thrust = 1; i.boost = false;
    if (!goal) { i.steer.x = 0; i.steer.y = 0; return i; }

    const dx = goal.x - k.position.x, dy = goal.y - k.position.y, dz = goal.z - k.position.z;
    const flat = Math.hypot(dx, dz), want = Math.atan2(-dx, -dz);
    // yaw rate is -steer.x, so a positive yaw error needs a negative stick
    i.steer.x = clamp(-angDiff(k.yaw, want) * 2.4, -1, 1);
    const wantPitch = Math.atan2(dy, Math.max(flat, 1));
    i.steer.y = clamp((wantPitch - k.pitch) * 2.4, -1, 1);

    // Wedged on the wreck or the silt: throw the nose around until free.
    this._still = k.speed < 0.6 ? this._still + dt : 0;
    if (this._still > 2.5) { this._wander = 1.5; this._still = 0; }
    if (this._wander > 0) { this._wander -= dt; i.steer.x = 1; i.steer.y = 0.6; }
    return i;
  }
}
