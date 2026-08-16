// God-rays from the surface.
//
// Not a screen-space effect — just additive cones hanging in the water. In fog
// this dense, honest volumetrics would be invisible and expensive, whereas eight
// tapered cylinders with a soft falloff read exactly right and cost nothing.
//
// They pulse on the music's low end via `react`, which is the most legible of the
// audio-reactive hooks: the shafts breathe with the kick.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const VERT = `
  varying float vY;
  varying vec3 vPos;
  void main(){
    vY = uv.y;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vY;
  varying vec3 vPos;
  void main(){
    // Fade at both ends so the cone never shows a hard cap.
    float fade = smoothstep(0.0, 0.35, vY) * smoothstep(1.0, 0.55, vY);
    float flicker = 0.82 + 0.18 * sin(uTime * 0.7 + vPos.x * 0.35 + vPos.z * 0.28);
    float a = fade * uOpacity * flicker;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Godrays {
  /** @param {import('../core/Rng.js').Rng} rng */
  constructor(rng) {
    this.group = new THREE.Group();
    this.shafts = [];
    this.enabled = true;

    const count = 8;
    for (let i = 0; i < count; i++) {
      const uniforms = {
        uColor: { value: new THREE.Color(0x9fd8c8) },
        uOpacity: { value: 0.055 + rng.float(0, 0.035) },
        uTime: { value: rng.float(0, 100) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });

      const height = 90;
      // Wide at the surface, narrow below — light spreading as it sinks.
      const geo = new THREE.CylinderGeometry(2.5, 14, height, 7, 1, true);
      const mesh = new THREE.Mesh(geo, mat);

      const { x, z } = rng.inDisc(CFG.world.radius * 0.8);
      mesh.position.set(x, CFG.world.surfaceY - height * 0.5, z);
      mesh.rotation.z = rng.float(-0.18, 0.18);
      mesh.rotation.x = rng.float(-0.14, 0.14);
      mesh.renderOrder = 1;

      this.shafts.push({ mesh, uniforms, base: uniforms.uOpacity.value });
      this.group.add(mesh);
    }
  }

  update(dt, react = 0, lightScale = 1) {
    for (const s of this.shafts) {
      s.uniforms.uTime.value += dt;
      // The kick pushes them brighter; weather pulls them down. The gain moved
      // to CFG.reactive.godrays so the whole environment can be dialled from one
      // place — it was 1.9 baked in here, which made "make the world breathe
      // harder" a hunt through five files.
      s.uniforms.uOpacity.value = s.base * lightScale * (1 + react * 1.9 * CFG.reactive.godrays);
    }
  }

  setQuality(level) {
    this.enabled = CFG.quality.levels[level]?.godrays !== false;
    this.group.visible = this.enabled;
  }

  setTrip(v) {
    for (const s of this.shafts) {
      s.uniforms.uColor.value.setHSL((0.45 + v * 0.5) % 1, 0.35 + v * 0.5, 0.72);
    }
  }
}
