// The SS Enias.
//
// Deliberately fictional. Lake Superior's famous wrecks are war graves — the
// Fitzgerald still holds 29 people and is legally protected — and building a
// treasure hunt on top of one would be a bad look for a band that plays there.
// The Enias is invented, so the lake's atmosphere is borrowed without borrowing
// anyone's grave.
//
// Broken in two, the way Superior actually does it: bow section largely intact
// and heeled over, stern section further off and collapsed, a debris trail spilled
// down the trench between them. The hull is generated parametrically from ship
// stations rather than modelled, which gets a real sheer and a fine entry at the
// bow for about forty lines.
//
// Every named piece registers a landmark, because the clue system speaks in
// landmarks ("in the shadow of the broken boiler") and those strings have to
// point at something that genuinely exists.

import * as THREE from 'three';
import { CFG } from '../../config.js';

export class Wreck {
  /**
   * @param {import('../core/Rng.js').Rng} rng
   * @param {import('./Seabed.js').Seabed} seabed
   */
  constructor(rng, seabed) {
    this.group = new THREE.Group();
    this.seabed = seabed;
    this.landmarks = [];

    const P = CFG.palette;
    this.woodMat = new THREE.MeshStandardMaterial({
      color: P.wreckWood, roughness: 0.98, metalness: 0.0, flatShading: true,
    });
    this.encrustMat = new THREE.MeshStandardMaterial({
      color: 0x35443c, roughness: 1.0, metalness: 0.0, flatShading: true,
    });
    this.ironMat = new THREE.MeshStandardMaterial({
      color: 0x2b2a26, roughness: 0.72, metalness: 0.55,
    });

    this._buildBow(rng);
    this._buildStern(rng);
    this._buildBoiler(rng);
    this._buildDebris(rng);
    this._buildMasts(rng);
  }

  _mark(name, pos, radius = 14) {
    this.landmarks.push({ name, position: pos.clone(), radius });
  }

  /** Ground a section on the seabed and heel it over, the way a hull settles. */
  _settle(obj, x, z, heel, yaw, lift = 0) {
    obj.position.set(x, this.seabed.heightAt(x, z) + lift, z);
    obj.rotation.set(0, yaw, heel);
    return obj;
  }

