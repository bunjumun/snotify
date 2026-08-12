// The ship's log of the SS Jupiter.
//
// Seven slates, scattered across the wreck field, that tell what happened to her
// if you find enough of them. Collected pages persist forever — this is the one
// thing in the game that accumulates across sessions, which gives a returning
// visitor a reason to come back that isn't a leaderboard.
//
// The Jupiter is invented. Superior's real wrecks hold real people, several are
// legally protected graves, and putting a cartoon horse and a bong inside one of
// them would be a genuinely unpleasant thing to do. So she's fictional, and the
// log is written to sound like the real ones do: flat, practical, weather first,
// and then not.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { LogPage } from '../entities/LogPage.js';

export const ENTRIES = [
  {
    id: 'p1', title: 'Log of the SS Jupiter — 4 November',
    body: `Cleared Two Harbors 0610 with iron ore, 6,900 tons. Glass falling but steady.
Wind SW light. Crew of twenty-two and the cook's dog, which is not crew but
eats like it.`,
  },
  {
    id: 'p2', title: '7 November',
    body: `Wind backed NE overnight and has not stopped since. Seas on the quarter.
Mr. Halloran reports the after hatch tarpaulin working loose. Sent two hands.
They came back wet through and said it is holding. It is not holding.`,
  },
  {
    id: 'p3', title: '9 November',
    body: `Glass at 28.6 and still going. I have not seen it this low on this lake.
Whitefish Point advises we run for shelter. We are eleven hours from shelter
and the shelter is upwind.`,
  },
  {
    id: 'p4', title: '10 November — forenoon',
    body: `Snow. Cannot see the bow from the wheelhouse. Sounding the whistle every
minute in case there is anyone else foolish enough to be out here.
No answer. There never is.`,
  },
  {
    id: 'p5', title: '10 November — 1540',
    body: `Took one over the bow that carried away the forward vent and half the rail.
Water in number two. Pumps on. Chief says he can hold it if it does not get
worse. It got worse while he was saying it.`,
  },
  {
    id: 'p6', title: '10 November — 1912',
    body: `We are down by the head and she will not answer the helm. I have told the
men. They took it better than I did.
Whoever finds this: she was a good boat and it was not her fault.`,
  },
  {
    id: 'p7', title: 'Last page — undated',
    body: `Something came alongside in the dark and it was not a boat.
Green, and longer than the hatch, and it looked at me the way a horse does.
The men say I have been at the medicinal stores. Perhaps. It is still there.
It is still there and it is waiting for the water to be quiet.`,
  },
];

export class LogPages {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('../world/Seabed.js').Seabed} seabed
   * @param {import('../world/Wreck.js').Wreck} wreck
   * @param {import('./Progress.js').Progress} progress
   */
  constructor(rng, seabed, wreck, progress) {
    this.group = new THREE.Group();
    this.progress = progress;
    this.pages = [];
    this.onFound = null;

    const count = Math.min(CFG.logPages.count, ENTRIES.length);
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
      const page = new LogPage(p, ENTRIES[i]);
      this.pages.push(page);
      this.group.add(page.group);
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
    return ENTRIES.filter((e) => this.progress.data.logPages.includes(e.id)).length;
  }

  /** Everything found so far, across every session. */
  found() {
    return ENTRIES.filter((e) => this.progress.data.logPages.includes(e.id));
  }

  blips(out) {
    for (const p of this.pages) {
      if (p.taken) continue;
      out.push({ x: p.group.position.x, z: p.group.position.z, type: 'log', strength: 0.5 });
    }
    return out;
  }
}
