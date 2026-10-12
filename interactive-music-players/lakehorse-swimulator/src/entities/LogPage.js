// A page of the Enias's log.
//
// Same trick as the jars: dim, and it glints when the lamp crosses it. Finding
// one is an act of looking rather than an act of arriving, which is the only
// thing that makes a collectible worth collecting.
//
// It's a slate rather than paper, because paper in a hundred years of Superior
// would be silt. The ship's log was kept in pencil on a slate board, and slate
// keeps — which is a convenient truth as well as a nice one.
//
// Scaled up with the stash and for the same reason: under a unit across inside a
// pickup radius of three, it was a target nobody could aim at. A board a diver
// would actually have written on is about this size anyway, so the old one was
// wrong twice.

import * as THREE from 'three';

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const slate = new THREE.BoxGeometry(1.80, 2.38, 0.14);
  SHARED = {
    slate,
    mat: new THREE.MeshStandardMaterial({
      color: 0x39434a, roughness: 0.7, metalness: 0.1,
      emissive: 0x9ad7ff, emissiveIntensity: 0.12,
    }),
    frameMat: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9 }),
    frame: new THREE.BoxGeometry(2.09, 2.67, 0.09),
  };
  return SHARED;
}

export class LogPage {
  /**
   * @param {THREE.Vector3} position
   * @param {{id:string, title:string, body:string}} entry
   */
  constructor(position, entry) {
    const S = shared();
    this.entry = entry;
    this.taken = false;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.set(-1.1, Math.random() * 6.28, Math.random() * 0.6 - 0.3);

    this.frame = new THREE.Mesh(S.frame, S.frameMat);
    this.group.add(this.frame);
    this.mesh = new THREE.Mesh(S.slate, S.mat.clone());
    this.mesh.position.z = 0.03;
    this.group.add(this.mesh);

    this.phase = Math.random() * Math.PI * 2;
    this._baseY = position.y;
    this._glint = 0;
  }

  update(dt, t, lamp) {
    if (this.taken) return;
    // Barely moves — it's lying where it fell, not drifting like a baggie.
    this.group.position.y = this._baseY + Math.sin(t * 0.6 + this.phase) * 0.05;
    const lit = lamp ? lamp.illumination(this.group.position) : 0;
    this._glint += (lit - this._glint) * Math.min(1, dt * 7);
    this.mesh.material.emissiveIntensity = 0.12 + this._glint * 2.2;
  }

  take() {
    this.taken = true;
    this.group.visible = false;
  }
}
