// The kelpie — the actual main character.
//
// Two jobs: be a believable silhouette in 80 units of murk, and feel like a
// large animal rather than a camera on rails.
//
// Geometry is procedural and deliberately simple. At this fog density you read
// shape and motion, never detail, so the budget goes into the swimming rather
// than the modelling: a counter-shaded body that undulates in the vertex shader,
// a fluke that sweeps and trails weed, a mane where every strand drifts on its
// own phase, and a pale eye that catches the lamp.
//
// Counter-shading — dark along the back, pale underneath — is doing more work
// here than any amount of extra geometry would. It's how every fish in the lake
// is painted, and it's what stops a dark animal in dark water reading as a hole.
// It's baked into vertex colours rather than computed in the shader because
// "which way is up" differs per part: the neck's own Y axis runs along its
// length, and in JS I can simply say so.
//
// Handling has weight. Thrust is a force, not a velocity; drag is real; the
// heading lags the stick on a spring; turns bank; and the fins "bite" — existing
// momentum is steered gradually toward the new heading instead of teleporting
// there. That last one is most of why it feels like water.
//
// Speed is a tail beat, not a switch. Holding swim is a resting cruise; every
// tap is a kick that shoves you forward and builds a surge, and the surge bleeds
// away as soon as you stop working. See the kick block in update().

