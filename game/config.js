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
    far: 82,
    deepColor: 0x113a42,  // below the thermocline it goes colder and darker
    stormFar: 46,         // Gales of November pull visibility in this tight
  },

  // Underwater light is mostly bounce, so the hemisphere does the heavy lifting
  // and the "sun" is a soft top-down suggestion of a surface far overhead.
  lights: {
    hemiSky: 0x8fe4d2,
    hemiGround: 0x1d453f,
    hemi: 3.4,
    sunColor: 0xe4fbf0,
    sun: 2.6,
    ambient: 0x47908a,
    ambientIntensity: 1.5,
    exposure: 1.25,
  },

  // ---------- Kelpie ----------
  // Not a flying camera. It has mass, it drags, it banks into turns, and its
  // heading lags the stick on a spring — you're steering a large animal that has
  // its own opinions about where it's going.
  kelpie: {
    thrust: 34,
    boostThrust: 78,
    drag: 0.86,           // per-second velocity retention; lower = more water
    addedMass: 1.9,       // resistance to changing direction, not just speed
    maxSpeed: 26,
    boostMaxSpeed: 44,

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
  // snaps taut on boost, which sells "holding on for dear life" for free — and
  // the same solver draws his air hose trailing off into the murk.
  diver: {
    links: 6,
    linkLength: 0.95,
    stiffness: 0.62,      // constraint iterations blend; higher = ropier
    gravity: -1.1,        // he's weighted; boots down
    drag: 0.93,
    solverIterations: 5,

    // Grip. Sustained boost builds strain; past the threshold he lets go and you
    // have to circle back for him. Breath keeps draining while he's adrift, so
    // losing him costs something real.
    gripMax: 100,
    gripStrainPerSec: 34,   // while boosting
    gripRecoverPerSec: 22,  // while not
    regrabRadius: 3.2,
    adriftDrainMult: 1.5,

    hoseLinks: 14,
    hoseLength: 1.4,
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

  // ---------- The trip ----------
  // uTrip (0..1) is the spine of the whole sequence. Post-processing, sparkles,
  // the audio phaser, the lowpass sweep, the camera orbit and the kelpie's mane
  // all read from this one value, so picture and sound bloom and fade as one
  // thing. Tuning the sequence is tuning this curve.
  trip: {
    riseTime: 0.6,
    holdTime: 10.0,       // exactly one camera revolution
    taperTime: 60.0,
    orbitRadius: 16,
    orbitElevation: 4.5,
    orbitRevolutions: 1,
    sparkleRate: 260,     // particles/sec at full intensity
  },

  // ---------- Camera ----------
  camera: {
    fov: 68,
    near: 0.1,
    far: 400,
    followDistance: 13.0,
    followHeight: 3.6,
    followSpring: 4.2,
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

    // Which track drives which layer. These are matched against version/song
    // names returned by get_game_tracks; first substring hit wins, and anything
    // unmatched falls through to the first available track rather than silence.
    layers: {
      calm:    'Mango Tree World',
      tension: null,      // fill in as more mixes get flagged game_ok
      trip:    null,
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
    kelpieFin: 0x2f5c3a,
    kelpieMane: 0x163327,
    kelpieEye: 0xbfd8c4,
    brass: 0xb08d4f,
    canvas: 0x6b6455,
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
