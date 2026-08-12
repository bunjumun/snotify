// The fish know where it is.
//
// Three clues, coarse to fine, each one delivered by a different fish that swims
// out of the murk to tell you and then leaves:
//
//   0  a lake trout gives a bearing and a distance band
//   1  a whitefish names the landmark it's lying near
//   2  a lake sturgeon — over a century old, and prehistoric with it — gives a
//      live warmer/colder ping, because the oldest thing in the lake is the one
//      that would know where things are buried
//
// Every line is generated from where the chest actually is this run, so a clue
// can never be wrong. That matters more than it sounds: one lying fish and the
// player stops listening to all of them, and the entire navigation system of the
// game is fish talking.
//
// No waypoint, ever. The fog IS the game; an arrow through it throws the game
// away. The closest this gets is the sturgeon's ping, and even that only tells
// you whether you're getting warmer.
//
// The hint button is also a lifeline. If you're low on breath and short of
// baggies, whoever turns up talks about baggies instead — because a player about
// to hit DREAM OVER through bad luck rather than bad play should have somewhere
// to turn, and that costs nothing to offer.
//
// And then there's being high. Sober, one fish talks to you, on a long cooldown,
// working through the three clues in the order they were written. Under the
// effects of a bowl, every school in the lake will answer: the clue is the good
// one, and the chest is on the sonar.
//
// After that the lore comes out as a conversation rather than a recital — the
// fish ask and the DIVER answers, because he is the one who came down from up
// there and it is the only speaking part he has in the whole game. A fish
// reciting a band's backstory at you is a plaque. A fish asking a stoned man
// where he's from, and him telling it, is a scene.
//
// That whole window is bought with four baggies and it drains on the same curve
// as the colour, which is the only reason it can be this generous — it is not a
// mode, it is a payoff.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { GuideFish } from '../entities/Fish.js';
import { Chest } from '../entities/Chest.js';

const TELLERS = [
  { who: 'A lake trout',   color: 0x8fbf8a },
  { who: 'A lake whitefish', color: 0xa8c4cc },
  { who: 'A lake sturgeon', color: 0xd8c48a, scale: 2.1 },
];

