// Weed baggies — the game's currency.
//
// Four packs a bowl. They're deliberately small and a little dim: finding them is
// supposed to be an act of searching, which is what gives the lamp a job and the
// wreck a reason to be explored rather than admired.
//
// The one concession to findability is that they glint when the lamp crosses
// them. That's the whole tutorial for the lamp, delivered without a tooltip — you
// sweep the light, something twinkles back, and you've learned it.

import * as THREE from 'three';
import { CFG } from '../../config.js';

// Shared across every instance. One geometry and two materials for the whole
// population, so the only per-baggie cost is a transform.
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const bag = new THREE.BoxGeometry(0.42, 0.5, 0.16);
  // Pinch the top so it reads as a pouch rather than a box.
  const p = bag.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.42); p.setZ(i, p.getZ(i) * 0.5); }
  }
  bag.computeVertexNormals();

  SHARED = {
    bag,
    bagMat: new THREE.MeshStandardMaterial({
      color: 0x9fdf7a, roughness: 0.42, metalness: 0.0,
      transparent: true, opacity: 0.88,
      emissive: 0x2c5a22, emissiveIntensity: 0.4,
    }),
    tieMat: new THREE.MeshStandardMaterial({ color: 0xd8d2b0, roughness: 0.85 }),
    tie: new THREE.TorusGeometry(0.1, 0.03, 5, 10),
  };
  return SHARED;
}

export class Baggie {
  constructor(position) {
    const S = shared();
    this.group = new THREE.Group();
    this.group.position.copy(position);

    this.mesh = new THREE.Mesh(S.bag, S.bagMat.clone());
    this.group.add(this.mesh);

    const tie = new THREE.Mesh(S.tie, S.tieMat);
    tie.position.y = 0.24;
    tie.rotation.x = Math.PI / 2;
    this.group.add(tie);

    this.taken = false;
    this.respawnAt = 0;
    this.phase = Math.random() * Math.PI * 2;
    this._baseY = position.y;
    this._glint = 0;
  }

  update(dt, t, lamp) {
    if (this.taken) return;
    const S = CFG.stash;
    // Bob and slowly turn — movement is what catches the eye in fog.
    this.group.position.y = this._baseY + Math.sin(t * S.bobFreq + this.phase) * S.bobAmp;
    this.group.rotation.y += dt * 0.7;

    // Glint. Eased rather than binary so sweeping past leaves a shimmer.
    const lit = lamp ? lamp.illumination(this.group.position) : 0;
    this._glint += (lit - this._glint) * Math.min(1, dt * 7);
    this.mesh.material.emissiveIntensity = 0.4 + this._glint * 2.6;
  }

  take() {
    this.taken = true;
    this.group.visible = false;
    this.respawnAt = performance.now() / 1000 + CFG.stash.respawnDelay;
  }

  place(position) {
    this.group.position.copy(position);
    this._baseY = position.y;
    this.taken = false;
    this.group.visible = true;
    this._glint = 0;
  }

  setTrip(v) {
    this.mesh.material.opacity = 0.88 + v * 0.12;
  }
}
