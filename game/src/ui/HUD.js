// The HUD.
//
// Deliberately literal. You should never have to read a number to know whether
// you can pack a bowl — four slots either are or aren't full, and the lighter
// either is or isn't lit. Breath changes colour as well as length, because from
// the corner of an eye colour reads faster than width.
//
// One prompt element handles interaction, fish dialogue and objectives, because
// only one of those should ever be competing for attention at a time.

import { CFG } from '../../config.js';
import { Radar } from './Radar.js';

export class HUD {
  constructor(progress) {
    this.progress = progress;
    this.radar = new Radar(document.getElementById('radar'));
    this.el = {
      hud: document.getElementById('hud'),
      wrap: document.getElementById('breathWrap'),
      fill: document.getElementById('breathFill'),
      label: document.getElementById('breathLabel'),
      slots: document.getElementById('slots'),
      lighter: document.getElementById('lighter'),
      shake: document.getElementById('shake'),
      prompt: document.getElementById('prompt'),
      seed: document.getElementById('seed'),
      debug: document.getElementById('debug'),
      hint: document.getElementById('btnHint'),
    };

    this.slotEls = [];
    for (let i = 0; i < CFG.stash.needed; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      this.el.slots.appendChild(d);
      this.slotEls.push(d);
    }

    this._promptTimer = 0;
    this._promptSticky = false;
    this._lastCarried = -1;
    this._lastLighter = null;
  }

  setSeed(seed) {
    this.el.seed.textContent = `seed ${seed}`;
    this.el.seed.onclick = async () => {
      const url = `${location.origin}${location.pathname}?seed=${seed}`;
      try {
        await navigator.clipboard.writeText(url);
        this.el.seed.textContent = 'copied ✓';
      } catch {
        // Clipboard is permission-gated and fails silently in some browsers;
        // showing the seed is still better than showing nothing.
        this.el.seed.textContent = `seed ${seed}`;
      }
      setTimeout(() => { this.el.seed.textContent = `seed ${seed}`; }, 1600);
    };
  }

  updateBreath(breath) {
    this.el.fill.style.transform = `scaleX(${breath.fraction})`;
    const s = Math.ceil(breath.value);
    const m = Math.floor(s / 60);
    this.el.label.textContent = `BREATH  ${m}:${String(s % 60).padStart(2, '0')}`;
    const c = this.el.hud.classList;
    c.toggle('warn', breath.state === 'warn');
    c.toggle('panic', breath.state === 'panic' || breath.state === 'empty');
  }

  updateInventory(stash, hasLighter) {
    if (stash.carried !== this._lastCarried) {
      this._lastCarried = stash.carried;
      this.slotEls.forEach((el, i) => el.classList.toggle('full', i < stash.carried));
    }
    if (hasLighter !== this._lastLighter) {
      this._lastLighter = hasLighter;
      this.el.lighter.classList.toggle('has', hasLighter);
    }
    this.el.shake.classList.toggle('hide', !stash.hasShake);
  }

  /**
   * @param {string} text may contain <kbd> markup
   * @param {{who?:string, seconds?:number, sticky?:boolean}} [opts]
   */
  say(text, opts = {}) {
    const who = opts.who ? `<span class="who">${opts.who}</span>` : '';
    this.el.prompt.innerHTML = who + text;
    this.el.prompt.classList.add('on');
    this._promptSticky = !!opts.sticky;
    this._promptTimer = opts.sticky ? Infinity : (opts.seconds ?? 3.5);
  }

  clearSay() {
    this.el.prompt.classList.remove('on');
    this._promptTimer = 0;
    this._promptSticky = false;
  }

  update(dt) {
    if (this._promptTimer > 0 && this._promptTimer !== Infinity) {
      this._promptTimer -= dt;
      if (this._promptTimer <= 0) this.clearSay();
    }
  }

  setHintAvailable(on) {
    this.el.hint.style.opacity = on ? '1' : '0.3';
    this.el.hint.disabled = !on;
  }

  showDebug(lines) {
    this.el.debug.classList.remove('hide');
    this.el.debug.textContent = lines;
  }
}