export class Clues {
  /**
   * @param {import('../core/Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    this.stage = 0;
    this.cooldown = 0;
    this.found = false;
    this.proximity = false;    // the sturgeon has spoken; live pings are on
    this._ping = 0;
    this._lastBand = -1;
    this._volunteered = false;
    this._toldHigh = false;    // the chest clue has been given while high
    this._lore = 0;            // rotates, so the lore doesn't repeat itself
    this._reply = null;        // the diver's half of an exchange, pending
    this._lampreyed = false;   // the lamprey gets its one non-answer per trip
    this._prevTrip = 0;        // for spotting the start of a fresh bowl
    this._chatCd = 0;          // gap between two shoals both having something to say
    this.tellers = [];         // live guide fish, cleaned up as they expire

    this.chest = new Chest(this._pickSpot(game.rng, game.wreck, game.seabed));
    game.scene.add(this.chest.group);
  }

  /**
   * Never open water. Every anchor is a short swim off something you'd have gone
   * to look at anyway, so finding it reads as having explored rather than having
   * been lucky.
   */
  _pickSpot(rng, wreck, seabed) {
    const lm = rng.pick(wreck.landmarks);
    for (let i = 0; i < 30; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(lm.radius * 0.9, lm.radius * 2.2);
      const x = lm.position.x + Math.cos(a) * r;
      const z = lm.position.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > CFG.world.radius * 0.9) continue;
      return new THREE.Vector3(x, seabed.heightAt(x, z) + 0.1, z);
    }
    const p = lm.position.clone();
    p.y = seabed.heightAt(p.x, p.z) + 0.1;
    return p;
  }

  /**
   * A retry is a new run at the same seed, so the chest is in the same place and
   * has to be findable again — but the clue chain resets, because the point of
   * the chain is the search and you've just lost the search.
   */
  resetRun() {
    this.stage = 0;
    this.cooldown = 0;
    this.found = false;
    this.proximity = false;
    this._volunteered = false;
    this._toldHigh = false;
    this._reply = null;
    this._lampreyed = false;
    this._chatCd = 0;
    this._lastBand = -1;
    for (const s of this.game.shoals.schools) s._spokeAt = -999;
    this.chest.close();
    for (const t of this.tellers) this.game.scene.remove(t.fish.group);
    this.tellers.length = 0;
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // The diver answering the question a fish just asked him. Deliberately not
    // gated on the trip still running — if it has worn off mid-sentence he
    // still finishes the sentence.
    if (this._reply) {
      this._reply.at -= dt;
      if (this._reply.at <= 0) {
        g.hud.say(this._reply.text, { who: 'The diver', seconds: 7.5 });
        this._reply = null;
      }
    }

    // A fresh bowl gives the lamprey its one non-answer back. `_toldHigh` is
    // deliberately NOT reset — the chest hasn't moved, so a later bowl should go
    // straight to the conversation rather than re-reading you the directions.
    if (g.trip.value > CFG.clues.highAt && this._prevTrip <= CFG.clues.highAt) this._lampreyed = false;
    this._prevTrip = g.trip.value;

    const dist = this.chest.update(dt, g.kelpie.position);
    this.chest.setTrip(g.trip.value);

    // Live guide fish age out rather than following you around forever.
    for (let i = this.tellers.length - 1; i >= 0; i--) {
      const t = this.tellers[i];
      t.fish.update(dt, g.time, g.kelpie.position);
      t.fish.setTrip(g.trip.value);
      t.life -= dt;
      if (t.life <= 0) {
        g.scene.remove(t.fish.group);
        this.tellers.splice(i, 1);
      } else if (t.life < 6) {
        t.fish.approach = false;   // it starts drifting off before it vanishes
      }
    }

    this._swimThrough(dt);

    if (!this.found && dist <= CFG.chest.openRadius) this._openChest();

    // The sturgeon's ping. Only after it has spoken, and only near enough for
    // "warmer" to mean anything.
    if (this.proximity && !this.found) {
      this._ping -= dt;
      if (this._ping <= 0 && dist < CFG.clues.proximityNear) {
        this._ping = CFG.clues.pingInterval;
        const band = Math.min(4, Math.floor((1 - dist / CFG.clues.proximityNear) * 5));
        if (band !== this._lastBand) {
          this._lastBand = band;
          g.hud.say(PING[band], { who: 'The sturgeon', seconds: 2.2 });
          g.audio?.sfx('fish');
        }
      }
    }

    // Chill and Easy volunteer a hint rather than waiting to be asked — those
    // modes exist for people who came for the band, not for the puzzle. Never
    // during the opening, though: a fish volunteering treasure directions on top
    // of the tutorial is two voices talking over each other.
    if (!this.found && !this._volunteered && !g.intro.active && g.difficulty.volunteersHints
        && g.breath.fraction < CFG.clues.volunteerAt && this.cooldown <= 0) {
      this._volunteered = true;
      this.ask();
    }

    this.game.hud.setHintAvailable(this.cooldown <= 0 && !this.found);
  }

  /**
   * Swim into a shoal while the bowl is working, and it talks to you.
   *
   * Nothing to press and nobody to find: you are in their water and you are
   * high, so they talk. It is how the blast-off pays off — you are fired up out
   * of the dark into the middle of a school, and it starts asking you questions
   * before you've pressed anything.
   *
   * Sober, they say nothing at all. That silence is the point: the ordinary lake
   * is a lake, one appointed fish will answer a direct question, and everything
   * else out there is weather. What a bowl buys is that the whole lake starts
   * talking — and it can only buy that if it isn't happening anyway.
   *
   * Two cooldowns. Per school, so the same shoal doesn't natter while you circle
   * it; and one global, so two overlapping shoals don't talk over each other.
   */
  _swimThrough(dt) {
    const g = this.game;
    this._chatCd = Math.max(0, this._chatCd - dt);
    // Only while the bowl is working. The opening has its own voices.
    if (g.trip.value <= CFG.clues.highAt) return;
    if (this._chatCd > 0 || this._reply || g.intro.active) return;

    const school = g.shoals.schoolAround(g.kelpie.position);
    if (!school) return;
    if (g.time - (school._spokeAt ?? -999) < CFG.clues.throughCooldown) return;
    school._spokeAt = g.time;

    // Straight into the lore exchange. Keeps the hint button's cooldown in step
    // so pressing it right after doesn't cut the diver off mid-answer.
    this._chatCd = CFG.clues.highCooldown;
    this.cooldown = CFG.clues.highCooldown;
    this._highHint();
  }

  // ---------------------------------------------------------------------- ask

  /** The hint button, and the gamepad's hint face button. */
  ask() {
    const g = this.game;
    if (this.cooldown > 0) return;

    // During the opening the fish already have something to say, and a second
    // one turning up with treasure directions mid-tutorial is just noise. Send
    // the button back to the intro's own nudge instead of refusing it.
    if (g.intro.active) {
      this.cooldown = 4;
      g.intro.nudge();
      return;
    }

    // Lifeline first. Being told where the treasure is while you suffocate would
    // be a joke at the player's expense.
    if (this._needsBaggies()) {
      this.cooldown = CFG.clues.askCooldown;
      return this._stashHint();
    }

    // High: ask whatever is swimming past, on a short leash.
    if (g.trip.value > CFG.clues.highAt) {
      this.cooldown = CFG.clues.highCooldown;
      return this._highHint();
    }

    this.cooldown = CFG.clues.askCooldown;
    if (this.found) return this._afterHint();
    return this._chestHint();
  }

  _needsBaggies() {
    const g = this.game;
    return !g.stash.canPack && g.breath.fraction < 0.45;
  }

  _stashHint() {
    const g = this.game;
    const near = g.stash.nearestAvailable(g.kelpie.position);
    const short = CFG.stash.needed - g.stash.carried;
    if (!near) {
      this._speak(0, `Nothing close. Keep moving — this wreck is full of it.`);
      return;
    }
    this._speak(0,
      `You're ${short} short and you're running out of air.<br>` +
      `There's a bag ${bearing(g.kelpie.position, near.position)}. Go.`);
  }

  _chestHint() {
    const g = this.game;
    const c = this.chest.position;

    if (this.stage === 0) {
      this._speak(0,
        `There's a box down here that isn't ours. Iron bands, wooden sides.<br>` +
        `It's ${bearing(g.kelpie.position, c)}.`);
      this.stage = 1;
      return;
    }

    if (this.stage === 1) {
      const { landmark } = g.wreck.nearestLandmark(c);
      const where = landmark ? landmark.name : 'the wreck';
      this._speak(1,
        `The trout sent you, then. It's lying by <b>${where}</b>,<br>` +
        `half under the silt. You'll want that lamp.`);
      this.stage = 2;
      return;
    }

    // Stage 2 and every ask after it: the sturgeon, and the pings come on.
    this.proximity = true;
    this._lastBand = -1;
    this._ping = 0;
    const d = g.kelpie.position.distanceTo(c);
    this._speak(2,
      `I have been in this water longer than the boat has.<br>` +
      `Stay near me and I'll tell you when you're close. ${d < CFG.clues.proximityNear
        ? `You already are.` : `You are not, yet.`}`);
  }

  /**
   * High. Ask whatever happens to be swimming past.
   *
   * The first answer is the good clue — bearing, landmark and the live ping all
   * at once, which sober takes three separate fish and three cooldowns to earn.
   * After that they talk about the horse, because the lore is the other half of
   * what a bowl buys you and because a band's game should hand over the band's
   * story somewhere.
   */
  _highHint() {
    const g = this.game;
    const R = CFG.clues.highRadius;

    // The lamprey is not here to help you and a bowl doesn't change that — but
    // it gets to say so once per trip and no more. Letting it answer every time
    // it happens to be the closest thing walls the entire conversation off for
    // anyone who parks near one, which is a joke that stops being funny on the
    // second telling.
    if (!this._lampreyed) {
      const near = g.shoals.nearestSchool(g.kelpie.position, R);
      if (near?.sp.role === 'dread') {
        this._lampreyed = true;
        this.cooldown = 3;
        g.hud.say('It turns to face you, and keeps turning.<br>It has nothing to say and all night to not say it.',
          { who: 'The sea lamprey', seconds: 3.6 });
        g.audio?.sfx('fish');
        return;
      }
    }

    // Nearest first, but fall through to ANY school rather than giving up. The
    // blast-off puts fifty units of water between you and the seabed the moment
    // the bowl lands, so a hard radius here means the conversation dies exactly
    // when it is supposed to be starting. Being high, you can hear the lot.
    const talks = (s) => s.sp.role !== 'dread';
    const school = g.shoals.nearestSchool(g.kelpie.position, R, talks)
      || g.shoals.nearestSchool(g.kelpie.position, Infinity, talks);
    if (!school) return this.found ? this._afterHint() : this._chestHint();

    const who = `A ${school.sp.name}`;

    if (!this.found && !this._toldHigh) {
      this._toldHigh = true;
      this.stage = Math.max(this.stage, 2);
      this.proximity = true;
      this._lastBand = -1;
      this._ping = 0;
      const c = this.chest.position;
      const { landmark } = g.wreck.nearestLandmark(c);
      g.hud.say(
        `Everything down here is talking at once, and it all agrees.<br>` +
        `The box is ${bearing(g.kelpie.position, c)}, by <b>${landmark ? landmark.name : 'the wreck'}</b>.`,
        { who, seconds: 8 });
      g.audio?.sfx('fish');
      return;
    }

    // A fish asking and the diver answering, rather than a fish reciting. He is
    // the one who came down from there, so he's the one who'd know — and it
    // gives him the only lines he has in the whole game. The answer lands on a
    // timer in update() so the two of them aren't talking over each other.
    const l = LORE[this._lore++ % LORE.length];
    g.hud.say(l.ask, { who, seconds: 3.8 });
    g.audio?.sfx('fish');
    this._reply = { text: l.say, at: 3.2 };
  }

  _afterHint() {
    const remaining = this.game.logs ? this.game.logs.pages.filter((p) => !p.taken).length : 0;
    if (remaining > 0) {
      this._speak(1,
        `You got it open, then.<br>` +
        `There are still <b>${remaining}</b> slates from her log out here, if you're curious.`);
    } else {
      this._speak(1, `You've had everything this wreck has. Go on — swim for the pleasure of it.`);
    }
  }

  /** Bring a fish over to say it, rather than printing text at nobody. */
  _speak(tellerIndex, text) {
    const g = this.game;
    const t = TELLERS[Math.min(tellerIndex, TELLERS.length - 1)];

    // Somewhere off to the side and slightly above, so it swims into frame
    // instead of appearing in the middle of it.
    const p = g.kelpie.position.clone();
    const a = g.rng.float(0, Math.PI * 2);
    p.x += Math.cos(a) * 26;
    p.z += Math.sin(a) * 26;
    p.y = Math.max(g.seabed.heightAt(p.x, p.z) + 3, p.y + 2);

    const fish = new GuideFish(p, { color: t.color, scale: t.scale ?? 1.5 });
    fish.approach = true;
    fish.approachFrom = 70;
    fish.standoff = 6;
    g.scene.add(fish.group);
    this.tellers.push({ fish, life: CFG.clues.guideLifetime });

    g.hud.say(text, { who: t.who, seconds: 8 });
    g.audio?.sfx('fish');
  }

  // -------------------------------------------------------------------- chest

  _openChest() {
    if (!this.chest.openLid()) return;
    this.found = true;
    this.proximity = false;
    const g = this.game;

    g.progress.markChestFound(g.runSeconds);
    g.audio?.sfx('chest');
    g.rig.addShake(0.3);
    g.bubbles.burst(this.chest.position.x, this.chest.position.y + 1, this.chest.position.z, 30, 1.2);
    g.hud.say('Something is in it.', { seconds: 2.4 });

    // Let the lid finish before the screen takes over — the reward is the moment
    // it opens, not the form that follows it.
    setTimeout(() => g.onChestOpened?.(), 1800);
  }

  blips(out) {
    if (this.found) return out;
    // The chest is on the sonar only while a hit is still working, and it fades
    // out on the same curve as the colour. That makes it the one thing you can't
    // get by looking — it costs a bowl — and it stops the radar from becoming a
    // waypoint you can stand still and read. When it starts to go, you go.
    const trip = this.game.trip.value;
    if (trip <= 0.02) return out;
    out.push({
      x: this.chest.position.x, z: this.chest.position.z, type: 'chest',
      strength: THREE.MathUtils.clamp(trip, 0.2, 1),
    });
    return out;
  }
}

