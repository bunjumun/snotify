// The diver — a verlet chain, not an animation.
//
// He is simulated rope with a man on the end. Nothing about his motion is
// authored: he trails because the solver drags him, swings wide because a turn
// throws him outward, and snaps taut on boost because the constraint says so.
// That gets "holding on for dear life" for roughly the cost of a for-loop, and it
// stays correct in situations no animator would have thought to cover.
//
// The same solver draws his air hose trailing off into the murk, which is free
// atmosphere and one of the strongest reads in the reference photos.
//
// Grip is the mechanic on top: sustained boost builds strain, past the threshold
// he lets go, and you have to circle back for him while breath keeps draining.

import * as THREE from 'three';
import { CFG } from '../../config.js';

/** One verlet particle. */
class Point {
  constructor(x, y, z) {
    this.pos = new THREE.Vector3(x, y, z);
    this.prev = new THREE.Vector3(x, y, z);
    this.pinned = false;
  }
}

export class Diver {
  constructor() {
    const P = CFG.palette;
    const D = CFG.diver;
    this.group = new THREE.Group();

    this.attached = true;
    this.grip = D.gripMax;
    this.adrift = false;

    // ---- Chains ----
    this.chain = [];
    for (let i = 0; i < D.links; i++) this.chain.push(new Point(0, -8, 40 + i * D.linkLength));
    this.chain[0].pinned = true;

    this.hose = [];
    for (let i = 0; i < D.hoseLinks; i++) this.hose.push(new Point(0, -8, 40 + i * D.hoseLength));

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    // ---- Materials ----
    this.brassMat = new THREE.MeshStandardMaterial({
      color: P.brass, roughness: 0.34, metalness: 0.85,
    });
    this.canvasMat = new THREE.MeshStandardMaterial({ color: P.canvas, roughness: 0.95 });
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0x4a4237, roughness: 0.9 });
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.85 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fd4d8, roughness: 0.08, metalness: 0.2,
      transparent: true, opacity: 0.55, emissive: 0x1d3f44, emissiveIntensity: 0.5,
    });

    this._buildBody();
    this._buildRopes();
  }

  _buildBody() {
    this.body = new THREE.Group();

    // Suit: bulky canvas, weighted low.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 4, 10), this.canvasMat);
    this.body.add(torso);

    // Helmet: the brass Mark V. Its porthole is the only warm colour on him and
    // the thing that catches the lamp, so it gets the extra geometry.
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), this.brassMat);
    helm.position.y = 0.62;
    this.body.add(helm);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.36, 0.14, 12), this.brassMat);
    collar.position.y = 0.4;
    this.body.add(collar);

    const port = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), this.glassMat);
    port.position.set(0, 0.63, 0.29);
    this.body.add(port);
    this.porthole = port;

    const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.028, 6, 16), this.brassMat);
    portRing.position.set(0, 0.63, 0.29);
    this.body.add(portRing);

    // Side ports, straight off the reference photo.
    for (const s of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.CircleGeometry(0.075, 10), this.glassMat);
      sp.position.set(s * 0.27, 0.64, 0.1);
      sp.rotation.y = s * 1.1;
      this.body.add(sp);
    }

    // Arms, reaching forward toward the grip — the pose does the storytelling.
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.62, 3, 6), this.canvasMat);
      arm.position.set(s * 0.3, 0.24, 0.3);
      arm.rotation.set(-1.15, 0, s * 0.22);
      this.body.add(arm);
      this.arms.push(arm);
    }

    // An empty at the right glove. The lighter gets parented here once a fish
    // hands it over, so it rides with him properly instead of being positioned
    // by hand every frame — and the light source is then genuinely wherever his
    // hand actually is, including while he's swinging around on a hard turn.
    this.hand = new THREE.Object3D();
    this.hand.position.set(0.36, 0.46, 0.62);
    this.body.add(this.hand);

    // Boots: heavy, and they hang. Weight is the whole silhouette.
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 3, 6), this.canvasMat);
      leg.position.set(s * 0.15, -0.55, 0);
      this.body.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.3), this.brassMat);
      boot.position.set(s * 0.15, -0.86, 0.05);
      this.body.add(boot);
    }

    this.group.add(this.body);
  }

  /** Rope drawn as short cylinders — WebGL line width is capped at 1px on nearly
   *  every platform, so a LineBasicMaterial rope is invisible in this much fog. */
  _buildRopes() {
    this.ropeSegs = [];
    for (let i = 0; i < CFG.diver.links - 1; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), this.ropeMat);
      m.geometry.translate(0, 0.5, 0); // pivot at one end so scale.y spans the link
      this.ropeSegs.push(m);
      this.group.add(m);
    }
    this.hoseSegs = [];
    for (let i = 0; i < CFG.diver.hoseLinks - 1; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 5), this.hoseMat);
      m.geometry.translate(0, 0.5, 0);
      this.hoseSegs.push(m);
      this.group.add(m);
    }
  }

  /** @param {THREE.Vector3} anchor where the kelpie's grip point is this frame */
  update(dt, anchor, kelpie) {
    const D = CFG.diver;

    // ---- Grip strain ----
    if (this.attached) {
      if (kelpie.boosting) {
        this.grip -= D.gripStrainPerSec * dt;
        if (this.grip <= 0) this._letGo(kelpie);
      } else {
        this.grip = Math.min(D.gripMax, this.grip + D.gripRecoverPerSec * dt);
      }
    }

    // ---- Tether ----
    if (this.attached) {
      this.chain[0].pos.copy(anchor);
      this.chain[0].pinned = true;
    } else {
      this.chain[0].pinned = false;
      // Adrift: drift gently and check whether the kelpie has come back for him.
      const d = this.chain[0].pos.distanceTo(anchor);
      if (d < D.regrabRadius) this._grab();
    }

    this._integrate(this.chain, dt, D.drag, D.gravity);
    for (let it = 0; it < D.solverIterations; it++) this._constrain(this.chain, D.linkLength, D.stiffness);

    // ---- Hose ----
    // Anchored at the helmet, the far end left free so it wanders off into the
    // dark. Lighter than the rope so it floats rather than hangs.
    const head = this.chain[this.chain.length - 1];
    this.hose[0].pos.copy(head.pos);
    this.hose[0].pinned = true;
    this._integrate(this.hose, dt, 0.97, 0.35);
    for (let it = 0; it < 3; it++) this._constrain(this.hose, D.hoseLength, 0.5);

    this._placeBody(head, dt);
    this._layRope(this.ropeSegs, this.chain);
    this._layRope(this.hoseSegs, this.hose);
  }

  _integrate(points, dt, drag, gravity) {
    for (const p of points) {
      if (p.pinned) { p.prev.copy(p.pos); continue; }
      this._tmp.copy(p.pos).sub(p.prev).multiplyScalar(drag);
      p.prev.copy(p.pos);
      p.pos.add(this._tmp);
      p.pos.y += gravity * dt * dt * 60;
      // A little sway so nothing ever hangs perfectly still in moving water.
      p.pos.x += Math.sin(performance.now() * 0.0011 + p.pos.z) * 0.0016;
    }
  }

  _constrain(points, restLength, stiffness) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      this._tmp.copy(b.pos).sub(a.pos);
      const d = this._tmp.length() || 0.0001;
      const diff = ((d - restLength) / d) * stiffness;
      this._tmp.multiplyScalar(diff * 0.5);
      if (!a.pinned) a.pos.add(this._tmp);
      if (!b.pinned) b.pos.sub(this._tmp);
    }
  }

  _placeBody(head, dt) {
    this.body.position.copy(head.pos);

    // Face back along the rope — he's being towed, so he looks where he came from
    // as much as where he's going. Upright-ish because the boots are weighted.
    const prev = this.chain[this.chain.length - 2];
    this._tmp.copy(head.pos).sub(prev.pos).normalize();
    this._tmp2.copy(head.pos).add(this._tmp);
    this.body.lookAt(this._tmp2);
    // Weighted boots fight the tow, so blend the roll back toward upright.
    this.body.rotation.z *= 0.35;

    // Arms strain visibly as grip runs out — the warning before he lets go.
    const strain = 1 - this.grip / CFG.diver.gripMax;
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.x = -1.15 - strain * 0.45;
    }
    this.canvasMat.color.setHex(this.adrift ? 0x55503f : CFG.palette.canvas);
  }

  _layRope(segs, points) {
    for (let i = 0; i < segs.length; i++) {
      const a = points[i].pos, b = points[i + 1].pos;
      const seg = segs[i];
      seg.position.copy(a);
      this._tmp.copy(b).sub(a);
      const len = this._tmp.length();
      seg.scale.set(1, len, 1);
      this._tmp.normalize();
      seg.quaternion.setFromUnitVectors(this._up, this._tmp);
    }
  }

  _letGo(kelpie) {
    this.attached = false;
    this.adrift = true;
    this.grip = 0;
    // Fling him with whatever the kelpie was doing — the moment should read as
    // being thrown off, not as quietly detaching.
    const p0 = this.chain[0];
    p0.prev.copy(p0.pos).addScaledVector(kelpie.velocity, -0.012);
    if (this.onLetGo) this.onLetGo();
  }

  _grab() {
    this.attached = true;
    this.adrift = false;
    this.grip = CFG.diver.gripMax * 0.55; // winded, not fresh
    if (this.onGrab) this.onGrab();
  }

  /** Helmet position — bubbles stream from here. */
  helmetPosition(out) {
    const head = this.chain[this.chain.length - 1];
    return out.copy(head.pos).add(this._tmp.set(0, 0.62, 0));
  }

  /** World position of the glove holding the lighter — the actual light source. */
  handPosition(out) {
    this.hand.getWorldPosition(out);
    return out;
  }

  setTrip(v) {
    this.glassMat.emissiveIntensity = 0.5 + v * 2.2;
    this.brassMat.metalness = 0.85 - v * 0.3;
  }

  reset(anchor) {
    this.attached = true;
    this.adrift = false;
    this.grip = CFG.diver.gripMax;
    for (let i = 0; i < this.chain.length; i++) {
      this.chain[i].pos.copy(anchor).add(this._tmp.set(0, -0.2 * i, CFG.diver.linkLength * i));
      this.chain[i].prev.copy(this.chain[i].pos);
    }
    for (let i = 0; i < this.hose.length; i++) {
      this.hose[i].pos.copy(this.chain[this.chain.length - 1].pos)
        .add(this._tmp.set(0, 0.3 * i, CFG.diver.hoseLength * i));
      this.hose[i].prev.copy(this.hose[i].pos);
    }
  }
}
