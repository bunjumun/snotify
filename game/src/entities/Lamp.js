// The lights.
//
// Six of them, and none of them is a torch you fly. Two are the KELPIE'S EYES,
// which are the headlights — they point where she is going and lead a little
// into a turn, so the water you are about to be in is already lit. Four are
// FLASHLIGHTS, one per diver on the rope behind you. You never see the divers
// while you're navigating, and that's exactly why their lights work: the beams
// come past you from behind, they swing as the rope swings, and the world in
// front of you is lit by four people you can't see. When the bong orbit swings
// out and reveals them, the light in the scene turns out to have had a source
// all along.
//
// Each light is three parts and the eyes need all three:
//
//  1. A SpotLight, which lights surfaces — silt, hull plating, a baggie.
//  2. A visible BEAM. This is the one that's easy to forget and impossible to do
//     without: a spotlight in fog lights things but is itself invisible, so it
//     reads as "some stuff got brighter" rather than as a lamp. Underwater you
//     see the shaft because the water is full of particulate, so we draw it —
//     an additive cone that fades along its length. The eyes get cones; the
//     helmets don't, because a cone whose apex is behind the camera is a bar of
//     light across the frame and nothing else.
//  3. A lens glow, so the source reads even when the beam points away from
//     camera. Helmets only, and only once you can see who's holding it.
//
// THE HELMETS LOOK AT THINGS. The four of them no longer hold a fixed fan: each
// rider claims a nearby findable and swings onto it, and takes his fan position
// back when there is nothing to see. That is four people behaving like four
// people, and it is also a hint you can miss, which is the only kind this game
// allows.
//
// It is fenced hard, because the pillar it brushes against is the strictest one
// in the build — "No waypoint, ever. The fog IS the game" (Clues.js). A beam that
// swings onto something across the lake is a waypoint wearing a hat. So a rider
// may only look at what he could plausibly have SEEN: inside CFG.lamp.lookRange,
// which is about a quarter of the way to the fog wall, and roughly in front of
// her. The caller decides what counts as findable and the chest is never on that
// list at any range. The EYES are not part of this. They are hers, they are the
// headlights, they point where she is going, and `illumination()` still measures
// off them — so nothing about how a pickup glints when you find it changed.
//
// Two states throughout. Before the lighter everything is a feeble cold glow
// that barely reaches past the divers' own boots; after, it's warm and flickers
// like a flame. That transition is the opening's payoff.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const BEAM_LEN = 40;
/** Stands in for the analyser before the first frame of audio. */
const ZERO = { low: 0, mid: 0, high: 0, kick: 0 };