  /**
   * Parametric hull. Stations run stern→bow; each is a section from port deck
   * edge, down around the keel, up to starboard. `entry` sharpens the bow.
   */
  _hullGeometry(len, beam, depth, { stations = 26, ring = 12, entry = 0.85, cut = 1.0 } = {}) {
    const verts = [], idx = [], uvs = [];
    for (let i = 0; i <= stations; i++) {
      const t = (i / stations) * cut;
      const z = (t - 0.5) * len;
      // Beam is fullest just aft of midship and tapers to nothing at the stem.
      const bw = (beam * 0.5) * Math.pow(Math.sin(Math.PI * Math.pow(t, entry)), 0.62);
      // Sheer: deeper amidships, rising fore and aft.
      const dp = depth * (0.58 + 0.42 * Math.sin(Math.PI * t));
      for (let j = 0; j <= ring; j++) {
        const u = (j / ring) * 2 - 1;
        const side = u === 0 ? 1 : Math.sign(u);
        const a = Math.abs(u) * Math.PI * 0.5;
        verts.push(
          side * bw * Math.pow(Math.sin(a), 0.75),
          -dp * Math.pow(Math.cos(a), 1.3),
          z,
        );
        uvs.push(j / ring, i / stations);
      }
    }
    for (let i = 0; i < stations; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * (ring + 1) + j;
        const b = a + ring + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _buildBow(rng) {
    const g = new THREE.Group();
    const LEN = 62, BEAM = 15, DEPTH = 9;

    // Only the forward ~62% survives; the break is where the stern tore away.
    const hull = new THREE.Mesh(
      this._hullGeometry(LEN, BEAM, DEPTH, { cut: 1.0, entry: 0.8 }),
      this.encrustMat,
    );
    hull.material.side = THREE.DoubleSide;
    g.add(hull);

    // Deck, stopping short of the break so the hold is open to the water.
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(BEAM * 0.82, LEN * 0.66, 6, 16), this.woodMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 0.1, LEN * 0.16);
    deck.material.side = THREE.DoubleSide;
    g.add(deck);

    // Exposed frames along the torn edge — the strongest read in the reference
    // photos and what makes it look broken rather than merely sunk.
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const z = -LEN * 0.5 + t * LEN * 0.3;
      const w = BEAM * 0.5 * Math.pow(Math.sin(Math.PI * Math.pow((z / LEN) + 0.5, 0.8)), 0.62);
      for (const s of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.42, DEPTH * rng.float(0.7, 1.15), 0.42), this.woodMat);
        rib.position.set(s * w * 0.96, -DEPTH * 0.3 + rng.float(0, 1.2), z);
        rib.rotation.z = s * rng.float(0.08, 0.3);
        g.add(rib);
      }
    }

    // Bulwark rail down both sides.
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, LEN * 0.6), this.woodMat);
      rail.position.set(s * BEAM * 0.42, 0.45, LEN * 0.18);
      rail.rotation.z = s * 0.06;
      g.add(rail);
    }

    // Bowsprit.
    const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 12, 7), this.woodMat);
    sprit.rotation.set(-1.35, 0, 0);
    sprit.position.set(0, 2.2, LEN * 0.52);
    g.add(sprit);

    this._settle(g, 8, -34, -0.34, 0.22, 6.5);
    this.group.add(g);
    this.bow = g;
    this._mark('the bow', new THREE.Vector3(8, this.seabed.heightAt(8, -34) + 6, -34), 22);
    this._mark('the open hold', new THREE.Vector3(4, this.seabed.heightAt(4, -14) + 4, -14), 14);
  }

  _buildStern(rng) {
    const g = new THREE.Group();
    const LEN = 34, BEAM = 14, DEPTH = 8;

    const hull = new THREE.Mesh(
      this._hullGeometry(LEN, BEAM, DEPTH, { cut: 0.62, entry: 1.4 }),
      this.encrustMat,
    );
    hull.material.side = THREE.DoubleSide;
    g.add(hull);

    // Collapsed transom, folded inward.
    const transom = new THREE.Mesh(new THREE.BoxGeometry(BEAM * 0.75, 5.5, 0.6), this.woodMat);
    transom.position.set(0, -1.5, -LEN * 0.34);
    transom.rotation.x = 0.55;
    g.add(transom);

    // Rudder and prop shaft: iron, so they survived better than the timber.
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 3.2), this.ironMat);
    rudder.position.set(0, -4.5, -LEN * 0.4);
    rudder.rotation.y = 0.4;
    g.add(rudder);

    // Deck planking, mostly gone — a few surviving strakes.
    for (let i = 0; i < 7; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, LEN * rng.float(0.2, 0.5)), this.woodMat);
      plank.position.set(rng.float(-BEAM * 0.35, BEAM * 0.35), 0.15, rng.float(-LEN * 0.2, LEN * 0.2));
      plank.rotation.y = rng.float(-0.2, 0.2);
      g.add(plank);
    }

    this._settle(g, -52, 46, 0.62, -0.9, 4.0);
    this.group.add(g);
    this.stern = g;
    this._mark('the stern', new THREE.Vector3(-52, this.seabed.heightAt(-52, 46) + 4, 46), 20);
  }

  _buildBoiler() {
    // The boiler is the single most recognisable object down here and the clue
    // system leans on it by name, so it gets to be big, iron, and unmistakable.
    const g = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 9, 16), this.ironMat);
    shell.rotation.z = Math.PI / 2;
    g.add(shell);

    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.22, 6, 20), this.ironMat);
      band.rotation.y = Math.PI / 2;
      band.position.x = -3.2 + i * 2.1;
      g.add(band);
    }
    // Firebox door, hanging open.
    const door = new THREE.Mesh(new THREE.CircleGeometry(1.5, 14), this.ironMat);
    door.position.set(4.6, 0, 0.9);
    door.rotation.set(0, 1.1, 0);
    door.material.side = THREE.DoubleSide;
    g.add(door);

    const x = -18, z = 14;
    g.position.set(x, this.seabed.heightAt(x, z) + 3.2, z);
    g.rotation.set(0.18, 0.7, 0.12);
    this.group.add(g);
    this.boiler = g;
    this._mark('the broken boiler', new THREE.Vector3(x, this.seabed.heightAt(x, z) + 3, z), 16);
  }

  _buildDebris(rng) {
    // Instanced planks spilled down the trench between the two sections. One draw
    // call for 300 objects; individually meshed this would be the level's whole
    // performance budget.
    const geo = new THREE.BoxGeometry(1, 0.22, 4.2);
    const mesh = new THREE.InstancedMesh(geo, this.woodMat, 300);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();

    for (let i = 0; i < 300; i++) {
      // Biased along the line from bow to stern — a trail, not a scatter.
      const t = rng.float(-0.15, 1.15);
      const x = THREE.MathUtils.lerp(8, -52, t) + rng.float(-16, 16);
      const z = THREE.MathUtils.lerp(-34, 46, t) + rng.float(-16, 16);
      p.set(x, this.seabed.heightAt(x, z) + rng.float(0.05, 0.5), z);
      e.set(rng.float(-0.3, 0.3), rng.float(0, 6.28), rng.float(-0.3, 0.3));
      q.setFromEuler(e);
      s.set(rng.float(0.5, 1.5), 1, rng.float(0.4, 1.6));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.debris = mesh;
    this._mark('the debris trail', new THREE.Vector3(-22, this.seabed.heightAt(-22, 6) + 2, 6), 30);
  }

  _buildMasts(rng) {
    // Down, of course. A standing mast would read as a ship at anchor.
    const specs = [
      { x: -6, z: 4, len: 30, yaw: 0.9, tilt: 1.42 },
      { x: -34, z: 28, len: 22, yaw: -0.4, tilt: 1.5 },
    ];
    for (const sp of specs) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, sp.len, 8), this.woodMat);
      mast.position.set(sp.x, this.seabed.heightAt(sp.x, sp.z) + 0.9, sp.z);
      mast.rotation.set(sp.tilt, sp.yaw, 0);
      this.group.add(mast);

      // A yard still crossed on it.
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, sp.len * 0.5, 6), this.woodMat);
      yard.position.copy(mast.position).add(new THREE.Vector3(rng.float(-3, 3), 0.6, rng.float(-3, 3)));
      yard.rotation.set(1.5, sp.yaw + 1.4, 0);
      this.group.add(yard);
    }
    this._mark('the fallen mast', new THREE.Vector3(-6, this.seabed.heightAt(-6, 4) + 1, 4), 18);
  }

  /** Nearest named landmark to a point — the clue generator's vocabulary. */
  nearestLandmark(pos) {
    let best = null, bestD = Infinity;
    for (const lm of this.landmarks) {
      const d = lm.position.distanceTo(pos);
      if (d < bestD) { bestD = d; best = lm; }
    }
    return { landmark: best, distance: bestD };
  }
}
