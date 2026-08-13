// Kelp and weed.
//
// One InstancedMesh for hundreds of strands, swaying in the vertex shader. Doing
// the sway on the CPU would mean touching every instance matrix every frame,
// which is exactly the kind of thing that quietly costs 8ms on a phone.
//
// Each strand's phase comes from its own world position, so the bed ripples
// across rather than pulsing in unison. `uReact` is fed by the music analyser's
// low-mid band, which is what makes the whole seabed breathe with the track.

import * as THREE from 'three';
import { CFG } from '../../config.js';

export class Flora {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('./Seabed.js').Seabed} seabed
   */
  constructor(rng, seabed) {
    this.group = new THREE.Group();
    this.uniforms = {
      uTime: { value: 0 },
      uReact: { value: 0 },   // 0..1 from the analyser
      uCurrent: { value: new THREE.Vector2(0, 0) },
    };

    const COUNT = 520;
    // A tall thin quad, segmented up its length so the bend is a curve rather
    // than a hinge.
    const blade = new THREE.PlaneGeometry(0.42, 5.5, 1, 7);
    blade.translate(0, 2.75, 0); // root at origin so the base stays planted

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
      shader.uniforms.uCurrent = this.uniforms.uCurrent;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform float uTime; uniform float uReact; uniform vec2 uCurrent;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // Instance origin doubles as a per-strand random phase — free variety
          // with no extra attribute to upload.
          vec3 iorg = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float phase = iorg.x * 0.21 + iorg.z * 0.17;
          // Bend scales with height above the root, squared, so it hinges from
          // the base like a real stalk.
          float h = clamp(transformed.y / 5.5, 0.0, 1.0);
          float bend = h * h;
          float s = sin(uTime * 0.85 + phase) * (0.55 + uReact * 1.15);
          transformed.x += s * bend * 1.5 + uCurrent.x * bend * 2.4;
          transformed.z += cos(uTime * 0.62 + phase * 1.3) * bend * 0.75 + uCurrent.y * bend * 2.4;
          transformed.y -= bend * 0.35 * abs(s); // shortens as it leans over
        `);
    };
    mat.customProgramCacheKey = () => 'kelp';

    const mesh = new THREE.InstancedMesh(blade, mat, COUNT);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();

    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < COUNT * 6) {
      const { x, z } = rng.inDisc(CFG.world.radius * 0.95);
      const y = seabed.heightAt(x, z);
      // Kelp wants the shallower shelves, not the deep trench — gives the world
      // distinct zones instead of an even carpet.
      if (y < CFG.world.floorY - 4) continue;
      p.set(x, y - 0.3, z);
      e.set(0, rng.float(0, 6.28), 0);
      q.setFromEuler(e);
      const sc = rng.float(0.55, 1.7);
      s.set(sc * rng.float(0.7, 1.3), sc, 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // one big spread-out batch; culling it is all-or-nothing

    this.mesh = mesh;
    this.group.add(mesh);
  }

  update(dt, react = 0, current = null) {
    this.uniforms.uTime.value += dt;
    // Ease the reaction so a snare hit doesn't snap the whole seabed sideways.
    this.uniforms.uReact.value += (react - this.uniforms.uReact.value) * Math.min(1, dt * 6);
    if (current) this.uniforms.uCurrent.value.set(current.x * 0.08, current.z * 0.08);
  }
}
