// Bongs — stations, not pickups.
//
// A bong needs the lighter and four baggies. Short of that it sits dark and
// unlit; at four it lights, and its positional hum comes up loud enough to be
// heard through fog well before it can be seen.
//
// That last part is the design working: "I'm loaded" stops being a number on the
// HUD and becomes a sense. You get your fourth baggie, the lake starts humming at
// you, and you follow it. Nothing has to explain that.

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

  /** @param {boolean} canUse lighter in hand AND four baggies */
  update(dt, t, canUse) {
    this.ready = canUse;
    const target = canUse ? 1 : 0;
    this._lit += (target - this._lit) * Math.min(1, dt * 3.2);

    // Slow breathing pulse when ready — alive, not a blinking waypoint.
    const pulse = 0.75 + 0.25 * Math.sin(t * 1.7 + this.phase);
    const lit = this._lit * pulse;

    this.waterMat.emissiveIntensity = 0.2 + lit * 2.6;
    this.waterMat.emissive.setHex(this._lit > 0.02 ? CFG.bong.hueWhenReady : CFG.bong.hueWhenDark);
    this.waterMat.color.setHex(this._lit > 0.02 ? 0x4e8f5e : 0x2c3a38);
    this.glassMat.emissiveIntensity = 0.3 + lit * 0.9;
    this.bowlMat.emissiveIntensity = lit * 3.0;
    this.bowlMat.emissive.setHex(0xff7a3a); // the packed bowl smoulders orange
    this.light.intensity = lit * 260;
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

    this._bubAcc += (CFG.bong.plumeBubbles + lit * CFG.bong.plumeBubblesLit) * dt;
    while (this._bubAcc >= 1) {
      bubbles?.spawn(x + w, y, z + w * 0.6, 0.5 + lit * 0.5);
      this._bubAcc -= 1;
    }

    this._smokeAcc += (CFG.bong.plumeSmoke + lit * CFG.bong.plumeSmokeLit) * dt;
    while (this._smokeAcc >= 1) {
      smoke?.spawn(x + w * 0.7, y, z + w * 0.4, 0.55 + lit * 0.45, 0.3);
      this._smokeAcc -= 1;
    }
  }

  inRange(pos) { return this.distanceTo(pos) <= CFG.bong.useRadius; }

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
