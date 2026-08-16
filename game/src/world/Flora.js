// Kelp and weed.
//
// One InstancedMesh for hundreds of strands, swaying in the vertex shader. Doing
// the sway on the CPU would mean touching every instance matrix every frame,
// which is exactly the kind of thing that quietly costs 8ms on a phone.
//
// Each strand's phase comes from its own world position, so the bed ripples
// across rather than pulsing in unison. `uReact` is fed by the music analyser's
// low-mid band, which is what makes the whole seabed breathe with the track, and
// `uRipple` by the mids as a wave that travels ACROSS the bed rather than moving
// all of it at once — a bed that breathes in unison is a bed that pulses, and a
// pulse reads as a bug in the renderer rather than as water.
//
// Two things about the strands themselves are worth knowing before changing any
// of it.
//
// HEIGHT AND WIDTH ARE SEPARATE. They used to be one scalar with a small width
// jitter on top, which meant every tall strand was also a wide strand and the bed
// read as a single plant photographed from several distances. Weed does not grow
// like that; the disagreement between the two axes is most of what stops a field
// of instanced quads looking instanced.
//
// AND THE SIZES ARE DEALT, NOT ROLLED. Rolling each strand's class independently
// against the odds is uniform over thousands of draws and lumpy over the few
// hundred a lake plants, so a seed can quietly come out with no tall stands in it
// anywhere — the exact defect that hit the jars on 2026-08-16, where two seeds in
// four had no half-jar in them. Nobody reports that as a bug; they simply never
// see the rare thing and conclude it does not exist. So the classes come off a
// shuffled bag: the mix is guaranteed, and the randomness lives in the order, the
// placement and the jitter inside each class.

import * as THREE from 'three';
import { CFG } from '../../config.js';

/** The unscaled blade, in geometry space. The shader needs the same number to
 *  normalise its bend, and baking it in beats uploading a uniform that never
 *  changes. Anything that scales a strand does it through the instance matrix. */
const BLADE_H = 5.5;
const BLADE_W = 0.42;

