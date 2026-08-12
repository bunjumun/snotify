// The diver's lamp.
//
// Three parts, and the game needs all three:
//
//  1. A SpotLight, which lights surfaces — silt, hull plating, a baggie.
//  2. A visible BEAM. This is the one that's easy to forget and impossible to do
//     without: a spotlight in fog lights things but is itself invisible, so the
//     lamp reads as "some stuff got brighter" rather than as a lamp. Underwater
//     you see the shaft because the water is full of particulate, so we draw it —
//     an additive cone that fades along its length.
//  3. A lens glow, so the source reads even when the beam points away from camera.
//
// It has two states. Before the lighter it's a feeble cold glow that barely
// reaches past the diver's own boots; after, it's a warm beam that flickers like
// a flame. That transition is the opening's payoff and it's worth the extra code.

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
  constructor(scene) {
    const L = CFG.lamp;

    this.lit = false;         // has the lighter
    this._litMix = 0;         // eased 0..1 between the two states
    this._flick = 1;
    this._t = 0;

    this.light = new THREE.SpotLight(L.dimColor, L.dimIntensity, L.dimDistance, L.dimAngle, L.penumbra, L.decay);
    this.light.castShadow = false;
    this.target = new THREE.Object3D();
    this.light.target = this.target;
    scene.add(this.light, this.target);

    // ---- Visible beam ----
    this.beamUniforms = {
      uColor: { value: new THREE.Color(L.dimColor) },
      uStrength: { value: 0.1 },
      uTime: { value: 0 },
      uLen: { value: BEAM_LEN },
    };
    const cone = new THREE.ConeGeometry(BEAM_LEN * Math.tan(L.angle), BEAM_LEN, 20, 1, true);
    cone.translate(0, -BEAM_LEN / 2, 0);   // apex to the origin
    cone.rotateX(Math.PI / 2);             // and point it down -Z
    this.beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
      uniforms: this.beamUniforms,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    }));
    this.beam.renderOrder = 3;
    this.beam.frustumCulled = false;
    scene.add(this.beam);

    // ---- Lens glow ----
    this.glowMat = new THREE.MeshBasicMaterial({
      color: L.dimColor, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
    });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), this.glowMat);
    scene.add(this.glow);

    this.aim = new THREE.Vector2(0, 0);
    this.beamDir = new THREE.Vector3(0, 0, -1);
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._warm = new THREE.Color(L.color);
    this._cold = new THREE.Color(L.dimColor);
    this._col = new THREE.Color();
  }

  /** The moment the fish hands over the lighter. */
  setLit(on) { this.lit = on; }

  update(dt, origin, baseRot, aimIntent) {
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

    this.light.position.copy(origin);
    this.target.position.copy(origin).addScaledVector(this.beamDir, 25);
    this.glow.position.copy(origin);
    this.beam.position.copy(origin);
    this.beam.quaternion.setFromUnitVectors(this._fwd, this.beamDir);

    // Interpolate every property between the two states.
    const m = this._litMix, f = this._flick;
    this._col.copy(this._cold).lerp(this._warm, m);
    this.light.color.copy(this._col);
    this.light.intensity = THREE.MathUtils.lerp(L.dimIntensity, L.intensity, m) * f;
    this.light.distance = THREE.MathUtils.lerp(L.dimDistance, L.distance, m);
    this.light.angle = THREE.MathUtils.lerp(L.dimAngle, L.angle, m);

    this.beamUniforms.uColor.value.copy(this._col);
    this.beamUniforms.uStrength.value = THREE.MathUtils.lerp(0.10, 0.34, m) * f;
    this.beamUniforms.uTime.value = this._t;
    this.beam.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.0, m));

    this.glowMat.color.copy(this._col);
    this.glowMat.opacity = THREE.MathUtils.lerp(0.35, 0.8, m) * f;
    this.glow.scale.setScalar(THREE.MathUtils.lerp(0.7, 1.25, m) * f);
  }

  /**
   * How centred a world point is in the beam, 0..1. Pickups use this to glint
   * when the light finds them — which teaches the lamp without a tooltip.
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
    this.beamUniforms.uStrength.value *= (1 + v * 0.8);
  }

  setActive(on) {
    this.light.visible = on;
    this.glow.visible = on;
    this.beam.visible = on;
  }
}
