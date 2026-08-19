// The opening.
//
// Four beats, in this order, for a reason:
//
//   0  You have weed, no fire, and a lamp that barely reaches your own boots.
//      You are told there's a pipe out there and pointed at it. That's all.
//   1  You GET to the pipe, and it's useless to you — and that is the moment a
//      fish comes out of the murk shouting that it'll get the light, and hands
//      you one. The lamp flares. The world visibly gets bigger. That IS the
//      tutorial for the lamp — nothing has to say "press F to look at things".
//   2  It tells you what you're now holding and what it's for.
//   3  You hit the pipe. Full trip. The payoff lands before any grind does.
//   4  A second fish explains the four-baggie loop, now that you want another.
//
// The fish waits at the bong on purpose. Handing someone a lighter before they
// have found anything to light is a fetch quest with the parts in the wrong
// order: the want has to exist first. Swimming a long way to a thing you can't
// use, and having the answer arrive exactly there, is a scene. Being given fire
// in the first ten seconds is a tooltip.
//
// Beat 3 before beat 4 is the same trick again. Explaining a resource economy to
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
    this._called = false;      // the fish has shouted from the haze
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

    // No fish yet. It turns up at the pipe, when you've earned the want — see
    // the header, and _meetAtBong() below.
    this.lighter = new Lighter();

    g.hud.say(
      'A bit of shake, no fire, and a lamp with nothing in it.<br>' +
      '<span style="opacity:.72">Tap to swim. She kicks each time.</span><br>' +
      'There\'s a pipe out there somewhere. Start with that.',
      { seconds: 6 },
    );
    this._nudgeAt = this._t + 16;
  }

  /**
   * The fish arrives at the pipe, once you have.
   *
   * It comes out of the murk off to one side rather than materialising in front
   * of you, and it comes in far enough out that the shout lands before the fish
   * is anything more than a shape. The bong is the anchor, not the player, so
   * arriving at the station from any direction produces the same scene.
   */
  _meetAtBong(bong) {
    const g = this.game;
    const a = g.rng.float(0, Math.PI * 2);
    const p = bong.position.clone();
    p.x += Math.cos(a) * 30;
    p.z += Math.sin(a) * 30;
    p.y = Math.max(g.seabed.heightAt(p.x, p.z) + 5, bong.position.y + bong.useHeight + 2);

    this.fish1 = new GuideFish(p, { color: 0x8fe0c4, scale: 1.45 });
    this.fish1.approach = true;
    this.fish1.approachFrom = 60;
    this.fish1.standoff = 5.0;
    this.fish1.carry(this.lighter.group);
    g.scene.add(this.fish1.group);
    this.fish.push(this.fish1);
    this._nudgeAt = this._t + 30;
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

    // ---- Beat 1: reach the pipe, and the fish turns up carrying the answer ----
    if (this.step === 0 && !this.fish1 && g.nearestBong
        && g.nearestBongDistance < CFG.bong.useRadius * 2.2) {
      this._meetAtBong(g.nearestBong);
    }

    // It shouts first, from out in the haze where you can't see it yet. That
    // call is the whole introduction to the fish: something out there is on your
    // side, it is coming, and it is cheerful about it.
    if (this.step === 0 && this.fish1 && !this._called
        && this.fish1.distanceTo(g.kelpie.position) < 24) {
      this._called = true;
      g.hud.say("HEY, I'LL GET THE LIGHT!", { who: 'Somewhere in the murk', seconds: 4 });
      g.audio?.sfx('fish');
    }
    if (this.step === 0 && this.fish1 && this.fish1.distanceTo(g.kelpie.position) < 7.5) {
      this._handover();
    }

    // ---- Beat 2: where to use it ----
    if (this.step === 1 && this._t >= this._handoffAt) {
      this._advance(2);
      // You are already standing at the pipe — that's where it found you — so
      // this beat is about what's in your glove, not about where to go.
      g.hud.say(
        `That arc will light a bowl at any depth. That's the whole trick.<br>` +
        `That one there is an old thing, but it still draws. Go on.`,
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
        `Fill <b>a jar's worth</b> and you can pack another. Some hold an eighth, some a half. ` +
        `Sweep that lamp about.`,
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
      'It presses a lighter into the diver\'s glove. Not a flint one. A <b>plasma torch</b>.<br>' +
      'Twin arc. No flame to drown. This lighter will burn even the wettest weed.<br>' +
      'The dankest dank.',
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
    } else if (this.step === 0 && g.nearestBong) {
      // Before the fish exists, the only thing to point at is the pipe — which
      // is the whole of beat 0 now. Used to promise it was humming; nothing in
      // AudioDirector ever gave a loaded bong a sound at range (CR-11 / the
      // outbox), so the line was a promise the game could not keep. Removed
      // rather than the sound built, at his word.
      g.hud.say(`There's a pipe ${this._bearingTo(g.nearestBong.position)}.`, { seconds: 4 });
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
