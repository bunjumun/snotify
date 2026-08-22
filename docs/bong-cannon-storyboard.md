# CR-30 — the bong cannon, storyboarded before any code

His line, QUEUE:

> "Retool bong hit payoff. When the bong is activated I'd like the horse and
> riders to be stretch pulled into the weed bowl of the bong. The bong will then
> react with them inside and then aim the top hole of the bong towards a school
> of fish and launch you into the middle of them like a cannon. behaving similar
> to the canons in super Mario 3d feel free to show me example renders before
> building code for actual mechanism <game"

He explicitly asked for renders before code, so this is that: a written storyboard
grounded in what the game already does, not a build. No code has been touched.

## The find that changes the scope

Read `Game.js`, `Trip.js`, `Kelpie.js` and `Rig.js` before storyboarding anything,
rather than starting from the sentence alone. **The cannon-into-fish mechanic he
is asking for already exists.** `_useBong()` calls `trip.start()`, whose
`onStart` handler already does `this.kelpie.blastOff(into)` where `into` is the
nearest fish school (overhead first, then anything above, then the nearest
school in the lake) — see `Game.js` around the `trip.onStart` assignment and
`Kelpie.blastOff()`. That already gives her an upward velocity kick and steers
her climb toward the school for `CFG.trip.launchSeek` seconds. **What does not
exist is the staging**: nothing currently pulls her toward the bong, holds her
inside it, or frames the moment as aiming and firing. Today the hit is instant —
contact fires it — and the RISE phase (1.5s, everything blooms in) is a colour
and camera bloom, not a place.

So this is not "build a launch-at-fish mechanic." It is **"restage the front of
an existing launch as three beats instead of one instant,"** which is a smaller
job than the line reads, in the same way CR-77's "just swap the ship" undersold
itself in the other direction — reading the code changed the size before any
storyboard could be trusted.

## The three beats

All three live inside what is currently the 1.5s RISE phase of `Trip.js`, before
`HOLD` (today's orbit) begins. `HOLD` and `TAPER` do not need to change; the
psychedelic orbit already works and is a natural "inside the reaction" visual on
its own — beat 2 below proposes reusing it rather than inventing a second orbit.

### Beat 1 — Pulled in (≈0.5s)

Contact still fires it (no button, unchanged). Instead of the bloom starting
immediately, the kelpie's group position lerps from point of contact to the
bowl's mouth (`bong.position` + `bong.useHeight`, which `Bong.js` already
tracks), while a stretch — scale.y up, scale.xz down, snapping back on arrival —
sells the "pulled" read Pillar 2 already asks for elsewhere (mass and drag, not
teleporting). No new geometry: this is a transform animation on the existing
kelpie and rider groups, the same kind of thing `Trip.js`'s own easing curves
already drive. Camera: cuts from chase to a tight framing on the bowl, held by
`Rig`'s existing orbit-weight blend rather than a new camera mode.

### Beat 2 — Inside, reacting (≈1.5–2s)

She and the riders are small, framed inside the glass. This is where the
existing HOLD-phase colour bloom, sparkle burst and phaser sweep belong —
reused, not reinvented, just retimed to read as "the bong reacting" rather than
"the lake reacting." `AudioDirector`'s existing phaser/lowpass sweep already
exists for this moment; nothing new to build there either.

### Beat 3 — Aimed and fired (≈0.5–0.8s)

The bowl's mouth (or the bong's tube exit — `Bong.js`'s glass tube geometry
already has a clear top) orients toward `into.home`, the same fish-school
target `blastOff` already computes. A quick camera whip-pan to line up the shot
(Mario 3D cannon framing: camera behind the cannon, looking down the barrel at
the target before the fire), then `kelpie.blastOff(into)` fires exactly as it
does today — no change to the physics, only to what the player sees lead into
it. She and the riders un-stretch back to normal scale as they leave the bowl.

## What this needs, sized honestly

- **No schema migration, no new dependency, no new page.** Everything above is
  Three.js transforms, existing camera plumbing, and re-sequenced timing on
  values `Trip.js` already owns.
- **Real new work: bowl-mouth aim geometry and the stretch curve.** Getting the
  pull-in and the aim-pan to read as one continuous camera move rather than two
  cuts is the part likely to take real iteration — this is the kind of thing
  that wants to be seen moving, not just described, which is exactly why he
  asked for renders rather than a spec.
- **One open question, his rather than a guess:** whether the fish school
  should always be visible/telegraphed before the cannon fires (so the player
  reads "aimed at that one, there") or whether the reveal should stay a
  surprise the way the climb is today. Mario 3D cannons show the reticle before
  you commit; the current lake blastOff does not warn you which school you are
  headed toward. Which of those two he wants changes how much of Beat 3 needs
  building versus reusing.

## What "renders" means without a build

No prototype was built for this pass — a working preview of a camera move like
Beat 3 is worth more seen moving than described, and building even a throwaway
version means touching `Trip.js`'s live phase machine, which is exactly the
"show me before you touch it" he asked for. This document is the render request
answered honestly: the shape of the three beats, and the one finding (the
launch already exists) that should change how big he thinks this is before he
green-lights it.
