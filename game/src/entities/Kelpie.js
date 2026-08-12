// The kelpie — the actual main character.
//
// Two jobs: be a believable silhouette in 80 units of murk, and feel like a
// large animal rather than a camera on rails.
//
// Geometry is procedural and deliberately simple. At this fog density you read
// shape and motion, never detail, so budget goes into the swimming rather than
// the modelling: a tapered body that undulates in the vertex shader, a fluke
// that sweeps, a mane that drags, and a pale eye that catches the lamp.
//
// Handling has weight. Thrust is a force, not a velocity; drag is real; the
// heading lags the stick on a spring; turns bank; and the fins "bite" — existing
// momentum is steered gradually toward the new heading instead of teleporting
// there. That last one is most of why it feels like water.

import * as THREE from 'three';
import { CFG } from '../../config.js';

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

    this.bodyMat = this._animatedMaterial({
      color: P.kelpieBody, roughness: 0.82, metalness: 0.05,
    });
    this.finMat = this._animatedMaterial({
      color: P.kelpieFin, roughness: 0.6, metalness: 0.1,
      side: THREE.DoubleSide, transparent: true, opacity: 0.94,
    });
    this.maneMat = this._animatedMaterial({
      color: P.kelpieMane, roughness: 0.95, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85,
    }, 1.9); // mane drags harder than the body it's attached to

    this._buildBody();
    this._buildHead();
    this._buildFins();
    this._buildMane();

    this.group.position.copy(this.position);
  }

  /**
   * MeshStandardMaterial with undulation injected into the vertex stage.
   * onBeforeCompile rather than a ShaderMaterial so we keep Three's lighting and
   * — much more importantly here — its fog, which is doing most of the art
   * direction's work.
   */
  _animatedMaterial(params, lagScale = 1) {
    const mat = new THREE.MeshStandardMaterial(params);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uSpeed = this.uniforms.uSpeed;
      shader.uniforms.uTrip = this.uniforms.uTrip;
      shader.uniforms.uLag = { value: lagScale };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform float uTime; uniform float uSpeed; uniform float uLag;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // Travelling wave down the body's long axis (local Z). Amplitude grows
          // with speed so a stationary kelpie hangs in the water rather than
          // wriggling on the spot, and the phase offset by Z is what makes it
          // read as swimming instead of shivering.
          float wave = sin(transformed.z * ${CFG.kelpie.undulateFreq.toFixed(2)}
                           + uTime * (2.2 + uSpeed * ${CFG.kelpie.undulateSpeedScale.toFixed(3)}) * uLag);
          float amp = ${CFG.kelpie.undulateAmp.toFixed(3)} * (0.35 + uSpeed * 0.035);
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
    // Materials that differ only by injected uniforms still need distinct program
    // cache keys, or Three reuses one compiled shader for all of them.
    mat.customProgramCacheKey = () => `kelpie-${lagScale}`;
    return mat;
  }

  _buildBody() {
    const K = CFG.kelpie;
    // Along Z, heavily segmented so the vertex wave is smooth rather than faceted.
    const geo = new THREE.CylinderGeometry(K.girth * 0.28, K.girth, K.length, 14, 30, true);
    geo.rotateX(Math.PI / 2);

    // Taper into a fish tail by hand: squash the rear rings vertically and pull
    // them in horizontally, which turns a cylinder into something with a caudal
    // peduncle without needing a modelling package.
    const pos = geo.attributes.position;
    const half = K.length / 2;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const t = (half - z) / K.length;         // 0 = tail (+Z), 1 = head (-Z)
      const pinch = THREE.MathUtils.smoothstep(t, 0.0, 0.42);
      const flatten = 1 - 0.65 * (1 - pinch);
      pos.setX(i, pos.getX(i) * (0.35 + 0.65 * pinch));
      pos.setY(i, pos.getY(i) * flatten);
    }
    geo.computeVertexNormals();

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

    // Neck, angled up out of the shoulders.
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.52, 1.5, 10),
      this.bodyMat,
    );
    neck.position.set(0, 0.42, 0.15);
    neck.rotation.x = 0.5;
    headGrp.add(neck);

    // Skull: a stretched box reads more equine than a sphere at this distance.
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 1.15), this.bodyMat);
    skull.position.set(0, 1.05, -0.42);
    skull.rotation.x = -0.28;
    headGrp.add(skull);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.5), this.bodyMat);
    muzzle.position.set(0, 0.86, -0.95);
    headGrp.add(muzzle);

    // Ears.
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), this.bodyMat);
      ear.position.set(s * 0.15, 1.35, -0.1);
      ear.rotation.z = s * 0.2;
      headGrp.add(ear);
    }

    // The eye is the one bright thing on the whole animal. In this much fog a
    // single specular highlight is what makes it feel alive and looked-at.
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: P.kelpieEye, emissive: P.kelpieEye, emissiveIntensity: 0.55, roughness: 0.25,
    });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), this.eyeMat);
      eye.position.set(s * 0.21, 1.13, -0.72);
      headGrp.add(eye);
    }

    this.head = headGrp;
    this.group.add(headGrp);
  }

  _buildFins() {
    const K = CFG.kelpie;

    // Caudal fluke, at the tail (+Z) — the thing that visibly drives the swimming.
    const fluke = new THREE.Mesh(this._finShape(1.5, 1.9), this.finMat);
    fluke.position.set(0, 0, K.length * 0.52);
    fluke.rotation.y = Math.PI / 2;
    this.fluke = fluke;
    this.group.add(fluke);

    // Dorsal, just aft of midships.
    const dorsal = new THREE.Mesh(this._finShape(1.5, 0.85), this.finMat);
    dorsal.position.set(0, K.girth * 0.62, 0.3);
    dorsal.rotation.y = Math.PI / 2;
    this.group.add(dorsal);

    // Pectorals, forward and angled out like a fish's.
    for (const s of [-1, 1]) {
      const pec = new THREE.Mesh(this._finShape(0.95, 0.7), this.finMat);
      pec.position.set(s * K.girth * 0.72, -0.15, -K.length * 0.16);
      pec.rotation.set(0.35, 0, s * -0.75);
      this.group.add(pec);
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
    // Strips of weed down the neck and spine. Given their own lag multiplier so
    // they trail behind the body's wave rather than moving with it.
    const K = CFG.kelpie;
    this.mane = new THREE.Group();
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const w = 0.09 + Math.random() * 0.06;
      const l = 1.5 + Math.random() * 1.4;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, l, 1, 5), this.maneMat);
      // Runs forward from the withers up the neck, so toward -Z.
      strip.position.set(
        (Math.random() - 0.5) * 0.3,
        K.girth * 0.5 + t * 0.85,
        -(K.length * 0.18 + t * 1.4),
      );
      strip.rotation.set(-1.05 + Math.random() * 0.3, Math.random() * 0.6 - 0.3, 0);
      this.mane.add(strip);
    }
    this.group.add(this.mane);
  }

  /** Where the diver's chain anchors — just behind the withers, so +Z. */
  gripPoint(out) {
    return out.set(0, CFG.kelpie.girth * 0.55, CFG.kelpie.length * 0.16)
      .applyQuaternion(this.quaternion)
      .add(this.position);
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

    // Bank into the turn. Cheap, and it's most of why turning reads as turning.
    const targetRoll = -this._yawVel * K.bankAmount;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-K.bankSpring * dt));

    this.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);

    // ---- Translation ----
    this.boosting = intent.boost && intent.thrust > 0.05;
    const power = this.boosting ? K.boostThrust : K.thrust;
    const maxSpeed = this.boosting ? K.boostMaxSpeed : K.maxSpeed;

    this._tmp.copy(this.forward).multiplyScalar(power * intent.thrust * dt);
    this.velocity.add(this._tmp);

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

    // The fluke sweeps opposite the body wave, which is what a tail actually does.
    if (this.fluke) {
      this.fluke.rotation.z = Math.sin(this.uniforms.uTime.value * (2.2 + this.speed * 0.055) + 1.4)
        * (0.18 + this.speed * 0.012);
    }
  }

  setTrip(v) {
    this.uniforms.uTrip.value = v;
    // Mane and eye go bioluminescent through the trip.
    this.eyeMat.emissiveIntensity = 0.55 + v * 2.4;
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
    this.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
  }
}
