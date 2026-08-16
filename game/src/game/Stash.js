// The baggie economy.
//
// Owns the baggie population, what you're carrying, and the shake you start with.
//
// **`carried` is eighths, not jars.** A bowl is eight of them and a jar is worth
// one, two or four, so picking up two jars can leave you anywhere from a quarter
// to a full bowl. Everything downstream — the HUD slots, the pickup message, the
// radar, the fish's hint about how much more you need — already spoke in
// `carried` against `CFG.stash.needed`, so changing what the unit means changed
// those surfaces for free rather than requiring a pass through each of them.
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

    this.carried = 0;   // eighths, 0..needed
    // You begin holding a little shake — enough for exactly one bowl. It creates
    // the want (I have weed and no fire) before anything gets explained.
    this.hasShake = true;

    this.anchors = this._makeAnchors(rng, seabed, difficulty.baggieCount * 3);
    this.baggies = [];
    for (let i = 0; i < difficulty.baggieCount; i++) {
      this.baggies.push(new Baggie(this.anchors[i], this._rollFraction()));
      this.group.add(this.baggies[this.baggies.length - 1].group);
    }

    this.onPickup = null;
  }

  get needed() { return CFG.stash.needed; }
  /** Shake counts as a full bowl's worth for the very first hit. */
  get canPack() { return this.hasShake || this.carried >= CFG.stash.needed; }

  /**
   * A jar's worth, DEALT FROM A SHUFFLED BAG rather than rolled.
   *
   * **The first cut rolled each jar independently against the weights, and it
   * had to be thrown away.** It is the obvious implementation and it is wrong
   * here for a reason worth writing down: a half is meant to be the rare one at
   * 0.15, and thirty-eight independent rolls at 0.15 land on zero halves about
   * once in every four hundred levels by the maths — but measured against this
   * generator, across four seeds, TWO of them produced a level with no half in
   * it anywhere. The draws are uniform over thousands (checked) and clumpy over
   * dozens, which is exactly the length a level is.
   *
   * A level with no halves in it is not a rare roll the player enjoys. It is a
   * level where a third of the prop silently does not exist, and nobody would
   * ever report it as a bug — they would just never see a big jar.
   *
   * So the bag: a level gets its fractions in the intended proportion, shuffled.
   * The randomness is in the ORDER and the placement, which is where it does the
   * work; the mix is guaranteed. It refills when it runs dry, so a long session
   * of respawns stays in proportion too rather than drifting.
   *
   * Still seeded throughout, so `?seed=` reproduces a layout exactly, sizes and
   * all — the size of a jar is as much a part of a level as where it is.
   */
  _rollFraction() {
    if (!this._bag || this._bag.length === 0) this._refillBag();
    return this._bag.pop();
  }

  /**
   * Fill the bag with one batch in the config's proportions and shuffle it.
   *
   * The batch is deliberately larger than a level's jar count so the deal is not
   * perfectly predictable near the end of it — a player who has counted the
   * halves should not be able to know the next jar. `Math.round` per entry means
   * the batch can come out a jar or two off; that is fine, and correcting it
   * would only put a bias somewhere less visible.
   */
  _refillBag() {
    const batch = CFG.stash.bagSize;
    const bag = [];
    for (const f of CFG.stash.fractions) {
      const n = Math.max(1, Math.round(batch * f.weight));
      for (let i = 0; i < n; i++) bag.push(f.eighths);
    }
    this._bag = this.rng.shuffle(bag);
  }

  _makeAnchors(rng, seabed, count) {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const { x, z } = rng.inDisc(CFG.world.radius * 0.88);
      const floor = seabed.heightAt(x, z);
      // Through the whole water column, not just lying in the silt. Weed is what
      // this planet runs on, so it is everywhere it can be: some of it settled on
      // the floor, some caught in the middle water, some drifting high enough
      // that you go UP for it. Keeping it all on the seabed made every run a
      // vacuum-cleaner pass at a fixed altitude and threw away the one axis this
      // game has that a map screen doesn't.
      const roll = rng.float(0, 1);
      const rise = roll < CFG.stash.floorShare
        ? rng.float(0.8, 3.4)                                   // settled in the silt
        : rng.float(CFG.stash.riseLow, CFG.stash.riseHigh);     // adrift in the column
      const p = new THREE.Vector3(x, floor + rise, z);
      // Spread them so a single sweep of one area can't collect four at once.
      if (out.some((o) => o.distanceTo(p) < CFG.stash.anchorSpacing)) continue;
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
          const worth = b.eighths;
          b.take();
          this.carried = Math.min(CFG.stash.needed, this.carried + worth);
          // The jar's worth goes out with the total, because breath returned is
          // paid per eighth rather than per jar. Without it a level of eighths
          // would be worth twice the air of a level of quarters.
          if (this.onPickup) this.onPickup(this.carried, worth);
        }
      } else if (now >= b.respawnAt) {
        // Reseed somewhere unoccupied and far enough away to be a discovery.
        const spot = this._freeAnchor(playerPos);
        // Rerolled on every reseed, so the mix of fractions in the level keeps
        // moving instead of setting into whatever the opening layout rolled.
        if (spot) b.place(spot, this._rollFraction());
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

  /**
   * What you are holding, written the way he asks for it in the note: a
   * reduced fraction. 6 eighths is three quarters, and a HUD that said 6/8
   * would be talking in the machine's units rather than in weed.
   *
   * @param {number} [eighths] defaults to what's carried
   */
  static fraction(eighths) {
    if (eighths <= 0) return '0';
    if (eighths >= CFG.stash.needed) return '1';
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const d = gcd(eighths, CFG.stash.needed);
    return `${eighths / d}/${CFG.stash.needed / d}`;
  }

  get fraction() { return Stash.fraction(this.carried); }

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
    this.baggies.forEach((b, i) => b.place(spots[i % spots.length], this._rollFraction()));
  }
}
