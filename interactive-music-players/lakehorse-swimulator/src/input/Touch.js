// Touch: a virtual stick on the left, buttons on the right.
//
// The stick is "floating" — it appears wherever the thumb lands in the left half
// rather than at a fixed spot. Fixed sticks force people to look at their hands;
// a floating one lets them keep their eyes on the water, which matters when
// visibility is 80 units and something is about to loom out of it.
//
// Every touch is tracked by `identifier`, never by index. Indices reshuffle when
// a finger lifts, which is how you end up steering with the button thumb.

import { CFG } from '../../config.js';

export class Touch {
  constructor(root) {
    this.root = root;                    // #touch layer
    this.base = root.querySelector('#stickBase');
    this.knob = root.querySelector('#stickKnob');
    this.zone = root.querySelector('#stick');

    this.stickId = null;
    this.origin = { x: 0, y: 0 };
    this.vec = { x: 0, y: 0 };

    this.thrust = false;
    this.boost = false;
    this.use = false;
    this.lamp = { x: 0, y: 0 };
    this.lampId = null;

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);
  }

  attach() {
    // Only reveal the touch layer once we've actually seen a touch. A laptop with
    // a touchscreen shouldn't get thumb-sticks pasted over the view.
    addEventListener('touchstart', this._onStart, { passive: false });
    addEventListener('touchmove', this._onMove, { passive: false });
    addEventListener('touchend', this._onEnd, { passive: false });
    addEventListener('touchcancel', this._onEnd, { passive: false });

    this._bindButton('#tThrust', (v) => { this.thrust = v; });
    this._bindButton('#tBoost', (v) => { this.boost = v; });
    this._bindButton('#tUse', (v) => { this.use = v; });
  }

  detach() {
    removeEventListener('touchstart', this._onStart);
    removeEventListener('touchmove', this._onMove);
    removeEventListener('touchend', this._onEnd);
    removeEventListener('touchcancel', this._onEnd);
  }

  _bindButton(sel, set) {
    const el = this.root.querySelector(sel);
    if (!el) return;
    const on = (e) => { e.preventDefault(); set(true); };
    const off = (e) => { e.preventDefault(); set(false); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
  }

  _reveal() {
    if (this.root.classList.contains('hide')) this.root.classList.remove('hide');
    if (this.bus) this.bus.markActive('touch');
  }

  _onStart(e) {
    this._reveal();
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('.tbtn, .iconbtn, .btn, #settings, #start, #death')) continue;
      const leftHalf = t.clientX < innerWidth * 0.5;
      if (leftHalf && this.stickId === null) {
        this.stickId = t.identifier;
        this.origin.x = t.clientX; this.origin.y = t.clientY;
        this.base.style.left = this.knob.style.left = `${t.clientX}px`;
        this.base.style.top = this.knob.style.top = `${t.clientY}px`;
        this.root.classList.add('active');
        e.preventDefault();
      } else if (!leftHalf && this.lampId === null) {
        // Right half drags aim the lamp.
        this.lampId = t.identifier;
        this._lampOrigin = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _onMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        const R = CFG.input.touch.stickRadius;
        let dx = t.clientX - this.origin.x;
        let dy = t.clientY - this.origin.y;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
        this.knob.style.left = `${this.origin.x + dx}px`;
        this.knob.style.top = `${this.origin.y + dy}px`;
        const dead = CFG.input.touch.stickDeadzone;
        this.vec.x = Math.abs(dx) < dead ? 0 : dx / R;
        this.vec.y = Math.abs(dy) < dead ? 0 : dy / R;
        e.preventDefault();
      } else if (t.identifier === this.lampId) {
        this.lamp.x = clamp1((t.clientX - this._lampOrigin.x) / (innerWidth * 0.25));
        this.lamp.y = clamp1((t.clientY - this._lampOrigin.y) / (innerHeight * 0.25));
      }
    }
  }

  _onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.vec.x = this.vec.y = 0;
        this.root.classList.remove('active');
      } else if (t.identifier === this.lampId) {
        this.lampId = null;
        this.lamp.x = this.lamp.y = 0;
      }
    }
  }

  contribute(raw) {
    raw.steer.x += this.vec.x;
    raw.steer.y -= this.vec.y;   // screen Y grows downward; nose up is positive
    if (this.thrust) raw.thrust = Math.max(raw.thrust, 1);
    if (this.boost) raw.boost = true;
    if (this.use) raw.interact = true;
    raw.lamp.x += this.lamp.x;
    raw.lamp.y += this.lamp.y;
  }
}

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
