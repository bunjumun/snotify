// The treasure chest.
//
// Placed somewhere new every run, always beside something you'd have swum over to
// look at anyway — never in open water, where finding it would be an accident
// rather than an achievement.
//
// It shows itself in three stages, and the staging is the whole design. Beyond
// glowRadius it is a dark shape in silt like everything else. Inside it, the
// bands catch a light that has no source. Inside beaconRadius it is unmistakably
// giving itself away. So the last twenty metres of a two-minute search are the
// part that feels like finding something, which is where that feeling belongs.

import * as THREE from 'three';
import { CFG } from '../../config.js';

export class Chest {
  /** @param {THREE.Vector3} position */
  constructor(position) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.position = this.group.position;
    this.open = false;
    this._lid = 0;
    this._glow = 0;
    this._t = 0;

    const wood = new THREE.MeshStandardMaterial({
      color: 0x3a2b1c, roughness: 0.95, metalness: 0.0, flatShading: true,
    });
    const iron = new THREE.MeshStandardMaterial({
      color: 0x6a5a3a, roughness: 0.55, metalness: 0.75,
      emissive: 0xffc061, emissiveIntensity: 0,
    });
    this.ironMat = iron;

    const W = 1.9, H = 1.05, D = 1.25;

    const base = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wood);
    base.position.y = H / 2;
    this.group.add(base);

    // Lid on its own pivot at the back edge, so opening it is one rotation.
    this.lidPivot = new THREE.Object3D();
    this.lidPivot.position.set(0, H, -D / 2);
    this.group.add(this.lidPivot);

    const lid = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W, 12, 1, false, 0, Math.PI), wood);
    lid.rotation.z = Math.PI / 2;
    lid.position.z = D / 2;
    this.lidPivot.add(lid);

    // Bands. These are what actually read at distance — a dark box in dark silt
    // is invisible, three horizontal metal lines are a made object.
    for (const x of [-W * 0.32, W * 0.32]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, H + 0.04, D + 0.06), iron);
      band.position.set(x, H / 2, 0);
      this.group.add(band);
      const lidBand = new THREE.Mesh(new THREE.BoxGeometry(0.12, D / 2 + 0.06, D / 2 + 0.06), iron);
      lidBand.position.set(x, 0, D / 4);
      this.lidPivot.add(lidBand);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.1), iron);
    lock.position.set(0, H - 0.1, D / 2 + 0.03);
    this.group.add(lock);

    // The light inside. Physical units — see config.js. Dead until it opens.
    this.light = new THREE.PointLight(0xffd08a, 0, 30, 1.5);
    this.light.position.set(0, H * 0.7, 0);
    this.group.add(this.light);

    // Silt mound, so it looks like it has been there a hundred years rather than
    // having been placed thirty seconds ago by a random number generator.
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(W * 0.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: CFG.palette.silt, roughness: 1, flatShading: true }),
    );
    mound.scale.set(1, 0.28, 1);
    mound.position.y = 0.02;
    this.group.add(mound);
  }

  /** @param {THREE.Vector3} playerPos */
  update(dt, playerPos) {
    this._t += dt;
    const C = CFG.chest;
    const d = this.position.distanceTo(playerPos);

    // Eased so swimming past leaves a shimmer rather than a switch flipping.
    const want = THREE.MathUtils.clamp(1 - (d - C.beaconRadius) / (C.glowRadius - C.beaconRadius), 0, 1);
    this._glow += (want - this._glow) * Math.min(1, dt * 2.2);

    const pulse = 0.75 + 0.25 * Math.sin(this._t * 1.7);
    this.ironMat.emissiveIntensity = this._glow * 1.5 * pulse + (this.open ? 1.6 : 0);

    if (this.open) {
      this._lid = Math.min(1, this._lid + dt * 0.9);
      // Ease-out, so the lid falls back on its hinge instead of arriving.
      this.lidPivot.rotation.x = -(1 - Math.pow(1 - this._lid, 3)) * 1.9;
      this.light.intensity = 40 + this._lid * 340 + Math.sin(this._t * 3.1) * 20 * this._lid;
    }
    return d;
  }

  openLid() {
    if (this.open) return false;
    this.open = true;
    return true;
  }

  /** A retry puts it back the way it was — same place, shut again. */
  close() {
    this.open = false;
    this._lid = 0;
    this.lidPivot.rotation.x = 0;
    this.light.intensity = 0;
  }

  setTrip(v) { this.light.distance = 30 * (1 + v * 0.5); }
}
