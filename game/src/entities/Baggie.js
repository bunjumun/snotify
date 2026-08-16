// Mason jars of weed — the game's currency.
//
// A jar holds an eighth, a quarter or a half, and eight eighths pack a bowl.
// They were baggies once, and small on purpose: finding them was meant to be an
// act of searching, which is what gave the lamp a job.
//
// **The fraction has to be readable from across the fog, with no number on it.**
// That is the whole difficulty of the change, and it is answered twice over,
// because either signal alone fails somewhere:
//
//  - **Size.** The jar scales by the cube root of its fraction, so the eye
//    reads volume rather than height. It is the signal that survives distance
//    and it is the one that is useless up close, where everything is big.
//  - **Fill.** The weed inside stands at the fraction's own height in the jar,
//    with the glass empty above it. It is the signal that survives being close
//    and is invisible at range, where a jar is four pixels of green.
//
// Cube root rather than linear on purpose: a half at linear scale is four times
// an eighth, which puts the small jar well inside the pickup radius of 4 and
// undoes the thing this prop was redrawn for — that what you see is what you
// hit. At the cube root the spread is 0.79 to 1.26 and the sphere still fits
// the picture at both ends.
//
// That intent survives the change of prop but the scale did not deserve to. A
// baggie was half a unit tall inside a pickup radius of nearly three, so you
// aimed at a speck and an invisible sphere five times its size did the actual
// collecting. What reads as "hard to find" and what reads as "the collision does
// not match the picture" are different things, and only the first one was ever
// wanted. The jar is roughly the size of the sphere that takes it, so what you
// see is what you hit.
//
// Glass earns the rest back. A jar is a worse thing to spot than a baggie at
// distance, because it is mostly transparent and takes the fog's colour, and a
// better one to spot with the lamp, because glass throws a highlight back at
// you where a plastic pouch just goes pale. The glint is still the whole
// tutorial for the lamp, delivered without a tooltip.
//
// Three meshes rather than the old two, all sharing one geometry set and two of
// three materials, so the cost of the change is one extra draw call per jar and
// nothing per-instance but a transform and a cloned glass material.

import * as THREE from 'three';
import { CFG } from '../../config.js';

// Shared across every instance. Segment counts are deliberately low: there can
// be 26 of these on Chill, most of them in fog, and nobody has ever inspected
// the silhouette of a jar closely enough to count its sides.
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;

  // A lathe profile rather than a cylinder, because the shoulder is the whole
  // reason a mason jar reads as a mason jar and not as a tin. Radius against
  // height, bottom to top, in the jar's own local space.
  const profile = [
    [0.00, -1.10], [0.60, -1.10], [0.64, -1.02],   // base and its slight flare
    [0.64,  0.42], [0.58,  0.62],                   // straight side, then in
    [0.44,  0.80], [0.42,  0.96],                   // shoulder, then the neck
  ].map(([r, y]) => new THREE.Vector2(r, y));

  SHARED = {
    glass: new THREE.LatheGeometry(profile, 10),
    // Sits just inside the glass and stops at the shoulder, so the jar reads as
    // packed rather than full to the lid. Open-ended: the top is under the lid
    // and the bottom is under the glass base, and neither is ever seen.
    weed: new THREE.CylinderGeometry(0.56, 0.54, 1.58, 9, 1, true),
    lid: new THREE.CylinderGeometry(0.46, 0.44, 0.20, 10),

    glassMat: new THREE.MeshStandardMaterial({
      color: 0xbcdfd2, roughness: 0.10, metalness: 0.0,
      transparent: true, opacity: 0.30,
      // The glint lives here. Cloned per instance in the constructor so each jar
      // can answer the lamp on its own.
      emissive: 0x2f5f52, emissiveIntensity: 0.25,
      side: THREE.DoubleSide,   // you can see the far wall through the near one
    }),
    // Deliberately matte and dark against the glass. Weed lit like a gemstone
    // stops reading as a plant, and the one thing that should catch the light
    // here is the jar.
    weedMat: new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.95, metalness: 0.0 }),
    lidMat: new THREE.MeshStandardMaterial({ color: CFG.palette.brass, roughness: 0.45, metalness: 0.7 }),
  };
  return SHARED;
}

