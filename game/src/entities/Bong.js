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
