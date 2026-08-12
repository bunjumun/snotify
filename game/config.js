// Lakehorse Swimulator — every tunable in the game, in one file.
//
// Nothing here is computed and nothing here is clever. If a number governs how
// the game feels, it belongs in this file so it can be found and changed without
// reading any of the systems that consume it. Modules import CFG and read from
// it; they never hardcode a magic number of their own.

export const CFG = {

  // ---------- World ----------
  // A bowl, not a box. The playfield is bounded by current that shoves you back
  // (see world/Bounds.js) rather than by an invisible wall, so the edge of the
  // level reads as "the lake keeps going" instead of "the map stopped".
  world: {
    radius: 200,          // soft boundary begins here
    boundarySoftness: 40, // over how many units the push-back ramps to full
    boundaryForce: 14,
    floorY: -60,          // seabed sits around here, displaced by noise
    surfaceY: 40,         // the far-off surface, mostly a light source
    seed: null,           // null = random per run; ?seed= in the URL overrides
  },

  // Superior is cold, green and close. Visibility is the single biggest lever on
  // both mood and framerate: everything past `fogFar` is culled, so the art
  // direction and the performance budget are the same decision.
  //
  // The haze is deliberately BRIGHTER than the things in it — that's the read in
  // every one of the reference wreck photos. Dark subject, luminous water. Making
  // the fog dark instead just produces a black screen with a horse in it.
  fog: {
    color: 0x2a6f6a,
    near: 4,
    far: 130,             // how far you can see, and therefore how much is drawn
    deepColor: 0x113a42,  // below the thermocline it goes colder and darker
    stormFar: 70,         // a gale pulls visibility in this tight
  },

  // Underwater light is mostly bounce, so the hemisphere does the heavy lifting
  // and the "sun" is a soft top-down suggestion of a surface far overhead.
  lights: {
    hemiSky: 0x8fe4d2,
    hemiGround: 0x1d453f,
    // Raised to carry the world on its own now the lamp is off. Underwater light
    // is overwhelmingly bounce anyway, so pushing the hemisphere and the ambient
    // is the physically honest way to do it — brighter water, not a brighter sun.
    hemi: 4.4,
    sunColor: 0xe4fbf0,
    sun: 3.0,
    ambient: 0x4e9a93,
    ambientIntensity: 2.0,
    exposure: 1.28,
  },

  // ---------- Kelpie ----------
  // Not a flying camera. It has mass, it drags, it banks into turns, and its
  // heading lags the stick on a spring — you're steering a large animal that has
  // its own opinions about where it's going.
  //
  // Cruising is deliberately slow. Holding the swim button is a resting swim —
  // it gets you there eventually. Speed comes from TAPPING it: every press is a
  // tail beat that shoves you forward and adds to a surge, and the surge bleeds
  // off the moment you stop working for it. A held button that travels as fast
  // as a worked one turns a lake into a corridor.
  kelpie: {
    thrust: 20,
    boostThrust: 48,
    drag: 0.86,           // per-second velocity retention; lower = more water
    addedMass: 1.9,       // resistance to changing direction, not just speed
    maxSpeed: 16,         // cruise: what holding the button alone will give you
    boostMaxSpeed: 27,

    // Tail beats. kickCooldown is not a nerf — a mashed key fires faster than
    // the physics step, and without a floor a tap becomes a teleport.
    kickImpulse: 7.5,     // instant push along forward, per beat
    kickCooldown: 0.15,   // seconds; beats closer together than this don't count
    kickSurge: 0.4,       // surge gained per beat, capped at 1
    kickDecay: 0.5,       // surge lost per second — ~1.3 beats/sec holds it full
    kickSpeedBonus: 15,   // added to maxSpeed at full surge, so worked > held
    kickThrustBonus: 26,  // and to acceleration, so a surge feels urgent

    yawRate: 1.9,         // radians/sec at full stick
    pitchRate: 1.4,
    pitchClamp: 1.15,     // ~66°, stops the horizon flipping over

    bankAmount: 0.72,     // how hard yaw rolls the body
    bankSpring: 5.0,
    headingSpring: 6.5,   // body catching up to intent
    headingDamp: 0.82,

    // Vertex-shader undulation. Amplitude scales with speed so it swims rather
    // than wriggling in place.
    undulateFreq: 3.4,
    undulateAmp: 0.30,
    undulateSpeedScale: 0.055,

    length: 5.2,
    girth: 1.35,
  },

  // ---------- Diver ----------
  // A verlet chain, not an animation. He trails, swings wide on hard turns and
  // snaps taut on boost, which sells "holding on for dear life" for free.
  //
  // They ride ABOVE her, not behind and below: men who were on her back, can't
  // stay on, and are now streaming off it on ropes. Hence BUOYANT, not weighted.
  // A long rope and negative gravity gave a man being dragged along the bottom,
  // which is a different and much sadder picture.
  //
  // The rope can be generous because none of the four is ever in frame while
  // you're navigating — they only appear when the bong orbit swings out (see
  // Game._followEntities). Length here buys a better reveal, and costs nothing.
  diver: {
    links: 6,
    linkLength: 0.75,     // ~4.5 units, so the four of them string out on the orbit
    stiffness: 0.88,      // constraint blend; higher = stiffer, less springy
    gravity: 0.4,         // he floats — the suit has air in it — but gently
    drag: 0.965,          // damps the bob. He should ride, not bounce.
    solverIterations: 5,

    // Grip. Sustained boost builds strain; past the threshold he lets go and you
    // have to circle back for him. Breath keeps draining while he's adrift, so
    // losing him costs something real.
    gripMax: 100,
    gripStrainPerSec: 34,   // while boosting
    gripRecoverPerSec: 22,  // while not
    regrabRadius: 3.2,
    adriftDrainMult: 1.5,
  },

  // ---------- Lamp ----------
  // Gives the fog a job and the diver something to do. Its cone is also how you
  // find a half-buried baggie or the glint off the lighter.
  // NOTE ON UNITS: since three r155 point and spot lights are physical — intensity
  // is candela and falls off with distance squared. A value of "2.6" that looked
  // sane in older Three is invisible now; useful numbers are in the hundreds.
  // Directional/hemisphere/ambient are still the old small numbers. Mixing the two
  // conventions up is the reason a scene comes out pitch black.
  // The lamp has two states, and the difference between them is the opening's
  // whole payoff. Before the lighter it's a feeble glow that barely reaches past
  // the diver; after, it's a real beam. You don't get told the world got bigger,
  // you watch it happen.
  lamp: {
    // The beam is back, but it no longer has its own axis. It points where she
    // is going and leads a little into a turn, so it lights the water you are
    // about to be in — one less thing to fly. The lens glow stays hidden while
    // you're navigating (see Game._followEntities): with the camera at the
    // diver's eyeline the light source is a hand's breadth from the lens, and
    // the glow sprite there is a dinner plate of blue in the middle of the view.
    enabled: true,
    aimLead: 0.5,         // how far the beam leads a turn, 0 = dead ahead
    color: 0xbcd8ff,      // plasma arc — cold blue-white, and it pops off the teal
    dimColor: 0x7f9aa8,   // the dead helmet lamp before a fish brings you fire
    intensity: 950,
    dimIntensity: 95,
    distance: 66,
    dimDistance: 22,
    angle: 0.46,          // radians, half-cone
    dimAngle: 0.62,       // wider and weaker — a haze, not a beam
    penumbra: 0.6,
    decay: 1.35,          // <2 so the beam carries further than physics would allow
    litTime: 1.8,         // seconds for the flare-up when the lighter arrives
    flicker: 0.09,        // it's a flame now, so it breathes
    aimSpring: 9.0,
    glintDot: 0.965,      // how centred a pickup must be to sparkle back
  },

  // ---------- Breath & the baggie economy ----------
  // Difficulty scales the tank, what a baggie gives back, how densely the level
  // is stocked, and how hard the cold layer bites. Four baggies to pack a bowl
  // never changes — that's the identity of the mechanic, not a difficulty knob.
  difficulty: {
    default: 'medium',
    order: ['chill', 'easy', 'medium', 'hard'],
    modes: {
      chill:  { label: 'Chill',  tank: 260, baggieReturn: 70, baggieCount: 26, thermoMult: 1.00, hints: 'volunteered' },
      easy:   { label: 'Easy',   tank: 180, baggieReturn: 20, baggieCount: 20, thermoMult: 1.15, hints: 'volunteered' },
      medium: { label: 'Medium', tank: 120, baggieReturn: 10, baggieCount: 14, thermoMult: 1.35, hints: 'onRequest' },
      hard:   { label: 'Hard',   tank:  90, baggieReturn:  5, baggieCount:  9, thermoMult: 1.60, hints: 'onRequest' },
    },
  },

  breath: {
    idleDrain: 1.0,       // multiplier applied to real seconds
    boostDrain: 2.1,
    warnAt: 30,           // HUD pulse, filter tightens, vignette starts closing
    panicAt: 10,          // heartbeat, desaturation
    sinkSpeed: 5.5,       // how fast the kelpie falls once the tank is empty
  },

  stash: {
    needed: 4,            // baggies per bowl — constant across all difficulties
    pickupRadius: 2.6,
    respawnDelay: 6,      // seconds before a taken anchor can reseed
    minPlayerDistance: 45,// don't reseed one in the player's lap
    bobAmp: 0.22,
    bobFreq: 1.3,
  },

  bong: {
    count: 5,
    useRadius: 4.0,
    humRadius: 55,        // audible through the fog well before it's visible
    hueWhenReady: 0x7de08a,
    hueWhenDark: 0x2c3a38,
  },

  // ---------- The chest ----------
  // Seeded, so ?seed= reproduces where it is. It is never placed in open water:
  // the anchors are all next to something you'd have gone to look at anyway, so
  // finding it feels like having explored rather than having been given a number.
  chest: {
    openRadius: 4.5,
    glowRadius: 26,       // how close before it starts showing itself at all
    beaconRadius: 9,      // and where it stops being subtle about it
  },

  // ---------- Clues ----------
  // Three stages, coarse to fine, each one a different fish. Nobody hands you a
  // waypoint — the fog is the game, and an arrow through it throws that away.
  //
  //   0  a bearing and a distance band            "a long way to the north-west"
  //   1  a landmark it's near                     "in the shadow of the broken boiler"
  //   2  a proximity ping from the sturgeon       warmer / colder, live
  //
  // askCooldown stops the hint button being a substitute for looking, without
  // ever refusing outright — a fish that won't talk to you is just a locked door.
  clues: {
    stages: 3,
    askCooldown: 12,      // seconds between hints
    volunteerAt: 0.45,    // Chill/Easy volunteer a hint below this much breath
    proximityNear: 55,    // the sturgeon's ping starts reading inside this
    pingInterval: 2.2,
    guideLifetime: 40,    // a summoned guide fish drifts off after this long

    // Sober, one fish talks to you, on a long cooldown, working through the
    // three clues in order. High, the whole lake is willing: any school nearby
    // will answer, the clue is the good one, and after that they start telling
    // you what they know about the horse. It costs a bowl and it wears off,
    // which is the only reason it can be this generous.
    highAt: 0.08,         // uTrip above which every fish will talk
    highRadius: 75,       // how close a school has to be to be worth asking
    // Shorter than the sober cooldown because the window is short and paid for,
    // but long enough that asking again doesn't cut the diver off mid-answer.
    highCooldown: 6,
  },

  // ---------- Fish ----------
  // Boids, one InstancedMesh per species, so a few hundred fish are a handful of
  // draw calls. They aren't decoration: schools tighten in loud passages, which is
  // the most visible thing the analyser does to the world.
  fish: {
    // One per species, so the whole roster in world/Species.js actually turns up
    // — including the three at the end of the list (siscowet, burbot, lamprey)
    // that a smaller budget would have quietly cut. Low quality halves it.
    // School sizes come from the species rows, not from here.
    schools: 9,
    neighbourRadius: 5.5,
    separation: 2.0,
    weights: { separation: 1.5, alignment: 0.55, cohesion: 0.5, home: 0.35, avoid: 2.6 },
    avoidRadius: 11,      // how close the kelpie gets before a school breaks
    speed: [2.4, 6.5],
    turnRate: 2.2,
    reactTighten: 0.55,   // how much a loud passage pulls a school in
    cullDistance: 165,    // schools past this stop updating; keep it > fog.far
  },

  // ---------- Ship's log ----------
  logPages: {
    count: 7,
    pickupRadius: 3.0,
  },

  // ---------- The trip ----------
  // uTrip (0..1) is the spine of the whole sequence. Post-processing, sparkles,
  // the audio phaser, the lowpass sweep, the camera orbit and the kelpie's mane
  // all read from this one value, so picture and sound bloom and fade as one
  // thing. Tuning the sequence is tuning this curve.
  trip: {
    riseTime: 0.6,
    holdTime: 10.0,       // exactly one camera revolution
    taperTime: 60.0,
    orbitRadius: 21,      // wider than it needs to be, on purpose
    orbitElevation: 7.0,
    orbitRevolutions: 1,
    sparkleRate: 520,     // particles/sec at full intensity
    sparkleRadius: 14,    // and how far out from her they spawn

    // The blast off. A hit fires her straight up out of the dark, and she keeps
    // climbing through the orbit — so the ten seconds you can't steer are spent
    // watching the wreck drop away underneath you instead of watching a camera
    // circle a stationary horse. `rise` is capped relative to where the hit
    // happened so a bowl smoked in the trench still ends somewhere you can see,
    // and one smoked in open water doesn't put you through the surface.
    // The climb is a velocity TARGET, not a force. A force plus a hard ceiling
    // overshoots by everything the momentum is still carrying — the first cut of
    // this launched her ninety-six units on a fifty-two unit budget and nearly
    // put her through the surface. Steering the velocity instead means the
    // ceiling is where she actually stops.
    launchKick: 14,       // instant vertical shove on the hit — this is the bang
    launchClimb: 30,      // units/sec she's driven toward while the lift lasts
    launchTime: 3.2,      // seconds a straight-up climb lasts (x3 when school-bound)
    launchArrive: 10,     // how close to the school counts as having arrived
    launchSeek: 8.0,      // seconds she'll chase one before giving up on it
    launchEase: 16,       // units below the ceiling where she starts arriving
    launchSpeed: 22,      // extra speed cap, or the clamp eats the climb
    launchRise: 52,       // how far above the hit she can get
  },

  // ---------- Smoke ----------
  // The exhale. A hit leaves a cloud hanging in the water where it happened, and
  // the pair drag a trail of it for as long as the trip lasts — thinning with
  // uTrip, so the comedown is something you can watch drift off behind you
  // rather than only a grade on the lens.
  //
  // Underwater smoke does not plume. It hangs, spreads and goes nowhere fast,
  // which is why `rise` is small and the lifetimes are long.
  smoke: {
    puff: 54,             // particles in the cloud a hit leaves behind
    trailRate: 30,        // particles/sec at full uTrip
    rise: 0.55,           // units/sec it eventually settles into
    life: [5.0, 9.5],     // seconds; long, because it has nowhere to go
  },

  // ---------- Camera ----------
  // The view is the DIVER'S. He is floating just off her back on a short rope,
  // so the camera sits at his eyeline and looks out past her head: first person
  // for him, third person for her, one pose. Nobody has to be told who they are.
  //
  // Which is also what makes the bong orbit land. It is the only time the camera
  // leaves him, and what it reveals as it swings out is how the two of them are
  // actually arranged — the horse, the rope, the man on the end of it. You have
  // been looking down that rope the whole game without seeing it.
  //
  // The offsets are in HER frame, not his actual verlet position: he bobs, and a
  // camera bolted to a rope simulation is a camera nobody can look through.
  camera: {
    fov: 68,
    near: 0.1,
    far: 400,
    // Above and slightly FORWARD of where he floats, so he is behind the lens
    // rather than in front of it. He buoys up and back on the rope, and every
    // offset that sat level with him or aft of him ended up either staring at
    // him or inside his suit. This is his eyeline, a foot in front of the glass.
    rideHeight: 3.0,      // high enough that she sits in the bottom third
    rideBack: 1.4,        // forward of where he floats (~2.0), so he is not
                          // the subject — his shoulder in the corner is plenty
    rideLookAhead: 16,    // look out this far past her head...
    rideLookHeight: 1.4,  // ...at about this height. Her back, neck and the back
                          // of her head take the bottom third; the rest is water
                          // you are about to swim into, which is the bit that
                          // matters when visibility is the whole game.
    // Tighter than a chase camera wants to be. The spring lag is what pulls the
    // view back off him at speed, and past about 4 that stops being "the ride
    // has weight" and starts being "why am I watching this man from behind".
    followSpring: 8.0,
    lookAhead: 4.0,       // bias the look target into velocity
    modeBlendTime: 0.9,   // FOLLOW <-> ORBIT, eased so it never cuts
  },

  // ---------- Thermocline ----------
  // Superior's cold layer, made visible. Below it: colder grade, faster drain,
  // more muffled audio. Gives the world a vertical axis with real stakes.
  // Has to sit INSIDE the playable band, not above it. The seabed lives around
  // -45 to -75 and the wreck sits on it, so a boundary at -22 would put the
  // entire level permanently on the cold side — every light dimmed, every run in
  // the dark, and no decision to make. At -52 the wreck field is in ordinary
  // water and the trench below is a choice with a price.
  thermocline: {
    depth: -52,
    thickness: 5,
    shimmerSpeed: 0.35,
  },

  // ---------- Weather ----------
  weather: {
    calmMin: 70,          // seconds of calm before a gale can roll in
    calmMax: 150,
    galeMin: 25,
    galeMax: 45,
    rampTime: 8,          // eased in and out, never a snap
    currentForce: 9.5,
    lightDim: 0.45,
  },

  // ---------- Input ----------
  input: {
    deadzone: 0.14,
    responseCurve: 1.8,   // >1 = fine control near centre
    gamepadDeadzone: 0.12,

    // Tilt. iOS needs requestPermission() from inside a user gesture (the DIVE
    // IN button does it) and HTTPS. Neutral is captured on start so the phone
    // can be held at whatever angle is comfortable, and screen.orientation.angle
    // is applied or landscape silently inverts both axes.
    tilt: {
      enabled: false,     // parked for now — Tilt.js is written and just needs registering
      sensitivity: 0.045,
      deadzone: 3.0,      // degrees
      clamp: 32,          // degrees from neutral = full deflection
      smoothing: 0.18,
      sensorTimeout: 1000,// ms before falling back to the virtual stick
    },

    touch: { stickRadius: 62, stickDeadzone: 8 },
  },

  // ---------- Audio ----------
  audio: {
    band: 'lakehorse',

    // The record plays start to finish, in the order music.json lists it, and
    // then goes round again. It is NOT cut up into calm/tension/trip stems that
    // swap on game state — a song that jumps to a different song because your
    // breath dipped is a game using music as a status light. The mood still moves
    // (the phaser on a bong, the lowpass as you drown), but it moves as an effect
    // over whatever is playing, so a listener hears the album rather than a
    // soundtrack reacting to them.
    playlist: {
      crossfade: 6,       // seconds of overlap between one track and the next
      shuffle: false,     // running order is the band's, not a shuffle's
      nowPlayingFor: 7,   // how long the title card stays up on a change
    },

    // The song is the point — it's the band's own record. Effects sit under it,
    // never on top of it.
    volumes: { music: 0.85, sfx: 0.38, ambience: 0.22 },

    // The filter is a SIGNAL, not a coating. Running a permanent 800Hz lowpass
    // over the music "sounds underwater" for about ten seconds and then just
    // sounds broken — and it wastes the one moment the effect is actually worth
    // something. So it stays wide open until breath drops under 20%, and then it
    // closes in on you. When you hear the record go muffled, you're drowning.
    lowpass: {
      open: 20000,        // effectively bypassed
      panic: 380,         // fully choked at zero breath
      chokeBelow: 0.20,   // fraction of tank where it starts closing
      q: 0.9,
    },

    // Six cascaded allpass stages with an LFO across them. Wet amount is uTrip,
    // so it swells with the rainbow and bleeds out on the same 60s taper.
    phaser: { stages: 6, rateHz: 0.28, depth: 1100, baseFreq: 340, feedback: 0.55, maxWet: 0.85 },

    reverb: { seconds: 3.2, decay: 2.4, wet: 0.22 },
    analyser: { fftSize: 512, smoothing: 0.78 },
  },

  // ---------- Quality ----------
  // 'auto' picks from devicePixelRatio and a first-second frame sample. Low
  // halves the post-processing buffer, thins the particles and drops god-rays.
  quality: {
    default: 'auto',
    dprClamp: 2,
    levels: {
      low:  { postScale: 0.5, particleScale: 0.4, godrays: false, fishScale: 0.5 },
      high: { postScale: 1.0, particleScale: 1.0, godrays: true,  fishScale: 1.0 },
    },
  },

  // ---------- Palette ----------
  palette: {
    waterTop: 0x2e6f6b,
    waterDeep: 0x04161c,
    kelpieBody: 0x1b2b22,
    // Counter-shading: dark along the back, pale beneath. Kept muted rather than
    // properly pale because the diver's lamp sits BELOW and BEHIND her — a true
    // fish-belly white blows straight out every time he looks up at her.
    kelpieBelly: 0x5d7267,
    kelpieFin: 0x2f5c3a,
    kelpieMane: 0x163327,
    kelpieEye: 0xbfd8c4,
    brass: 0xb08d4f,
    canvas: 0x6b6455,

    // Dazzle, for the diver's suit. Three tones, because two reads as a barcode
    // and four stops reading as a pattern at all.
    suitLight: 0xd9d1bc,
    suitDark: 0x1d2529,
    suitMid: 0x74877e,
    suitAdrift: 0x9a8f78,   // multiplied over the pattern once he's lost his grip
    wreckWood: 0x2a2620,
    silt: 0x3d4a44,
    kelp: 0x2b4a33,
  },
};

// Difficulty resolves through here so every system asks the same question the
// same way, and a mode the user has never picked still returns something sane.
export function modeCfg(name) {
  return CFG.difficulty.modes[name] || CFG.difficulty.modes[CFG.difficulty.default];
}
