// The diver — a verlet chain, not an animation.
//
// He is simulated rope with a man on the end. Nothing about his motion is
// authored: he trails because the solver drags him, swings wide because a turn
// throws him outward, and snaps taut on boost because the constraint says so.
// That gets "holding on for dear life" for roughly the cost of a for-loop, and it
// stays correct in situations no animator would have thought to cover.
//
// There is no air hose. He had one in an earlier cut, trailing off into the dark
// toward a tender on the surface — which is a beautiful read in the reference
// photos and a lie here. There is no boat up there. There is no up there. His air
// is whatever is in the suit, which is also why he floats.
//
// Grip is the mechanic on top: sustained boost builds strain, past the threshold
// he lets go, and you have to circle back for him while breath keeps draining.
//
// The suit is dazzle-camouflaged, painted procedurally in _dazzleTexture(). It's
// the site's own livery, it's period-correct for a wreck, and practically it
// makes the one thing you have to keep track of legible in eighty units of murk.
//
// FOUR OF THEM, AND THEY ARE NOT THE SAME MAN. This mattered more than it
// sounded. Every rider used to slerp toward the same quaternion at the same rate
// off the same mesh, so the rope threw them apart in space while their bodies
// held parade formation — a rigid object with four heads. Two halves to the fix,
// and they are independent:
//
//   ROTATION. Follow rate falls off down the rope, so the man on her back reads
//   her turn almost at once and the man on the end finds out late. On top of
//   that each one BANKS into his own motion, roll taken from the sideways
//   component of his own chain velocity, and PITCHES with his own rise and fall.
//   None of it is authored; it is all read back out of the solver that was
//   already running, which is the same trick the rope itself is.
//
//   IMAGE. Each rider is built from his index: helmet, collar, boots, shoulder
//   width, arm splay and dazzle scale all shift, plus a small hue push on the
//   brass. Rider 0 is the reference and barely varies, because he is the one the
//   camera, the lamp and the lighter belong to. The variation is deliberately
//   small — four men in the same navy-issue suit, not four species.

import * as THREE from 'three';
import { CFG } from '../../config.js';

/** One verlet particle. */
class Point {
  constructor(x, y, z) {
    this.pos = new THREE.Vector3(x, y, z);
    this.prev = new THREE.Vector3(x, y, z);
    this.pinned = false;
  }
}

/** How far off the glass a rider is held, in world units. */
const WALL_CLEARANCE = 0.15;

