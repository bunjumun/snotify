// What survives a death, and what survives closing the tab.
//
// The lighter is the important one. Finding it is the opening's whole first beat,
// and it's permanent — it survives death and it survives returning tomorrow, so
// the tutorial happens exactly once per person and every bong forever after has a
// reason to check for it.
//
// Everything here is best-effort. Private browsing throws on localStorage writes,
// and a game on a band's website should shrug that off rather than break.

const KEY = 'lakehorse.progress';

const DEFAULTS = {
  hasLighter: false,
  introStep: 0,       // 0 = never played, 4 = tutorial finished
  chestFound: false,
  bestTime: null,     // seconds to find the chest
  claimed: false,     // they've already been through the reward screen once
  logPages: [],
  runs: 0,
};

export class Progress {
  constructor() {
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* corrupt or unavailable — defaults are fine */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  get hasLighter() { return !!this.data.hasLighter; }
  giveLighter() { this.data.hasLighter = true; this.save(); }

  get introStep() { return this.data.introStep | 0; }
  setIntroStep(n) {
    if (n > this.data.introStep) { this.data.introStep = n; this.save(); }
  }
  /** A returning player skips straight to the real loop. */
  get introDone() { return this.data.introStep >= 4; }

  markChestFound(seconds) {
    this.data.chestFound = true;
    if (this.data.bestTime === null || seconds < this.data.bestTime) this.data.bestTime = seconds;
    this.save();
  }

  /** Asking for the same address on every run is how you lose a mailing list. */
  get claimed() { return !!this.data.claimed; }
  markClaimed() { this.data.claimed = true; this.save(); }

  addLogPage(id) {
    if (!this.data.logPages.includes(id)) { this.data.logPages.push(id); this.save(); }
  }

  countRun() { this.data.runs++; this.save(); }

  /** Wipes everything — used by the debug overlay to re-test the opening. */
  reset() {
    this.data = { ...DEFAULTS, logPages: [] };
    this.save();
  }
}
