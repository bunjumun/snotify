// Phone tilt steering.
//
// Four things bite here, and all four are silent failures rather than errors:
//
//  1. iOS 13+ requires DeviceOrientationEvent.requestPermission() and it must be
//     called from inside a real user gesture. The DIVE IN button is that gesture.
//     Called anywhere else it rejects, and it rejects quietly.
//  2. It also requires HTTPS. GitHub Pages gives us that; `python3 -m http.server`
//     on a phone over LAN does not, which is why tilt can only be tested on a
//     deployed build.
//  3. Neutral has to be captured, not assumed. Nobody holds a phone flat, and
//     people play lying down. We snapshot the attitude at start and steer from
//     the delta.
//  4. screen.orientation.angle has to be applied or landscape silently inverts
//     both axes — the single most common "tilt is broken" bug.
//
// Steering only. Thrust stays on a thumb: full tilt-to-fly is nauseating within
// about a minute, whereas tilt-to-steer with a throttle button feels good.

import { CFG } from '../../config.js';

export class Tilt {
  constructor() {
    this.enabled = false;
    this.supported = 'DeviceOrientationEvent' in window;
    this.granted = false;
    this.gotEvent = false;

    this.neutral = null;          // {beta, gamma} captured on start / recentre
    this.raw = { beta: 0, gamma: 0 };
    this.smoothed = { x: 0, y: 0 };
    this._pendingRecentre = true;

    this._onOrient = this._onOrient.bind(this);
  }

  /** True when the platform will make us ask (iOS 13+). */
  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
           typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /**
   * MUST be called synchronously from a user gesture handler.
   * Resolves true if we can read the sensor.
   */
  async requestPermission() {
    if (!this.supported) return false;
    if (!Tilt.needsPermission()) { this.granted = true; return true; }
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      this.granted = res === 'granted';
    } catch {
      // Thrown when called outside a gesture, or on insecure origins.
      this.granted = false;
    }
    return this.granted;
  }

  attach() {
    if (!this.supported) return;
    addEventListener('deviceorientation', this._onOrient);
    // If nothing arrives, the device has no usable sensor (or permission was
    // denied) and we quietly stay disabled so the virtual stick keeps working.
    this._timeout = setTimeout(() => {
      if (!this.gotEvent) this.enabled = false;
    }, CFG.input.tilt.sensorTimeout);
  }

  detach() {
    removeEventListener('deviceorientation', this._onOrient);
    clearTimeout(this._timeout);
  }

  _onOrient(e) {
    if (e.beta === null && e.gamma === null) return; // sensor present but idle
    this.gotEvent = true;
    this.enabled = true;
    this.raw.beta = e.beta || 0;
    this.raw.gamma = e.gamma || 0;
    if (this._pendingRecentre) {
      this.neutral = { beta: this.raw.beta, gamma: this.raw.gamma };
      this._pendingRecentre = false;
    }
  }

  /** Take the current attitude as "centred". Called on start, unpause, and by the settings button. */
  recentre() {
    if (this.gotEvent) this.neutral = { beta: this.raw.beta, gamma: this.raw.gamma };
    else this._pendingRecentre = true;
    this.smoothed.x = this.smoothed.y = 0;
  }

  contribute(rawIntent, dt) {
    if (!this.enabled || !this.neutral) return;
    const t = CFG.input.tilt;

    // Delta from neutral. Beta wraps at ±180, so normalise or a phone held near
    // vertical flips the pitch axis every few frames.
    let dBeta = wrap180(this.raw.beta - this.neutral.beta);
    let dGamma = wrap180(this.raw.gamma - this.neutral.gamma);

    // Rotate device axes into screen axes. Without this, landscape inverts.
    const rad = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const sx = dGamma * cos + dBeta * sin;
    const sy = dBeta * cos - dGamma * sin;

    const shape = (deg) => {
      const a = Math.abs(deg);
      if (a < t.deadzone) return 0;
      const v = Math.min(1, (a - t.deadzone) / (t.clamp - t.deadzone));
      return Math.sign(deg) * v;
    };

    // Smoothing matters more here than on a stick — raw accelerometer data is
    // noisy enough to make the horizon jitter while the phone sits still.
    const k = 1 - Math.exp(-(1 / Math.max(t.smoothing, 0.001)) * dt);
    this.smoothed.x += (shape(sx) - this.smoothed.x) * k;
    this.smoothed.y += (shape(sy) - this.smoothed.y) * k;

    rawIntent.steer.x += this.smoothed.x;
    rawIntent.steer.y += this.smoothed.y;

    if (this.bus && (Math.abs(this.smoothed.x) + Math.abs(this.smoothed.y)) > 0.12) {
      this.bus.markActive('tilt');
    }
  }
}

function wrap180(d) {
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
