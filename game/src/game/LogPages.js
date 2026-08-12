// The ship's log of the Jupiter.
//
// Seven slates, scattered across the wreck field, that tell what happened to her
// if you find enough of them. Collected pages persist forever — this is the one
// thing in the game that accumulates across sessions, which gives a returning
// visitor a reason to come back that isn't a leaderboard.
//
// This is not a lake and she was not a boat. It's an ocean world with no land on
// it, and the Jupiter was an ore hauler out of the colony of the same name, run
// for The Drain by people who had signed away nine years of their lives to dig
// gold. See the band's own story: Anocean and Enias got out the same way, and
// this ship is what happened to everyone who tried it after them.
//
// The voice is the one thing kept from the sea-log it was written as: flat,
// practical, cargo and weather first, and then not. A captain recording a
// disaster in the same hand he records tonnage is worth more than any amount of
// telling the player it was frightening.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { LogPage } from '../entities/LogPage.js';

export const ENTRIES = [
  {
    id: 'p1', title: 'Log of the Jupiter — day 1',
    body: `Cleared the yards 0610 with eleven hundred tonnes of ore and forty-one souls.
The manifest lists both in the same column and nobody at the gate thought that
was worth a second look. Trim good. Every one of them has signed away nine years.`,
  },
  {
    id: 'p2', title: 'day 9',
    body: `They have started calling it a run instead of a haul. I have not corrected them.
Coordinates for The Drain came off a chart drawn by somebody who never came back
to say whether it worked. We are going anyway. That is the mood aboard.`,
  },
  {
    id: 'p3', title: 'day 14 — entering',
    body: `No stars in here. That I was ready for. What I was not ready for is that there
is no dark either — it is lit and there is nothing doing the lighting.
Two of the crew will not come out of the hold. I am not ordering them to.`,
  },
  {
    id: 'p4', title: 'day 14 — out the other side',
    body: `Water. All of it, every heading, curve to curve, and no land anywhere on it.
The navigator laughed for about four seconds and then had to sit down.
We are through. We are somewhere. Those are not the same thing.`,
  },
  {
    id: 'p5', title: 'day 14 — 1540',
    body: `She was built to be caught by a cradle and there is no cradle. We came in flat
and fast and it made no difference at all — water at that speed is a floor.
Breach forward. Pumps on. Chief says he can hold it if it does not get worse.
It got worse while he was saying it.`,
  },
  {
    id: 'p6', title: 'day 14 — 1912',
    body: `We are down by the head and she will not answer. I have told the crew.
They took it better than I did.
Whoever finds this: she was a good ship and none of it was her fault.`,
  },
  {
    id: 'p7', title: 'Last page — undated',
    body: `Something came alongside in the dark and it was not a ship.
Green, and longer than the hold, and lit from the inside like nothing is meant
to be. It looked at me the way a horse does.
The crew say I have been at the medical stores. Perhaps. It is still out there.
It is still out there and it is waiting for the water to go quiet.`,
  },
];

export class LogPages {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('../world/Seabed.js').Seabed} seabed
   * @param {import('../world/Wreck.js').Wreck} wreck
   * @param {import('./Progress.js').Progress} progress
   * @param {{id:string,title:string,body:string}[]} [entries] the band's live
   *   log from Band assets; the copy compiled in above when there isn't one.
   */
  constructor(rng, seabed, wreck, progress, entries = null) {
    this.group = new THREE.Group();
    this.progress = progress;
    this.pages = [];
    this.onFound = null;
    this.entries = entries && entries.length ? entries : ENTRIES;

    const ENTRIES_ = this.entries;
    const count = Math.min(CFG.logPages.count, ENTRIES_.length);
    // One per landmark where possible, so the story is told by the wreck rather
    // than sprinkled across open lake. Anything left over goes in the silt.
    const spots = rng.shuffle(wreck.landmarks.slice());
    for (let i = 0; i < count; i++) {
      const lm = spots[i % spots.length];
      let x, z;
      if (lm) {
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(lm.radius * 0.4, lm.radius * 1.15);
        x = lm.position.x + Math.cos(a) * r;
        z = lm.position.z + Math.sin(a) * r;
      } else {
        ({ x, z } = rng.inDisc(CFG.world.radius * 0.7));
      }
      const p = new THREE.Vector3(x, seabed.heightAt(x, z) + 0.5, z);
      const page = new LogPage(p, ENTRIES_[i]);
      this.pages.push(page);
      this.group.add(page.group);
    }
  }

  /**
   * Swap in the band's live log once it arrives.
   *
   * The slates keep the positions they were placed at rather than being placed
   * again: the placement is seeded, and re-running it after other systems have
   * drawn from the same generator would move every page and break `?seed=`.
   * Only the words change, which is all that was ever fetched.
   */
  setEntries(entries) {
    if (!entries || !entries.length) return;
    this.entries = entries;
    for (let i = 0; i < this.pages.length; i++) {
      const e = entries[i % entries.length];
      if (e) this.pages[i].entry = e;
    }
  }

  update(dt, t, playerPos, lamp) {
    for (const p of this.pages) {
      p.update(dt, t, lamp);
      if (p.taken) continue;
      if (playerPos.distanceTo(p.group.position) <= CFG.logPages.pickupRadius) {
        p.take();
        this.progress.addLogPage(p.entry.id);
        if (this.onFound) this.onFound(p.entry, this.foundCount, this.pages.length);
      }
    }
  }

  get foundCount() {
    return this.entries.filter((e) => this.progress.data.logPages.includes(e.id)).length;
  }

  /** Everything found so far, across every session. */
  found() {
    return this.entries.filter((e) => this.progress.data.logPages.includes(e.id));
  }

  blips(out) {
    for (const p of this.pages) {
      if (p.taken) continue;
      out.push({ x: p.group.position.x, z: p.group.position.z, type: 'log', strength: 0.5 });
    }
    return out;
  }
}
