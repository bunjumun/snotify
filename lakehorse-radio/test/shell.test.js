// Tests for data/shell.js. Run: node test/shell.test.js
'use strict';
const assert = require('assert');
const S = require('../data/shell.js');

// ---- pure ----
assert.strictEqual(S.clockText(new Date(2026, 10, 22, 18, 2)), '6:02 PM');
assert.strictEqual(S.clockText(new Date(2026, 10, 22, 0, 5)), '12:05 AM');
assert.strictEqual(S.clockText(new Date(2026, 10, 22, 12, 0)), '12:00 PM');
assert.strictEqual(S.clockText(new Date(2026, 10, 22, 9, 30)), '9:30 AM');
assert.strictEqual(S.taskLabel('PLAYER.EXE'), 'PLAYER');
assert.strictEqual(S.taskLabel('win-x'), 'win-x');
assert.strictEqual(S.needsNetwork({ hasSavedNetwork: false }), true);
assert.strictEqual(S.needsNetwork({ hasSavedNetwork: true }), false);
assert.strictEqual(S.needsNetwork({}), false);        // unknown is not first run
assert.strictEqual(S.needsNetwork(null), false);
assert.strictEqual(S.needsNetwork(undefined), false);

// ---- attach, against a fake page ----
function fakePage() {
  const els = {};
  const clicks = [];
  const mk = (id, extra) => {
    const e = Object.assign({
      id, hidden: false, textContent: '', dataset: {}, children: [], attrs: {}, listeners: {},
      parentNode: null,
      classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); },
        toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      addEventListener(t, f) { this.listeners[t] = f; },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); },
      click() { clicks.push(id); if (this.listeners.click) this.listeners.click(); },
      scrollIntoView() {}
    }, extra || {});
    Object.defineProperty(e, 'textContent', {
      get() { return this._t || ''; },
      set(v) { this._t = v; if (v === '') this.children = []; }
    });
    els[id] = e;
    return e;
  };
  ['tasks', 'startMenu', 'startBtn', 'startNetwork', 'startNetworkNote', 'callout', 'tray'].forEach((i) => mk(i));
  els.startMenu.hidden = true; els.callout.hidden = true;
  const win = (id, title, ds) => { const w = mk(id, { hidden: true }); w.dataset = Object.assign({ title }, ds || {}); return w; };
  win('win-player', 'PLAYER.EXE').hidden = false;
  win('win-speaker', 'SPEAKER.EXE');
  win('win-network', 'NETWORK.EXE');
  win('matrixWindow', 'MATRIX.EXE', { opener: 'matrixOpen', closer: 'matrixClose' });
  mk('matrixOpen', { click() { clicks.push('matrixOpen'); els.matrixWindow.hidden = false; } });
  mk('matrixClose', { click() { clicks.push('matrixClose'); els.matrixWindow.hidden = true; } });
  const openBtn = (target) => { const b = mk('open-' + target); b.dataset = { open: target }; return b; };
  const closeBtn = (winId) => { const b = mk('close-' + winId); b.dataset = { close: '' }; b.parentNode = { parentNode: els[winId] }; return b; };
  ['win-player', 'win-speaker', 'win-network', 'matrixWindow'].forEach(openBtn);
  ['win-player', 'win-network', 'matrixWindow'].forEach(closeBtn);
  const wins = ['win-player', 'win-speaker', 'win-network', 'matrixWindow'].map((i) => els[i]);
  const all = (sel) => sel === '.win' ? wins
    : sel === '[data-open]' ? Object.keys(els).filter((k) => k.startsWith('open-')).map((k) => els[k])
    : sel === '[data-close]' ? Object.keys(els).filter((k) => k.startsWith('close-')).map((k) => els[k]) : [];
  const timers = [];
  const doc = { createElement: () => ({ children: [], listeners: {}, classList: { contains: () => false }, addEventListener(t, f) { this.listeners[t] = f; }, set textContent(v) { this.t = v; }, get textContent() { return this.t; } }) };
  const api = S.attach((id) => els[id], { doc, all, now: () => new Date(2026, 10, 22, 18, 2), setInterval: (f, ms) => timers.push(ms), noObserver: true });
  return { els, clicks, api, timers };
}
const taskTitles = (p) => p.els.tasks.children.map((b) => b.textContent);

let p = fakePage();
// Player is open first, everything else closed, the clock shows, no nag.
assert.deepStrictEqual(taskTitles(p), ['PLAYER']);
assert.strictEqual(p.els.tray.textContent, '6:02 PM');
assert.strictEqual(p.els.startMenu.hidden, true);
assert.strictEqual(p.els.callout.hidden, true);
assert.deepStrictEqual(p.timers, [30000]);

// Opening a plain window shows it, closes the Start menu, and adds a task.
p.api.setStart(true);
p.els['open-win-speaker'].click();
assert.strictEqual(p.els['win-speaker'].hidden, false);
assert.strictEqual(p.els.startMenu.hidden, true);
assert.deepStrictEqual(taskTitles(p), ['PLAYER', 'SPEAKER']);
assert.ok(p.els['win-speaker'].classList.contains('focus'));
assert.ok(!p.els['win-player'].classList.contains('focus'));

// The X closes it again.
p = fakePage();
p.els['open-win-network'].click();
p.els['close-win-network'].click();
assert.strictEqual(p.els['win-network'].hidden, true);
assert.deepStrictEqual(taskTitles(p), ['PLAYER']);

// A window that names an opener is opened through it, never by the attribute.
p = fakePage();
p.els['open-matrixWindow'].click();
assert.ok(p.clicks.includes('matrixOpen'));
assert.strictEqual(p.els.matrixWindow.hidden, false);
assert.deepStrictEqual(taskTitles(p), ['PLAYER', 'MATRIX']);
p.els['close-matrixWindow'].click();
assert.ok(p.clicks.includes('matrixClose'));
assert.strictEqual(p.els.matrixWindow.hidden, true);
// Already open: choosing it again does not click the opener a second time.
p.els['open-matrixWindow'].click();
const openClicks = p.clicks.filter((c) => c === 'matrixOpen').length;
p.els['open-matrixWindow'].click();
assert.strictEqual(p.clicks.filter((c) => c === 'matrixOpen').length, openClicks);

// First run: Start opens, Network is flagged, its window opens, the tray warns.
p = fakePage();
p.api.onStatus({ hasSavedNetwork: false });
assert.strictEqual(p.els.startMenu.hidden, false);
assert.ok(p.els.startNetwork.classList.contains('needs'));
assert.strictEqual(p.els.startNetworkNote.textContent, 'needs setup');
assert.strictEqual(p.els.callout.hidden, false);
assert.strictEqual(p.els['win-network'].hidden, false);
assert.strictEqual(p.els.tray.textContent, 'NO WI-FI');

// Choosing anything dismisses the callout.
p.els['open-win-player'].click();
assert.strictEqual(p.els.callout.hidden, true);

// A saved network, or an unreadable reply, leaves the desktop quiet.
p = fakePage();
p.api.onStatus({ hasSavedNetwork: true });
p.api.onStatus(null);
assert.strictEqual(p.els.startMenu.hidden, true);
assert.strictEqual(p.els['win-network'].hidden, true);
assert.strictEqual(p.els.tray.textContent, '6:02 PM');

// The Start button toggles the menu and reports it.
p = fakePage();
p.els.startBtn.click();
assert.strictEqual(p.els.startMenu.hidden, false);
assert.strictEqual(p.els.startBtn.attrs['aria-expanded'], 'true');
p.els.startBtn.click();
assert.strictEqual(p.els.startMenu.hidden, true);

console.log('shell: all passed');
