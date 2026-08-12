// Where the fish live.
//
// Picks a seeded set of species, gives each one a patch of water to hold, and
// updates only the ones near enough to matter. Deliberately not uniform: the
// smelt and perch get placed first and get the open water, so the commonest fish
// are the ones you actually meet, and the siscowet is pushed below the
// thermocline because that's where the fat deep-water trout is.
//
// Everything is seeded, so ?seed= reproduces the same lake down to which school
// is over the boiler.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { SPECIES } from './Species.js';
import { School } from '../entities/School.js';

export class Shoals {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('./Seabed.js').Seabed} seabed
   * @param {string} quality
   */
  constructor(rng, seabed, quality = 'high') {
    this.group = new THREE.Group();
    this.schools = [];
    this.seabed = seabed;

    const budget = Math.max(2, Math.round(CFG.fish.schools * CFG.quality.levels[quality].fishScale));
    // Commonest first, then whatever else the seed picks — so a short list is
    // still a plausible lake rather than four sturgeon and nothing else.
    const pool = ['smelt', 'perch', 'whitefish', 'trout', 'sucker', 'walleye', 'siscowet', 'burbot', 'lamprey'];

    for (let i = 0; i < budget; i++) {
      const sp = SPECIES.find((s) => s.id === pool[i % pool.length]);
      if (!sp) continue;
      const home = this._pickHome(rng, sp);
      const [lo, hi] = sp.school;
      const count = Math.round(rng.float(lo, hi));
      const school = new School(sp, rng, seabed, home, Math.max(1, count));
      this.schools.push(school);
      this.group.add(school.group);
    }
  }

  _pickHome(rng, sp) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const { x, z } = rng.inDisc(CFG.world.radius * 0.8);
      const floor = this.seabed.heightAt(x, z);
      const y = floor + (sp.hover[0] + sp.hover[1]) * 0.5;
      // The siscowet wants the cold side of the layer; everything else wants the
      // ordinary water above it.
      const below = y < CFG.thermocline.depth;
      if (sp.deepOnly && !below) continue;
      if (!sp.deepOnly && below && attempt < 16) continue;
      return new THREE.Vector3(x, y, z);
    }
    const { x, z } = rng.inDisc(CFG.world.radius * 0.7);
    return new THREE.Vector3(x, this.seabed.heightAt(x, z) + sp.hover[0], z);
  }

  update(dt, playerPos, react) {
    for (const s of this.schools) s.update(dt, playerPos, react);
  }

  setTrip(v) { for (const s of this.schools) s.setTrip(v); }

  /** Nearest school of a given role — the clue system asks for a 'guide'. */
  nearestOfRole(pos, role) {
    let best = null, bestD = Infinity;
    for (const s of this.schools) {
      if (s.sp.role !== role) continue;
      const d = s.home.distanceTo(pos);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Blips for the sonar: one per school, not one per fish. */
  blips(out) {
    for (const s of this.schools) {
      if (s.sp.role === 'dread') continue;   // a lamprey doesn't announce itself
      out.push({ x: s.home.x, z: s.home.z, type: 'fish', strength: 0.55 });
    }
    return out;
  }
}
