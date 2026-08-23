// Driving the menus from a game controller.
//
// The pad could already open the pause screen and then do nothing with it,
// which is worse than not opening it: Start pauses, and every control on the
// panel is pointer-only. Same on the start screen, the death screen, the ship's
// log and the reward screen. Five overlays, none of them reachable.
//
//   d-pad / left stick   move the ring        A / cross   press it
//   left / right         slider or dropdown   B / circle  back out
//
// Three decisions worth keeping:
//
// 1. THIS RUNS ITS OWN rAF, not the game's. The panels that most need it are up
//    when the game loop is paused or has never started, so hanging it off
//    Game.update() would leave it dead in exactly the two places it is for.
//    The cost is one getGamepads() call a frame, which is what the spec makes
//    you do anyway; when no pad is connected it returns immediately.
//
// 2. THE LIST IS REBUILT EVERY FRAME and the ring is an index into it, not a
//    remembered element. The difficulty picker on the start screen replaces its
//    own innerHTML on every press, so a held element reference is a dead node
//    one frame later. An index survives that.
//
// 3. IT ONLY ACTS WHEN AN OVERLAY IS UP. In play, the pad belongs to the diver
//    and this class does nothing at all.
//
// Note what this deliberately does NOT do: it never claims the pause button.
// Start is already bound to togglePause() in Game, and two owners for one button
// is how you get a panel that opens and shuts in the same frame.

