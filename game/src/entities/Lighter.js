// The lighter.
//
// A fish brings it to you. That's better than hiding it in the wreck for two
// reasons: hunting a small dark object in deliberately bad visibility is
// frustrating rather than atmospheric, and having a creature swim out of the murk
// and hand you fire is a far better first thirty seconds than a scavenger hunt.
//
// Mechanically it's permanent and load-bearing — it gates every bong in the game
// — so it never stops mattering after the handover.
//
// This class is only the prop. It gets parented to the fish, released on
// handover, and fades out; the actual "you have fire now" state lives in
// Progress, and the visible payoff is the lamp flaring up in Lamp.js.

import * as THREE from 'three';

export class Lighter {
  constructor() {
    this.group = new THREE.Group();
    this.held = false;
    this._t = 0;

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xc9c2b4, roughness: 0.22, metalness: 0.92,
      emissive: 0xffb454, emissiveIntensity: 0.5,
      transparent: true, opacity: 1,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 0.12), this.bodyMat);
    this.group.add(body);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.14), this.bodyMat);
    lid.position.y = 0.24;
    this.group.add(lid);

    // A plasma torch, not a flint lighter — which is the fish's whole point, and
    // the reason anyone can light a bowl at the bottom of Lake Superior. Twin
    // electrodes with an arc between them: no flame, so there's nothing for the
    // water to put out.
    const elecMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.3, metalness: 0.9 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6), elecMat);
      e.position.set(s * 0.07, 0.36, 0);
      this.group.add(e);
    }

    // The arc itself. Additive and unfogged so it stays hot-looking at any range.
    this.arcMat = new THREE.MeshBasicMaterial({
      color: 0xdcefff, transparent: true, opacity: 0.95,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    this.arc = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.018, 0.018), this.arcMat);
    this.arc.position.y = 0.44;
    this.group.add(this.arc);

    // Halo around the arc, which is what actually reads from a distance.
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x9ec4ff, transparent: true, opacity: 0.5,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), this.glowMat);
    this.glow.position.y = 0.44;
    this.group.add(this.glow);

    // Physical units (see config.js). Once it's in the diver's glove this is a
    // real light source throwing warm flicker across the lake floor, not a decal
    // — that pool of moving light on the silt is the whole point of the handover.
    this.light = new THREE.PointLight(0x9ec4ff, 30, 16, 1.5);
    this.light.position.y = 0.44;
    this.group.add(this.light);
  }

  update(dt) {
    this._t += dt;
    // An arc doesn't breathe like a flame — it buzzes. Fast jitter over a much
    // faster carrier, with the occasional near-dropout, reads as electrical.
    const buzz = 0.72 + Math.random() * 0.5;
    const carrier = 0.88 + Math.sin(this._t * 47) * 0.12;
    const f = buzz * carrier;

    this.arc.scale.set(1, f * 1.4, f * 1.4);
    this.arcMat.opacity = 0.6 + f * 0.4;
    this.glow.scale.setScalar(f);
    this.glowMat.opacity = 0.32 + f * 0.3;
    this.light.intensity = (this.held ? HELD_INTENSITY : 30) * f;

    if (!this.held) this.group.rotation.y += dt * 0.9;
  }

  /**
   * Parent it into the diver's glove, keeping it upright in his hand.
   * @param {THREE.Object3D} hand
   */
  attachTo(hand) {
    hand.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.held = true;
  }
}

// Bright enough to genuinely light the seabed underneath the pair.
const HELD_INTENSITY = 460;
