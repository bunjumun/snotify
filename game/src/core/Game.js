// The game.
//
// Owns the renderer, the world, the entities and the state machine, and wires the
// one value that matters — uTrip — from Trip.js out to the post shader, the
// sparkles, the kelpie, the bongs, the god-rays and the audio, every frame.
//
// Audio is optional throughout. Every call goes through `this.audio?.` so the
// whole game runs, and is testable, with no AudioContext at all — which matters
// because the context can't exist until someone has tapped DIVE IN.

import * as THREE from 'three';
import { CFG } from '../../config.js';
import { Rng, seedFromUrl } from './Rng.js';
import { Loop } from './Loop.js';
import { Rig } from './Rig.js';

import { InputBus } from '../input/InputBus.js';
import { Keyboard } from '../input/Keyboard.js';
import { Gamepad_ } from '../input/Gamepad.js';
import { Touch } from '../input/Touch.js';

import { Seabed } from '../world/Seabed.js';
import { Wreck } from '../world/Wreck.js';
import { Flora } from '../world/Flora.js';
import { Bounds } from '../world/Bounds.js';
import { Thermocline } from '../world/Thermocline.js';
import { Weather } from '../world/Weather.js';
import { Shoals } from '../world/Shoals.js';

import { Kelpie } from '../entities/Kelpie.js';
import { Diver } from '../entities/Diver.js';
import { Lamp } from '../entities/Lamp.js';
import { placeBongs } from '../entities/Bong.js';

import { Bubbles } from '../fx/Bubbles.js';
import { Particles } from '../fx/Particles.js';
import { Smoke } from '../fx/Smoke.js';
import { Godrays } from '../fx/Godrays.js';
import { Post } from '../fx/Post.js';

import { Difficulty } from '../game/Difficulty.js';
import { Progress } from '../game/Progress.js';
import { Breath, BreathState } from '../game/Breath.js';
import { Stash } from '../game/Stash.js';
import { Trip } from '../game/Trip.js';
import { Intro } from '../game/Intro.js';
import { Clues } from '../game/Clues.js';
import { LogPages } from '../game/LogPages.js';
import { LogFeed } from '../game/LogFeed.js';

import { HUD } from '../ui/HUD.js';
import { RewardScreen } from '../ui/RewardScreen.js';
import { Logbook } from '../ui/Logbook.js';
import { KEYS } from './Keys.js';

export const State = { TITLE: 'title', PLAY: 'play', PAUSED: 'paused', DEAD: 'dead' };

/** One rider per band member. They only ever come into frame on the bong orbit. */
const RIDERS = 4;

