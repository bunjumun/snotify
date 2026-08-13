// The diver — a verlet chain, not an animation.
//
// He is simulated rope with a man on the end. Nothing about his motion is
// authored: he trails because the solver drags him, swings wide because a turn
// throws him outward, and snaps taut on boost because the constraint says so.
// That gets "holding on for dear life" for roughly the cost of a for-loop, and it
// stays correct in situations no animator would have thought to cover.
//
// There is no air hose. He had one in an earlier cut, trailing off into the dark
// toward a tender on the surface — which is a beautiful read in the reference
// photos and a lie here. There is no boat up there. There is no up there. His air
// is whatever is in the suit, which is also why he floats.
//
// Grip is the mechanic on top: sustained boost builds strain, past the threshold
// he lets go, and you have to circle back for him while breath keeps draining.
//
// The suit is dazzle-camouflaged, painted procedurally in _dazzleTexture(). It's
// the site's own livery, it's period-correct for a wreck, and practically it
// makes the one thing you have to keep track of legible in eighty units of murk.

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

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    // Scratch for the prone pose. Allocating these per frame is how you hand the
    // GC a stutter on a phone.
    this._fwd = new THREE.Vector3();
    this._down = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._basis = new THREE.Matrix4();
    this._q = new THREE.Quaternion();

    // ---- Materials ----
    this.brassMat = new THREE.MeshStandardMaterial({
      color: P.brass, roughness: 0.34, metalness: 0.85,
    });
    // White base: the dazzle texture carries the colour, and `color` is left
    // free to tint the whole suit when he goes adrift.
    this.canvasMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: this._dazzleTexture(), roughness: 0.95,
    });
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0x4a4237, roughness: 0.9 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fd4d8, roughness: 0.08, metalness: 0.2,
      transparent: true, opacity: 0.55, emissive: 0x1d3f44, emissiveIntensity: 0.5,
    });

    this._buildBody();
    this._buildRopes();
  }

  /**
   * Dazzle camouflage, painted once into a canvas and used as the suit's map.
   *
   * Dazzle never hid a ship. It broke up the cues you'd use to read a hull's
   * heading and speed, which is a good joke on a man being towed backwards
   * through fog on the end of a rope, and it puts the only high-contrast thing
   * in the lake on the character you most need to keep track of.
   *
   * The pattern is panels of parallel stripes at deliberately conflicting
   * angles — it's the disagreement between neighbouring panels that does the
   * work, so the panels are irregular, sheared, and never share a slope with
   * the one beside them. The wrap seam down his back isn't hidden either: on a
   * dazzle pattern one more hard edge just reads as one more panel, which makes
   * this the one place a seam is free.
   */
  _dazzleTexture() {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
    const P = CFG.palette;

    g.fillStyle = hex(P.suitLight);
    g.fillRect(0, 0, S, S);

    let x = -S * 0.1;
    let panel = 0;
    while (x < S) {
      const w = S * (0.11 + Math.random() * 0.17);
      const skew = (Math.random() - 0.5) * S * 0.4;   // panels aren't rectangles
      g.save();
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + w, 0);
      g.lineTo(x + w + skew, S);
      g.lineTo(x + skew, S);
      g.closePath();
      g.clip();

      // Slope flips hard between neighbours. That contrast IS the camouflage;
      // a consistent angle would just be a deck chair.
      g.translate(x + w / 2, S / 2);
      g.rotate((panel % 2 ? 1 : -1) * (0.5 + Math.random() * 0.7));
      g.fillStyle = hex(panel % 3 === 2 ? P.suitMid : P.suitDark);
      const band = 6 + Math.random() * 13;
      for (let y = -S; y < S; y += band * 2) g.fillRect(-S, y, S * 2, band);
      g.restore();

      x += w;
      panel++;
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1.4);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
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

    const head = this.chain[this.chain.length - 1];
    this._placeBody(head, dt, kelpie);
    this._layRope(this.ropeSegs, this.chain);
  }

  _integrate(points, dt, drag, gravity) {
    for (const p of points) {
      if (p.pinned) { p.prev.copy(p.pos); continue; }
      this._tmp.copy(p.pos).sub(p.prev).multiplyScalar(drag);
      p.prev.copy(p.pos);
      p.pos.add(this._tmp);
      p.pos.y += gravity * dt * dt * 60;
      // A little sway so nothing ever hangs perfectly still in moving water.
      // Small: this is a man riding, and any more of it reads as a man bobbing.
      p.pos.x += Math.sin(performance.now() * 0.0011 + p.pos.z) * 0.0006;
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

  _placeBody(head, dt, kelpie) {
    this.body.position.copy(head.pos);

    // Prone, head first, belly toward her back: a man lying along the top of a
    // swimming animal, not a man dangling off the back of one. He used to look
    // back down the rope, which is honest for something being towed and reads as
    // a corpse the moment he is also floating.
    //
    // His model is built upright — local +Y is his head, local +Z is his face —
    // so the basis puts +Y along her heading and +Z pointing down at her.
    if (kelpie) {
      this._fwd.set(0, 0, -1).applyQuaternion(kelpie.quaternion);
      this._down.set(0, -1, 0).applyQuaternion(kelpie.quaternion);
      this._side.crossVectors(this._fwd, this._down).normalize();
      this._basis.makeBasis(this._side, this._fwd, this._down);
      this._q.setFromRotationMatrix(this._basis);
      // Slerped, not assigned, so the rope still throws him around a little on a
      // hard turn instead of welding him to her heading.
      this.body.quaternion.slerp(this._q, 1 - Math.exp(-7 * dt));
    }

    // Arms strain visibly as grip runs out — the warning before he lets go.
    const strain = 1 - this.grip / CFG.diver.gripMax;
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.x = -1.15 - strain * 0.45;
    }
    // Adrift, the dazzle goes muddy — he stops being the brightest thing down
    // here at exactly the moment you need to find him.
    this.canvasMat.color.setHex(this.adrift ? CFG.palette.suitAdrift : 0xffffff);
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

  /** Where the next rider down the line ties on: this one's own body. */
  hitchPoint(out) {
    return out.copy(this.chain[this.chain.length - 1].pos);
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
    // Up and back from the grip, which is where he actually rides.
    for (let i = 0; i < this.chain.length; i++) {
      this.chain[i].pos.copy(anchor).add(this._tmp.set(0, 0.3 * i, CFG.diver.linkLength * i));
      this.chain[i].prev.copy(this.chain[i].pos);
    }
  }
}
