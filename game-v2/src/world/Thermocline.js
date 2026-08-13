// The thermocline — Superior's cold layer, made visible.
//
// Gives the world a vertical axis with stakes attached. Above it is the ordinary
// green murk; below it the grade goes cold, breath drains faster, and the audio
// muffles further. All three cues fire off the same crossing, so "it got colder"
// is something you feel in three senses at once rather than read on a meter.
//
// Those three are ramps, though, and for a long time that was the whole of it:
// the most consequential line in the water was the one thing you could cross
// without noticing you had. `crossing()` is the moment itself, latched so that
// hovering at the boundary does not fire it over and over.
//
// Drawn as a single shimmering sheet: transparent, no depth write, so you can see
// it from both sides and pass through it without a visible pop.

import * as THREE from 'three';
import { CFG } from '../../config.js';

export class Thermocline {
  constructor() {
    const T = CFG.thermocline;
    const size = CFG.world.radius * 2.6;

    this.uniforms = {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0x2a5f66) },
      uOpacity: { value: 0.16 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        varying float vFade;
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Fade the sheet out with distance or its edges give away that it's a
          // finite plane rather than a property of the water.
          vFade = 1.0 - smoothstep(60.0, 190.0, length(mv.xyz));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime; uniform vec3 uTint; uniform float uOpacity;
        varying vec2 vUv; varying float vFade;
        void main(){
          // Two crossed sine fields at different rates read as slow density
          // shimmer without needing a texture.
          float a = sin(vUv.x * 42.0 + uTime * 0.5) * sin(vUv.y * 37.0 - uTime * 0.37);
          float b = sin(vUv.x * 13.0 - uTime * 0.22) * sin(vUv.y * 17.0 + uTime * 0.19);
          float shimmer = 0.5 + 0.5 * (a * 0.35 + b * 0.65);
          float alpha = uOpacity * shimmer * vFade;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uTint, alpha);
        }
      `,
    });

    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = T.depth;
    this.mesh.renderOrder = 2;
    this.group = this.mesh;

    // Which side of the layer she is on, latched. Starts unknown rather than
    // false: a run that spawns in the cold has not crossed anything, and
    // defaulting to "warm" would open it with a jolt it has not earned.
    this.cold = null;
  }

  update(dt) {
    this.uniforms.uTime.value += dt * CFG.thermocline.shimmerSpeed * 3.0;
  }

  /** 0 above the layer, 1 fully below — everything else reads this. */
  submersion(y) {
    const T = CFG.thermocline;
    return THREE.MathUtils.clamp((T.depth - y) / T.thickness, 0, 1);
  }

  isBelow(y) { return y < CFG.thermocline.depth; }

  /**
   * Has she just crossed? +1 on the frame she commits to the cold, -1 on the
   * frame she is back out of it, 0 the rest of the time. Call it once a frame:
   * the answer is an edge, and reading it consumes it.
   *
   * The two thresholds are far apart on purpose. A bare `y < depth` test fires
   * every frame spent at the boundary, and the boundary is precisely where you
   * hang while deciding whether the trench is worth the air.
   *
   * @param {number} y
   * @returns {-1|0|1}
   */
  crossing(y) {
    const T = CFG.thermocline;
    const s = this.submersion(y);
    // First look adopts whichever side she is already on, reporting nothing.
    if (this.cold === null) { this.cold = s >= T.enterAt; return 0; }
    if (!this.cold && s >= T.enterAt) { this.cold = true; return 1; }
    if (this.cold && s <= T.exitAt) { this.cold = false; return -1; }
    return 0;
  }
}