// Public by design — see supabase/schema-v19.sql. lore_active() serves only the
// draft the band deliberately promoted, which is why it needs no password.
const LORE_URL = 'https://twgukeyoayfqldnojrkg.supabase.co';
const LORE_KEY = 'sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = State.TITLE;
    this.audio = null;          // set by main.js once the context is unlocked
    this.time = 0;              // wall clock, never reset — animations read this
    this.runSeconds = 0;        // this run only, for the chest's best time

    this.difficulty = new Difficulty();
    this.progress = new Progress();
    this.seed = seedFromUrl() || Rng.makeSeed();
    this.rng = new Rng(this.seed);

    this._initRenderer();
    this._initScene();
    this._initWorld();
    this._initEntities();
    this._initFx();
    this._initSystems();
    this._initInput();

    this.hud = new HUD(this.progress);
    this.hud.setSeed(this.seed);

    this.loop = new Loop((dt) => this.update(dt), (a, dt) => this.render(dt));
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---------------------------------------------------------------- renderer

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    // Clamped: a 3x-DPR phone rendering at native resolution is rendering nine
    // times the pixels of a 1x screen, which no amount of shader thrift survives.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, CFG.quality.dprClamp));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CFG.lights.exposure;
    this.renderer.setClearColor(CFG.fog.color, 1);

    // Read the saved setting HERE rather than only in main.js, because some of
    // what quality governs — how many schools of fish the lake gets — is decided
    // when the world is built and can't be changed afterwards.
    let want = CFG.quality.default;
    try { want = localStorage.getItem(KEYS.quality) || want; } catch { /* private mode */ }
    this.quality = want === 'auto' ? this._guessQuality() : want;
  }

  /** Cheap heuristic up front; the frame sampler in update() can demote later. */
  _guessQuality() {
    const smallScreen = Math.min(innerWidth, innerHeight) < 500;
    const manyPixels = devicePixelRatio > 2.2;
    return (smallScreen || manyPixels) ? 'low' : 'high';
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(CFG.fog.color, CFG.fog.near, CFG.fog.far);
    this.scene.background = new THREE.Color(CFG.fog.color);

    // Underwater light is overwhelmingly bounce, so the hemisphere does the heavy
    // lifting and the "sun" is only a soft suggestion of a surface far overhead.
    const L = CFG.lights;
    this.hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(L.sunColor, L.sun);
    this.sun.position.set(30, 120, -20);
    this.scene.add(this.sun);

    this.ambient = new THREE.AmbientLight(L.ambient, L.ambientIntensity);
    this.scene.add(this.ambient);

    this._baseLight = { hemi: L.hemi, sun: L.sun, ambient: L.ambientIntensity };
  }

  // ------------------------------------------------------------------- world

  _initWorld() {
    this.seabed = new Seabed(this.rng);
    this.scene.add(this.seabed.group);

    this.wreck = new Wreck(this.rng, this.seabed);
    this.scene.add(this.wreck.group);

    this.flora = new Flora(this.rng, this.seabed);
    this.scene.add(this.flora.group);

    this.thermocline = new Thermocline();
    this.scene.add(this.thermocline.group);

    this.weather = new Weather(this.rng);
    // Weather has carried these two hooks since it was written and nothing had
    // ever assigned them. This is the arrival: the lake picks a direction and
    // leans, and you get one surge of warning before the fog closes. There is no
    // matching cue on `onEnd` because a gale letting go is an absence, not an
    // event, and the eight-second ramp out already reads as one.
    this.weather.onStart = () => {
      this.rig.addShake(CFG.weather.onsetTrauma);
      this.pad?.rumble(0.45, 260);
    };
    this.bounds = new Bounds();

    this.shoals = new Shoals(this.rng, this.seabed, this.quality);
    this.scene.add(this.shoals.group);
  }

  _initEntities() {
    this.kelpie = new Kelpie();
    this.scene.add(this.kelpie.group);

    // Four riders, one per band member. Only rider 0 has a grip that can fail:
    // four independent "go back for him" states at once would be a different and
    // much worse game, and you would never see three of them anyway.
    //
    // Each Diver paints its own dazzle at construction, so the four of them come
    // out in four different patterns for free.
    this.divers = [];
    for (let i = 0; i < RIDERS; i++) {
      const d = new Diver();
      this.scene.add(d.group);
      this.divers.push(d);
    }
    this.diver = this.divers[0];   // the one the camera, the lamp and the lighter belong to
    // Both of these are placed, and the diver is the reason spatialisation was
    // worth building at all: he is the one thing in the lake that persists at a
    // distance and makes noise. "Go back for him" is a direction as much as an
    // instruction, and hearing which side he came off tells you it without the
    // HUD having to.
    this.diver.onLetGo = () => {
      this.hud.say('He lost his grip. Go back for him.', { seconds: 3.2 });
      this.audio?.sfx('grip_lost', { at: this._diverAt() });
      this.pad?.rumble(0.8, 240);
      this.rig.addShake(0.5);
    };
    this.diver.onGrab = () => {
      this.hud.say('Got him.', { seconds: 1.8 });
      this.audio?.sfx('grip_regain', { at: this._diverAt() });
    };

    this.lamp = new Lamp(this.scene, RIDERS);
    this.heldLighter = null;   // set by Intro when a fish hands it over

    this.bongs = placeBongs(this.rng, this.seabed);
    for (const b of this.bongs) this.scene.add(b.group);
  }

  /**
   * A fish has handed over the lighter. From here the diver holds it, it burns in
   * his glove, and it becomes the light source that actually shows you the floor.
   * @param {import('../entities/Lighter.js').Lighter} lighter
   */
  giveLighter(lighter) {
    this.heldLighter = lighter;
    this.progress.giveLighter();
    this.lamp.setLit(true);
  }

  _initFx() {
    this.bubbles = new Bubbles();
    this.scene.add(this.bubbles.group);

    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.particles.setSparkleCentre(this.kelpie.position);

    this.smoke = new Smoke();
    this.scene.add(this.smoke.group);

    this.godrays = new Godrays(this.rng);
    this.scene.add(this.godrays.group);

    this.post = new Post(this.renderer);
    this.setQuality(this.quality);
  }

  _initSystems() {
    this.breath = new Breath(this.difficulty);
    this.breath.onState = (next) => this._onBreathState(next);
    this.breath.onEmpty = () => this.die();

    this.stash = new Stash(this.rng, this.seabed, this.difficulty);
    this.scene.add(this.stash.group);
    this.stash.onPickup = (n) => {
      this.breath.add(this.difficulty.baggieReturn);
      this.audio?.sfx('baggie');
      this.bubbles.burst(this.kelpie.position.x, this.kelpie.position.y, this.kelpie.position.z, 6, 0.6);
      const need = CFG.stash.needed;
      this.hud.say(n >= need ? 'Bowl packed. Find a bong.' : `${n}/${need}`, { seconds: 1.8 });
    };

    this.trip = new Trip();
    this.trip.onStart = () => {
      this.audio?.tripStart();
      // Everything at once. This is the moment the whole run is paid for, and it
      // costs four baggies — it is allowed to be too much.
      const k = this.kelpie.position;
      this.bubbles.burst(k.x, k.y + 1, k.z, 120, 1.6);
      const h = this._helm || (this._helm = new THREE.Vector3());
      for (const d of this.divers) {
        d.helmetPosition(h);
        this.bubbles.burst(h.x, h.y, h.z, 18, 1.1);
      }
      // Up out of the dark and through the middle of a school, if there's one
      // overhead worth arriving in. Straight up if there isn't.
      // Up out of the dark and through the middle of a school. Overhead first,
      // then anything that isn't below her, and failing both, the nearest shoal
      // in the lake at any angle — arriving among fish is the point of the climb
      // and "there wasn't one directly above you" is a poor reason to lose it.
      // Once you're there, swimming into them is what starts them talking; see
      // Clues._swimThrough.
      const into = this.shoals.schoolAbove(k)
        || this.shoals.nearestSchool(k, Infinity, (s) => s.sp.role !== 'dread');
      this.kelpie.blastOff(into ? into.home : null);
      this.rig.addShake(0.85);
    };
    this.trip.onHoldEnd = () => this.audio?.tripTaper();
    this.trip.onEnd = () => this.audio?.tripEnd();

    this.rig = new Rig(innerWidth / innerHeight);
    this.intro = new Intro(this);

    // Phase 2: the chest, the fish that know where it is, and the log.
    // Clues needs the wreck's landmarks and the rig, so it's built last.
    this.clues = new Clues(this);
    this.logs = new LogPages(this.rng, this.seabed, this.wreck, this.progress);
    this.scene.add(this.logs.group);
    // The band's live log, if they've promoted one. Placed first with the copy
    // compiled into the game and re-worded when the fetch lands — a page you
    // can't reach in the first quarter-second doesn't care which it got, and
    // this way the placement stays seeded and the game never waits on a server.
    this.logFeed = new LogFeed(CFG.audio.band, LORE_URL, LORE_KEY);
    this.logFeed.refresh().then((entries) => this.logs.setEntries(entries));
    this.logs.onFound = (entry, found, total) => {
      this.audio?.sfx('page');
      this.hud.say(
        `Recovered <b>${entry.title}</b>. That makes ${found} of ${total}.<br>` +
        `<span style="opacity:.7">Read it from the pause screen.</span>`,
        { seconds: 4.5 },
      );
    };

    this.reward = new RewardScreen(this);
    this.logbook = new Logbook(this);
    this.onChestOpened = () => this.reward.show(this.audio?.treasure ?? []);
  }

  _initInput() {
    this.input = new InputBus();
    this.input.add(new Keyboard(this.canvas));
    this.pad = this.input.add(new Gamepad_());
    this.pad.onPause = () => this.togglePause();
    this.input.add(new Touch(document.getElementById('touch')));
    // Tilt is written and parked — registering it is a one-liner when wanted.
    // if (CFG.input.tilt.enabled) this.tilt = this.input.add(new Tilt());
  }

  // ------------------------------------------------------------------ public

  start() {
    this.state = State.PLAY;
    this.respawn();
    this.loop.start();
    this.intro.begin();
  }

  /**
   * Spawn off the wreck's bow, facing it, about ten units off the bottom.
   *
   * Both halves matter. Height, because the water column is 100 units and the fog
   * only reaches 80 — spawn mid-water and the player opens the game staring into
   * an empty green void with no cue that anything exists. And heading, because the
   * first thing anyone should ever see is the Enias coming out of the haze.
   */
  _spawnPose() {
    const bow = this.wreck.landmarks.find((l) => l.name === 'the bow');
    const target = bow ? bow.position : new THREE.Vector3(8, CFG.world.floorY, -34);
    const pos = new THREE.Vector3(target.x + 26, 0, target.z + 46);
    pos.y = this.seabed.heightAt(pos.x, pos.z) + 10;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    return { position: pos, yaw: Math.atan2(-dx, -dz) };
  }

  respawn() {
    const spawn = this._spawnPose();
    this.kelpie.reset(spawn.position, spawn.yaw);
    const anchor = new THREE.Vector3();
    this.kelpie.gripPoint(anchor);
    for (const d of this.divers) {
      d.reset(anchor);
      d.hitchPoint(anchor);   // the next one starts where this one ends
    }
    this.rig.snapTo(this.kelpie);
    this.breath.reset();
    this.trip.cancel();
    this.smoke.clear();       // a retry shouldn't begin inside last run's cloud
    this.post.trip = 0;
    this.post.panic = 0;
    this.runSeconds = 0;      // what markChestFound() records as a best time
    this.progress.countRun();
  }

  retry() {
    document.getElementById('death').classList.add('hide');
    this.stash.reset();
    this.clues.resetRun();
    this.respawn();
    this.state = State.PLAY;
    this.audio?.revive();
  }

  die() {
    if (this.state === State.DEAD) return;
    this.state = State.DEAD;
    this.trip.cancel();
    this.audio?.death();
    document.getElementById('death').classList.remove('hide');
  }

  togglePause() {
    if (this.state === State.PLAY) {
      this.state = State.PAUSED;
      this.logbook.refreshCount();
      document.getElementById('settings').classList.remove('hide');
      this.audio?.duck(true);
    } else if (this.state === State.PAUSED) {
      this.state = State.PLAY;
      document.getElementById('settings').classList.add('hide');
      this.audio?.duck(false);
    }
  }

  /**
   * Everything here is live except the fish: how many schools the lake holds is
   * fixed when the world is built, so changing quality mid-run affects the
   * picture immediately and the population on the next load.
   */
  setQuality(level) {
    this.quality = level;
    this.post.setQuality(level);
    this.particles.setQuality(level);
    this.smoke.setQuality(level);
    this.bubbles.setQuality(level);
    this.godrays.setQuality(level);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, CFG.quality.dprClamp));
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
    this.post.resize();
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;

    if (this.state === State.PAUSED) return;

    if (this.state === State.DEAD) {
      this.kelpie.sink(dt);
      this._followEntities(dt);
      return;
    }

    this.input.update(dt);
    // During the cinematic the player is a passenger — the orbit is the payoff
    // for the run, and fighting the camera through it would spoil it.
    const intent = this.trip.cinematic ? IDLE_INTENT : this.input.intent;

    this.weather.update(dt);
    this.thermocline.update(dt);

    // Current: weather plus the soft boundary that keeps you in the bowl.
    const current = this._current || (this._current = new THREE.Vector3());
    current.copy(this.weather.current).add(this.bounds.force(this.kelpie.position));

    // Two continuous sources of unease, both HELD at a floor rather than topped
    // up per frame. Bounds.strain had been computed since the boundary was
    // written, carrying a comment saying it was for cues at the edge, and nothing
    // read it until Phase 1 — at which point it was read and still did nothing,
    // because `addShake(rate * dt)` cannot hold a level against a linear decay.
    // See Rig.sustain() for why. So this is the cue actually arriving: a rising
    // unease as the current leans harder, so pushing at the edge of the lake
    // feels like being pushed back rather than like drifting into treacle.
    if (this.bounds.strain > 0.05) {
      this.rig.sustain(this.bounds.strain * CFG.world.strainTrauma);
    }

    // The gale's buffet, the same way. Off the current's actual magnitude rather
    // than off `intensity`, because the current already pulses: the shake and the
    // shove are then the same water, and the camera surges with the gusts instead
    // of humming flat underneath them.
    const buffet = this.weather.current.length() / CFG.weather.currentForce;
    if (buffet > 0.02) this.rig.sustain(buffet * CFG.weather.galeTrauma);

    this.kelpie.update(dt, intent, { current, attract: this._bongAttract() });

    // Hitting the floor is an event, not a clamp. clampAbove() reports whether it
    // had to move her, and that report used to be dropped on the ground: you
    // could fly nose-first into the silt at full speed and get nothing back. No
    // jolt, no sound, no cost, she simply stopped descending. Read the closing
    // speed before the clamp, because after it the velocity is still pointing
    // down through a floor she is no longer inside.
    const closing = -this.kelpie.velocity.y;
    if (this.seabed.clampAbove(this.kelpie.position, 2.0)) this._hitSeabed(closing);

    // A tail beat throws water. This puff is the receipt for the tap — without
    // something leaving the fluke, tapping reads as a button that does nothing.
    //
    // The beat also costs air, and both come off the same event on purpose. The
    // puff IS the price: you watch the breath you just spent leave the fluke, so
    // the tank never drops for a reason you did not see happen. Charged before
    // breath.update() below, so a beat and the rate it was taken under settle in
    // the same frame.
    if (this.kelpie.kicked) {
      const tail = this._tail || (this._tail = new THREE.Vector3());
      this.kelpie.tailPoint(tail);
      this.breath.spend(CFG.breath.kickCost);
      this.bubbles.burst(tail.x, tail.y, tail.z, 5, 0.5);
      // Louder from a standing start than mid-sprint: the same beat is more work
      // when there's no momentum under it, and the ear already expects that.
      this.audio?.sfx('kick', { force: 1 - Math.min(1, this.kelpie.speed / 20) });
    }

    this._followEntities(dt);

    // ---- Breath ----
    const submersion = this.thermocline.submersion(this.kelpie.position.y);

    // The layer takes the light and speeds the drain the moment you pass it, and
    // it did both as silent ramps: the most consequential line in the water was
    // the one thing you could cross without noticing. Down through it knocks,
    // back up through it lets go. Latched inside Thermocline, so hanging at the
    // boundary weighing up the trench costs nothing.
    const crossed = this.thermocline.crossing(this.kelpie.position.y);
    if (crossed > 0) {
      this.rig.addShake(CFG.thermocline.crossTrauma);
      this.audio?.sfx('cold_in');
      this.pad?.rumble(0.35, 180);
    } else if (crossed < 0) {
      this.rig.addShake(CFG.thermocline.riseTrauma);
      this.audio?.sfx('cold_out');
    }

    this.breath.update(dt, {
      boosting: this.kelpie.boosting,
      belowThermo: submersion,
      diverAdrift: this.diver.adrift,
    });

    // ---- Pickups and stations ----
    this.runSeconds += dt;
    this.stash.update(dt, this.time, this.kelpie.position, this.lamp);
    this.logs.update(dt, this.time, this.kelpie.position, this.lamp);
    this._updateBongs(dt);
    this.clues.update(dt);

    // ---- Trip ----
    this.trip.update(dt);
    this._applyTrip(this.trip.value);
    this.rig.orbitWeight = this.trip.orbitWeight;
    this.rig.orbitProgress = this.trip.orbitProgress;

    // ---- FX ----
    const react = this.audio?.react ?? { low: 0, mid: 0, high: 0, kick: 0 };
    this.kelpie.setReact(react);
    this.flora.update(dt, react.low, current);
    // Schools tighten in loud passages — the most visible thing the analyser does.
    this.shoals.update(dt, this.kelpie.position, react.mid);
    this.godrays.update(dt, react.low, this.weather.lightScale());
    // The bong sequence reads the record too. Handed over every frame; the
    // shader only looks at it while uTrip is up.
    this.post.setReact(react);
    // ...and the least visible: the bass, in the hands of anyone on a pad. It
    // rides `kick` rather than `low` so it lands on the beat instead of buzzing
    // through every loud passage, and it stands aside for any one-shot.
    this.pad?.music(react.kick);
    this.bubbles.update(dt, this.time);
    this.particles.update(dt, this.rig.camera.position, this.trip.value, react.kick);

    // Helmet bubbles: constant trickle, more when working hard.
    const helm = this._helm || (this._helm = new THREE.Vector3());
    this.diver.helmetPosition(helm);
    // Heavy while she's climbing — the wake is most of what sells the launch.
    const rate = this.kelpie.lift > 0 ? 110 : this.kelpie.boosting ? 26 : 9;
    this.bubbles.emit(dt, helm.x, helm.y, helm.z, rate, 0.85);

    // Smoke trails off him for as long as the trip lasts and thins with uTrip,
    // so the comedown is something you can watch drifting behind you.
    this.smoke.setTrip(this.trip.value);
    if (this.trip.value > 0.01) {
      this.smoke.trail(dt, helm.x, helm.y, helm.z, CFG.smoke.trailRate * this.trip.value);
    }
    this.smoke.update(dt);

    this._applyEnvironment(submersion);
    this.intro.update(dt);
    this.hud.update(dt);
    this.hud.updateBreath(this.breath);
    this.hud.updateInventory(this.stash, this.progress.hasLighter);
    this._updateRadar(dt);

    // Her ears, not the camera's. The rig sits on a spring behind her and is
    // updated below this line anyway, so listening from it would mean panning
    // against a pose that is both laggy and a frame stale. Pillar 2 settles it:
    // you steer an animal, and the animal is what hears.
    this.audio?.update(dt, {
      position: this.kelpie.position,
      forward: this.kelpie.forward,
      breathFraction: this.breath.fraction,
      panic: this.breath.panic,
      belowThermo: submersion,
      trip: this.trip.value,
      speed: this.kelpie.speed,
    });

    this.rig.update(dt, this.kelpie);
  }

  /**
   * Feed the sonar.
   *
   * Rebuilt each frame rather than cached, because what's on it changes with what
   * you're carrying: a bong reads as dark until you can actually use it, so the
   * radar answers "where can I go right now" rather than "where are the objects".
   */
  _updateRadar(dt) {
    const blips = this._blips || (this._blips = []);
    blips.length = 0;

    const canUse = this.progress.hasLighter && this.stash.canPack;
    for (const b of this.bongs) {
      blips.push({ x: b.position.x, z: b.position.z, type: canUse ? 'bongReady' : 'bongDark' });
    }
    // Only baggies still in the world, and only if you actually need more.
    if (!this.stash.canPack) {
      for (const b of this.stash.baggies) {
        if (b.taken) continue;
        blips.push({ x: b.group.position.x, z: b.group.position.z, type: 'baggie' });
      }
    }
    for (const f of this.intro.fish) {
      blips.push({ x: f.group.position.x, z: f.group.position.z, type: 'fish' });
    }
    for (const t of this.clues.tellers) {
      blips.push({ x: t.fish.group.position.x, z: t.fish.group.position.z, type: 'fish' });
    }
    this.shoals.blips(blips);
    this.logs.blips(blips);
    this.clues.blips(blips);

    this.hud.radar.setBlips(blips);
    this.hud.radar.draw(dt, this.kelpie.position, this.kelpie.yaw);
  }

  /**
   * She met the floor. `speed` is how fast she was closing on it.
   *
   * The silt absorbs rather than bounces, because she is half a tonne of animal
   * meeting mud and not a ball. Losing the horizontal speed as well as the fall
   * is the part that sells it: a crash that only cancels your descent leaves you
   * skating along the bottom at full pelt, which reads as a bug.
   *
   * Hit-stop only for the hard half of the range. On a graze it would register as
   * a dropped frame rather than as weight, and a stutter the player can't explain
   * is worse than no feedback at all.
   */
  _hitSeabed(speed) {
    const I = CFG.impact;
    if (speed < I.minSpeed) return;
    const f = Math.min(1, (speed - I.minSpeed) / (I.hardSpeed - I.minSpeed));

    this.kelpie.velocity.y = 0;
    this.kelpie.velocity.multiplyScalar(1 - I.absorb * f);

    this.rig.addShake(I.trauma * f);
    if (f > 0.5) this.loop.hitStop(I.hitStop * f, I.hitStopScale);
    this.audio?.sfx('thud', { force: f });
    this.pad?.rumble(0.55 * f, 140);

    // From her belly rather than her centre, so the cloud comes off the ground
    // she actually touched.
    const p = this.kelpie.position;
    this.smoke.puff(p.x, p.y - 1.4, p.z, Math.round(I.silt * f) + 2, I.siltSize * (0.5 + f));
  }

  _followEntities(dt) {
    const anchor = this._anchor || (this._anchor = new THREE.Vector3());
    // In series, not in parallel. One rope off her back, and the four of them
    // strung along it — the first holds on, everyone else holds the man in
    // front. It also means rider 0 losing his grip takes the whole line with
    // him, which is the correct and much funnier outcome.
    for (let i = 0; i < this.divers.length; i++) {
      if (i === 0) this.kelpie.gripPoint(anchor);
      else this.divers[i - 1].hitchPoint(anchor);
      this.divers[i].update(dt, anchor, this.kelpie);
    }

    // He is not in frame while you're navigating. The camera sits at his eyeline
    // and his own shoulder has no business blocking the water — visibility is
    // the whole game. He appears when the orbit swings out, which is what turns
    // the bong hit into a reveal of who has been carrying you.
    //
    // The exception is non-negotiable: once he's adrift you have to be able to
    // find him, and hiding the thing the player is required to go and collect is
    // not a camera decision, it's a bug.
    const showDiver = this.rig.orbitWeight > 0.02 || this.diver.adrift;
    for (const d of this.divers) d.group.visible = showDiver;
    // The helmet lens glows go with them. They mark where the flashlights ARE,
    // which is worth seeing when you can see who's holding them and is otherwise
    // four plates of blue light behind your head. The eyes' beam cones stay
    // either way: those are the art, and they're hers.
    if (this.lamp.glow) this.lamp.glow.visible = showDiver;

    // Where the light comes from: her two eyes, then a helmet per rider — and
    // the lead rider's GLOVE once he's holding the lighter, so the one lamp that
    // was ever lit by hand still swings with the hand.
    const srcs = this._lampSrcs || (this._lampSrcs = []);
    while (srcs.length < 2 + this.divers.length) srcs.push(new THREE.Vector3());
    this.kelpie.eyePoint(srcs[0], 0);
    this.kelpie.eyePoint(srcs[1], 1);
    for (let i = 0; i < this.divers.length; i++) {
      const at = srcs[2 + i];
      if (i === 0 && this.heldLighter) this.divers[i].handPosition(at);
      else this.divers[i].helmetPosition(at);
    }
    // Everything points where she's going, leading into the turn rather than
    // being flown separately.
    const aim = this._lampAim || (this._lampAim = { x: 0, y: 0 });
    const steer = this.input.intent.steer;
    aim.x = steer.x * CFG.lamp.aimLead;
    aim.y = -steer.y * CFG.lamp.aimLead * 0.8;
    this.lamp.update(dt, srcs, this.kelpie.quaternion, aim, this.audio?.react);
  }

  /**
   * What, if anything, is pulling her heading around this frame.
   *
   * Only ever a bong you can actually light — being steered at a station you
   * haven't got the baggies for would be worse than no help at all — and never
   * during the cinematic. Strength eases as the square of how close you are, so
   * at the rim it is almost nothing and nobody would call it a tractor beam.
   *
   * One frame stale: nearestBong is set further down update(). At sixty frames a
   * second nobody is going to notice.
   */
  _bongAttract() {
    const b = this.nearestBong;
    if (!b || this.trip.active) return null;
    if (!this.progress.hasLighter || !this.stash.canPack) return null;
    const d = this.nearestBongDistance;
    // Held on almost to the glass. It used to let go at half the use radius,
    // which was fine when that was five units and is a hole now that contact is
    // what fires the thing — the help has to last until you actually touch it.
    if (d > CFG.bong.magnetRadius || d < CFG.bong.hitRadius * 0.6) return null;
    // Only if it's roughly ahead. Being reeled in from behind isn't assistance.
    const to = this._toBong || (this._toBong = new THREE.Vector3());
    to.copy(b.position).sub(this.kelpie.position).normalize();
    if (Math.acos(THREE.MathUtils.clamp(to.dot(this.kelpie.forward), -1, 1)) > CFG.bong.magnetAhead) {
      return null;
    }
    const t = 1 - d / CFG.bong.magnetRadius;   // 0 at the rim, 1 at the bowl
    const a = this._attract || (this._attract = { point: new THREE.Vector3(), strength: 0 });
    a.point.copy(b.position);
    a.point.y += b.useHeight;
    a.strength = CFG.bong.magnetTurn * t;   // linear — see the note on magnetTurn
    return a;
  }

  /**
   * Contact fires it. There is no button.
   *
   * There used to be both: swim into a lit bong and it went off, or press E from
   * anywhere inside the much larger use radius. Two ways to do one thing, and the
   * one nobody used was the one being advertised — the prompt sat on screen
   * during exactly the approach that was already about to trigger the other path.
   * You cannot help running into a station you are steering at, and being told to
   * press a key while you do it reads as the key being required.
   *
   * So the button and its prompt are gone. `useRadius` stays and still does the
   * job it was always better at: it is the range at which the game will tell you
   * what you are missing, which is why a station never silently refuses.
   *
   * The coyote grace went with the button. Its own comment said it only ever
   * answered a real press, and with no press there is nothing for it to forgive.
   */
  _updateBongs(dt) {
    const canUse = this.progress.hasLighter && this.stash.canPack;
    let nearest = null, nearestD = Infinity;

    for (const b of this.bongs) {
      b.update(dt, this.time, canUse, this.audio?.react);
      const d = b.distanceTo(this.kelpie.position);
      b.plume(dt, this.bubbles, this.smoke, d);
      if (d < nearestD) { nearestD = d; nearest = b; }
    }
    this.nearestBong = nearest;
    this.nearestBongDistance = nearestD;

    const inRange = !!nearest && nearestD <= CFG.bong.useRadius;
    if (this.trip.active || !inRange) return;

    // Say what's missing rather than silently refusing.
    if (!this.progress.hasLighter) {
      // Except during the opening. Reaching your first pipe with nothing to
      // light it is not a mistake to be corrected — it's the scene, and the fish
      // is already on its way over to say so. Nagging every frame on top of that
      // just talks over it.
      if (!(this.intro.active && this.intro.step < 2)) {
        this.hud.say('No fire. You need a lighter.', { seconds: 2 });
      }
      return;
    }
    if (!this.stash.canPack) {
      this.hud.say(`Not enough to pack. <b>${this.stash.carried}/${CFG.stash.needed}</b>`, { seconds: 2 });
      return;
    }
    // No stopping, no lining up on the last two metres. You charge a lit bong and
    // the lit bong happens to you.
    if (nearestD <= CFG.bong.hitRadius) this._useBong(nearest);
  }

  _useBong(bong) {
    this.stash.spend();
    this.breath.fill();
    this.trip.start();

    // The exhale: a cloud where the hit happened, and a smaller one off the
    // helmet, since he's the one who was holding it.
    const b = bong.position;
    this.smoke.puff(b.x, b.y + 1.3, b.z, CFG.smoke.puff, 1.8);
    const helm = this._helm || (this._helm = new THREE.Vector3());
    for (const d of this.divers) {
      d.helmetPosition(helm);
      this.smoke.puff(helm.x, helm.y, helm.z, Math.round(CFG.smoke.puff * 0.3), 1.1);
    }

    this.hud.clearSay();
    this.pad?.rumble(0.6, 400);
    this.intro.onBongUsed();
  }

  /**
   * Where rider zero is, for placing his sounds. He has no `position` of his
   * own: he is a rope of segments, and the helmet is the end of it that counts.
   * Lazy scratch field rather than a fresh Vector3 per call, matching the rest
   * of the hot paths in here.
   */
  _diverAt() {
    const v = this._diverPos || (this._diverPos = new THREE.Vector3());
    return this.diver.helmetPosition(v);
  }

  /** Fan uTrip out to everything that reads it. */
  _applyTrip(v) {
    this.post.trip = v;
    this.kelpie.setTrip(v);
    this.diver.setTrip(v);
    this.lamp.setTrip(v);
    this.godrays.setTrip(v);
    this.shoals.setTrip(v);
    for (const b of this.bongs) b.setTrip(v);
  }

  /** Fog, light and colour follow weather and depth together. */
  _applyEnvironment(submersion) {
    const far = this.weather.fogFar();
    this.scene.fog.far += (far - this.scene.fog.far) * 0.02;

    const c = this._fogColor || (this._fogColor = new THREE.Color());
    const deep = this._deepColor || (this._deepColor = new THREE.Color(CFG.fog.deepColor));
    c.setHex(CFG.fog.color).lerp(deep, submersion * 0.7);
    this.scene.fog.color.lerp(c, 0.05);
    this.scene.background.lerp(c, 0.05);
    this.renderer.setClearColor(this.scene.fog.color, 1);

    // Below the cold layer it should feel colder and closer, not unplayable.
    const ls = this.weather.lightScale() * (1 - submersion * 0.3);
    this.hemi.intensity = this._baseLight.hemi * ls;
    this.sun.intensity = this._baseLight.sun * ls;
    this.ambient.intensity = this._baseLight.ambient * ls;

    this.post.panic = this.breath.panic;
  }

  _onBreathState(next) {
    if (next === BreathState.WARN) {
      this.hud.say('Running low. Find a bong.', { seconds: 2.6 });
      this.audio?.sfx('warn');
    } else if (next === BreathState.PANIC) {
      this.audio?.heartbeat(true);
    }
    if (next !== BreathState.PANIC) this.audio?.heartbeat(false);
  }

  // ------------------------------------------------------------------ render

  render(dt) {
    this.post.render(this.scene, this.rig.camera, dt);
    if (this.debug) this._renderDebug();
  }

  _renderDebug() {
    const s = this.post.stats;
    this.hud.showDebug(
      `fps    ${this.loop.fps.toFixed(0)}\n` +
      `calls  ${s.calls}\n` +
      `tris   ${s.triangles}\n` +
      `device ${this.input.activeDevice}\n` +
      `speed  ${this.kelpie.speed.toFixed(1)}  surge ${this.kelpie.surge.toFixed(2)}\n` +
      `breath ${this.breath.value.toFixed(1)} / ${this.breath.max}\n` +
      `uTrip  ${this.trip.value.toFixed(3)} (${this.trip.phase})\n` +
      `bag    ${this.stash.carried}/${CFG.stash.needed}${this.stash.hasShake ? ' +shake' : ''}\n` +
      `grip   ${this.diver.grip.toFixed(0)}${this.diver.adrift ? ' ADRIFT' : ''}\n` +
      `gale   ${this.weather.intensity.toFixed(2)} (${this.weather.state})\n` +
      `clue   stage ${this.clues.stage}${this.clues.proximity ? ' +ping' : ''}` +
      `${this.clues.found ? ' FOUND' : ''} @ ${this.kelpie.position.distanceTo(this.clues.chest.position).toFixed(0)}m\n` +
      `fish   ${this.shoals.schools.filter((s) => s.active).length}/${this.shoals.schools.length} schools\n` +
      `log    ${this.logs.foundCount}/${this.logs.pages.length}\n` +
      `track  ${this.audio?.nowPlaying?.title ?? '—'} (${this.audio?.source ?? '—'})\n` +
      `seed   ${this.seed}`,
    );
  }
}

// Frozen so an accidental write during the cinematic can't leak into real input.
const IDLE_INTENT = Object.freeze({
  steer: Object.freeze({ x: 0, y: 0 }),
  thrust: 0, kick: false, boost: false, interact: false,
  lamp: Object.freeze({ x: 0, y: 0 }),
});
