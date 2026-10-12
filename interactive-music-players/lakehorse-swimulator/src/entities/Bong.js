// Bongs — stations, not pickups.
//
// A bong needs the lighter and a full bowl. Short of that it sits dark and
// unlit; at eight eighths it lights.
//
// UNBUILT: this file's own header used to promise a positional hum that would
// carry through the fog once loaded, so "I'm loaded" would stop being a number
// on the HUD and become a sense. No such sound was ever wired into
// AudioDirector; the only cue a loaded bong gives at range is the light below,
// which fades out well inside the fog line. Raised in the outbox and answered
// at his word: not building the hum, and Intro.js no longer promises it.

import * as THREE from 'three';
import { CFG } from '../../config.js';

// The glass tube's own dimensions, in the 1x model space everything here is
// built in. Kept beside the class rather than inside it because the containment
// test and the CylinderGeometry in the constructor have to agree exactly, and
// two copies of 2.6 in different scopes is how they stop agreeing.
const TUBE_TOP = 2.6;
const BORE_BOTTOM = 0.62;
const BORE_TOP = 0.42;
// Where the downstem lands on the tube axis, and so where the vortex starts.
// Same figure throatPoint() returns; see its note for how it is derived.
const THROAT_Y = 0.637;

export class Bong {
  constructor(position, rng) {
    const P = CFG.palette;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rng ? rng.float(0, Math.PI * 2) : 0;
    this.position = this.group.position;

    // Everything below is modelled at 1× and then scaled as one object, so the
    // proportions are fixed and the size is a single number in config.js.
    this.scale = CFG.bong.scale;
    this.group.scale.setScalar(this.scale);
    /** World-space height of the bowl above the base. Scales with the prop. */
    this.useHeight = CFG.bong.useHeight * this.scale;

    this.ready = false;
    this._lit = 0;
    this.phase = rng ? rng.float(0, Math.PI * 2) : 0;
    this._bubAcc = rng ? rng.float(0, 1) : 0;   // per-bong, so five don't pulse together
    this._smokeAcc = rng ? rng.float(0, 1) : 0;

    // Glass tube. Encrusted at the base, clear enough up top to catch the lamp.
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x7fb8a8, roughness: 0.12, metalness: 0.1,
      transparent: true, opacity: 0.42,
      emissive: CFG.bong.hueWhenDark, emissiveIntensity: 0.3,
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 2.6, 14, 1, true), this.glassMat);
    tube.position.y = 1.3;
    tube.material.side = THREE.DoubleSide;
    this.group.add(tube);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.78, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: 0x2f4038, roughness: 0.95 }),
    );
    base.position.y = 0.25;
    this.group.add(base);

    // Downstem and bowl, angled out the side.
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x6f8f84, roughness: 0.3, metalness: 0.2 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8), stemMat);
    stem.position.set(0.42, 1.0, 0);
    stem.rotation.z = -0.85;
    this.group.add(stem);

    this.bowlMat = new THREE.MeshStandardMaterial({
      color: 0x5f7d72, roughness: 0.4, emissive: 0x000000, emissiveIntensity: 0,
    });
    const bowl = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 10), this.bowlMat);
    bowl.position.set(0.86, 1.42, 0);
    bowl.rotation.z = Math.PI;
    this.group.add(bowl);

    // The water inside, which glows when it's packed.
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x2c3a38, transparent: true, opacity: 0.7,
      emissive: CFG.bong.hueWhenDark, emissiveIntensity: 0.2,
    });
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.58, 0.8, 14), this.waterMat);
    water.position.y = 0.75;
    this.group.add(water);

    // Point light, off until ready. This is what makes a loaded bong visible from
    // outside the fog line.
    // Physical units — see the note in config.js. A "loaded" bong has to be
    // visible from outside the fog line, which is a lot of candela.
    this.light = new THREE.PointLight(CFG.bong.hueWhenReady, 0, CFG.bong.humRadius * 0.7, 1.4);
    this.light.position.y = 1.2;
    this.group.add(this.light);
  }

  /**
   * A point modelled at 1x, in world space. Everything in the constructor is
   * built at 1x and then scaled and spun as one object, so a landmark on the
   * prop has to be put through the same two steps to come out in the right
   * place — and the spin is per-bong and random, so skipping it puts the bowl
   * on the wrong side of four bongs out of five.
   */
  _localToWorld(out, x, y, z) {
    const s = this.scale, r = this.group.rotation.y;
    const c = Math.cos(r), sn = Math.sin(r);
    return out.set(
      this.position.x + (x * c + z * sn) * s,
      this.position.y + y * s,
      this.position.z + (-x * sn + z * c) * s,
    );
  }

  /**
   * The bowl, out on the end of the downstem — where the pull draws her IN.
   * Matches the cone's own placement in the constructor; keep the two together.
   */
  bowlPoint(out) { return this._localToWorld(out, 0.86, 1.42, 0); }

  /**
   * Where the downstem actually meets the tube axis — the far end of the stem,
   * not the middle of it. Derived from the stem mesh rather than guessed: it is
   * 1.1 long, centred (0.42, 1.0), laid over at -0.85 rad, so its ends land on
   * (0.833, 1.363), which is the bowl, and (0.007, 0.637), which is this. Note
   * it is BELOW the bowl and below the waterline: the way in goes down the stem
   * before it goes up the tube, and a path that does not dip here leaves the
   * glass through the side.
   */
  throatPoint(out) { return this._localToWorld(out, 0, 0.637, 0); }

  /** The top of the tube — where she is fired OUT. Tube is 2.6 tall, centred at 1.3. */
  mouthPoint(out) { return this._localToWorld(out, 0, 2.6, 0); }

  /** The middle of the glass, which is what a camera should frame the prop by. */
  framePoint(out) { return this._localToWorld(out, 0, 1.3, 0); }

  /**
   * A point on the vortex: a helix rising up the inside of the tube, from the
   * throat to the mouth, which is what the group is drawn up on (CR-30).
   *
   * The orbit radius is taken as a share of the BORE AT THAT HEIGHT rather than
   * a fixed distance, so the spiral automatically narrows with the glass, and
   * then narrows again on top of that toward the mouth. The two together make
   * it funnel into the hole instead of running parallel to the wall and
   * arriving off to one side of it.
   *
   * @param {THREE.Vector3} out
   * @param {number} u 0 at the throat, 1 at the mouth
   * @param {number} turns how many times round on the way up
   * @param {number} radiusFrac share of the bore to orbit at
   * @param {number} [phase] where on the circle it starts
   */
  vortexPoint(out, u, turns, radiusFrac, phase = 0) {
    const k = u < 0 ? 0 : u > 1 ? 1 : u;
    const y = THROAT_Y + (TUBE_TOP - THROAT_Y) * k;
    const bore = BORE_BOTTOM + (BORE_TOP - BORE_BOTTOM) * (y / TUBE_TOP);
    const r = bore * radiusFrac * (1 - k * 0.55);
    const a = phase + k * turns * Math.PI * 2;
    return this._localToWorld(out, Math.cos(a) * r, y, Math.sin(a) * r);
  }

  /** The bore radius at a world point's height, in world units. Read-only. */
  boreAt(p) {
    const y = Math.min(TUBE_TOP, Math.max(0, (p.y - this.position.y) / this.scale));
    return (BORE_BOTTOM + (BORE_TOP - BORE_BOTTOM) * (y / TUBE_TOP)) * this.scale;
  }

  /**
   * The inside of the glass, as a hard boundary (CR-30).
   *
   * Clamps a world point into the tube and returns the bore RADIUS available at
   * that height, in world units, so the caller can also size itself to fit.
   * Nothing gets out through the side while this is being applied: the tube is
   * the wall, and the only way on is up and out of the mouth.
   *
   * The bore tapers — 0.62 local at the water, 0.42 at the mouth — so the room
   * a rider has depends on how far up it has got, which is the taper doing the
   * distortion for free rather than a number anyone has to tune.
   *
   * @param {THREE.Vector3} p world point, clamped in place
   * @param {number} [clearance] world units to stay off the glass by
   * @param {number} [amount] 0..1 how much of the correction to apply. Below 1
   *   the point is eased toward the wall's answer rather than snapped to it,
   *   which is what lets the glass switch on without a jolt as they enter it.
   * @returns {number} world-space bore radius at the clamped height
   */
  containInTube(p, clearance = 0, amount = 1) {
    const s = this.scale, r = this.group.rotation.y;
    const c = Math.cos(r), sn = Math.sin(r);
    // World to local. The forward map in _localToWorld is
    //   wx = px + (x*c + z*sn)*s ,  wz = pz + (-x*sn + z*c)*s
    // so this is its exact inverse, not an approximation of it.
    const dx = (p.x - this.position.x) / s, dz = (p.z - this.position.z) / s;
    let x = dx * c - dz * sn;
    let z = dx * sn + dz * c;
    let y = (p.y - this.position.y) / s;

    // The tube runs 0 to 2.6. Held inside both ends: the base is solid and the
    // mouth is not a way out until the launch takes over from this.
    y = y < 0 ? 0 : y > TUBE_TOP ? TUBE_TOP : y;
    const bore = BORE_BOTTOM + (BORE_TOP - BORE_BOTTOM) * (y / TUBE_TOP);
    const room = Math.max(0, bore - clearance / s);

    const rho = Math.hypot(x, z);
    if (rho > room) { const k = room / rho; x *= k; z *= k; }

    const wx = this.position.x + (x * c + z * sn) * s;
    const wy = this.position.y + y * s;
    const wz = this.position.z + (-x * sn + z * c) * s;
    if (amount >= 1) p.set(wx, wy, wz);
    else {
      p.x += (wx - p.x) * amount;
      p.y += (wy - p.y) * amount;
      p.z += (wz - p.z) * amount;
    }
    return bore * s;
  }

  /**
   * @param {boolean} canUse lighter in hand AND a full bowl
   * @param {{low:number,mid:number,high:number,kick:number}} [react] the record
   */
  update(dt, t, canUse, react = null) {
    this.ready = canUse;
    const target = canUse ? 1 : 0;
    this._lit += (target - this._lit) * Math.min(1, dt * 3.2);

    // Slow breathing pulse when ready — alive, not a blinking waypoint. On top
    // of that the bowl takes the kick, so a packed bong smoulders in time with
    // whatever is playing: it's the one object in the world you approach on
    // purpose, and it should feel like it's waiting for you.
    const kick = react ? react.kick : 0;
    const pulse = 0.75 + 0.25 * Math.sin(t * 1.7 + this.phase);
    const lit = this._lit * pulse;
    this._kick = kick;

    this.waterMat.emissiveIntensity = 0.2 + lit * 2.6;
    this.waterMat.emissive.setHex(this._lit > 0.02 ? CFG.bong.hueWhenReady : CFG.bong.hueWhenDark);
    this.waterMat.color.setHex(this._lit > 0.02 ? 0x4e8f5e : 0x2c3a38);
    this.glassMat.emissiveIntensity = 0.3 + lit * 0.9;
    this.bowlMat.emissiveIntensity = lit * (3.0 + kick * 5.5);
    this.bowlMat.emissive.setHex(0xff7a3a); // the packed bowl smoulders orange
    this.light.intensity = lit * 260 * (1 + kick * 0.5);
  }

  /**
   * It never stops smoking.
   *
   * A thin column of bubbles and smoke leaving the mouthpiece and climbing for
   * the surface, running whether or not you can use the thing. It costs almost
   * nothing and it does two jobs: it says "this is lit and waiting" from further
   * out than the glass is visible, and a rising line is the only vertical
   * reference in a bowl of green fog — you can read your own depth off it.
   *
   * Own accumulators rather than the shared ones inside emit()/trail(), because
   * those belong to the diver's trail and five bongs taking turns with them
   * would thin it out.
   *
   * @param {number} dist distance to the player, for skipping distant plumes
   */
  plume(dt, bubbles, smoke, dist = 0) {
    if (dist > CFG.bong.plumeRadius) return;
    const lit = this._lit;
    const x = this.position.x, z = this.position.z;
    const y = this.position.y + this.useHeight * 1.15;   // the mouth, not the bowl

    // Wander the column a little so it reads as drifting water rather than a
    // vertical line of dots.
    const w = Math.sin(this.phase + performance.now() * 0.0006) * 0.5;

    // A packed bong exhales harder on the beat, so the column pulses rather
    // than trickling — visible from further out than the glass is.
    const beat = 1 + (this._kick || 0) * lit * 1.6;
    this._bubAcc += (CFG.bong.plumeBubbles + lit * CFG.bong.plumeBubblesLit) * beat * dt;
    while (this._bubAcc >= 1) {
      bubbles?.spawn(x + w, y, z + w * 0.6, 0.5 + lit * 0.5);
      this._bubAcc -= 1;
    }

    this._smokeAcc += (CFG.bong.plumeSmoke + lit * CFG.bong.plumeSmokeLit) * beat * dt;
    while (this._smokeAcc >= 1) {
      smoke?.spawn(x + w * 0.7, y, z + w * 0.4, 0.55 + lit * 0.45, 0.3);
      this._smokeAcc -= 1;
    }
  }

  inRange(pos) { return this.distanceTo(pos) <= CFG.bong.useRadius; }

  /**
   * Are you in the column? This is what fires the thing.
   *
   * A vertical capsule of CFG.bong.hitRadius running from the base up past the
   * bowl by CFG.bong.hitHeight, rather than a sphere sitting on the bowl.
   *
   * The sphere was wrong at both ends and only ever wrong SOMETIMES, which is
   * what made it read as "some of my bongs aren't working" rather than as a
   * miss. It fired on a dead-centre pass only below about ten units off the
   * floor; two thirds of the stash floats 4 to 46 units up, so you would collect
   * your fourth baggie high, swim straight at a bong and sail over the top of
   * it. Nothing was said either way, because the game only opens its mouth to
   * tell you what you are missing and you were missing nothing.
   *
   * Starting the column at the base rather than the bowl matters more since the
   * prop doubled: the bowl is now 9.3 units up and the kelpie is clamped to 2.0
   * above the seabed, so bowl-up would have made the commonest approach of all,
   * along the floor, the one that could never connect.
   */
  hitTest(pos) {
    const at = this._hitPoint || (this._hitPoint = new THREE.Vector3());
    at.copy(this.position);
    // Clamp onto the segment, then it is an ordinary sphere test against that.
    const top = at.y + this.useHeight + CFG.bong.hitHeight;
    const y = Math.min(Math.max(pos.y, at.y), top);
    const dx = pos.x - at.x, dy = pos.y - y, dz = pos.z - at.z;
    return dx * dx + dy * dy + dz * dz <= CFG.bong.hitRadius * CFG.bong.hitRadius;
  }

  /** Distance to the bowl rather than to the base. See CFG.bong.useHeight. */
  distanceTo(pos) {
    const at = this._usePoint || (this._usePoint = new THREE.Vector3());
    at.copy(this.position);
    at.y += this.useHeight;
    return pos.distanceTo(at);
  }

  setTrip(v) {
    this.light.distance = CFG.bong.humRadius * 0.5 * (1 + v);
  }
}

/**
 * Scatter bongs across the level.
 *
 * Placement is seeded and spread by rejection sampling — clustered bongs would
 * make half the map a dead zone, and the whole point is that there's always one
 * somewhere plausible to run for.
 */
export function placeBongs(rng, seabed, count = CFG.bong.count) {
  const out = [];
  const MIN_APART = 55;
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    const { x, z } = rng.inDisc(CFG.world.radius * 0.78);
    const pos = new THREE.Vector3(x, seabed.heightAt(x, z) + 0.1, z);
    if (out.some((b) => b.position.distanceTo(pos) < MIN_APART)) continue;
    out.push(new Bong(pos, rng));
  }
  return out;
}
