// Keyboard + mouse.
//
// WASD/arrows steer, Space swims, Shift boosts, E uses — and so does the MOUSE,
// which steers as an absolute stick: its offset from the centre of the canvas is
// the deflection. No pointer lock. Grabbing the cursor for a game someone opened
// from a band page is a hostile thing to do, and this doesn't need it.
//
// The mouse used to aim the lamp on its own axis. The lamp now points where
// she's going, which frees the better input device to do the harder job.

export class Keyboard {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0 };
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  attach() {
    addEventListener('keydown', this._onDown);
    addEventListener('keyup', this._onUp);
    addEventListener('mousemove', this._onMove);
    // Losing focus mid-key leaves it stuck down forever otherwise — you tab away
    // holding boost, come back, and the kelpie is still flooring it.
    addEventListener('blur', this._onBlur);
  }

  detach() {
    removeEventListener('keydown', this._onDown);
    removeEventListener('keyup', this._onUp);
    removeEventListener('mousemove', this._onMove);
    removeEventListener('blur', this._onBlur);
  }

  _onDown(e) {
    if (e.repeat) return;
    // Don't hijack typing in the reward-screen email field or the settings panel.
    if (isTypingTarget(e.target)) return;
    this.keys.add(e.code);
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (this.bus) this.bus.markActive('keyboard');
  }

  _onUp(e) { this.keys.delete(e.code); }
  _onBlur() { this.keys.clear(); }

  _onMove(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  }

  contribute(raw) {
    const k = this.keys;
    let sx = 0, sy = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    // Not inverted. Up is up: intent.steer.y is "positive = nose up", and every
    // adapter is responsible for handing it over that way round.
    if (k.has('KeyW') || k.has('ArrowUp')) sy += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1;

    raw.steer.x += sx;
    raw.steer.y += sy;
    if (k.has('Space')) raw.thrust = Math.max(raw.thrust, 1);
    if (k.has('ShiftLeft') || k.has('ShiftRight')) raw.boost = true;
    if (k.has('KeyE') || k.has('Enter')) raw.interact = true;

    // Absolute stick. Screen Y grows downward, so it's negated: cursor up is
    // nose up, same as ArrowUp, and cursor right turns right, same as D.
    raw.steer.x += this.mouse.x;
    raw.steer.y -= this.mouse.y;
  }
}

// Keys the page would otherwise scroll or activate on.
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isTypingTarget(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}
