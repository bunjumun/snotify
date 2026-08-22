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

    // Trauma HELD while you lean on the boundary, at full strain and scaled by
    // how hard it is pushing. A hum of unease rather than an impact: large enough
    // to notice and be annoyed by is exactly right, since being annoyed is the
    // message.
    //
    // Was 0.9 and was inert. It was topped up per second against a linear decay
    // of 1.2, which cancels any rate under 1.2 to nothing every single frame, and
    // the cue measured 0.0001 world units of camera offset while looking perfectly
    // correct in the source. It goes through `Rig.sustain()` now, where the number
    // is a floor and means something different, hence the retune: 0.40 measures
    // 0.095 world units of camera displacement, about two thirds of a hard seabed
    // hit, held for as long as you keep leaning on the edge of the world. Squared
    // trauma does the rest — half the strain is a quarter the throw.
    strainTrauma: 0.40,
  },

  // ---------- Flora ----------
  // The kelp bed. One InstancedMesh, swayed in the vertex shader, so the count
  // here costs vertex work and nothing else: no extra draw call, no extra file,
  // no page weight. That is the only reason it can be this generous.
  //
  // Height and width are DELIBERATELY separate numbers. They used to be one
  // scalar with a small width jitter on top, which meant a tall strand was always
  // a wide strand and the whole bed read as one plant photographed at several
  // distances. Real weed does not work like that: a stand can be tall and thin,
  // or squat and broad, and it is the disagreement between the two that stops a
  // field of instanced quads looking instanced.
  flora: {
    count: 860,           // was 520. One draw call either way.
    tries: 6,             // placement attempts per strand before giving up

    // Three classes, DEALT rather than rolled. Rolling each strand independently
    // against these odds is uniform over thousands and lumpy over the few hundred
    // a lake actually plants — the same defect that produced two seeds with no
    // half-jars in them on 2026-08-16. Dealing from a shuffled bag guarantees the
    // mix and leaves the randomness where it belongs: the order, the placement,
    // and the jitter inside each class.
    //
    // `h` is the height multiplier band, `w` the width band, `weight` how many of
    // that class go into the bag. Turf is the floor of the bed, stands are the
    // rare tall ones you can actually navigate by.
    classes: [
      { name: 'turf',  weight: 5, h: [0.35, 0.75], w: [0.75, 1.5]  },
      { name: 'bed',   weight: 8, h: [0.7,  1.5],  w: [0.55, 1.15] },
      { name: 'stand', weight: 3, h: [1.5,  2.9],  w: [0.4,  0.85] },
    ],

    // Lean. A strand planted dead vertical looks pinned; a couple of degrees of
    // permanent tilt off true makes the bed look like it grew rather than got
    // placed. Radians, applied about a random horizontal axis.
    leanMax: 0.22,
    sink: 0.3,            // how far the root is pushed under the seabed surface
    shelfDepth: 4,        // kelp skips anything more than this far below floorY
  },

  // ---------- The record, in the world ----------
  // How hard the ENVIRONMENT moves with the music. Every one of these numbers
  // used to live inside the module that consumed it, which meant "make the world
  // breathe harder" was a hunt through five files.
  //
  // Kept deliberately apart from `CFG.trip` and `CFG.bongHit`, which were calmed
  // on 2026-08-16 and are a different question. Those play over his own record
  // while the screen is already doing the most it ever does; these play while you
  // are simply swimming, and are the whole reason the lake feels like it is
  // listening. Raising one is not a reason to raise the other, in either
  // direction. Do not merge these sections.
  reactive: {
    kelpSway: 1.75,       // was 1.15 baked into Flora's shader — lows, the big bend
    kelpRipple: 0.9,      // NEW: mids, as a wave travelling across the bed
    godrays: 1.6,         // multiplier on the low-band shaft brightness
    motes: 1.5,           // multiplier on the kick push through the particulate
    shoals: 1.45,         // multiplier on how hard the mids turn a school
    ease: 6,              // shared smoothing rate; a snare must not snap the bed
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
  // One button, two verbs, told apart by how long you hold it.
  //
  // TAP is a single tail beat. One press, one shove, and the surge it adds bleeds
  // straight back off, so tapping is how you move slowly and precisely: you pick
  // your way along the wreck one beat at a time and you can stop on a rib.
  //
  // HOLD is the boost. Keep the button down past holdToBoost and she settles
  // into working the tail continuously, which is the only way to cross open water
  // quickly and the only thing in the game that drains the tank by the second.
  //
  // The two never fight, because a press fires its kick on the rising edge before
  // the hold timer has had a chance to run. Every boost therefore opens with a
  // real beat rather than with the animal simply accelerating.
  kelpie: {
    thrust: 20,
    boostThrust: 48,
    drag: 0.86,           // per-second velocity retention; lower = more water
    addedMass: 1.9,       // resistance to changing direction, not just speed
    maxSpeed: 16,         // what beats alone, without the hold, will give you
    boostMaxSpeed: 27,

    // How long the button has to stay down before a tap becomes a boost. Short
    // enough that committing to a sprint doesn't feel delayed, long enough that
    // deliberate single beats never trip it by accident. Tune this before any
    // other number here: it is the seam between the game's two speeds.
    holdToBoost: 0.22,

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

    // 0.72 put her at seventy-six degrees in a sustained turn — practically on
    // her side. Survivable when the camera watched from behind; not survivable
    // now the camera rides her back and takes a third of the roll with it.
    bankAmount: 0.34,     // how hard yaw rolls the body; ~37 deg at full stick
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

    // ---- How they turn ----
    // Every rider used to slerp toward the SAME quaternion at the SAME rate, so
    // the rope threw four men apart in space while their bodies held parade
    // formation. Three separate fixes, and they are separate on purpose because
    // each is a different lie the old code told.
    //
    // 1. Follow rate falls off down the rope. The man on her back reads her turn
    //    almost at once; the man four links back finds out about it late, which
    //    is what being on the end of a rope actually feels like.
    faceRate: 7.0,        // rider 0; this is the old shared number
    // Multiplied per rider down the line. 0.85 and not lower, which was measured
    // rather than guessed: at 0.62 the last rider follows at 1.7 per second, and
    // on a hard circling turn at full surge he falls a THIRD OF A LAP behind her
    // heading and reads as a man facing backwards. 0.85 gives the tail of the
    // line about 25 degrees of lag at the same speed, which is lag you feel and
    // never mistake for a broken transform.
    faceRateFalloff: 0.85,
    // The hard ceiling on lag, radians. An exponential chase can fall arbitrarily
    // far behind a sustained turn, and it did: a trailing rider was measured 174
    // degrees off her heading on a hard circle, which reads as a man riding
    // backwards rather than as a man being dragged. ~34 degrees is generous
    // enough that the falloff above still does all the visible work and nothing
    // is ever clamped on an ordinary turn.
    faceMaxLag: 0.6,
    // 2. Bank. Roll comes from the sideways component of THAT rider's own chain
    //    velocity, so a hard turn rolls the outside man further than the inside
    //    one and they come out of it at different times. Radians per unit per
    //    second of sideways travel, then clamped.
    //
    //    THE NUMBER IS SET BY WHERE IT SATURATES, not by where it looks nice on
    //    one turn. A sustained circle at maxSpeed throws a rider sideways at
    //    9 to 16 units a second, so at the 0.09 this started at every one of the
    //    four sat pinned against the clamp for a seventh of a hard turn — four
    //    men locked at the same extreme angle, which is the parade formation this
    //    was built to get rid of, arrived at from the other direction. At 0.045 a
    //    hard sustained circle rides around 25 degrees and the clamp is reserved
    //    for a genuine whip.
    bank: 0.045,
    bankMax: 0.6,         // ~34 degrees; past this he reads as falling off
    bankRate: 5.0,        // how fast roll chases the velocity, per second
    // 3. Pitch with rise and fall, so a man being dragged upward noses up rather
    //    than staying flat and sliding through the water like a plank. Weaker
    //    than the bank on purpose: vertical travel is smaller and more constant,
    //    and matching the bank here just makes everyone permanently nose-down.
    pitch: 0.06,
    pitchMax: 0.5,

    // ---- How they look ----
    // Per-rider build variation, as a fraction. 0 is the lead rider's build; the
    // rest are pushed away from it by up to this much on each dimension. Kept
    // modest: these are four men in the same navy-issue suit, not four species,
    // and anything larger reads as a scaling bug rather than as casting.
    varyBuild: 0.16,
    varyDazzle: 0.35,     // how much the dazzle texture's scale varies
    varyBrass: 0.1,       // hue shift on the brass, so helmets are not identical
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

    // Six emitters. Two are her eyes and they are the headlights: narrow, bright
    // and cone-visible, toed slightly out the way headlights are set. Four are
    // the riders' flashlights, wider and softer, fanned so they read as four
    // people on a rope rather than one hot stripe — and with no visible cone,
    // because they're behind the camera and a cone with its apex behind you is
    // just a bar of light across the frame.
    // Not as hot as the old single helmet lamp, and it can't be: that one sat
    // behind the camera and lit things from behind, while these sit on the front
    // of her head and point straight at whatever is hovering in front of you. A
    // guide fish parks five units off the nose, and at 430 it came back as a
    // white hole in the middle of the screen.
    eyeIntensity: 300,
    eyeAngle: 0.34,
    eyeToe: 0.07,         // radians of toe-out per eye

    // Colour. The plasma arc is a cold blue-white and six of them is a lot of
    // one note, so each source is pulled toward its own hue: her eyes split
    // green and violet — the green is the same green that's in her — and the
    // riders' helmets run warm tungsten, which is what actually separates
    // "hers" from "theirs" when the orbit swings out and shows you both.
    tintEyeA: 0x74f0c0,   // her left — the green in the mane
    tintEyeB: 0xa79bff,   // her right — colder, violet
    tintHelmet: 0xffb877,  // old filament lamps, warm against all that teal
    tintAmount: 0.6,      // how far from the plasma white each one is pulled

    // And they move with the record. The kick is a transient, so it reads as a
    // flash on the beat; mid is a level, so it reads as the beam breathing.
    beatKick: 0.55,       // extra brightness at the top of a hit
    beatMid: 0.3,         // how much the shaft swells with the mids
    beatTint: 0.5,        // highs push the colour further from white
    // Deliberately faint. Four of them add up, they come from behind the camera
    // where nothing occludes them, and the moment they're bright enough to read
    // as work lights they flatten the fog — which is the whole picture. They are
    // meant to be a wash you notice when it swings, not a light you navigate by.
    helmetIntensity: 85,
    helmetAngle: 0.5,
    helmetSpread: 0.2,    // how far the four fan apart, radians

    // ---- The riders look at things ----
    // The four helmets swing onto findables instead of holding a fixed fan. It
    // is the crew doing what a crew would: four people on a rope, looking around,
    // and one of them notices something in the silt.
    //
    // THE PILLAR THIS MUST NOT BREAK, and it is the hardest rule in the game:
    // "No waypoint, ever. The fog IS the game." (see Clues.js). A beam that
    // swings onto something across the lake is a waypoint with better manners. So
    // a rider may only look at what he could plausibly have SEEN: inside
    // `lookRange`, which is well inside the fog, and roughly in front of her. The
    // chest is never a target at any range — that one belongs to the fish, and
    // the entire clue system exists to keep it there.
    lookAt: true,
    lookRange: 34,        // units; fog reaches 130, so this is arm's length by
                          // comparison and cannot function as a compass
    lookAhead: -0.15,     // min dot with her heading. Slightly behind is allowed,
                          // because a rider IS behind her and something she has
                          // just passed is the most natural thing for him to turn
                          // and look at.
    lookMax: 0.85,        // radians a helmet may swing off its fan position
    lookRate: 2.6,        // how fast a beam crosses onto a target, per second.
                          // Slow: this is a man turning his head, and anything
                          // quick reads as a targeting system.
    lookHold: 1.1,        // seconds a rider stays on a target after it stops
                          // qualifying, so a beam does not flick on and off at
                          // the edge of range
    beamStrength: 0.26,   // the visible shaft, per eye — two of these now

    intensity: 950,       // the reference pair; the ratio below is the dim state
    dimIntensity: 95,
    distance: 66,
    dimDistance: 22,
    angle: 0.46,          // radians, half-cone — the beam cone geometry
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
  // is stocked, and how hard the cold layer bites. An eighth of a bowl is an
  // eighth on every mode — the fractions are the identity of the mechanic, not
  // a difficulty knob. What difficulty moves is how many jars there are.
  //
  // Counts went up by about half when the fractions came in, because a jar is
  // no longer reliably a quarter: at the old counts a level stocked mostly with
  // eighths would have had the player scraping the map for a single bowl. The
  // ratio between the modes is untouched.
  //
  // `baggieReturn` is now the breath returned by a QUARTER, and each jar pays
  // out in proportion (`eighths / 2`). A full bowl's worth of jars therefore
  // still returns exactly what four old baggies did, whatever mix of sizes it
  // arrived in — otherwise a run of eighths would have been worth more air than
  // a run of halves for the same weed, which is backwards.
  difficulty: {
    default: 'medium',
    order: ['chill', 'easy', 'medium', 'hard'],
    modes: {
      chill:  { label: 'Chill',  tank: 260, baggieReturn: 70, baggieCount: 38, thermoMult: 1.00, hints: 'volunteered' },
      easy:   { label: 'Easy',   tank: 180, baggieReturn: 20, baggieCount: 30, thermoMult: 1.15, hints: 'volunteered' },
      medium: { label: 'Medium', tank: 120, baggieReturn: 10, baggieCount: 21, thermoMult: 1.35, hints: 'onRequest' },
      hard:   { label: 'Hard',   tank:  90, baggieReturn:  5, baggieCount: 14, thermoMult: 1.60, hints: 'onRequest' },
    },
  },

  // ---------- Impact ----------
  // What hitting the floor costs.
  //
  // The seabed is the only genuinely hard surface in this game. Everything else
  // slows you: water, current, the boundary. So it is the only place the kelpie
  // can be STOPPED by something, and it was doing that silently — the clamp put
  // her back above the silt and nothing else happened at all.
  //
  // Everything below scales off one number, the closing speed, so a graze and a
  // nose-dive are the same event at two strengths rather than two behaviours with
  // a threshold between them that the player can feel as a switch.
  impact: {
    minSpeed: 6,          // under this it's a landing, not a crash. No reaction.
    hardSpeed: 26,        // at or past this, everything is at full strength
    absorb: 0.55,         // fraction of remaining speed eaten by the silt
    trauma: 0.55,         // camera trauma at a hard hit
    hitStop: 0.07,        // seconds at a hard hit — about four frames
    hitStopScale: 0.05,
    silt: 14,             // particles thrown up at a hard hit
    siltSize: 1.5,
  },

  breath: {
    idleDrain: 1.0,       // multiplier applied to real seconds

    // The hold. This is the fast way across open water and the only thing that
    // bills you purely for time, so it is the number that sets how far a lungful
    // of air will carry you.
    boostDrain: 2.1,

    // What one tail beat takes out of the tank, in seconds of air. Every beat
    // costs, held or tapped, because the animal is doing the same work either
    // way — you simply see it charged one beat at a time when you tap.
    //
    // Picking your way along at roughly a beat a second costs well under the
    // hold, which is what makes slow, deliberate swimming the cheap option it
    // ought to be. Mashing costs MORE than holding, and that is deliberate: if
    // hammering the button were the efficient way to travel, the hold would be
    // decoration and every player would arrive at the wreck with a sore thumb.
    kickCost: 0.35,

    warnAt: 30,           // HUD pulse, filter tightens, vignette starts closing
    panicAt: 10,          // heartbeat, desaturation
    sinkSpeed: 5.5,       // how fast the kelpie falls once the tank is empty
  },

  stash: {
    // ---------- What a jar is worth ----------
    // A bowl is measured in EIGHTHS, not in jars. Every jar used to be worth
    // exactly a quarter, so "four jars" and "one bowl" were the same sentence
    // and the number on the HUD was really a jar count wearing a fraction's
    // clothes. Now a jar carries an eighth, a quarter or a half, so what you
    // are holding is an amount and the jars are how it arrives.
    //
    // Integers throughout, deliberately. Eight eighths and a jar worth 1, 2 or
    // 4 of them means no float ever reaches a comparison — 0.125 * 8 is not 1
    // in binary and a bowl that refuses to pack at 8/8 would be an unfindable
    // bug for exactly the reason nobody would look for it.
    needed: 8,            // eighths per bowl — constant across all difficulties
    // Weighted to the small end so more jars are genuinely needed rather than
    // just present: the expected jar is 1.85 eighths, so a bowl takes about
    // 4.3 jars against the old flat 4. The pace barely moves; the variance is
    // the point. A half is rare enough to feel like luck when the tank is low.
    fractions: [
      { eighths: 1, weight: 0.45, label: '1/8' },
      { eighths: 2, weight: 0.40, label: '1/4' },
      { eighths: 4, weight: 0.15, label: '1/2' },
    ],
    // These weights are DEALT, not rolled — see Stash._rollFraction, which had
    // to stop rolling them because a level of independent draws kept coming out
    // with no halves in it at all. This is the size of the deck that gets dealt:
    // bigger than the jar count on any difficulty, so what is left in the bag is
    // never quite countable, and small enough that the proportions still hold
    // over a single level rather than only over a long session.
    bagSize: 48,
    // How much bigger a half-jar is than an eighth-jar. Was the cube root
    // (1/3), which read as 0.79/1.0/1.26 against the quarter — correct but
    // subtle. Raised at his word ("make jars dimensionally larger in relation
    // to amount"), to 0.79/1.0/1.46 -> now 0.68/1.0/1.46. Still short of
    // linear (0.5/1.0/2.0), which would put an eighth close to a speck inside
    // a pickup radius of 4; this keeps the small jar findable while making the
    // half genuinely read as twice the eighth rather than a fifth larger.
    sizeExponent: 0.55,
    // Grown with the prop rather than left behind it. A baggie was half a unit
    // tall inside a radius of 2.6, so the collision was five times the size of
    // the thing drawn and picking one up felt like it happened *near* the jar
    // rather than *to* it. The jar is about 2.2 tall now and the radius sits
    // just outside it, which is the relationship the player can actually see.
    // This does loosen how tightly the stash can be spaced; it does not touch
    // any movement number, so the Phase 1 gate is unaffected.
    pickupRadius: 4.0,
    respawnDelay: 6,      // seconds before a taken anchor can reseed
    minPlayerDistance: 45,// don't reseed one in the player's lap
    // How far apart two anchors have to be, so one sweep of one area cannot
    // collect four at once. Was 24 and hardcoded in Stash.js. It had to come
    // down when the counts went up: a disc of radius 176 fits maybe 150
    // anchors at 24 units and the seeder wants three per jar, which at 38 jars
    // is 114 and would have had it spinning out its guard loop and quietly
    // returning short. At 18 there is room for roughly twice that.
    anchorSpacing: 18,

    // Weed is the fuel of this planet and it is not only lying in the silt. A
    // third of it settles on the floor; the rest is caught anywhere in the water
    // column, up to well above the wreck. Height above the seabed, in units —
    // the thermocline sits in the middle of that range, so some of the stash is
    // deliberately on the cold side of it.
    floorShare: 0.34,
    riseLow: 4,
    riseHigh: 46,

    bobAmp: 0.22,
    bobFreq: 1.3,
  },

  bong: {
    count: 5,
    // Big. A station you can see across the fog line and steer at from a long
    // way out, rather than a bottle on the seabed you have to go looking for at
    // close range. Scales the whole prop, and useHeight scales with it.
    // Doubled from 2.1: a landmark you navigate by rather than a prop you find.
    scale: 4.2,
    // Hitting it means HITTING it. Swim into the thing and it goes off — no
    // button, no stopping, no lining up. The kelpie is 5.2 units nose to tail
    // and the glass is over 12 tall now, so this is genuinely "you touched it".
    // This is the radius of the COLUMN, not of a ball on the bowl. It used to be
    // a sphere centred on the bowl and that was wrong at both ends: it fired only
    // below about ten units off the floor, so anyone arriving high — which is most
    // of the time, since two thirds of the stash floats 4 to 46 units up — flew
    // straight over the top and got silence, because the game only speaks to say
    // what you are MISSING and they were missing nothing. Doubling the scale would
    // have broken the other end too, lifting the bowl 9.3 up and putting it out of
    // reach of a kelpie clamped 2.0 above the seabed. See Bong.hitTest().
    hitRadius: 5.5,
    // How far above the bowl the column still counts. World units, deliberately
    // not scaled with the prop: this is a gameplay volume tuned against the stash
    // column rather than a proportion of the glass. 22 puts the top of the column
    // 31 up, and the capsule's cap adds hitRadius on top of that, so measured it
    // connects up to about 36 units off the floor and lets go by 46. That is the
    // realistic dive-in covered without making a bong into a chimney you set off
    // while cruising over it on your way somewhere else.
    // It is also what the world already draws — plume() sends bubbles and smoke up
    // from the mouthpiece, so this is "swim through the smoke and it lights".
    hitHeight: 22,
    // Generous on purpose. A bong is a station you swim up to, not a pixel you
    // have to land on — and the reward for reaching it is the best thing in the
    // game, so making the last two metres the hard part is the wrong place to
    // put difficulty. The scarcity is in the eight eighths, which is where it
    // belongs.
    // Twice what it was. With contact firing it anyway, E is for the approach
    // you didn't quite line up — it should be forgiving well before the glass.
    useRadius: 20.0,
    // And measured to the BOWL, not to the silt the stand is buried in. The
    // kelpie is clamped two units off the floor and usually swimming higher than
    // that, so measuring from the base spent most of the radius on the vertical
    // gap before you were anywhere near it horizontally.
    useHeight: 2.2,
    // And they pull, gently. The last twenty metres of lining up on a station is
    // the least interesting steering in the game and the reward for arriving is
    // the best thing in it, so the game helps. Eased as the square of how close
    // you are, so at the rim it is almost nothing and you'd never call it a
    // tractor beam — you'd just say the bongs are easy to hit.
    // Wide, because a correction has to START early. At twenty units you only
    // entered the field at the moment you were already passing, and measurably
    // nothing happened: 17.2 units closest approach with the help, 17.1 without.
    magnetRadius: 42,
    // It bends the HEADING, not the body. A force here does essentially nothing:
    // the fins bite existing momentum back onto the current course faster than
    // any gentle sideways shove can move it, and the first cut of this changed
    // the closest approach by 0.0 units. Turning her instead lets the swimming
    // model carry her in, which is also what "magnetic" actually feels like.
    // Linear in distance, not squared. Squared meant it was still doing almost
    // nothing at fifteen units and only woke up at five, by which point you have
    // already gone past — the correction has to start EARLY to be a correction.
    // Still well under the 1.9 rad/s the stick has, so you always win.
    magnetTurn: 3.0,      // heading spring toward it, rad/s at the bowl
    magnetYield: 0.75,    // how much active steering switches the help off
    // Only helps toward something roughly in front. A magnet that reels you in
    // from behind is not an assist, it's a hand on the tiller.
    magnetAhead: 1.25,    // radians off the nose, beyond which it lets you go
    humRadius: 55,        // audible through the fog well before it's visible

    // The plume. Always running, harder when the thing is packed and lit.
    // Per second, per bong; see Bong.plume(). Kept modest because five of these
    // share a pool with the kelpie's wake and a hit's worth of exhale.
    plumeRadius: 120,     // beyond this the column isn't drawn at all
    plumeBubbles: 4,
    plumeBubblesLit: 7,   // added on top, faded in with the light
    plumeSmoke: 2.5,
    plumeSmokeLit: 4.5,

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

    // Swimming into a shoal makes it talk — but only while a bowl is working.
    // Sober, the schools say nothing; one appointed fish answers the hint button
    // and that is the whole of it. Per school, so circling one doesn't turn it
    // into a chatterbox.
    throughCooldown: 45,
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
    //
    // Past nine it wraps and the commonest five get a second shoal each, which
    // is what a lake looks like and, more to the point, is what makes swimming
    // into fish a thing that happens often enough to be a mechanic. They cost a
    // draw call each and cull at 165 units, and every school rolls its own body
    // proportions, so the second smelt shoal is not the first one again.
    schools: 14,
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
    // Same reasoning as the stash: a slate under a unit across inside a radius
    // of 3 was a target you could not aim at. Both grew together.
    pickupRadius: 4.5,
  },

  // ---------- The trip ----------
  // uTrip (0..1) is the spine of the whole sequence. Post-processing, sparkles,
  // the audio phaser, the lowpass sweep, the camera orbit and the kelpie's mane
  // all read from this one value, so picture and sound bloom and fade as one
  // thing. Tuning the sequence is tuning this curve.
  trip: {
    // **Was 0.6, and that was the whole of "smooth out the visual effect".** The
    // sequence went from nothing to everything — hue, aberration, glow, edge
    // shimmer, the camera leaving her back — inside two thirds of a second, and
    // over a smoothstep, which is only flat at its ends and steepest exactly in
    // the middle where all of that is happening at once. It read as a cut rather
    // than a bloom. At 1.5 the picture opens up over about a bar and a half at
    // most tempos, and the camera has time to swing out rather than jumping.
    //
    // This does NOT lengthen the sequence: the hold is a fixed ten seconds of
    // its own and the taper is a minute. It only spends longer arriving.
    //
    // pullTime is the beat BEFORE this one, added for CR-30: contact stretch-
    // pulls her to the bowl before any of the above starts blooming, so the hit
    // reads as being drawn into the bong rather than detonating on contact.
    //
    // **Was 0.45, and that was too short to see, which is the whole of his note
    // on it.** At his word on 22 Aug the pull is now a shot rather than a snap:
    // the camera swings out wide and makes one full circuit of the horse, the
    // riders and the bong while she is drawn in. A revolution needs time to
    // read — at 0.45s it would have been a whip-pan, which is a different and
    // much worse effect.
    //
    // **Then 2.2 -> 5.5 at his word the same day: "spend more time on the
    // getting pulled into bong and launched part, and make the launch and
    // travel happen faster, so the sequence takes the same amount of time but
    // there is more spent on the bong part."** The total is held exactly: 5.5 +
    // 1.5 rise + 6.7 hold is 13.7s, the same as 2.2 + 1.5 + 10 was. What moved
    // is where the time is spent. The rise was deliberately NOT cut to pay for
    // it — see riseTime below, whose length is the whole of an earlier fix.
    pullTime: 5.5,
    // Of that pull, the share spent getting her to the stem opening. The rest is
    // her travelling through the glass and out the top.
    // **0.34 -> 0.13 at his word, 22 Aug: "have the group go straight to the
    // pipe stem opening as soon as bong is triggered, there is a few second lull
    // before they find their way around."** That lull was this number: 1.9s of
    // being reeled in, on a curve that eased out of nothing, so the first half
    // second after the trigger barely moved them. Now it is 0.7s and the curve
    // starts at full speed (see Trip's PULL case), so the bong takes them the
    // instant it fires. It also buys the inside of the bong another 1.2s, which
    // is where he wanted the time spent anyway.
    pullInFraction: 0.13,
    // How far she draws out while being reeled in, as a fraction of her length.
    // Volume is preserved (see Kelpie.setPullShape), so she thins as she pulls.
    pullStretch: 0.9,
    // Two different shapes inside the bong, not one, at his word on 22 Aug:
    // "they should be smushed against the glass sort of when they are inside,
    // not so tiny once in the bong, just tiny as they pass through the pipe."
    //
    // THE PIPE — the downstem, bore 0.84 across. Nothing goes through that at
    // any appreciable size, so this is the tiny one.
    pullPipeShrink: 0.12,
    // THE CHAMBER — the glass tube, bore 5.2 across at the water and 3.5 at the
    // mouth, and 10.9 tall.
    //
    // **The smush is gone, at his word on 22 Aug: "the horse is still bloating
    // out of the tube boundaries, i'd prefer we go back to tiny characters
    // following a vortex up the stem of the tube inside of the tube's
    // boundaries."** Bulging her girth to press the glass could not be made to
    // work, and the reason is worth keeping: containment clamps where she IS,
    // her POSITION, while the bulge scales how big she is. Put her centre on the
    // axis and swell her past the bore and she is still, correctly, contained —
    // and still visibly outside the glass. Sizing her to fit needs her real
    // silhouette, not her origin, and that is a bounding-volume problem the
    // clamp was never going to solve by tightening a number.
    //
    // Tiny sidesteps it completely: at a fifth of herself nothing she has can
    // reach the glass, so the boundary holds without having to measure her.
    pullChamberScale: 0.2,
    // The vortex she rides up on. Turns are how many times round on the way up,
    // radius is the share of the bore she orbits at, and the spiral tightens
    // toward the mouth on its own so it funnels rather than running parallel.
    pullVortexTurns: 2.5,
    pullVortexRadius: 0.5,
    // The riders' rope shortens to these, so the line of them stays in the
    // glass with her rather than trailing eighteen units out through the side.
    pullPipeReel: 0.12,
    pullChamberReel: 0.3,
    // One full circuit. **Any value is safe to change this to, including a
    // fractional one** — the rig carries wherever the pull left the angle
    // through into the hold as `orbitPhase`, so the two always run on without a
    // seam. Measured rather than assumed: the worst camera step across a phase
    // boundary is 0.288 units at 0.5, 0.75, 1 and 2 revolutions alike.
    //
    // One is a feel choice, not a constraint. It puts the sweep at about 164
    // degrees a second, which is brisk against the hold's 36 — and the contrast
    // is the point, since being yanked into the glass should not move at the
    // same pace as the drift afterwards.
    pullRevolutions: 1,
    // Wide enough to hold the whole tableau. The glass is over 12 tall, the
    // kelpie 5.2 nose to tail, and four riders string out on ~4.5 units of rope
    // behind her, so the thing being circled is roughly 30 across.
    // **40 -> 30 at his word, 22 Aug: "don't zoom quite as far out."**
    pullRadius: 30,
    pullElevation: 14,   // looking down on it a little, not level with it
    // And then it comes IN, once she is in the glass — also his: "give us a
    // view of the squished kelpie and divers inside of the bong tube." The
    // reel-in is the wide shot, the trip up the tube is this one. Close enough
    // to read four riders at a fifth of their size through 42% opaque glass.
    // **9 -> 14 after looking at it:** at 9 the camera was close enough that the
    // base and the water cylinder filled the frame and she was a dark speck
    // behind them. 14 sits outside the glass looking in, which is the shot.
    pullCloseRadius: 14,
    pullCloseElevation: 4,
    riseTime: 1.5,
    // Still exactly one camera revolution, just a quicker one: 10 -> 6.7 to pay
    // for the longer pull without lengthening the whole sequence. The travel it
    // covers was sped up to match (see the launch block below), so she still
    // arrives among the fish well inside it rather than being cut off short.
    holdTime: 6.7,
    taperTime: 60.0,
    orbitRadius: 21,      // wider than it needs to be, on purpose
    orbitElevation: 7.0,
    orbitRevolutions: 1,
    sparkleRate: 520,     // particles/sec at full intensity
    sparkleRadius: 14,    // and how far out from her they spawn
    // How hard the bass onset multiplies that rate. At 2.0 a solid kick trebles
    // the spawn for the frames it lasts, which the accumulator pays out as a
    // visible cluster rather than a slightly denser drizzle. Any lower and the
    // beat is not readable in the particles at all, which was the old behaviour.
    sparkleKick: 2.0,

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
    // **All sped up on 22 Aug at his word ("make the launch and travel happen
    // faster").** The hold that contains this travel came down from 10s to
    // 6.7s to pay for the longer pull, so the climb has to cover the same
    // ground in about two thirds of the time or she would still be on her way
    // up when the camera came home. The ceiling logic is what makes this safe
    // to raise: the climb is a velocity TARGET against a computed ceiling, not
    // a force, so a faster climb still stops where it was always going to stop
    // rather than overshooting through the surface.
    launchKick: 20,       // instant vertical shove on the hit — this is the bang
    launchClimb: 48,      // units/sec she's driven toward while the lift lasts
    launchTime: 2.2,      // seconds a straight-up climb lasts (x3 when school-bound)
    launchArrive: 10,     // how close to the school counts as having arrived
    launchSeek: 5.0,      // seconds she'll chase one before giving up on it
    launchEase: 22,       // units below the ceiling where she starts arriving
    launchSpeed: 36,      // extra speed cap, or the clamp eats the climb
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
    puff: 110,            // particles in the cloud a hit leaves behind
    trailRate: 44,        // particles/sec at full uTrip
    rise: 0.55,           // units/sec it eventually settles into
    life: [5.0, 9.5],     // seconds; long, because it has nowhere to go
    // Strength of the flow field that folds the cloud. Sampled by position, so
    // neighbours move together and it billows instead of fizzing. Push this too
    // far and the smoke starts swimming; 1.5 is about where it stops looking
    // like weather and starts looking like it was blown out of something.
    swirl: 1.35,
    // Max turn rate of a sprite about its own centre, radians/sec, signed.
    spin: 1.1,
    // How much screen area one puff covers. Smoke only reads as a volume when
    // its sprites overlap each other; below about 3 this goes back to looking
    // like scattered dust however many of them there are.
    spread: 4.8,
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

    // Shake, on a trauma model. Callers add trauma and forget; the rig squares
    // it to get the actual offset, which is the whole trick. Linear shake spends
    // most of its life in a mushy middle that reads as a loose camera mount,
    // where squared trauma makes a small knock stay small and a real hit hurt.
    shake: {
      decay: 1.2,         // trauma lost per second, linear
      frequency: 22,      // how fast the noise walks; lower reads as a wobble
      maxOffset: 0.42,    // world units of displacement at full trauma
      maxRoll: 0.10,      // radians of roll at full trauma, past which it spins
    },
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

    // Crossing the layer is an event, and an event needs a latch or it fires on
    // every frame you spend hovering at the boundary — which is exactly where a
    // diver deciding whether to go down spends their time. These are positions
    // in the submersion ramp rather than depths, so the cue moves with `depth`
    // and `thickness` and never needs retuning alongside them.
    //
    // Deliberately far apart: 3.25 units of water you have to genuinely swim
    // back through before it re-arms, so porpoising the boundary cannot chirp at
    // you. Anyone determined enough to do it anyway meets the same ceiling the
    // tail beat has, since trauma clamps at 1 and decays.
    enterAt: 0.80,        // submersion at which you have committed to the cold
    exitAt: 0.15,         // ...and at which you are back out of it

    // Down is a shock, up is relief, so they are not the same number. Below the
    // layer the light goes and the tank drains faster, and the knock going in is
    // the announcement of that price. Coming back up you already know it.
    crossTrauma: 0.40,
    riseTrauma: 0.20,
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

    // The leading edge. Fog and light take the whole rampTime to become legible,
    // which left eight seconds where the lake had already turned and nothing had
    // said so. This knock is what says it: one surge arriving, about a third of a
    // second of it. Sized between the clue ping and losing a rider, because it is
    // news rather than damage.
    onsetTrauma: 0.35,

    // ...and the buffet under it, held for as long as the gale blows. Read off
    // the current's actual magnitude rather than off `intensity`, because the
    // current already pulses: the shake and the shove are then the same water,
    // and the camera surges with the gusts instead of humming flat underneath
    // them. Since the offset goes as trauma squared, that pulse is wide — the
    // lulls are nearly still and the peaks lean on you.
    //
    // Below `world.strainTrauma` on purpose. The boundary is a message you are
    // meant to act on within seconds; a gale is weather you live inside for half
    // a minute, and it must not turn into nausea. Both go through `Rig.sustain()`,
    // which takes the larger of the two rather than their sum, so being blown
    // against the edge of the lake is the worst place to be without ever being
    // worse than the edge alone.
    galeTrauma: 0.26,
  },

  // ---------- Input ----------
  input: {
    deadzone: 0.14,
    responseCurve: 1.8,   // >1 = fine control near centre
    gamepadDeadzone: 0.12,

    // How long a "use" press stays alive looking for something to act on.
    //
    // A press consumed on exactly the frame it happens throws away every press
    // made slightly early, and the player never experiences that as their own
    // timing being off. They experience it as the button not working, which is
    // the single most expensive misreading a control can invite. 110ms is inside
    // the 80-120ms band where a press feels forgiven rather than replayed.
    //
    // Note the tail beat deliberately does NOT get this. A buffered kick would
    // bank credit against the cooldown, and mashing is supposed to hit a ceiling
    // rather than queue up. See the kick block in Kelpie.update().
    //
    // NOTHING CONSUMES THIS AT PRESENT. The bong was the only use verb in the
    // game and it fires on contact now, so the buffer is armed every press and
    // read by nobody. Kept rather than deleted because the machinery is correct
    // and tested and the next thing worth pressing a button at will want it; if
    // no such thing arrives, this and the InputBus interact plumbing should go
    // together. `useGraceMs` did NOT survive the same cull: coyote time only
    // ever existed to forgive a press, so with no press there was nothing left
    // for it to do.
    bufferMs: 110,

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

    // ---------- Rumble ----------
    // One scale over every one-shot in the game rather than five retuned call
    // sites. The call sites already encode what matters, which is their weight
    // RELATIVE to each other: a seabed slam at 0.8 against a thermocline knock
    // at 0.35 is a judgement worth keeping. They were simply all too strong in
    // absolute terms, and one number fixes that without relitigating any of it.
    rumble: {
      scale: 0.55,

      // The record in your hands. Driven by the analyser's `kick` (the onset)
      // rather than `low` (the level), for the same reason the analyser itself
      // gives: a level makes things glow, an onset makes them hit, and a hand
      // feels a beat far better than it feels a volume.
      //
      // Capped low on purpose. This is a hum under the impacts, not a competitor
      // to them: at musicMax the bass is still well below the quietest one-shot.
      musicMax: 0.22,
      // Gamepad haptics have no "sustain" primitive, so a continuous effect is
      // really a series of overlapping short ones. The effect must outlast the
      // gap that follows it or the rumble strobes.
      musicEveryMs: 100,
      musicHoldMs: 160,
      // A one-shot silences the music rumble for its duration plus this. Without
      // it the next re-arm lands on top of a seabed slam and cuts it in half:
      // playEffect REPLACES whatever is running rather than mixing with it.
      musicYieldMs: 90,
    },
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

      // How early to hand the next track to the idle deck so preload='auto' has
      // somewhere to put it. Assigning `src` is what starts the download, and it
      // used to happen at the exact instant the fade opened, so every transition
      // faded up into a track that had not received a byte. On a phone on mobile
      // data that is the worst possible moment to be buffering. Twenty seconds is
      // enough for a mix to get a head start without holding a second stream open
      // for a meaningful part of every track.
      preload: 20,
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
    //
    // maxWet came down from 0.85. At that depth the phaser stopped being an
    // effect over the record and became the record's replacement: the sweep ate
    // the mids for the whole hold, and a band's own song is not something to
    // wash out for ten seconds. At 0.6 the whoosh still reads clearly as the
    // hit landing and you can still hear what is playing underneath it, which
    // is the entire point of pillar 3.
    // The phaser over the record during a hit. `maxWet` came down from 0.6 with
    // the rest of the hit, then again at his word after playing it
    // ("reduce wetness or phaser on audio track as well"): 0.42 -> 0.28. At
    // 0.28 the sweep still reads as motion over the mix rather than under it,
    // and the mix is the one thing here that is not ours to smear.
    phaser: { stages: 6, rateHz: 0.28, depth: 1100, baseFreq: 340, feedback: 0.55, maxWet: 0.28 },

    // ---------- The bong hit ----------
    // The bubble of the pull itself. Turned down at his word: it was 22 bubbles
    // at a flat 0.16 across 1.2 seconds, all of them equally loud, which arrives
    // as a wall rather than as somebody taking a hit. Start here if it is still
    // too much — `gain` is the level of the first bubble and everything else
    // follows from it.
    bongHit: {
      bubbles: 14,        // was 22
      gain: 0.085,        // was 0.16, a flat level for the whole run
      tailGain: 0.35,     // the last bubble, as a fraction of the first
      spacing: 0.062,     // seconds between bubbles; 14 x 0.062 is ~0.87s total
      attack: 0.018,      // was 0.008, which put a click on the front of each
    },

    reverb: { seconds: 3.2, decay: 2.4, wet: 0.22 },
    analyser: { fftSize: 512, smoothing: 0.78 },

    // ---------- Spatial ----------
    // Where a sound is, relative to her. The listener is the KELPIE, not the
    // camera: pillar 2 says you steer an animal rather than a camera, and the
    // camera rides a spring whose lag would smear every pan into mush.
    //
    // Hand-rolled from a stereo panner, a gain and a filter rather than a
    // PannerNode. The 3D listener API is split across browsers (positionX as an
    // AudioParam on some, the deprecated setPosition on others) and this game's
    // whole distribution property is working first time in a phone's in-app
    // browser. Three cheap nodes we control beat one node we have to feature-
    // detect.
    spatial: {
      // Where falloff starts. Tied conceptually to fog.far (130): a sound from
      // the edge of what you can see should be at the edge of what you can hear,
      // so vision and audio agree about how big the lake is.
      refDistance: 14,      // full level inside this
      maxDistance: 130,     // matches fog.far — inaudible past what you can see
      // Never hard-panned. On headphones a full pan is disorienting rather than
      // informative, and on the phone speaker most of this plays through it is
      // thrown away entirely.
      maxPan: 0.75,
      // Water eats the top end long before it eats the level, which is why a
      // distant sound reads as distant even at matched volume. Interpolated in
      // log space for the reason the choke documents below.
      muffleNear: 18000,    // Hz at the listener
      muffleFar: 700,       // Hz at maxDistance
    },

    // ---------- The cold layer ----------
    // config.thermocline promises "more muffled audio" below the layer and for a
    // long time nothing implemented it. The trap is reaching for the lowpass
    // below, which would wreck the one cue this file is emphatic about: when you
    // hear the RECORD go muffled, you are drowning. Two different states cannot
    // share one signal.
    //
    // So the cold layer gets its own filter, on ambience and SFX only, and the
    // music bus passes it untouched. Pillar 3 agrees from the other direction:
    // the album plays straight through and does not go dull because you swam
    // deep. Below the layer the LAKE goes quiet and dull around a record that
    // carries on exactly as it was.
    thermo: {
      muffleOpen: 20000,    // above the layer, effectively bypassed
      muffleDeep: 1100,     // fully below it
      ambienceDuck: 0.45,   // and the bed itself pulls back this far
    },

    // ---------- Heartbeat ----------
    // It used to be a fixed 900ms interval at fixed pitch and level, so the first
    // moment of panic and the last breath sounded identical. A heart that speeds
    // up as the tank empties is the most legible dying cue there is and it costs
    // nothing. Driven by breath.panic, which is already 0..1 across the band.
    heartbeat: {
      slowBpm: 54,          // at the moment panic starts
      fastBpm: 132,         // at an empty tank
      quietVol: 0.30,
      loudVol: 0.62,
      baseHz: 64,           // the thump, which also rises a little with panic
      riseHz: 18,
    },

    // ---------- Ducking ----------
    // The music dips under the sounds that carry information. Web Audio's
    // compressor has no sidechain input, so this is volume automation rather
    // than a true sidechain.
    //
    // The attack is deliberately NOT the 10ms the mixing literature gives for
    // ducking dialogue: that is written for speech over a loop, and on a real
    // record a dip that fast clicks. 45ms is under the ear's threshold for the
    // dip itself while still getting out of the way in time.
    //
    // Which sounds duck is the whole design. The tail beat must NEVER duck: it
    // fires several times a second and ducking on it turns the album into a
    // pumping mess. See the DUCKS set in AudioDirector.
    duck: {
      amount: 0.55,         // music bus multiplier while a cue is speaking
      attack: 0.045,
      release: 0.35,
    },

    // ---------- Flow ----------
    // Water moving past her. The boost had a beat per kick and no sense of speed
    // at all, which is half of "the fins bite" missing. Quiet and on the ambience
    // bus, so the listener's own ambience slider covers it and it sits under the
    // bed rather than over it.
    flow: {
      atSpeed: 22,          // speed at which it reaches full
      maxGain: 0.30,
      freqNear: 220,        // bandpass centre at a standstill
      freqFar: 900,         // ...and at full pelt, so it brightens as it rises
    },
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
    // The fins are the one place the reference lets real colour in: the membrane
    // is a bright sea-green against an otherwise near-black animal, and the dark
    // rays are drawn into it by the shader rather than modelled.
    kelpieFin: 0x3d8a55,
    // Near-black, and flatter than the hide. The feelers read as silhouette at
    // every distance, which is the only way a wire that thin survives the fog.
    kelpieBarbel: 0x101a14,
    // Lighter than her hide on purpose. She reads as a silhouette against bright
    // water, and weed the same value as the body is weed nobody ever sees.
    kelpieMane: 0x35664a,
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
