// The opening.
//
// Four beats, in this order, for a reason:
//
//   0  You have weed, no fire, and a lamp that barely reaches your own boots.
//   1  A fish swims out of the murk carrying a lighter and hands it to you.
//      The lamp flares. The world visibly gets bigger. That IS the tutorial for
//      the lamp — nothing has to say "press F to look at things".
//   2  The same fish tells you what to do with it: there's a pipe, that way.
//   3  You hit it. Full trip. The payoff lands before any grind is explained.
//   4  A second fish explains the four-baggie loop, now that you want another.
//
// Beat 3 before beat 4 is the whole trick. Explaining a resource economy to
// someone who has never seen the reward is a chore; explaining it to someone who
// just watched the screen turn into a rainbow is an offer.
//
// The chain runs once per person, ever — Progress keeps the lighter and the step
// in localStorage, so a returning player drops straight into the loop.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { GuideFish } from '../entities/Fish.js';
import { Lighter } from '../entities/Lighter.js';

export class Intro {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.step = 0;
    this.active = false;
    this.fish = [];
    this.lighter = null;
    this._t = 0;
    this._nudgeAt = 0;
    this._handoffAt = 0;
  }

  begin() {
    const g = this.game;

    if (g.progress.introDone || g.progress.hasLighter) {
      // Returning player: no tutorial, and they already have fire in hand.
      this.active = false;
      this.step = 4;
      this.lighter = new Lighter();
      this.lighter.attachTo(g.diver.hand);
      g.giveLighter(this.lighter);
      g.hud.say('Back in the water.', { seconds: 2.4 });
      return;
    }

    this.active = true;
    this.step = 0;
    g.lamp.setLit(false);

    // Fish 1 waits out in the haze ahead and closes in once you've had a moment
    // to notice how little you can see.
    const k = g.kelpie.position;
    const fwd = g.kelpie.forward;
    const p = k.clone().addScaledVector(fwd, 34);
    p.y = Math.max(g.seabed.heightAt(p.x, p.z) + 6, k.y + 2);

    this.fish1 = new GuideFish(p, { color: 0x8fe0c4, scale: 1.45 });
    this.fish1.approach = true;
    this.fish1.approachFrom = 60;
    this.fish1.standoff = 5.0;
    g.scene.add(this.fish1.group);
    this.fish.push(this.fish1);

    this.lighter = new Lighter();
    this.fish1.carry(this.lighter.group);

    g.hud.say(
      'A bit of shake, no fire, and a lamp with nothing in it.<br>' +
      '<span style="opacity:.72">Tap to swim — she kicks each time.</span><br>Something is coming.',
      { seconds: 6 },
    );
    this._nudgeAt = this._t + 22;
  }

  update(dt) {
    this._t += dt;
    const g = this.game;

    for (const f of this.fish) {
      f.update(dt, g.time, g.kelpie.position);
      f.setTrip(g.trip.value);
    }
    if (this.lighter) this.lighter.update(dt);
    if (!this.active) return;

    // ---- Beat 1: the handover ----
    if (this.step === 0 && this.fish1.distanceTo(g.kelpie.position) < 7.5) {
      this._handover();
    }

    // ---- Beat 2: where to use it ----
    if (this.step === 1 && this._t >= this._handoffAt) {
      this._advance(2);
      const bearing = this._bearingTo(g.nearestBong?.position);
      g.hud.say(
        `That arc will light a bowl at any depth. That's the whole trick.<br>` +
        `There's a pipe ${bearing}. Old thing. Still draws.`,
        { who: 'A whitefish', seconds: 8 },
      );
      g.audio?.sfx('fish');
      // It has done its bit — let it drift off rather than trailing you forever.
      this.fish1.approach = false;
      this._nudgeAt = this._t + 35;
    }

    // ---- Beat 4: after the first hit, baggies get explained ----
    if (this.step === 3 && this.fish2 && this.fish2.distanceTo(g.kelpie.position) < 13) {
      this._advance(4);
      this.active = false;
      g.hud.say(
        `Good, isn't it. That was the last of your shake, though.<br>` +
        `Find <b>four baggies</b> and you can pack another. They're all over this wreck — ` +
        `sweep that lamp about.`,
        { who: 'A lake trout', seconds: 10 },
      );
      g.audio?.sfx('fish');
    }

    if (this._t > this._nudgeAt) {
      this._nudgeAt = this._t + 40;
      this.nudge();
    }
  }

  _handover() {
    const g = this.game;
    this._advance(1);

    // Straight from the fish's mouth into the diver's glove — it stays there for
    // the rest of the game, burning, throwing light across the floor.
    this.fish1.release();
    this.lighter.attachTo(g.diver.hand);
    g.giveLighter(this.lighter);

    g.audio?.sfx('lighter');
    g.rig.addShake(0.12);

    g.hud.say(
      'It presses a lighter into the diver\'s glove. Not a flint one — a <b>plasma torch</b>.<br>' +
      'Twin arc. No flame to drown. Burns just fine down here.',
      { who: 'A whitefish', seconds: 6 },
    );

    // Give the flare-up a beat to land before anyone talks over it.
    this._handoffAt = this._t + 5.2;
  }

  onBongUsed() {
    const g = this.game;
    if (!this.active) return;
    if (this.step < 3) {
      this._advance(3);
      if (!this.fish2) {
        // Fish 2 appears where the hit actually happened, not somewhere decided
        // before the player had moved.
        const p = g.kelpie.position.clone();
        p.x += 11; p.y += 3;
        this.fish2 = new GuideFish(p, { color: 0xe0c98f, scale: 1.6 });
        this.fish2.approach = true;
        this.fish2.approachFrom = 40;
        this.fish2.standoff = 7;
        g.scene.add(this.fish2.group);
        this.fish.push(this.fish2);
      }
      this._nudgeAt = this._t + 30;
    }
  }

  /**
   * Never a waypoint. The fog is the game; an arrow through it throws that away.
   * Public, because the hint button routes here while the opening is running.
   */
  nudge() {
    const g = this.game;
    if (this.step === 0 && this.fish1) {
      g.hud.say(`Something is glowing ${this._bearingTo(this.fish1.group.position)}.`, { seconds: 4 });
    } else if (this.step === 2 && g.nearestBong) {
      g.hud.say(`The pipe is ${this._bearingTo(g.nearestBong.position)}.`, { seconds: 4 });
    } else if (this.step === 3 && this.fish2) {
      g.hud.say(`Another one is waiting ${this._bearingTo(this.fish2.group.position)}.`, { seconds: 4 });
    }
  }

  _advance(n) {
    this.step = n;
    this.game.progress.setIntroStep(n);
  }

  /** Compass wording — the same vocabulary the Phase 2 clue system will use. */
  _bearingTo(target) {
    if (!target) return 'somewhere out there';
    const k = this.game.kelpie.position;
    const dx = target.x - k.x;
    const dz = target.z - k.z;
    const dist = Math.hypot(dx, dz);
    // -Z is north, matching how the world is laid out.
    const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const dir = dirs[Math.round(deg / 45) % 8];
    const near = dist < 40 ? 'not far' : dist < 110 ? 'a way' : 'a long way';
    return `${near} to the ${dir}`;
  }
}