export class Flora {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('./Seabed.js').Seabed} seabed
   */
  constructor(rng, seabed) {
    const F = CFG.flora;
    const R = CFG.reactive;
    this.group = new THREE.Group();
    this.uniforms = {
      uTime: { value: 0 },
      uReact: { value: 0 },   // 0..1 from the analyser, low band
      uRipple: { value: 0 },  // 0..1, mids, travels across the bed
      uSway: { value: R.kelpSway },
      uRippleGain: { value: R.kelpRipple },
      uCurrent: { value: new THREE.Vector2(0, 0) },
    };

    const COUNT = F.count;
    // A tall thin quad, segmented up its length so the bend is a curve rather
    // than a hinge.
    const blade = new THREE.PlaneGeometry(BLADE_W, BLADE_H, 1, 7);
    blade.translate(0, BLADE_H / 2, 0); // root at origin so the base stays planted

    const mat = new THREE.MeshStandardMaterial({
      color: CFG.palette.kelp,
      roughness: 0.9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.93,
      alphaTest: 0.1,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uReact = this.uniforms.uReact;
      shader.uniforms.uRipple = this.uniforms.uRipple;
      shader.uniforms.uSway = this.uniforms.uSway;
      shader.uniforms.uRippleGain = this.uniforms.uRippleGain;
      shader.uniforms.uCurrent = this.uniforms.uCurrent;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform float uTime; uniform float uReact; uniform float uRipple;
          uniform float uSway; uniform float uRippleGain; uniform vec2 uCurrent;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // Instance origin doubles as a per-strand random phase — free variety
          // with no extra attribute to upload.
          vec3 iorg = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float phase = iorg.x * 0.21 + iorg.z * 0.17;
          // Bend scales with height above the root, squared, so it hinges from
          // the base like a real stalk. BLADE_H, not the instance's own height:
          // this is geometry space, before the instance matrix scales it, so a
          // tall stand and a scrap of turf hinge identically and correctly.
          float h = clamp(transformed.y / ${BLADE_H.toFixed(1)}, 0.0, 1.0);
          float bend = h * h;
          float s = sin(uTime * 0.85 + phase) * (0.55 + uReact * uSway);
          // The mids, as a wave crossing the bed. The phase term is a plane
          // travelling over the lake rather than each strand's own offset, so a
          // busy passage visibly moves THROUGH the weed instead of inflating all
          // of it at once. That distinction is the whole point: a bed that
          // breathes in unison reads as the renderer stuttering.
          float wave = sin(iorg.x * 0.045 + iorg.z * 0.031 - uTime * 1.9);
          float ripple = wave * uRipple * uRippleGain;
          transformed.x += (s + ripple) * bend * 1.5 + uCurrent.x * bend * 2.4;
          transformed.z += cos(uTime * 0.62 + phase * 1.3) * bend * 0.75
                         + ripple * bend * 0.6 + uCurrent.y * bend * 2.4;
          transformed.y -= bend * 0.35 * abs(s); // shortens as it leans over
        `);
    };
    mat.customProgramCacheKey = () => 'kelp';

    const mesh = new THREE.InstancedMesh(blade, mat, COUNT);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();

    // The bag, dealt once for the whole bed and long enough to cover it. See the
    // header: this is a guaranteed mix, not a weighted roll.
    const bag = this._dealClasses(rng, COUNT);
    this.classCounts = {};

    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < COUNT * F.tries) {
      const { x, z } = rng.inDisc(CFG.world.radius * 0.95);
      const y = seabed.heightAt(x, z);
      // Kelp wants the shallower shelves, not the deep trench — gives the world
      // distinct zones instead of an even carpet.
      if (y < CFG.world.floorY - F.shelfDepth) continue;

      const cls = bag[placed];
      this.classCounts[cls.name] = (this.classCounts[cls.name] || 0) + 1;

      p.set(x, y - F.sink, z);
      // Yaw is free variety. The lean is the part that matters: a strand planted
      // dead vertical reads as placed, and a couple of degrees off true reads as
      // grown. Tilt about a random horizontal axis, so it leans in a direction of
      // its own rather than every strand leaning the same way.
      const tiltDir = rng.float(0, Math.PI * 2);
      const tilt = rng.float(0, F.leanMax);
      e.set(Math.cos(tiltDir) * tilt, rng.float(0, Math.PI * 2), Math.sin(tiltDir) * tilt);
      q.setFromEuler(e);
      // Height and width drawn separately, inside the class's own bands, so a
      // tall strand is free to be a thin one.
      s.set(rng.float(cls.w[0], cls.w[1]), rng.float(cls.h[0], cls.h[1]), 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // one big spread-out batch; culling it is all-or-nothing

    this.mesh = mesh;
    this.group.add(mesh);
  }

  /**
   * One entry per strand, in the configured proportions, shuffled.
   *
   * `Math.round` per class can leave the bag a strand or two short of `count`,
   * so it is topped up from the heaviest class rather than left to hand back
   * `undefined` at the end of the placement loop — an off-by-one here would
   * throw during worldgen, on one seed in a hundred, which is the worst possible
   * shape for a bug.
   */
  _dealClasses(rng, count) {
    const classes = CFG.flora.classes;
    const total = classes.reduce((n, c) => n + c.weight, 0);
    const bag = [];
    for (const c of classes) {
      const n = Math.max(1, Math.round((count * c.weight) / total));
      for (let i = 0; i < n; i++) bag.push(c);
    }
    const filler = classes.reduce((a, b) => (b.weight > a.weight ? b : a));
    while (bag.length < count) bag.push(filler);
    return rng.shuffle(bag);
  }

  update(dt, react = 0, current = null, mid = 0) {
    this.uniforms.uTime.value += dt;
    // Ease both reactions so a snare hit doesn't snap the whole seabed sideways.
    // Same rate for both on purpose: they are two readings of one record, and
    // letting them drift apart makes the bed argue with itself.
    const k = Math.min(1, dt * CFG.reactive.ease);
    this.uniforms.uReact.value += (react - this.uniforms.uReact.value) * k;
    this.uniforms.uRipple.value += (mid - this.uniforms.uRipple.value) * k;
    if (current) this.uniforms.uCurrent.value.set(current.x * 0.08, current.z * 0.08);
  }
}
