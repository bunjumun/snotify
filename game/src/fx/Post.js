// Post-processing: one render target, one fullscreen pass, one shader.
//
// Three's EffectComposer lives in examples/jsm, which isn't part of the vendored
// core build — and we wouldn't want it anyway. A chain of passes means a chain of
// full-resolution buffers, which is the fastest way to turn 60fps into 24 on a
// phone. Everything here happens in a single fragment shader with a single
// texture read at its heart.
//
// `uTrip` (0..1) drives the whole bong sequence: hue rotation, saturation,
// chromatic aberration, glow and shimmer. The same value drives the phaser, the
// filter sweep and the camera orbit, so picture and sound are guaranteed to move
// together — they're literally reading the same number.
//
// `uPanic` is the other half: as breath runs out the vignette closes and colour
// drains, which is the visual half of a cue the audio is making at the same time.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uTrip;
  uniform float uPanic;
  uniform float uTime;
  uniform vec2  uResolution;
  varying vec2 vUv;

  // Rodrigues rotation of RGB about the luminance axis. Cheaper and more stable
  // than a round trip through HSV, and it never blows out saturated pixels.
  vec3 hueRotate(vec3 c, float a){
    const vec3 k = vec3(0.57735);
    float cs = cos(a), sn = sin(a);
    return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
  }

  void main(){
    vec2 uv = vUv;
    vec2 centred = uv - 0.5;

    // Chromatic aberration, radial, scaled by the trip. At uTrip 0 this costs two
    // extra samples for nothing, so it's branched out entirely.
    vec3 col;
    if (uTrip > 0.004) {
      float ca = uTrip * 0.006 * (1.0 + 0.5 * sin(uTime * 1.7));
      col.r = texture2D(tDiffuse, uv + centred * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - centred * ca).b;
    } else {
      col = texture2D(tDiffuse, uv).rgb;
    }

    // Base grade: the water is always a little cold and a little green.
    col = mix(col, col * vec3(0.86, 1.04, 1.02), 0.5);

    if (uTrip > 0.004) {
      // Hue cycles round the wheel across the sequence, with a slow ripple across
      // the frame so the whole screen isn't one flat shifted colour.
      float ripple = sin(uv.x * 5.0 + uTime * 0.9) * sin(uv.y * 4.0 - uTime * 0.7);
      col = hueRotate(col, uTrip * (uTime * 0.55 + ripple * 0.5));

      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, 1.0 + uTrip * 1.35);           // saturation
      col += smoothstep(0.55, 1.0, lum) * uTrip * 0.32;         // cheap bloom-ish glow

      // Edge shimmer, so movement leaves a faint trail of colour.
      float edge = length(vec2(dFdx(lum), dFdy(lum)));
      col += edge * uTrip * 1.6 * vec3(0.6, 0.9, 1.0);
    }

    // Panic: colour drains and the frame closes in.
    if (uPanic > 0.004) {
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum) * vec3(1.05, 0.9, 0.9), uPanic * 0.75);
    }

    float vig = smoothstep(0.95, 0.28, length(centred) * (1.0 + uPanic * 0.85));
    col *= mix(1.0, vig, 0.55 + uPanic * 0.4);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Post {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.scale = 1;
    this.stats = { calls: 0, triangles: 0 };

    const size = renderer.getSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,   // headroom for the glow before it clips
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uTrip: { value: 0 },
      uPanic: { value: 0 },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.x, size.y) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
    });

    // A single oversized triangle rather than a quad: one fewer vertex, no seam
    // down the diagonal, and it's the standard trick for exactly this.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 2, 0, 0, 2,
    ]), 2));

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(geo, this.material));
  }

  setQuality(level) {
    this.scale = CFG.quality.levels[level]?.postScale ?? 1;
    this.resize();
  }

  resize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x * this.scale));
    const h = Math.max(2, Math.floor(size.y * this.scale));
    this.target.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  render(scene, camera, dt) {
    this.uniforms.uTime.value += dt;

    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // Snapshot the scene's cost before the fullscreen pass overwrites it —
    // renderer.info is per-render, so reading it afterwards only ever reports
    // the one triangle we just drew, which makes the debug overlay useless.
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  set trip(v) { this.uniforms.uTrip.value = v; }
  set panic(v) { this.uniforms.uPanic.value = v; }
}
