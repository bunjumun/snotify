// The baggie economy.
//
// Owns the baggie population, what you're carrying, and the shake you start with.
//
// Two rules keep the loop from breaking:
//
//  1. The population is maintained. As baggies are taken, new ones seed at unused
//     anchors, so a long session never strips the level bare and stalls.
//  2. Reseeding happens away from the player. Popping a baggie into existence in
//     someone's face is worse than having none at all — it tells them the world
//     is being generated around them rather than being a place.
//
// Anchors are seeded, so `?seed=` reproduces the layout exactly.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { Baggie } from '../entities/Baggie.js';

export class Stash {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('../world/Seabed.js').Seabed} seabed
   * @param {import('./Difficulty.js').Difficulty} difficulty
   */
  constructor(rng, seabed, difficulty) {
    this.rng = rng;
    this.seabed = seabed;
    this.difficulty = difficulty;
    this.group = new THREE.Group();

    this.carried = 0;
    // You begin holding a little shake — enough for exactly one bowl. It creates
    // the want (I have weed and no fire) before anything gets explained.
    this.hasShake = true;

    this.anchors = this._makeAnchors(rng, seabed, difficulty.baggieCount * 3);
    this.baggies = [];
    for (let i = 0; i < difficulty.baggieCount; i++) {
      this.baggies.push(new Baggie(this.anchors[i]));
      this.group.add(this.baggies[this.baggies.length - 1].group);
    }

    this.onPickup = null;
  }

  get needed() { return CFG.stash.needed; }
  /** Shake counts as a full bowl's worth for the very first hit. */
  get canPack() { return this.hasShake || this.carried >= CFG.stash.needed; }

  _makeAnchors(rng, seabed, count) {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const { x, z } = rng.inDisc(CFG.world.radius * 0.88);
      const y = seabed.heightAt(x, z) + rng.float(0.8, 3.4);
      const p = new THREE.Vector3(x, y, z);
      // Spread them so a single sweep of one area can't collect four at once.
      if (out.some((o) => o.distanceTo(p) < 24)) continue;
      out.push(p);
    }
    return out;
  }

  update(dt, t, playerPos, lamp) {
    const now = performance.now() / 1000;

    for (const b of this.baggies) {
      b.update(dt, t, lamp);

      if (!b.taken) {
        if (playerPos.distanceTo(b.group.position) <= CFG.stash.pickupRadius) {
          b.take();
          this.carried = Math.min(CFG.stash.needed, this.carried + 1);
          if (this.onPickup) this.onPickup(this.carried);
        }
      } else if (now >= b.respawnAt) {
        // Reseed somewhere unoccupied and far enough away to be a discovery.
        const spot = this._freeAnchor(playerPos);
        if (spot) b.place(spot);
      }
    }
  }

  _freeAnchor(playerPos) {
    const taken = this.baggies.filter((b) => !b.taken).map((b) => b.group.position);
    const options = this.rng.shuffle(this.anchors);
    for (const a of options) {
      if (a.distanceTo(playerPos) < CFG.stash.minPlayerDistance) continue;
      if (taken.some((t) => t.distanceTo(a) < 6)) continue;
      return a;
    }
    return null;
  }

  /** Called when a bong is used. Spends the shake first, then the baggies. */
  spend() {
    if (this.hasShake) { this.hasShake = false; return; }
    this.carried = 0;
  }

  /** Nearest baggie still in the world — the fish's stash hint points at this. */
  nearestAvailable(pos) {
    let best = null, bestD = Infinity;
    for (const b of this.baggies) {
      if (b.taken) continue;
      const d = b.group.position.distanceTo(pos);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best ? { baggie: best, distance: bestD, position: best.group.position } : null;
  }

  reset() {
    this.carried = 0;
    this.hasShake = true;
    const spots = this.rng.shuffle(this.anchors);
    this.baggies.forEach((b, i) => b.place(spots[i % spots.length]));
  }
}