const BEAM_VERT = `
  uniform float uLen;
  varying float vT;      // 0 at the lens, 1 at the far end
  varying vec2 vRad;
  void main(){
    vT = clamp(-position.z / uLen, 0.0, 1.0);
    vRad = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAG = `
  precision mediump float;
  uniform vec3  uColor;
  uniform float uStrength;
  uniform float uTime;
  varying float vT;
  varying vec2  vRad;
  void main(){
    // Dense at the lens, gone by the far end — that's how a shaft in murk looks,
    // and it also hides the fact that the cone has a hard geometric end.
    float along = pow(1.0 - vT, 2.2);
    // Soft edges so the cone never shows a silhouette.
    float radial = 1.0 - smoothstep(0.35, 1.0, length(vRad) / max(0.001, 0.35 + vT * 6.0));
    // Slow drifting motes in the beam.
    float dust = 0.85 + 0.15 * sin(vT * 40.0 - uTime * 2.2);
    float a = along * radial * dust * uStrength;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Lamp {
  /**
   * @param {THREE.Scene} scene
   * @param {number} riders how many flashlights are on the rope behind her
   */
  constructor(scene, riders = 4) {
    const L = CFG.lamp;

    this.lit = false;         // has the lighter
    this._litMix = 0;         // eased 0..1 between the two states
    this._flick = 1;
    this._t = 0;
    this.enabled = L.enabled !== false;

    /** @type {{light:THREE.SpotLight,target:THREE.Object3D,base:number,angle:number,yaw:number,pitch:number,beam?:THREE.Mesh,uniforms?:object,glow?:THREE.Mesh}[]} */
    this.heads = [];
    // The helmet glows live in one group so the reveal can switch them as a set.
    this.glow = new THREE.Group();

    // ---- The eyes. Headlights: narrow, bright, dead ahead, with visible cones.
    for (let i = 0; i < 2; i++) {
      this.heads.push(this._makeHead(scene, {
        base: L.eyeIntensity, angle: L.eyeAngle,
        // A hair of toe-out, the way headlights are set, so the pair covers more
        // water than one beam of twice the power would.
        yaw: (i === 0 ? -1 : 1) * L.eyeToe, pitch: 0,
        tint: i === 0 ? L.tintEyeA : L.tintEyeB,
        beam: true, glow: false,
      }));
    }

    // ---- The rope. One per rider, fanned so four beams read as four people
    // rather than as one hot stripe down the middle of the screen.
    /** Index of the first helmet in `heads`. The two eyes come first and are
     *  never targeted, so everything about looking-at starts here. */
    this.firstHelmet = this.heads.length;
    for (let i = 0; i < riders; i++) {
      const t = riders > 1 ? (i / (riders - 1)) * 2 - 1 : 0;   // -1..1
      const h = this._makeHead(scene, {
        base: L.helmetIntensity, angle: L.helmetAngle,
        yaw: t * L.helmetSpread,
        pitch: (i % 2 ? 1 : -1) * L.helmetSpread * 0.45,
        tint: L.tintHelmet,
        beam: false, glow: true,
      });
      // Where this rider is actually looking, as a world direction, eased toward
      // whatever the fan or a target asks for. Kept per head rather than
      // recomputed, because the easing IS the effect: an instant swing is a
      // turret and a slow one is a man noticing something.
      h.look = new THREE.Vector3(0, 0, -1);
      // `h.target` is already taken: it is the SpotLight's aim Object3D. The
      // world point this rider has decided to look at is `lookAt`, and confusing
      // the two silently aims every beam at the origin.
      h.lookAt = null;            // world point, or null for the fan position
      h.hold = 0;                 // seconds left before he gives up on it
      this.heads.push(h);
    }

    if (this.enabled) scene.add(this.glow);

    // The first eye is the reference light: it owns the aim, and it's what the
    // pickups test against in illumination().
    this.light = this.heads[0].light;
    this.beam = this.heads[0].beam;

    this.aim = new THREE.Vector2(0, 0);
    this.beamDir = new THREE.Vector3(0, 0, -1);
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._headDir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._want = new THREE.Vector3();
    this._lastDt = 1 / 60;   // setLookTargets can run before the first update()
    this._warm = new THREE.Color(L.color);
    this._cold = new THREE.Color(L.dimColor);
    this._col = new THREE.Color();
  }

  _makeHead(scene, opt) {
    const L = CFG.lamp;
    const head = {
      base: opt.base, angle: opt.angle, yaw: opt.yaw, pitch: opt.pitch,
      tint: new THREE.Color(opt.tint ?? L.color),
      col: new THREE.Color(),
      light: new THREE.SpotLight(L.dimColor, 0, L.dimDistance, opt.angle, L.penumbra, L.decay),
      target: new THREE.Object3D(),
    };
    head.light.castShadow = false;
    head.light.target = head.target;
    if (this.enabled) scene.add(head.light, head.target);

    if (opt.beam) {
      head.uniforms = {
        uColor: { value: new THREE.Color(L.dimColor) },
        uStrength: { value: 0.1 },
        uTime: { value: 0 },
        uLen: { value: BEAM_LEN },
      };
      const cone = new THREE.ConeGeometry(BEAM_LEN * Math.tan(opt.angle), BEAM_LEN, 20, 1, true);
      cone.translate(0, -BEAM_LEN / 2, 0);   // apex to the origin
      cone.rotateX(Math.PI / 2);             // and point it down -Z
      head.beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
        uniforms: head.uniforms,
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      head.beam.renderOrder = 3;
      head.beam.frustumCulled = false;
      if (this.enabled) scene.add(head.beam);
    }

    if (opt.glow) {
      head.glowMat = new THREE.MeshBasicMaterial({
        color: L.dimColor, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
      });
      head.glow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), head.glowMat);
      this.glow.add(head.glow);
    }
    return head;
  }

  /** The moment the fish hands over the lighter. */
  setLit(on) { this.lit = on; }

  /**
   * @param {THREE.Vector3[]} origins one per head, in construction order: the
   *   two eyes first, then a helmet per rider. Short arrays are tolerated — a
   *   head with nowhere to be is switched off rather than left at the origin.
   */
  /**
   * Hand the riders a list of things worth looking at.
   *
   * Called before `update()`, with world points in rough priority order. The
   * caller owns the policy — what is findable right now, and what must never be
   * (the chest) — because that is a game question and this class only knows about
   * light. Passing an empty list or never calling this at all returns every
   * helmet to its fan position, which is exactly the old behaviour.
   *
   * One target per rider, nearest first, and no two riders on the same thing:
   * four beams converging on one baggie is a spotlight, and a spotlight is the
   * waypoint we are not allowed to build. Spread over four things it reads as
   * four people looking around, which is the whole idea.
   *
   * @param {THREE.Vector3[]} points candidates, already filtered for relevance
   * @param {THREE.Vector3} at where she is, for the range test
   */
  setLookTargets(points, at) {
    const L = CFG.lamp;
    const n = this.heads.length - this.firstHelmet;
    if (n <= 0) return;
    if (!L.lookAt || !points || points.length === 0) {
      for (let i = 0; i < n; i++) this.heads[this.firstHelmet + i].lookAt = null;
      return;
    }

    // Range and heading gates. Both exist to keep this a thing a rider could
    // have seen rather than a compass — see the header.
    //
    // `this._dir` is last frame's heading, because this runs before update()
    // recomputes it. At the rate she turns and the rate a beam crosses, one frame
    // of staleness is invisible; the alternative is calling this after update and
    // acting on the targets a frame late instead, which is the same lag wearing a
    // different hat.
    const near = this._cand || (this._cand = []);
    near.length = 0;
    for (const p of points) {
      const d = this._tmp.copy(p).sub(at).length();
      if (d > L.lookRange) continue;
      if (this._tmp.divideScalar(d || 1).dot(this._dir) < L.lookAhead) continue;
      near.push({ p, d });
    }
    near.sort((a, b) => a.d - b.d);

    for (let i = 0; i < n; i++) {
      const h = this.heads[this.firstHelmet + i];
      const claim = near[i];
      if (claim) {
        h.lookAt = claim.p;
        h.hold = L.lookHold;
      } else if (h.hold > 0) {
        // Keep the last one a moment longer. Without this a rider strobes on and
        // off every time a target crosses the range gate, which is the ugliest
        // possible version of this effect.
        h.hold -= this._lastDt;
        if (h.hold <= 0) h.lookAt = null;
      } else {
        h.lookAt = null;
      }
    }
  }

  update(dt, origins, baseRot, aimIntent, react = null) {
    this._lastDt = dt;
    const L = CFG.lamp;
    this._t += dt;
    const r = react || ZERO;

    // Ease between dim and lit. Slow enough to be an event you notice.
    const target = this.lit ? 1 : 0;
    this._litMix += (target - this._litMix) * (1 - Math.exp(-(1 / L.litTime) * 4 * dt));

    // A flame breathes; a dead bulb doesn't.
    const flickTarget = 1 + (Math.random() - 0.5) * L.flicker * this._litMix;
    this._flick += (flickTarget - this._flick) * Math.min(1, dt * 12);

    const k = 1 - Math.exp(-L.aimSpring * dt);
    this.aim.x += (aimIntent.x - this.aim.x) * k;
    this.aim.y += (aimIntent.y - this.aim.y) * k;

    // Aim relative to travel, so "forward" is straight ahead however the kelpie
    // has rolled.
    this._dir.set(0, 0, -1).applyQuaternion(baseRot);
    this._right.set(1, 0, 0).applyQuaternion(baseRot);
    this._up.set(0, 1, 0).applyQuaternion(baseRot);
    this.beamDir.copy(this._dir)
      .addScaledVector(this._right, this.aim.x * 0.85)
      .addScaledVector(this._up, -this.aim.y * 0.7)
      .normalize();

    if (!this.enabled) return;   // aim is computed above; the rest is display

    const m = this._litMix, f = this._flick;
    const dimRatio = L.dimIntensity / L.intensity;
    this._col.copy(this._cold).lerp(this._warm, m);
    const dist = THREE.MathUtils.lerp(L.dimDistance, L.distance, m);

    // The record, in the light. A kick is a flash with a tail, the mids are the
    // beam breathing, and the highs push each source further toward its own
    // colour — so a busy passage is visibly more coloured than a quiet one.
    // All of it scales with `m`: a dead lamp doesn't dance.
    const beat = 1 + (r.kick * L.beatKick + r.mid * L.beatMid) * m;
    const tintAmt = L.tintAmount * m * (1 - L.beatTint * 0.5 + r.high * L.beatTint);

    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i];
      const at = origins[i];
      if (!at) { h.light.visible = false; if (h.beam) h.beam.visible = false; continue; }
      h.light.visible = true;

      // Each head looks slightly off the shared aim, so six lights read as six
      // lights rather than as one over-bright one.
      this._headDir.copy(this.beamDir)
        .addScaledVector(this._right, h.yaw)
        .addScaledVector(this._up, h.pitch)
        .normalize();

      // ...and a rider with something to look at leaves that fan position for it.
      // The eyes have no `look` field at all, so this whole block is helmets only
      // and her headlights keep pointing where she is going.
      if (h.look) {
        this._want.copy(this._headDir);
        if (h.lookAt) {
          this._tmp.copy(h.lookAt).sub(at);
          const d = this._tmp.length();
          if (d > 0.001) {
            this._tmp.divideScalar(d);
            // Clamped against the FAN position, not against her heading: the cap
            // is "how far a man turns his head", and measuring it off her would
            // let the outermost rider swing further than the innermost for no
            // reason anyone could see.
            const dot = THREE.MathUtils.clamp(this._tmp.dot(this._headDir), -1, 1);
            const off = Math.acos(dot);
            // Past the cap he looks as far that way as he can and no further,
            // which reads as a man craning rather than as a beam refusing.
            const w = off > L.lookMax ? L.lookMax / off : 1;
            this._want.lerp(this._tmp, w).normalize();
          }
        }
        // Eased, and this easing is the effect. Instant is a turret.
        h.look.lerp(this._want, 1 - Math.exp(-L.lookRate * dt)).normalize();
        this._headDir.copy(h.look);
      }

      h.light.position.copy(at);
      h.target.position.copy(at).addScaledVector(this._headDir, 25);
      h.col.copy(this._col).lerp(h.tint, tintAmt);
      h.light.color.copy(h.col);
      h.light.intensity = THREE.MathUtils.lerp(h.base * dimRatio, h.base, m) * f * beat;
      h.light.distance = dist;
      h.light.angle = THREE.MathUtils.lerp(h.angle * 1.35, h.angle, m);

      if (h.beam) {
        h.beam.visible = true;
        h.beam.position.copy(at);
        h.beam.quaternion.setFromUnitVectors(this._fwd, this._headDir);
        h.uniforms.uColor.value.copy(h.col);
        h.uniforms.uStrength.value = THREE.MathUtils.lerp(0.10, L.beamStrength, m) * f * beat;
        h.uniforms.uTime.value = this._t;
        h.beam.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.0, m));
      }
      if (h.glow) {
        h.glow.position.copy(at);
        h.glowMat.color.copy(h.col);
        h.glowMat.opacity = THREE.MathUtils.lerp(0.35, 0.8, m) * f;
        h.glow.scale.setScalar(THREE.MathUtils.lerp(0.7, 1.25, m) * f);
      }
    }
  }

  /**
   * How centred a world point is in the beam, 0..1. Pickups use this to glint
   * when the light finds them — which teaches the lamp without a tooltip.
   *
   * Measured off her eyes rather than off all six, because this isn't really a
   * lighting question: it asks whether the PLAYER is looking at the thing, and
   * where she's looking is where the headlights point.
   */
  illumination(point) {
    this._tmp.copy(point).sub(this.light.position);
    const dist = this._tmp.length();
    if (dist > this.light.distance) return 0;
    this._tmp.divideScalar(dist);
    const dot = this._tmp.dot(this.beamDir);
    const cutoff = Math.cos(this.light.angle * 1.6);
    if (dot < cutoff) return 0;
    return THREE.MathUtils.smoothstep(dot, cutoff, 1) * (1 - dist / this.light.distance);
  }

  setTrip(v) {
    this._tripBoost = v;
    for (const h of this.heads) {
      if (h.uniforms) h.uniforms.uStrength.value *= (1 + v * 0.8);
    }
  }

  setActive(on) {
    for (const h of this.heads) {
      h.light.visible = on;
      if (h.beam) h.beam.visible = on;
    }
    this.glow.visible = on;
  }
}