// Standard-mapping indices. Same layout Gamepad.js documents.
const B = { A: 0, B: 1, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const AX = { LX: 0, LY: 1 };

// Held direction repeats: long enough that a nudge moves one line, fast enough
// that holding it walks the panel.
const FIRST_REPEAT = 0.38;
const NEXT_REPEAT = 0.11;
const STICK_ON = 0.55;   // higher than the game deadzone: a lean, not a drift

/**
 * The overlays, topmost first. `back` is what B does, and null means B does
 * nothing because there is nowhere to back out to.
 */
const PANELS = [
  { id: 'reward', back: (g) => g.reward?.hide() },
  { id: 'logbook', back: (g) => g.logbook?.hide() },
  { id: 'lorebook', back: (g) => g.loreHistory?.hide() },
  { id: 'settings', back: (g) => g.togglePause() },
  { id: 'death', back: null },
  { id: 'start', back: null },
];

const FOCUSABLE = 'button, select, input, .mode, [role="radio"]';

export class PadMenu {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.panelId = null;
    this._where = new Map();
    this._prev = {};
    this._held = 0;
    this._repeatIn = 0;
    this._last = 0;
    this._raf = null;
    this._tick = this._tick.bind(this);
  }

  attach() {
    if (this._raf === null) {
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }
  }

  detach() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._clearRing();
  }

  // ------------------------------------------------------------------ polling

  get _pad() {
    if (!navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;

    const pad = this._pad;
    const panel = this._topPanel();
    if (!pad || !panel) {
      // Either nothing to drive or nothing to drive it with. Drop the ring so a
      // player who puts the pad down and reaches for the mouse is not left with
      // a highlight on something they are not about to press.
      if (this.panelId !== null) { this._clearRing(); this.panelId = null; }
      return;
    }

    if (panel.id !== this.panelId) {
      // Remember where the ring was on each panel. Opening the ship's log from
      // the pause screen and closing it again should put you back on the button
      // you pressed, not at the top of the volume sliders.
      if (this.panelId !== null) this._where.set(this.panelId, this.index);
      this.panelId = panel.id;
      this.index = this._where.get(panel.id) ?? 0;
    }

    const items = this._items(panel.id);
    if (!items.length) return;
    this.index = Math.max(0, Math.min(this.index, items.length - 1));

    const btn = (i) => {
      const b = pad.buttons[i];
      return b ? (typeof b === 'object' ? b.pressed || b.value > 0.5 : b > 0.5) : false;
    };
    const ax = (i) => pad.axes[i] ?? 0;

    // Direction, from the d-pad or from a leaning stick, whichever is asking.
    let dy = 0, dx = 0;
    if (btn(B.UP) || ax(AX.LY) < -STICK_ON) dy = -1;
    else if (btn(B.DOWN) || ax(AX.LY) > STICK_ON) dy = 1;
    if (btn(B.LEFT) || ax(AX.LX) < -STICK_ON) dx = -1;
    else if (btn(B.RIGHT) || ax(AX.LX) > STICK_ON) dx = 1;

    const dir = dy || dx;
    if (!dir) {
      this._held = 0;
      this._repeatIn = 0;
    } else {
      const fresh = this._held === 0;
      this._held = 1;
      this._repeatIn -= dt;
      if (fresh || this._repeatIn <= 0) {
        this._repeatIn = fresh ? FIRST_REPEAT : NEXT_REPEAT;
        if (dy) {
          // Wrapping is deliberate. These lists are short, and a ring that stops
          // dead at the bottom of a six-line panel reads as the pad failing.
          this.index = (this.index + dy + items.length) % items.length;
        } else {
          this._adjust(items[this.index], dx);
        }
      }
    }

    // Edge-triggered, because a menu press must not repeat while held.
    const a = btn(B.A), b = btn(B.B);
    if (a && !this._prev.a) this._activate(items[this.index]);
    if (b && !this._prev.b && panel.back) panel.back(this.game);
    this._prev.a = a;
    this._prev.b = b;

    this._ring(items, this.index);
  }

  // -------------------------------------------------------------------- panel

  _topPanel() {
    for (const p of PANELS) {
      const el = document.getElementById(p.id);
      if (el && !el.classList.contains('hide')) return { ...p, el };
    }
    return null;
  }

  /** Visible, enabled controls inside a panel, in document order. */
  _items(id) {
    const root = document.getElementById(id);
    if (!root) return [];
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.disabled) return false;
      if (el.classList.contains('hide')) return false;
      if (el.type === 'hidden') return false;
      // offsetParent is null for anything display:none, including a whole
      // hidden branch of the panel — which is how the reward screen swaps its
      // email form for its download button.
      return el.offsetParent !== null;
    });
  }

  // ------------------------------------------------------------------ the ring

  _ring(items, i) {
    // Clear the whole document, not just this panel's items. Opening the ship's
    // log from the pause screen leaves the pause screen visible underneath, so
    // scoping the clear to the top panel left a second ring glowing on the
    // button you came in through.
    for (const el of document.querySelectorAll('.padfocus')) {
      if (el !== items[i]) el.classList.remove('padfocus');
    }
    for (const el of items) el.classList.toggle('padfocus', el === items[i]);
    const el = items[i];
    if (el && document.activeElement !== el) {
      try { el.focus({ preventScroll: true }); } catch { /* older Safari */ }
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }

  _clearRing() {
    for (const el of document.querySelectorAll('.padfocus')) el.classList.remove('padfocus');
  }

  // ------------------------------------------------------------- acting on one

  _activate(el) {
    if (!el) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // A slider has no press. Left and right are its controls, and clicking it
    // would jump the handle to wherever the ring happens to sit.
    if (el.tagName === 'INPUT' && el.type === 'range') return;
    // A native dropdown cannot be opened from script, so A steps it on. That is
    // the same thing left and right do, which is the point: whichever button
    // they reach for works.
    if (el.tagName === 'SELECT') return this._adjust(el, 1);
    if (el.tagName === 'INPUT') return;   // text and email want a keyboard
    el.click();
  }

  _adjust(el, dir) {
    if (!el || !dir) return;
    if (el.tagName === 'SELECT') {
      const n = el.options.length;
      if (!n) return;
      el.selectedIndex = Math.max(0, Math.min(n - 1, el.selectedIndex + dir));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') {
      const min = parseFloat(el.min || '0');
      const max = parseFloat(el.max || '1');
      // A twentieth of the run, or the slider's own step if that is coarser.
      const step = Math.max(parseFloat(el.step || '0') || 0, (max - min) / 20);
      const v = Math.max(min, Math.min(max, (parseFloat(el.value) || 0) + dir * step));
      el.value = String(v);
      // Volume listens on input, not change, so it moves while you hold it.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return this._activate(el);
    // The mode picker is a row of buttons, so left and right walk it the way it
    // looks like it should be walked.
    if (el.classList.contains('mode')) {
      const items = this._items(this.panelId);
      const next = this.index + dir;
      if (next >= 0 && next < items.length && items[next].classList.contains('mode')) {
        this.index = next;
      }
    }
  }
}
