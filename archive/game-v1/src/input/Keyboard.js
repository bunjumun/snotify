// Keyboard.
//
// WASD/arrows steer, Space swims, Shift boosts, E uses. That's the whole device.
//
// The mouse does nothing here, and that is deliberate twice over. It briefly
// aimed the lamp on its own axis, which the lamp no longer needs — it points
// where she's going. Then it briefly steered as an absolute stick, which meant
// the kelpie turned whenever the cursor happened not to be centred, including
// while nobody was touching it. A pointer that steers without being touched is
// not a control, it's a draught.

export class Keyboard {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  attach() {
    addEventListener('keydown', this._onDown);
    addEventListener('keyup', this._onUp);
    // Losing focus mid-key leaves it stuck down forever otherwise — you tab away
    // holding boost, come back, and the kelpie is still flooring it.
    addEventListener('blur', this._onBlur);
  }

  detach() {
    removeEventListener('keydown', this._onDown);
    removeEventListener('keyup', this._onUp);
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
  }
}

// Keys the page would otherwise scroll or activate on.
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isTypingTarget(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}