export class Diver {
  /**
   * @param {number} [index] which rider on the rope, 0 = the one at her back and
   *   the one everything else is measured against
   * @param {number} [riders] how many there are, so the falloff can be spread
   *   across however many the game decides to run with
   */
  constructor(index = 0, riders = 1) {
    const P = CFG.palette;
    const D = CFG.diver;
    this.group = new THREE.Group();

    this.index = index;
    // A stable signed number per rider, used for every build decision below so
    // one man is consistently the big one rather than being tall in the boots and
    // small in the helmet. Not seeded: which rider is which affects nothing a
    // seed is meant to reproduce, and Rng belongs to worldgen.
    //
    // RIDER 0 IS EXACTLY ZERO, which is the whole point of the shape of this
    // expression and was worth a bug to learn. The obvious `index / (riders - 1)`
    // mapped to -1..1 puts the lead rider at one extreme, so the one man the
    // camera actually looks at, who holds the lighter and carries the lamp, came
    // out as the most distorted of the four. He is the reference silhouette; the
    // other three spread evenly either side of him.
    // The rest ALTERNATE either side of him, with the magnitude growing down the
    // rope. Alternating rather than ramping is the point: neighbours differ most,
    // and neighbours are what you see side by side when the orbit swings out. A
    // straight ramp across -1..1 puts a rider on zero and hands you two identical
    // men, which is the bug this replaced.
    const v = index === 0 ? 0
      : (index % 2 ? 1 : -1) * (0.4 + 0.6 * ((index - 1) / Math.max(1, riders - 2)));
    this._who = v;
    this._build = {
      helmet: 1 + v * D.varyBuild,
      torso: 1 - v * D.varyBuild * 0.55,
      boots: 1 + v * D.varyBuild * 1.3,
      shoulder: 1 + v * D.varyBuild * 0.8,
      armSplay: v * D.varyBuild * 1.4,
    };
    // Follow rate falls off down the rope. The lead rider keeps the old shared
    // number exactly, so nothing about the man you actually look at changed.
    this._faceRate = D.faceRate * Math.pow(D.faceRateFalloff, index);
    this._roll = 0;
    this._pitch = 0;

    this.attached = true;
    this.grip = D.gripMax;
    this.adrift = false;

    // ---- Chains ----
    this.chain = [];
    for (let i = 0; i < D.links; i++) this.chain.push(new Point(0, -8, 40 + i * D.linkLength));
    this.chain[0].pinned = true;

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    // Scratch for the prone pose. Allocating these per frame is how you hand the
    // GC a stutter on a phone.
    this._fwd = new THREE.Vector3();
    this._down = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._basis = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    // Bank and pitch scratch. The two axes are constants in his own model space,
    // never mutated, and the two quaternions are rewritten in place each frame.
    this._vel = new THREE.Vector3();
    this._lean = new THREE.Quaternion();
    this._nose = new THREE.Quaternion();
    this._bodyAxis = new THREE.Vector3(0, 1, 0);  // head to boots
    this._sideAxis = new THREE.Vector3(1, 0, 0);  // across the shoulders

    // ---- Materials ----
    // The brass is nudged around the hue wheel per rider. Four identical helmets
    // catching the same lamp is the single most photocopied-looking thing about a
    // line of them, and a helmet is the brightest part of each man.
    this.brassMat = new THREE.MeshStandardMaterial({
      color: P.brass, roughness: 0.34, metalness: 0.85,
    });
    if (index > 0) this.brassMat.color.offsetHSL(v * D.varyBrass, 0, v * D.varyBrass * 0.4);
    // White base: the dazzle texture carries the colour, and `color` is left
    // free to tint the whole suit when he goes adrift.
    this.canvasMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: this._dazzleTexture(), roughness: 0.95,
    });
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0x4a4237, roughness: 0.9 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fd4d8, roughness: 0.08, metalness: 0.2,
      transparent: true, opacity: 0.55, emissive: 0x1d3f44, emissiveIntensity: 0.5,
    });

    this._buildBody();
    this._buildRopes();
  }

  /**
   * Dazzle camouflage, painted once into a canvas and used as the suit's map.
   *
   * Dazzle never hid a ship. It broke up the cues you'd use to read a hull's
   * heading and speed, which is a good joke on a man being towed backwards
   * through fog on the end of a rope, and it puts the only high-contrast thing
   * in the lake on the character you most need to keep track of.
   *
   * The pattern is panels of parallel stripes at deliberately conflicting
   * angles — it's the disagreement between neighbouring panels that does the
   * work, so the panels are irregular, sheared, and never share a slope with
   * the one beside them. The wrap seam down his back isn't hidden either: on a
   * dazzle pattern one more hard edge just reads as one more panel, which makes
   * this the one place a seam is free.
   */
  _dazzleTexture() {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
    const P = CFG.palette;

    g.fillStyle = hex(P.suitLight);
    g.fillRect(0, 0, S, S);

    let x = -S * 0.1;
    let panel = 0;
    while (x < S) {
      const w = S * (0.11 + Math.random() * 0.17);
      const skew = (Math.random() - 0.5) * S * 0.4;   // panels aren't rectangles
      g.save();
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + w, 0);
      g.lineTo(x + w + skew, S);
      g.lineTo(x + skew, S);
      g.closePath();
      g.clip();

      // Slope flips hard between neighbours. That contrast IS the camouflage;
      // a consistent angle would just be a deck chair.
      g.translate(x + w / 2, S / 2);
      g.rotate((panel % 2 ? 1 : -1) * (0.5 + Math.random() * 0.7));
      g.fillStyle = hex(panel % 3 === 2 ? P.suitMid : P.suitDark);
      const band = 6 + Math.random() * 13;
      for (let y = -S; y < S; y += band * 2) g.fillRect(-S, y, S * 2, band);
      g.restore();

      x += w;
      panel++;
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Repeat varies per rider as well as the pattern itself: two different random
    // patterns at the same stripe pitch still read as the same fabric from any
    // distance where fog is doing the work, and that distance is most of them.
    const dz = 1 + this._who * CFG.diver.varyDazzle;
    tex.repeat.set(2 * dz, 1.4 * dz);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _buildBody() {
    this.body = new THREE.Group();
    // Every dimension below is the original number times one of these. At B all
    // ones the mesh is bit-for-bit the old diver, which is what makes the lead
    // rider a genuine reference rather than a near-miss.
    const B = this._build;

    // Suit: bulky canvas, weighted low.
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34 * B.torso, 0.5 * B.torso, 4, 10), this.canvasMat);
    this.body.add(torso);

    // Helmet: the brass Mark V. Its porthole is the only warm colour on him and
    // the thing that catches the lamp, so it gets the extra geometry.
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3 * B.helmet, 14, 12), this.brassMat);
    helm.position.y = 0.62;
    this.body.add(helm);

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31 * B.helmet, 0.36 * B.helmet, 0.14, 12), this.brassMat);
    collar.position.y = 0.4;
    this.body.add(collar);

    const port = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), this.glassMat);
    port.position.set(0, 0.63, 0.29);
    this.body.add(port);
    this.porthole = port;

    const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.028, 6, 16), this.brassMat);
    portRing.position.set(0, 0.63, 0.29);
    this.body.add(portRing);

    // Side ports, straight off the reference photo.
    for (const s of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.CircleGeometry(0.075, 10), this.glassMat);
      sp.position.set(s * 0.27, 0.64, 0.1);
      sp.rotation.y = s * 1.1;
      this.body.add(sp);
    }

    // Arms, reaching forward toward the grip — the pose does the storytelling.
    // Splay varies, which is the cheapest identity there is: one man has his
    // elbows out and the next is tucked in, and you read that at any distance the
    // silhouette survives at all.
    this.arms = [];
    this._armRest = -1.15 + this._build.armSplay * 0.6;
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.62, 3, 6), this.canvasMat);
      arm.position.set(s * 0.3 * B.shoulder, 0.24, 0.3);
      arm.rotation.set(this._armRest, 0, s * (0.22 + this._build.armSplay));
      this.body.add(arm);
      this.arms.push(arm);
    }

    // An empty at the right glove. The lighter gets parented here once a fish
    // hands it over, so it rides with him properly instead of being positioned
    // by hand every frame — and the light source is then genuinely wherever his
    // hand actually is, including while he's swinging around on a hard turn.
    this.hand = new THREE.Object3D();
    this.hand.position.set(0.36, 0.46, 0.62);
    this.body.add(this.hand);

    // Boots: heavy, and they hang. Weight is the whole silhouette, so this is the
    // variation that carries furthest through fog.
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 3, 6), this.canvasMat);
      leg.position.set(s * 0.15, -0.55, 0);
      this.body.add(leg);
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.19 * B.boots, 0.13 * B.boots, 0.3 * B.boots), this.brassMat);
      boot.position.set(s * 0.15, -0.86, 0.05);
      this.body.add(boot);
    }

    this.group.add(this.body);
  }

  /** Rope drawn as short cylinders — WebGL line width is capped at 1px on nearly
   *  every platform, so a LineBasicMaterial rope is invisible in this much fog. */
  _buildRopes() {
    this.ropeSegs = [];
    for (let i = 0; i < CFG.diver.links - 1; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), this.ropeMat);
      m.geometry.translate(0, 0.5, 0); // pivot at one end so scale.y spans the link
      this.ropeSegs.push(m);
      this.group.add(m);
    }
  }

  /** @param {THREE.Vector3} anchor where the kelpie's grip point is this frame */
  /**
   * @param {number} [reel] 1 normally. Below 1 the rope is shortened by that
   *   factor, which is how the riders get INTO the bong with her (CR-30) rather
   *   than trailing eighteen units of rope out through the side of the glass.
   *   Fed through the constraint rather than by moving the nodes, so the solver
   *   draws them in over a few frames instead of teleporting them.
   * @param {import('./Bong.js').Bong|null} [wall] the glass to stay inside of,
   *   or null out in open water.
   * @param {number} [wallAmount] 0..1 how firmly the glass holds them, ramped
   *   so it comes on as they enter rather than switching on under them.
   */
  update(dt, anchor, kelpie, reel = 1, wall = null, wallAmount = 1) {
    const D = CFG.diver;

    // ---- Grip strain ----
    if (this.attached) {
      if (kelpie.boosting) {
        this.grip -= D.gripStrainPerSec * dt;
        if (this.grip <= 0) this._letGo(kelpie);
      } else {
        this.grip = Math.min(D.gripMax, this.grip + D.gripRecoverPerSec * dt);
      }
    }

    // ---- Tether ----
    if (this.attached) {
      this.chain[0].pos.copy(anchor);
      this.chain[0].pinned = true;
    } else {
      this.chain[0].pinned = false;
      // Adrift: drift gently and check whether the kelpie has come back for him.
      const d = this.chain[0].pos.distanceTo(anchor);
      if (d < D.regrabRadius) this._grab();
    }

    this._integrate(this.chain, dt, D.drag, D.gravity);
    // The glass is solved WITH the rope, not after it. Clamping once at the end
    // of the frame set the two against each other: the constraint pass pushed a
    // man out through the tube to keep his link length, the clamp shoved him
    // back, and the pair of them traded him back and forth every frame, which is
    // the containment glitching. Inside the loop they negotiate instead, exactly
    // as a verlet collision constraint is meant to.
    const link = D.linkLength * reel;
    for (let it = 0; it < D.solverIterations; it++) {
      this._constrain(this.chain, link, D.stiffness);
      if (wall) for (const n of this.chain) wall.containInTube(n.pos, WALL_CLEARANCE, wallAmount);
    }
    // `prev` is deliberately NOT clamped. Dragging it along with the position
    // zeroes the implied velocity, and a rope with no velocity at the wall goes
    // dead and then snaps when it is let go. Leaving it lets the contact bleed
    // off as damping, which is what a body sliding against glass should do.

    const head = this.chain[this.chain.length - 1];
    this._placeBody(head, dt, kelpie);
    if (wall) wall.containInTube(this.body.position, WALL_CLEARANCE, wallAmount);
    this._layRope(this.ropeSegs, this.chain);
  }

  _integrate(points, dt, drag, gravity) {
    for (const p of points) {
      if (p.pinned) { p.prev.copy(p.pos); continue; }
      this._tmp.copy(p.pos).sub(p.prev).multiplyScalar(drag);
      p.prev.copy(p.pos);
      p.pos.add(this._tmp);
      p.pos.y += gravity * dt * dt * 60;
      // A little sway so nothing ever hangs perfectly still in moving water.
      // Small: this is a man riding, and any more of it reads as a man bobbing.
      p.pos.x += Math.sin(performance.now() * 0.0011 + p.pos.z) * 0.0006;
    }
  }

  _constrain(points, restLength, stiffness) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      this._tmp.copy(b.pos).sub(a.pos);
      const d = this._tmp.length() || 0.0001;
      const diff = ((d - restLength) / d) * stiffness;
      this._tmp.multiplyScalar(diff * 0.5);
      if (!a.pinned) a.pos.add(this._tmp);
      if (!b.pinned) b.pos.sub(this._tmp);
    }
  }

  _placeBody(head, dt, kelpie) {
    this.body.position.copy(head.pos);

    // Prone, head first, belly toward her back: a man lying along the top of a
    // swimming animal, not a man dangling off the back of one. He used to look
    // back down the rope, which is honest for something being towed and reads as
    // a corpse the moment he is also floating.
    //
    // His model is built upright — local +Y is his head, local +Z is his face —
    // so the basis puts +Y along her heading and +Z pointing down at her.
    if (kelpie) {
      const D = CFG.diver;
      this._fwd.set(0, 0, -1).applyQuaternion(kelpie.quaternion);
      this._down.set(0, -1, 0).applyQuaternion(kelpie.quaternion);
      this._side.crossVectors(this._fwd, this._down).normalize();
      this._basis.makeBasis(this._side, this._fwd, this._down);
      this._q.setFromRotationMatrix(this._basis);

      // His own motion this frame, straight out of the verlet solver — no new
      // state to keep in sync and nothing authored. `prev` is last frame's
      // position, so the difference IS his velocity, in the units the solver
      // already works in.
      // Divided by dt rather than scaled by 60, so the lean is the same at 30 fps
      // as at 144 — a per-frame displacement read raw would make him bank harder
      // on a slower machine, which is the classic version of this bug.
      this._vel.copy(head.pos).sub(head.prev).divideScalar(Math.max(dt, 1e-4));
      // Bank into the turn. The sideways component is measured against HER side
      // vector rather than the world's, so "sideways" still means sideways when
      // she is rolled over, and the sign comes out right upside down.
      const lateral = this._vel.dot(this._side);
      const rise = this._vel.dot(this._up);
      const bankTarget = THREE.MathUtils.clamp(-lateral * D.bank, -D.bankMax, D.bankMax);
      const pitchTarget = THREE.MathUtils.clamp(rise * D.pitch, -D.pitchMax, D.pitchMax);
      // Chased rather than assigned, and slower than the facing: roll is the
      // heaviest thing a man on a rope does and snapping it looks like a glitch.
      const bk = 1 - Math.exp(-D.bankRate * dt);
      this._roll += (bankTarget - this._roll) * bk;
      this._pitch += (pitchTarget - this._pitch) * bk;

      // Applied to the TARGET, not to the body: banking after the slerp would
      // fight the slerp every frame and settle at whatever the two happened to
      // average out to. Right-multiplied, so both are local rotations — his model
      // is built with +Y along his length and +X across his shoulders, so roll is
      // about local Y and nosing up is about local X.
      this._q.multiply(this._lean.setFromAxisAngle(this._bodyAxis, this._roll));
      this._q.multiply(this._nose.setFromAxisAngle(this._sideAxis, this._pitch));

      // Slerped, not assigned, so the rope still throws him around a little on a
      // hard turn instead of welding him to her heading — and at HIS rate, which
      // falls off down the rope, so the tail of the line lags into a turn and
      // straightens out of it late.
      this.body.quaternion.slerp(this._q, 1 - Math.exp(-this._faceRate * dt));
      // AND THEN CLAMPED, which is not belt-and-braces — it is the fix for a
      // real failure the rate alone cannot prevent. An exponential chase has no
      // bound on how far behind it can fall: on a sustained hard circle the
      // trailing rider kept losing ground every frame and was measured 174
      // degrees off her heading, which is a man riding backwards. Lag is the
      // effect we want and unbounded lag is a bug, so the two are separated
      // here: the rate says how he follows, this says how far behind he is ever
      // allowed to get.
      this.body.quaternion.rotateTowards(this._q, CFG.diver.faceMaxLag);
    }

    // Arms strain visibly as grip runs out — the warning before he lets go.
    const strain = 1 - this.grip / CFG.diver.gripMax;
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.x = this._armRest - strain * 0.45;
    }
    // Adrift, the dazzle goes muddy — he stops being the brightest thing down
    // here at exactly the moment you need to find him.
    this.canvasMat.color.setHex(this.adrift ? CFG.palette.suitAdrift : 0xffffff);
  }

  _layRope(segs, points) {
    for (let i = 0; i < segs.length; i++) {
      const a = points[i].pos, b = points[i + 1].pos;
      const seg = segs[i];
      seg.position.copy(a);
      this._tmp.copy(b).sub(a);
      const len = this._tmp.length();
      seg.scale.set(1, len, 1);
      this._tmp.normalize();
      seg.quaternion.setFromUnitVectors(this._up, this._tmp);
    }
  }

  _letGo(kelpie) {
    this.attached = false;
    this.adrift = true;
    this.grip = 0;
    // Fling him with whatever the kelpie was doing — the moment should read as
    // being thrown off, not as quietly detaching.
    const p0 = this.chain[0];
    p0.prev.copy(p0.pos).addScaledVector(kelpie.velocity, -0.012);
    if (this.onLetGo) this.onLetGo();
  }

  _grab() {
    this.attached = true;
    this.adrift = false;
    this.grip = CFG.diver.gripMax * 0.55; // winded, not fresh
    if (this.onGrab) this.onGrab();
  }

  /** Where the next rider down the line ties on: this one's own body. */
  hitchPoint(out) {
    return out.copy(this.chain[this.chain.length - 1].pos);
  }

  /** Helmet position — bubbles stream from here. */
  helmetPosition(out) {
    const head = this.chain[this.chain.length - 1];
    return out.copy(head.pos).add(this._tmp.set(0, 0.62, 0));
  }

  /** World position of the glove holding the lighter — the actual light source. */
  handPosition(out) {
    this.hand.getWorldPosition(out);
    return out;
  }

  /**
   * Shrink a rider while the bong has him (CR-30). Scaled on `body` and not on
   * `group`: the rope segments are children of the group positioned in WORLD
   * space off the chain, so scaling the group would drag them toward the origin
   * rather than making them smaller. The rope keeps its own thickness, which at
   * 0.035 units is not something anyone will notice going through a bong.
   *
   * Same two sizes the kelpie gets, for the same reason: small enough that
   * nothing of him can reach the glass, so the tube's boundary holds without
   * anyone measuring him against it.
   *
   * @param {number} inside 0..1 how far into the bong he is
   * @param {number} chamber 0..1 in the tube rather than the stem
   */
  setPullShape(inside, chamber) {
    const T = CFG.trip;
    const i = THREE.MathUtils.clamp(inside, 0, 1);
    const m = THREE.MathUtils.clamp(chamber, 0, 1);
    this.body.scale.setScalar(THREE.MathUtils.lerp(
      1, THREE.MathUtils.lerp(T.pullPipeShrink, T.pullChamberScale, m), i));
  }

  setTrip(v) {
    this.glassMat.emissiveIntensity = 0.5 + v * 2.2;
    this.brassMat.metalness = 0.85 - v * 0.3;
  }

  reset(anchor) {
    this.attached = true;
    this.adrift = false;
    this.grip = CFG.diver.gripMax;
    this.body.scale.setScalar(1);   // as on the kelpie: no inherited bong shape

    // Up and back from the grip, which is where he actually rides.
    for (let i = 0; i < this.chain.length; i++) {
      this.chain[i].pos.copy(anchor).add(this._tmp.set(0, 0.3 * i, CFG.diver.linkLength * i));
      this.chain[i].prev.copy(this.chain[i].pos);
    }
  }
}