import * as THREE from 'three';
import { CFG } from '../../config.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Kelpie {
  constructor() {
    const P = CFG.palette;
    this.group = new THREE.Group();

    // ---- Motion state ----
    this.position = new THREE.Vector3(0, -8, 40);
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.roll = 0;
    this._yawVel = 0;
    this._pitchVel = 0;
    this.speed = 0;
    this.boosting = false;

    // ---- Tail beats ----
    this.surge = 0;        // 0..1, built by kicking and always draining
    this.kicked = false;   // true for the one frame a beat lands, for FX
    this.kickPulse = 0;    // decays from 1; drives the visible tail snap
    this._kickCd = 0;
    this.lift = 0;         // the bong launch, 1 -> 0 over trip.launchTime
    this._ceiling = 0;
    this._climbTarget = null;
    this._climbT = 0;

    this.forward = new THREE.Vector3(0, 0, -1);
    this._desired = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    // ---- Materials ----
    // A shared time uniform drives every animated part, so the body, fluke and
    // mane can never fall out of phase with one another.
    this.uniforms = {
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uTrip: { value: 0 },
    };

    // White, because the vertex colours carry the whole paint job.
    this.bodyMat = this._swimMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.05,
    });
    // A skull is rigid. The wave is masked to almost nothing this far forward
    // anyway, but "almost" is enough to make a muzzle swim off a face — so the
    // head gets the same paint and none of the undulation.
    this.headMat = this._swimMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.05,
    }, false);
    this.finMat = this._swimMaterial({
      color: P.kelpieFin, roughness: 0.6, metalness: 0.1,
      side: THREE.DoubleSide, transparent: true, opacity: 0.94,
    });
    this.maneMat = this._maneMaterial();

    this._buildBody();
    this._buildHead();
    this._buildFins();
    this._buildMane();

    this.group.position.copy(this.position);
  }

  // ------------------------------------------------------------------ shading

  /**
   * Bake counter-shading into vertex colours along an axis of this part's own
   * choosing. `lo` is the height that's fully belly, `hi` fully back.
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Vector3} up which way is up, in this geometry's local space
   */
  _countershade(geo, lo, hi, up = UP) {
    const pos = geo.attributes.position;
    const back = new THREE.Color(CFG.palette.kelpieBody);
    const belly = new THREE.Color(CFG.palette.kelpieBelly);
    const c = new THREE.Color();
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const v = up.x * pos.getX(i) + up.y * pos.getY(i) + up.z * pos.getZ(i);
      c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(v, lo, hi));
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  /** Flat vertex colour, for the parts too small to shade across. */
  _tint(geo, hex) {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  /** Squeeze the front (-Z) end of a box so it reads as a head, not a brick. */
  _wedge(geo, frontScale = 0.62) {
    const pos = geo.attributes.position;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < min) min = z;
      if (z > max) max = z;
    }
    const span = (max - min) || 1;
    for (let i = 0; i < pos.count; i++) {
      const s = frontScale + (1 - frontScale) * ((pos.getZ(i) - min) / span);
      pos.setX(i, pos.getX(i) * s);
      pos.setY(i, pos.getY(i) * s);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------- materials

  /**
   * MeshStandardMaterial with the swimming undulation injected into the vertex
   * stage. onBeforeCompile rather than a ShaderMaterial so we keep Three's
   * lighting and — much more importantly here — its fog, which is doing most of
   * the art direction's work.
   */
  _swimMaterial(params, wave = true) {
    const K = CFG.kelpie;
    const mat = new THREE.MeshStandardMaterial(params);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uSpeed = this.uniforms.uSpeed;
      shader.uniforms.uTrip = this.uniforms.uTrip;

      if (wave) shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform float uTime; uniform float uSpeed;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // Travelling wave down the body's long axis (local Z). Amplitude grows
          // with speed so a stationary kelpie hangs in the water rather than
          // wriggling on the spot, and the phase offset by Z is what makes it
          // read as swimming instead of shivering.
          float wave = sin(transformed.z * ${K.undulateFreq.toFixed(2)}
                           + uTime * (2.2 + uSpeed * ${K.undulateSpeedScale.toFixed(3)}));
          float amp = ${K.undulateAmp.toFixed(3)} * (0.35 + uSpeed * 0.045);
          // Zero at the head (-Z) rising to full at the tail (+Z), so the skull
          // stays steady and the body carries the wave back into the fluke —
          // which is the direction a fish actually swims.
          float mask = smoothstep(-2.4, 2.6, transformed.z);
          transformed.x += wave * amp * mask;
          transformed.y += wave * amp * 0.22 * mask;
        `);

      // Trip glow rides the same uTrip everything else does.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTrip;')
        .replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          if (uTrip > 0.001) {
            vec3 shimmer = vec3(
              0.5 + 0.5 * sin(uTrip * 6.28318 + 0.0),
              0.5 + 0.5 * sin(uTrip * 6.28318 + 2.094),
              0.5 + 0.5 * sin(uTrip * 6.28318 + 4.188));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, shimmer, uTrip * 0.35);
          }
        `);
    };
    // Materials that differ only by injected uniforms still need distinct
    // program cache keys, or Three reuses one compiled shader for all of them.
    mat.customProgramCacheKey = () => (wave ? 'kelpie-swim' : 'kelpie-rigid');
    return mat;
  }

  /**
   * Weed. Every strand is a unit-length ribbon hanging along -Y from its root
   * with a phase baked into an attribute, which is the fix for the thing that
   * gives procedural hair away instantly: a whole mane moving as one object.
   * The sway is masked root-to-tip, and at speed the strands stream aft, so the
   * mane reports how fast you're going without anyone having to animate it.
   */
  _maneMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      color: CFG.palette.kelpieMane,
      emissive: CFG.palette.kelpieMane,
      emissiveIntensity: 0,
      roughness: 0.95, side: THREE.DoubleSide,
      transparent: true, opacity: 0.88,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uSpeed = this.uniforms.uSpeed;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform float uTime; uniform float uSpeed;
          attribute float aPhase;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // The strand hangs from y=0 to y=-1, so this is 0 at the root and 1 at
          // the free end. Squared, because a strand pivots at its root.
          float tip = clamp(-transformed.y, 0.0, 1.0);
          float bend = tip * tip;
          float wave = sin(uTime * (1.7 + uSpeed * 0.04) + aPhase + tip * 3.1);
          transformed.x += wave * (0.14 + uSpeed * 0.010) * bend;
          transformed.z += cos(uTime * 1.25 + aPhase) * 0.07 * bend;
          // Drag: at speed the whole mane lies back along the body (+Z is aft).
          transformed.z += uSpeed * 0.022 * bend;
        `);
    };
    mat.customProgramCacheKey = () => 'kelpie-mane';
    return mat;
  }

  /**
   * One weed strand, rooted at its own origin and hanging down -Y over unit
   * length — scale Y to length it. `phase` is baked per strand so no two drift
   * together.
   */
  _strand(width, phase, segs = 6) {
    const geo = new THREE.PlaneGeometry(width, 1, 1, segs);
    geo.translate(0, -0.5, 0);
    const n = geo.attributes.position.count;
    geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(phase), 1));
    return new THREE.Mesh(geo, this.maneMat);
  }

  // ---------------------------------------------------------------- geometry

  _buildBody() {
    const K = CFG.kelpie;
    // Along Z, heavily segmented so the vertex wave is smooth rather than
    // faceted. The cylinder's thin end lands at +Z, which is the tail.
    const geo = new THREE.CylinderGeometry(K.girth * 0.28, K.girth, K.length, 14, 30, true);
    geo.rotateX(Math.PI / 2);

    // Taper into a fish tail by hand, and give it a barrel while we're here: a
    // swell behind the shoulders and a narrowing where the neck comes out. A
    // pure taper reads as a cone with a horse stuck on it.
    const pos = geo.attributes.position;
    const half = K.length / 2;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const t = (half - z) / K.length;         // 0 = tail (+Z), 1 = head (-Z)
      const pinch = THREE.MathUtils.smoothstep(t, 0.0, 0.42);
      const flatten = 1 - 0.65 * (1 - pinch);
      const barrel = 1 + 0.17 * Math.exp(-Math.pow((t - 0.60) / 0.22, 2));
      const shoulder = 1 - 0.24 * THREE.MathUtils.smoothstep(t, 0.74, 1.0);
      const w = (0.35 + 0.65 * pinch) * barrel * shoulder;
      pos.setX(i, pos.getX(i) * w);
      pos.setY(i, pos.getY(i) * flatten * barrel * shoulder);
    }
    geo.computeVertexNormals();
    this._countershade(geo, -K.girth * 0.8, K.girth * 0.18);

    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.group.add(this.body);
  }

  _buildHead() {
    const P = CFG.palette;
    const K = CFG.kelpie;
    // Head is at -Z: that's forward, and it has to match the direction of travel
    // or the chase camera ends up staring the animal in the face.
    const headGrp = new THREE.Group();
    headGrp.position.set(0, 0.55, -K.length * 0.46);

    // Neck, angled up out of the shoulders. Its own Y axis runs along its
    // length, so it's shaded across its radius instead: local -Z is the side
    // facing the surface once the lean is applied.
    const lean = 0.52;
    const neckGeo = new THREE.CylinderGeometry(0.30, 0.58, 1.75, 12, 3);
    this._countershade(neckGeo, -0.40, 0.12, new THREE.Vector3(0, 0, -1));
    const neck = new THREE.Mesh(neckGeo, this.headMat);
    neck.position.set(0, 0.45, 0.18);
    neck.rotation.x = lean;
    headGrp.add(neck);

    // Cheek. One rounded mass under the eye is the difference between a horse
    // and a plank with ears.
    const jowlGeo = new THREE.SphereGeometry(0.25, 10, 8);
    jowlGeo.scale(0.86, 1.0, 1.15);
    this._countershade(jowlGeo, -0.2, 0.05);
    const jowl = new THREE.Mesh(jowlGeo, this.headMat);
    jowl.position.set(0, 1.0, -0.3);
    headGrp.add(jowl);

    // Skull: a stretched box, wedged toward the muzzle.
    const skullGeo = this._wedge(new THREE.BoxGeometry(0.46, 0.52, 1.2, 2, 2, 4), 0.6);
    this._countershade(skullGeo, -0.22, 0.03);
    const skull = new THREE.Mesh(skullGeo, this.headMat);
    skull.position.set(0, 1.08, -0.5);
    skull.rotation.x = -0.26;
    headGrp.add(skull);

    const muzzleGeo = this._wedge(new THREE.BoxGeometry(0.3, 0.32, 0.6, 2, 2, 2), 0.78);
    this._countershade(muzzleGeo, -0.15, 0.03);
    const muzzle = new THREE.Mesh(muzzleGeo, this.headMat);
    muzzle.position.set(0, 0.92, -1.02);
    muzzle.rotation.x = -0.1;
    headGrp.add(muzzle);

    // Jaw, slung under. Cheap, and it's what puts a mouth on the silhouette.
    const jawGeo = this._tint(new THREE.BoxGeometry(0.24, 0.15, 0.62), 0x141d18);
    const jaw = new THREE.Mesh(jawGeo, this.headMat);
    jaw.position.set(0, 0.78, -0.86);
    jaw.rotation.x = 0.12;
    headGrp.add(jaw);

    // Nostrils — two dark pits. At this range they're two pixels, and two dark
    // pixels in the right place are worth more than a nose.
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(
        this._tint(new THREE.SphereGeometry(0.045, 6, 5), 0x0b120e), this.headMat,
      );
      n.position.set(s * 0.085, 0.98, -1.28);
      headGrp.add(n);
    }

    // Ears.
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(
        this._tint(new THREE.ConeGeometry(0.13, 0.52, 5), CFG.palette.kelpieBody), this.headMat,
      );
      ear.position.set(s * 0.17, 1.56, -0.08);
      ear.rotation.set(-0.22, 0, s * 0.26);
      headGrp.add(ear);
    }

    // Forelock, falling forward between the ears.
    for (let i = 0; i < 3; i++) {
      const f = this._strand(0.1, Math.random() * 6.28, 4);
      f.position.set((i - 1) * 0.07, 1.4, -0.24);
      f.scale.y = 0.5 + Math.random() * 0.35;
      f.rotation.set(0.55 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5, 0);
      headGrp.add(f);
    }

    // The eye is the one bright thing on the whole animal. In this much fog a
    // single specular highlight is what makes it feel alive and looked-at.
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: P.kelpieEye, emissive: P.kelpieEye, emissiveIntensity: 0.55, roughness: 0.25,
    });
    // Kept, because they're the headlights: Lamp hangs a spotlight on each one
    // and points the pair where she's steering. See eyePoint().
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.078, 8, 6), this.eyeMat);
      eye.position.set(s * 0.215, 1.16, -0.74);
      headGrp.add(eye);
      this.eyes.push(eye);
    }

    this.head = headGrp;
    this.group.add(headGrp);
  }

  _buildFins() {
    const K = CFG.kelpie;

    // Caudal fluke, at the tail (+Z) — the thing that visibly drives the
    // swimming, so it gets trailing weed to smear its motion.
    const fluke = new THREE.Mesh(this._finShape(1.5, 1.9), this.finMat);
    fluke.position.set(0, 0, K.length * 0.52);
    fluke.rotation.y = Math.PI / 2;
    this.fluke = fluke;
    this.group.add(fluke);

    // Parented to the fin, so they whip when it sweeps. Rotated so their hanging
    // axis points aft along the fin's own -X.
    for (const y of [0.72, 0.1, -0.5]) {
      const s = this._strand(0.07, Math.random() * 6.28, 5);
      s.position.set(1.3, y, 0);
      s.scale.y = 1.1 + Math.random() * 0.8;
      s.rotation.z = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      fluke.add(s);
    }

    // Dorsal, just aft of midships.
    const dorsal = new THREE.Mesh(this._finShape(1.5, 0.85), this.finMat);
    dorsal.position.set(0, K.girth * 0.62, 0.3);
    dorsal.rotation.y = Math.PI / 2;
    this.group.add(dorsal);

    // Pectorals, forward and angled out like a fish's.
    for (const s of [-1, 1]) {
      const pec = new THREE.Mesh(this._finShape(1.05, 0.72), this.finMat);
      pec.position.set(s * K.girth * 0.7, -0.18, -K.length * 0.16);
      pec.rotation.set(0.35, 0, s * -0.75);
      this.group.add(pec);
    }

    // Pelvic pair, small, well aft — they close the gap between the pectorals
    // and the fluke that otherwise makes the back half look unfinished.
    for (const s of [-1, 1]) {
      const pel = new THREE.Mesh(this._finShape(0.6, 0.42), this.finMat);
      pel.position.set(s * K.girth * 0.34, -0.35, K.length * 0.2);
      pel.rotation.set(0.2, 0, s * -1.0);
      this.group.add(pel);
    }
  }

  /** A soft leaf shape — fins are silhouettes here, not surfaces. */
  _finShape(len, height) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(len * 0.35, height * 0.85, len, height * 0.42);
    s.quadraticCurveTo(len * 0.55, 0, len * 0.72, -height * 0.42);
    s.quadraticCurveTo(len * 0.3, -height * 0.3, 0, 0);
    return new THREE.ShapeGeometry(s, 8);
  }

  _buildMane() {
    // A crest running from the poll, back along the neck and down the spine to
    // the dorsal. Longest over the middle of the neck, the way a mane actually
    // hangs, and every strand on its own phase.
    const K = CFG.kelpie;
    this.mane = new THREE.Group();
    const N = 15;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const arch = Math.sin(t * Math.PI);
      const strip = this._strand(0.1 + Math.random() * 0.06, Math.random() * 6.28);
      strip.position.set(
        (Math.random() - 0.5) * 0.16,
        THREE.MathUtils.lerp(1.74, K.girth * 0.62, t) - arch * 0.2,
        THREE.MathUtils.lerp(-2.85, 0.6, t),
      );
      strip.scale.y = 1.05 + arch * 1.5 + Math.random() * 0.4;
      // rotation.x negative swings the hanging axis aft, so the mane lies back
      // over the withers instead of dangling like a curtain.
      strip.rotation.set(
        -1.12 - t * 0.28,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.4,
      );
      this.mane.add(strip);
    }

    // Weed at the nape. She has been down here a long time and things grow on
    // her — this is the bit that reads as SEAWEED rather than as hair: longer,
    // thinner, denser, and hung right at the back of the neck where it streams
    // out behind the skull. The mane shader already lays strands aft with speed,
    // so at a standstill it drifts and at a sprint it goes flat, for free.
    for (let i = 0; i < 9; i++) {
      const w = 0.055 + Math.random() * 0.045;
      const weed = this._strand(w, Math.random() * 6.28, 8);
      weed.position.set(
        (Math.random() - 0.5) * 0.34,
        1.5 + (Math.random() - 0.5) * 0.3,
        -2.55 + Math.random() * 0.9,
      );
      weed.scale.y = 2.2 + Math.random() * 1.5;
      weed.rotation.set(
        -1.28 - Math.random() * 0.22,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.55,
      );
      this.mane.add(weed);
    }

    this.group.add(this.mane);
  }

  // ------------------------------------------------------------------ motion

  /**
   * The one knot on her back. All four riders hang off this: the first holds the
   * rope, and the rest are hitched to each other in a line behind him.
   */
  gripPoint(out) {
    return out.set(0, CFG.kelpie.girth * 0.55, CFG.kelpie.length * 0.12)
      .applyQuaternion(this.quaternion)
      .add(this.position);
  }

  /**
   * One eye, in world space. The headlights hang off these, so it reads off the
   * actual mesh rather than a hardcoded offset — move the head and the beams
   * move with it, including the bob.
   *
   * @param {0|1} i left, then right
   */
  eyePoint(out, i) {
    return this.eyes[i].getWorldPosition(out);
  }

  /** The fluke, in world space — where a tail beat throws water from. */
  tailPoint(out) {
    return out.set(0, 0, CFG.kelpie.length * 0.6)
      .applyQuaternion(this.quaternion)
      .add(this.position);
  }

  /**
   * The bong hit: she comes up out of the dark and keeps climbing through the
   * whole orbit.
   *
   * Given a target — a school of fish overhead — she aims for it and surfaces
   * through the middle of them. Given nothing, she just goes up. Either way the
   * ceiling is worked out here rather than fixed, so a bowl smoked in the trench
   * still ends somewhere you can see and one smoked in open water doesn't push
   * you through the surface.
   *
   * @param {THREE.Vector3|null} target where to come up, usually a school's home
   */
  blastOff(target = null) {
    const T = CFG.trip;
    const cap = CFG.world.surfaceY - 10;
    this.lift = 1;
    this._climbTarget = target ? target.clone() : null;
    this._climbT = T.launchSeek;   // hard stop; an unreachable school can't fly her forever
    this._ceiling = Math.min(cap, target ? target.y : this.position.y + T.launchRise);
    // Never a descent. If the only thing on offer is below her, go straight up.
    if (this._ceiling < this.position.y + 8) {
      this._ceiling = Math.min(cap, this.position.y + T.launchRise);
      this._climbTarget = null;
    }
    this.velocity.y += T.launchKick;
  }

  update(dt, intent, env = {}) {
    const K = CFG.kelpie;

    // ---- Rotation, on a spring ----
    // The stick sets a target rate; the body accelerates toward it. Direct
    // assignment here is what makes a vehicle feel like a mouse cursor.
    const targetYawVel = -intent.steer.x * K.yawRate;
    const targetPitchVel = intent.steer.y * K.pitchRate;
    const rk = 1 - Math.exp(-K.headingSpring * dt);
    this._yawVel += (targetYawVel - this._yawVel) * rk;
    this._pitchVel += (targetPitchVel - this._pitchVel) * rk;
    this._yawVel *= Math.pow(K.headingDamp, dt * 60 * 0.016);

    this.yaw += this._yawVel * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + this._pitchVel * dt, -K.pitchClamp, K.pitchClamp);

    // ---- Blast off ----
    // Nose up first, so the climb reads as swimming rather than as being lifted
    // by a crane. The force goes in below, before the fins bite, so the bite
    // turns it into travel along the new heading instead of fighting it.
    if (this.lift > 0) {
      const T = CFG.trip;
      if (this._climbTarget) {
        // Aimed at a school: fly to it in three dimensions rather than matching
        // its altitude and stopping. Matching only the height is how the first
        // version left her hanging sixty metres short of the fish she was
        // supposed to be arriving in the middle of.
        const to = this._tmp.copy(this._climbTarget).sub(this.position);
        this._climbT -= dt;
        if (to.length() < T.launchArrive || this._climbT <= 0) {
          this._climbTarget = null;   // she's in them, or she's out of time
          this.lift = 0;
        } else {
          // Full drive for the whole seek. Decaying it instead left her stalling
          // out twenty-five units short of the school she was aiming at, which
          // is close enough to see them and not close enough to be in them.
          this.lift = 1;
          const climb = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.35, 1.15);
          this.pitch = THREE.MathUtils.lerp(this.pitch, climb, 1 - Math.exp(-3.2 * dt));
          const want = Math.atan2(-to.x, -to.z);
          const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
          this.yaw += d * (1 - Math.exp(-2.2 * dt));
        }
      } else {
        // Nothing overhead worth arriving in. Just go up.
        this.lift = Math.max(0, this.lift - dt / T.launchTime);
        this.pitch = THREE.MathUtils.lerp(this.pitch, 0.95, 1 - Math.exp(-3.2 * dt));
      }
    }

    // ---- Magnetism ----
    // Something close enough to matter bends the heading toward itself. Applied
    // here, to the heading, rather than as a force on the body: a force gets
    // eaten by the fins biting momentum back onto course, and measurably did.
    //
    // It also yields to the stick. Assist that fights a player who is actively
    // steering isn't assist, it's a disagreement.
    if (env.attract) {
      const a = env.attract;
      const dx = a.point.x - this.position.x;
      const dz = a.point.z - this.position.z;
      const dy = a.point.y - this.position.y;
      const steering = Math.min(1, Math.hypot(intent.steer.x, intent.steer.y));
      const s = a.strength * (1 - steering * CFG.bong.magnetYield);
      if (s > 0.001) {
        const wantYaw = Math.atan2(-dx, -dz);
        const off = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
        this.yaw += off * (1 - Math.exp(-s * dt));
        const wantPitch = THREE.MathUtils.clamp(
          Math.atan2(dy, Math.hypot(dx, dz)), -K.pitchClamp, K.pitchClamp);
        this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-s * 0.7 * dt));
      }
    }

    // Bank AWAY from the turn — she leans right going left, and vice versa.
    //
    // Banking into it is what an aircraft does and what a fish does, and it was
    // the obvious choice until you actually ride her: the camera sits on her
    // back and rolls with her, so an inward bank tips the horizon the wrong way
    // and the turn reads as sliding rather than turning. Leaning out puts the
    // horizon where the eye expects it. It's also just what a horse does.
    const targetRoll = this._yawVel * K.bankAmount;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-K.bankSpring * dt));

    this.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);

    // ---- Tail beats ----
    // Surge drains every frame whether or not you're doing anything, so speed is
    // something you keep paying for rather than something you switch on. The
    // impulse is what makes a single tap feel like effort even from a standstill.
    this.surge = Math.max(0, this.surge - K.kickDecay * dt);
    this._kickCd = Math.max(0, this._kickCd - dt);
    this.kickPulse = Math.max(0, this.kickPulse - dt * 3.2);
    // A beat inside the cooldown is dropped rather than queued: mashing should
    // hit a ceiling, not bank credit that spends itself later.
    this.kicked = intent.kick && this._kickCd <= 0;
    if (this.kicked) {
      this._kickCd = K.kickCooldown;
      this.surge = Math.min(1, this.surge + K.kickSurge);
      this.kickPulse = 1;
      this.velocity.addScaledVector(this.forward, K.kickImpulse);
    }

    // ---- Translation ----
    this.boosting = intent.boost && intent.thrust > 0.05;
    const power = (this.boosting ? K.boostThrust : K.thrust) + this.surge * K.kickThrustBonus;
    const maxSpeed = (this.boosting ? K.boostMaxSpeed : K.maxSpeed)
      + this.surge * K.kickSpeedBonus + this.lift * CFG.trip.launchSpeed;

    this._tmp.copy(this.forward).multiplyScalar(power * intent.thrust * dt);
    this.velocity.add(this._tmp);

    // The climb. Driven as a velocity TARGET rather than added as a force — a
    // force plus a hard ceiling overshoots by everything the momentum is still
    // carrying, which on the first cut was forty-odd units of it.
    if (this.lift > 0) {
      const T = CFG.trip;
      if (this._climbTarget) {
        // Along the heading, which is already pointed at the school.
        const want = T.launchClimb * this.lift;
        const along = this.velocity.dot(this.forward);
        this.velocity.addScaledVector(this.forward, (want - along) * (1 - Math.exp(-5 * dt)));
      } else {
        // Straight up, easing off as the ceiling comes to meet her.
        const room = Math.max(0, this._ceiling - this.position.y);
        const want = T.launchClimb * this.lift * Math.min(1, room / T.launchEase);
        this.velocity.y += (want - this.velocity.y) * (1 - Math.exp(-5 * dt));
      }
    }

    // Ambient current — weather and the boundary both push through here.
    if (env.current) this.velocity.addScaledVector(env.current, dt);

    // Fins bite: steer existing momentum toward the new heading. Without this you
    // slide like an air hockey puck; with too much of it, water feels like tarmac.
    const sp = this.velocity.length();
    if (sp > 0.01) {
      this._desired.copy(this.forward).multiplyScalar(sp);
      this.velocity.lerp(this._desired, 1 - Math.exp(-K.addedMass * dt));
    }

    this.velocity.multiplyScalar(Math.pow(K.drag, dt * 60 * 0.0166));
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);

    this.position.addScaledVector(this.velocity, dt);
    this.speed = this.velocity.length();

    // A slow idle bob so it never looks frozen when you stop.
    const bob = Math.sin(this.uniforms.uTime.value * 0.9) * 0.12 * (1 - Math.min(1, this.speed / 6));

    this.group.position.copy(this.position);
    this.group.position.y += bob;
    this.group.quaternion.copy(this.quaternion);

    this.uniforms.uTime.value += dt;
    this.uniforms.uSpeed.value = this.speed;

    // The fluke sweeps opposite the body wave, which is what a tail actually
    // does, and snaps hard on a beat — that snap is the visual receipt for the
    // tap, and without it tapping feels like nothing is happening.
    if (this.fluke) {
      this.fluke.rotation.z = Math.sin(this.uniforms.uTime.value * (2.2 + this.speed * 0.055) + 1.4)
        * (0.18 + this.speed * 0.018 + this.kickPulse * 0.5);
    }
  }

  setTrip(v) {
    this._trip = v;
    this.uniforms.uTrip.value = v;
    this._applyGlow();
  }

  /**
   * The record, in her.
   *
   * Her eyes catch the kick and the mane swells with the mids — she is the one
   * thing on screen the whole time, so if anything is going to move with the
   * music it had better be her. Kept small: this is a horse breathing in time,
   * not a light show strapped to a horse.
   */
  setReact(r) {
    this._kick = r ? r.kick : 0;
    this._mid = r ? r.mid : 0;
    this._applyGlow();
  }

  _applyGlow() {
    const v = this._trip || 0;
    const kick = this._kick || 0, mid = this._mid || 0;
    this.eyeMat.emissiveIntensity = 0.55 + v * 4.2 + kick * 1.6;
    this.maneMat.emissiveIntensity = v * 2.8 + mid * 0.35;
  }

  /** Used by Breath when the tank hits zero — she stops swimming and sinks. */
  sink(dt) {
    this.velocity.multiplyScalar(Math.pow(0.6, dt));
    this.velocity.y -= CFG.breath.sinkSpeed * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.pitch = THREE.MathUtils.lerp(this.pitch, -0.5, 1 - Math.exp(-1.2 * dt));
    this.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
    this.uniforms.uTime.value += dt;
    this.uniforms.uSpeed.value = this.speed = this.velocity.length();
  }

  /**
   * @param {THREE.Vector3} position
   * @param {number} yaw heading in radians; forward is (-sin yaw, 0, -cos yaw)
   */
  reset(position, yaw = Math.PI) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0; this.roll = 0;
    this._yawVel = this._pitchVel = 0;
    this.surge = 0; this.kickPulse = 0; this._kickCd = 0; this.kicked = false;
    this.lift = 0; this._climbTarget = null; this._climbT = 0;
    this.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
  }
}
