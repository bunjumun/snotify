// Difficulty.
//
// Four modes scaling four things: how long the tank lasts, what a baggie gives
// back, how densely the level is stocked, and how hard the cold layer bites.
// Four-baggies-to-a-bowl is deliberately NOT one of them — that's the identity of
// the mechanic, and a version of the game where it's three would be a different
// game rather than an easier one.
//
// Hints stay available on request at every level, Hard included. Withholding them
// makes a run tedious rather than hard; what Hard actually removes is slack.
//
// Chill exists for the band page. Most people arriving from a music site want the
// aquarium, not the challenge, and 4:20 with a minute-plus per baggie means
// anyone who picks anything up is effectively unkillable.

import { CFG, modeCfg } from '../../config.js';

const KEY = 'lakehorse.difficulty';

export class Difficulty {
  constructor() {
    this.name = localStorage.getItem(KEY) || CFG.difficulty.default;
    if (!CFG.difficulty.modes[this.name]) this.name = CFG.difficulty.default;
  }

  get cfg() { return modeCfg(this.name); }
  get tank() { return this.cfg.tank; }
  get baggieReturn() { return this.cfg.baggieReturn; }
  get baggieCount() { return this.cfg.baggieCount; }
  get thermoMult() { return this.cfg.thermoMult; }
  get volunteersHints() { return this.cfg.hints === 'volunteered'; }

  set(name) {
    if (!CFG.difficulty.modes[name]) return;
    this.name = name;
    try { localStorage.setItem(KEY, name); } catch { /* private mode; not worth failing over */ }
  }

  /** [{id, label, tankLabel, cfg}] for the start screen and settings. */
  list() {
    return CFG.difficulty.order.map((id) => {
      const c = CFG.difficulty.modes[id];
      const m = Math.floor(c.tank / 60), s = String(c.tank % 60).padStart(2, '0');
      return { id, label: c.label, tankLabel: `${m}:${s}`, cfg: c };
    });
  }
}