// The weed cylinder is 1.58 tall and centred at -0.28, so it stands from -1.07
// to 0.51 in the jar's own space. Filling it part way means scaling in Y and
// pushing the centre back up by half of what was lost, so the weed keeps
// sitting on the bottom of the jar instead of hovering in the middle of it.
const WEED_BASE = -1.07;
const WEED_HEIGHT = 1.58;

export class Baggie {
  /**
   * @param {THREE.Vector3} position
   * @param {number} [eighths] what the jar is worth: 1, 2 or 4. Defaults to a
   *   quarter, which is what every jar was before fractions existed.
   */
  constructor(position, eighths = 2) {
    const S = shared();
    this.group = new THREE.Group();
    this.group.position.copy(position);

    // `mesh` stays the glass, because that is what glints and the rest of the
    // file already talks to `this.mesh.material` about exactly that.
    this.mesh = new THREE.Mesh(S.glass, S.glassMat.clone());
    this.group.add(this.mesh);

    const weed = new THREE.Mesh(S.weed, S.weedMat);
    this._weed = weed;
    this.group.add(weed);

    const lid = new THREE.Mesh(S.lid, S.lidMat);
    lid.position.y = 1.04;
    this.group.add(lid);

    this.taken = false;
    this.respawnAt = 0;
    this.phase = Math.random() * Math.PI * 2;
    this._baseY = position.y;
    this._glint = 0;
    // A jar has an up, where a pouch did not. Tilting each one differently stops
    // a shelf of them looking like a shop display.
    this.group.rotation.z = (Math.random() - 0.5) * 0.5;
    this.group.rotation.x = (Math.random() - 0.5) * 0.4;

    this.setFraction(eighths);
  }

  /**
   * Set what this jar is worth and redraw it to match. Separate from the
   * constructor because a jar is reused: `place()` reseeds it somewhere else,
   * and reseeding it at the same size every time would mean the level's mix of
   * fractions slowly froze into whatever the first layout happened to roll.
   *
   * @param {number} eighths 1, 2 or 4
   */
  setFraction(eighths) {
    this.eighths = eighths;
    // Volume, not height. See the header for why this is a cube root.
    this.group.scale.setScalar(Math.pow(eighths / 2, CFG.stash.sizeExponent));
    // Fill runs 0.55 to 1.0 rather than 0.25 to 1.0. The two signals multiply,
    // so a literal fill on top of a cube-root size would leave an eighth-jar
    // holding a smear of green nobody would read as weed at all. Overstating
    // the small end is the right error here: the jar still reads as the least
    // of the three, which is all the fill has to say.
    const fill = 0.55 + 0.45 * ((eighths - 1) / 3);
    this._weed.scale.y = fill;
    this._weed.position.y = WEED_BASE + (WEED_HEIGHT * fill) / 2;
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
    this.mesh.material.emissiveIntensity = 0.25 + this._glint * 2.4;
    // Glass also goes from nearly invisible to obviously there. Opacity is what
    // sells a highlight on something transparent; brightening alone just makes a
    // pale shape paler.
    this.mesh.material.opacity = 0.30 + this._glint * 0.42;
  }

  take() {
    this.taken = true;
    this.group.visible = false;
    this.respawnAt = performance.now() / 1000 + CFG.stash.respawnDelay;
  }

  place(position, eighths = this.eighths) {
    this.group.position.copy(position);
    this._baseY = position.y;
    this.taken = false;
    this.group.visible = true;
    this._glint = 0;
    if (eighths !== this.eighths) this.setFraction(eighths);
  }

  setTrip(v) {
    this.mesh.material.opacity = 0.30 + v * 0.30;
  }
}