/**
 * What the fish know, told a fragment at a time and only while you're high.
 *
 * This is the album's own story, and it is kept in step with
 * `lakehorse sim/style assets/lakehorse lore.rtf` — that file is the source of
 * truth and it gets edited, so read it before touching anything here. The arc:
 * Earth is destroyed by a megachurch CEO with a gun big enough to hole the sky,
 * the survivors are sent out mining, Anocean and Enias defect from the gold
 * colony on Jupiter, down through The Drain to Mango Tree World, the utopia they
 * couldn't agree on, and the horse that came up out of the water and the ash
 * afterwards. Each line is a piece; keep asking and the arc assembles itself.
 *
 * The last two are the setting rather than the story: this is a water bong
 * planet and weed is what it runs on, which is why the stations are down here
 * and why the diver is the one who finds that strange.
 *
 * It sits behind the bong deliberately. The ship's log tells you the sober
 * version — a lake freighter, iron ore, weather — and it is all true. This is the
 * other true thing, and you only get at it in the other state. That's not a
 * gimmick: it is the one piece of content in the game whose delivery mechanism
 * is the point.
 */
const LORE = [
  { ask: "You're not from the water. Where do you come from?",
    say: 'A planet called Earth. It is not there any more.<br>We were sent out mining, to start again. That was the offer.' },

  { ask: 'Planets do not simply stop being there.',
    say: 'A man who ran a megachurch built a gun the size of a city<br>and shot a hole in the sky with it. That is the whole story.' },

  { ask: 'And nobody stopped him?',
    say: 'He had the money, so he had the pulpit, so he had the gun.<br>By the time it mattered, arguing with him was heresy.' },

  { ask: 'So they sent you where?',
    say: 'Jupiter. A seam of gold in a place not built for people.<br>You dug it, or you owed it. Usually both.' },

  { ask: 'You keep saying gold. What is gold?',
    say: 'Something they wanted badly enough to spend people on.<br>That is the entire definition. There is nothing under it.' },

  { ask: 'Then why would anyone stay?',
    say: 'Nine years on a contract, and they count the years slower than you do.<br>Up there a man is a number with a job attached to it.' },

  { ask: 'And how does a man fall this far?',
    say: 'The Drain. A hole between one place and the next.<br>No stars in it. No dark either, which is the part nobody warns you about.' },

  { ask: 'Someone went first. Someone always goes first.',
    say: 'Anocean and Enias. Two of them, out through the gate before it shut.<br>Everyone who tried it after them got what you are swimming through.' },

  { ask: 'Did the first two find anything?',
    say: 'Somewhere clean, and they named it after a tree.<br>They had a whole plan for it. Plans last about as long as plans do.' },

  { ask: 'What broke it?',
    say: 'Two dreams, one world, and no give in either of them.<br>Their own people took up arms over the shape of paradise.' },

  { ask: 'So they died hating each other.',
    say: 'No. When it was all ash they finally said the kind thing —<br>that they had kept each other alive. Late. But they said it.' },

  { ask: 'And the green one? The one you are holding on to?',
    say: 'She came up out of the water and the ash together, lit from inside.<br>Nobody called her. Nobody can. She just arrives.' },

  { ask: 'Should I be afraid of her?',
    say: 'She is no drowning-horse, whatever the old stories say.<br>Where she puts her feet down, it comes back green.' },

  { ask: 'Then why is she HERE?',
    say: 'Look around you and ask me that again.<br>She only ever turns up where it has already gone wrong.' },

  { ask: 'So what is left to do?',
    say: 'You do not get the new world with the old hands.<br>That is the whole instruction. That is all of it.' },

  { ask: 'Why do you dive for the weed? It is only a plant.',
    say: 'On this world it is the fuel. Everything here runs on it —<br>the water, the light, whatever it is you use to talk to me.' },

  { ask: 'Then what were you burning, before you came here?',
    say: 'Something we had to take out of the ground and could never put back.<br>You grow yours. That is the difference, and it is the only one.' },
];

const PING = [
  'Cold. You are wandering.',
  'Warmer. Keep on.',
  'Warmer still.',
  'Very warm. Slow down and look.',
  'It is under you. Sweep the lamp.',
];

/** Compass wording. Same vocabulary the opening uses, so the world speaks one language. */
function bearing(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  // -Z is north, matching how the world is laid out.
  const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const dir = dirs[Math.round(deg / 45) % 8];
  const near = dist < 40 ? 'not far' : dist < 110 ? 'a way' : 'a long way';
  return `${near} to the ${dir}`;
}
