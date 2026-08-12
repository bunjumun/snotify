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
// Two states throughout. Before the lighter everything is a feeble cold glow
// that barely reaches past the divers' own boots; after, it's warm and flickers
// like a flame. That transition is the opening's payoff.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const BEAM_LEN = 40;

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
        beam: true, glow: false,
      }));
    }

    // ---- The rope. One per rider, fanned so four beams read as four people
    // rather than as one hot stripe down the middle of the screen.
    for (let i = 0; i < riders; i++) {
      const t = riders > 1 ? (i / (riders - 1)) * 2 - 1 : 0;   // -1..1
      this.heads.push(this._makeHead(scene, {
        base: L.helmetIntensity, angle: L.helmetAngle,
        yaw: t * L.helmetSpread,
        pitch: (i % 2 ? 1 : -1) * L.helmetSpread * 0.45,
        beam: false, glow: true,
      }));
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
    this._warm = new THREE.Color(L.color);
    this._cold = new THREE.Color(L.dimColor);
    this._col = new THREE.Color();
  }

  _makeHead(scene, opt) {
    const L = CFG.lamp;
    const head = {
      base: opt.base, angle: opt.angle, yaw: opt.yaw, pitch: opt.pitch,
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
  update(dt, origins, baseRot, aimIntent) {
    const L = CFG.lamp;
    this._t += dt;

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

      h.light.position.copy(at);
      h.target.position.copy(at).addScaledVector(this._headDir, 25);
      h.light.color.copy(this._col);
      h.light.intensity = THREE.MathUtils.lerp(h.base * dimRatio, h.base, m) * f;
      h.light.distance = dist;
      h.light.angle = THREE.MathUtils.lerp(h.angle * 1.35, h.angle, m);

      if (h.beam) {
        h.beam.visible = true;
        h.beam.position.copy(at);
        h.beam.quaternion.setFromUnitVectors(this._fwd, this._headDir);
        h.uniforms.uColor.value.copy(this._col);
        h.uniforms.uStrength.value = THREE.MathUtils.lerp(0.10, L.beamStrength, m) * f;
        h.uniforms.uTime.value = this._t;
        h.beam.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.0, m));
      }
      if (h.glow) {
        h.glow.position.copy(at);
        h.glowMat.color.copy(this._col);
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
