// The Gales of November.
//
// Superior's weather is the lake's whole reputation, and it costs almost nothing
// to put down here: fog pulls in, the light dims toward dusk, and the current
// picks a direction and leans. Three values already in the engine, modulated by
// one eased intensity.
//
// It matters mechanically as well as atmospherically — a gale that shoves you
// off your line while you're three baggies deep with forty seconds left is where
// the run gets interesting.

import * as THREE from 'three';
import { CFG } from '../../config.js';

const CALM = 'calm', BUILDING = 'building', GALE = 'gale', EASING = 'easing';

export class Weather {
  /** @param {import('../core/Rng.js').Rng} rng */
  constructor(rng) {
    this.rng = rng;
    this.state = CALM;
    this.timer = rng.float(CFG.weather.calmMin, CFG.weather.calmMax);
    this.intensity = 0;              // 0..1, eased — everything reads this
    this.current = new THREE.Vector3();
    this._dir = new THREE.Vector3(1, 0, 0);
    this._t = 0;
    this.onStart = null;
    this.onEnd = null;
  }

  update(dt) {
    const W = CFG.weather;
    this.timer -= dt;
    this._t += dt;

    switch (this.state) {
      case CALM:
        if (this.timer <= 0) {
          this.state = BUILDING;
          this.timer = W.rampTime;
          // Pick a heading for this gale and stick to it — a current that
          // wanders is just noise; one that commits is weather.
          const a = this.rng.float(0, Math.PI * 2);
          this._dir.set(Math.cos(a), 0, Math.sin(a));
          if (this.onStart) this.onStart();
        }
        break;

      case BUILDING:
        this.intensity = 1 - this.timer / W.rampTime;
        if (this.timer <= 0) {
          this.state = GALE;
          this.intensity = 1;
          this.timer = this.rng.float(W.galeMin, W.galeMax);
        }
        break;

      case GALE:
        if (this.timer <= 0) { this.state = EASING; this.timer = W.rampTime; }
        break;

      case EASING:
        this.intensity = this.timer / W.rampTime;
        if (this.timer <= 0) {
          this.state = CALM;
          this.intensity = 0;
          this.timer = this.rng.float(W.calmMin, W.calmMax);
          if (this.onEnd) this.onEnd();
        }
        break;
    }

    this.intensity = THREE.MathUtils.clamp(this.intensity, 0, 1);

    // Gusts: the current pulses rather than pushing flat, so it reads as surge.
    const gust = 0.65 + 0.35 * Math.sin(this._t * 0.7) * Math.sin(this._t * 0.23);
    this.current.copy(this._dir).multiplyScalar(W.currentForce * this.intensity * gust);
  }

  /** Fog distance for the current conditions. */
  fogFar() {
    return THREE.MathUtils.lerp(CFG.fog.far, CFG.fog.stormFar, this.intensity);
  }

  /** Multiplier on the sun/ambient light. */
  lightScale() {
    return THREE.MathUtils.lerp(1, CFG.weather.lightDim, this.intensity);
  }

  get active() { return this.intensity > 0.02; }
}
