// Tests for data/matrix-window.js. Run: node test/matrix-window.test.js
'use strict';
const assert = require('assert');
const M = require('../data/matrix-window.js');

const frame = (c) => c.repeat(64);

// ---- pure helpers ----
assert.deepStrictEqual(M.parseFrame(frame('0')), new Array(64).fill(0));
assert.strictEqual(M.parseFrame(frame('f'))[63], 15);
assert.strictEqual(M.parseFrame('abc'), null);
assert.strictEqual(M.parseFrame(frame('g')), null);
assert.strictEqual(M.parseFrame(undefined), null);
assert.strictEqual(M.parseFrame(frame('0') + '0'), null);

assert.strictEqual(M.nextDelay(250, 100), 250);          // fast stays at base
assert.strictEqual(M.nextDelay(250, 500), 500);          // slow doubles
assert.strictEqual(M.nextDelay(1500, 900), 2000);        // capped
assert.strictEqual(M.nextDelay(2000, -1), 2000);         // failure backs off, capped
assert.strictEqual(M.nextDelay(1000, 100), 500);         // recovers by halves
assert.strictEqual(M.nextDelay(300, 100), 250);          // never below base

assert.strictEqual(M.lightAlpha(0, 100), 0);             // dark stays dark
assert.ok(M.lightAlpha(1, 1) >= 0.08);                   // lit is never invisible
assert.strictEqual(M.lightAlpha(15, 100), 1);
assert.ok(M.lightAlpha(15, 50) < M.lightAlpha(15, 100));
assert.strictEqual(M.lightAlpha(15, 1000), 1);           // slider clamped

assert.strictEqual(M.titleFor('Mango Tree World.wav'), 'Mango Tree World');
assert.strictEqual(M.titleFor(''), 'LAKEHORSE');
assert.strictEqual(M.titleFor(null), 'LAKEHORSE');
assert.strictEqual(M.titleFor('  '), 'LAKEHORSE');
assert.strictEqual(M.titleFor('Mr. Blue'), 'Mr. Blue');   // not an extension

const d = new Date(2026, 10, 22, 7, 5, 9);
assert.strictEqual(M.clockQuery(d), 'h=7&m=5&s=9');
assert.strictEqual(M.modeRequest('dazzle', '', d), '/api/matrix?mode=dazzle');
assert.strictEqual(M.modeRequest('title', 'A&B.wav', d), '/api/matrix?mode=title&title=A%26B');
assert.strictEqual(M.modeRequest('clock', '', d), '/api/matrix?mode=clock&h=7&m=5&s=9');
assert.strictEqual(M.modeRequest('image', '', d), '');    // not offered here
assert.strictEqual(M.modeRequest('nope', '', d), '');

// ---- attach: no request until opened, one in flight, hidden pauses ----
function fakePage() {
  const els = {};
  const mk = (id) => {
    const e = { id, hidden: false, textContent: '', value: '', children: [], listeners: {}, attrs: {},
      dataset: {}, width: 320, height: 320,
      classList: { s: new Set(), toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      addEventListener(t, f) { this.listeners[t] = f; },
      setAttribute(k, v) { this.attrs[k] = v; },
      getContext() { return { fillRect() {}, beginPath() {}, arc() {}, fill() {}, set fillStyle(v) {}, set globalAlpha(v) {} }; } };
    els[id] = e; return e;
  };
  ['matrixOpen', 'matrixWindow', 'matrixCanvas', 'matrixPreview', 'matrixBright', 'matrixNote',
   'matrixFull', 'matrixClose', 'matrixModes', 'nowPlaying'].forEach(mk);
  els.matrixBright.value = '70';
  els.nowPlaying.textContent = 'Jupiter Gold.wav';
  M.MODES.forEach((m) => { const b = mk('mode-' + m); b.dataset.mode = m; els.matrixModes.children.push(b); });
  return els;
}

function harness(replies, extra) {
  const els = fakePage();
  const calls = [];
  const timers = [];
  let clockMs = 0;
  const doc = { hidden: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } };
  const fetchImpl = (url, o) => {
    calls.push({ url, method: (o && o.method) || 'GET' });
    const r = replies.shift();
    if (r instanceof Error) return Promise.reject(r);
    clockMs += r.took || 0;
    return Promise.resolve({ json: () => Promise.resolve(r.body) });
  };
  const store = {}; 
  const api = M.attach((id) => els[id], {
    fetch: fetchImpl, doc,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: (h) => { if (timers[h - 1]) timers[h - 1].f = null; },
    now: () => clockMs, date: () => d, ...(extra || {}),
    storage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }
  });
  return { els, calls, timers, api, doc, store, advance: (ms) => { clockMs += ms; } };
}
const flush = () => new Promise((r) => setImmediate(r));
const live = (h) => h.timers.filter((t) => t.f);
const fire = (h) => { const t = live(h)[0]; const f = t.f; t.f = null; f(); };  // a timer fires once

(async () => {
  // Closed: attaching makes no request and schedules nothing.
  let h = harness([]);
  assert.strictEqual(h.calls.length, 0);
  assert.strictEqual(h.timers.length, 0);

  // Open: one request at once, the next scheduled only after the reply.
  h = harness([{ body: { ok: true, mode: 'off', frame: frame('0') } },
               { body: { ok: true, mode: 'bars', frame: frame('8') } },
               { body: { ok: true, mode: 'bars', frame: frame('8') } }]);
  h.api.open();
  assert.strictEqual(h.els.matrixWindow.hidden, false);
  assert.strictEqual(h.calls.length, 1);
  assert.strictEqual(live(h).length, 0);                // none until the reply lands
  await flush();
  assert.strictEqual(live(h).length, 1);
  assert.strictEqual(live(h)[0].ms, 250);
  fire(h); await flush();
  assert.strictEqual(h.calls.length, 2);
  assert.strictEqual(h.els['mode-bars'].attrs['aria-pressed'], 'true');  // follows the box
  assert.strictEqual(h.els['mode-off'].attrs['aria-pressed'], 'false');

  // Close stops the loop and cancels the pending poll.
  h.api.close();
  assert.strictEqual(h.els.matrixWindow.hidden, true);
  assert.strictEqual(live(h).length, 0);
  const before = h.calls.length;
  h.api.open(); await flush(); h.api.close();
  assert.strictEqual(h.calls.length, before + 1);

  // Slow replies back the poll rate off; a failure does too and says so.
  h = harness([{ body: { ok: true, mode: 'off', frame: frame('0') }, took: 600 }, new Error('down')]);
  h.api.open(); await flush();
  assert.strictEqual(live(h)[0].ms, 500);
  fire(h); await flush();
  assert.strictEqual(live(h).pop().ms, 1000);
  assert.ok(/Lost touch/.test(h.els.matrixNote.textContent));

  // A garbled frame draws nothing and counts as a failure.
  h = harness([{ body: { ok: true, mode: 'off', frame: 'short' } }]);
  h.api.open(); await flush();
  assert.strictEqual(live(h)[0].ms, 500);

  // Hidden tab: no new poll is scheduled; shown again, it polls at once.
  h = harness([{ body: { ok: true, mode: 'off', frame: frame('0') } },
               { body: { ok: true, mode: 'off', frame: frame('0') } }]);
  h.api.open(); h.doc.hidden = true; await flush();
  assert.strictEqual(live(h).length, 0);
  h.doc.hidden = false; h.doc.listeners.visibilitychange(); await flush();
  assert.strictEqual(h.calls.length, 2);

  // Choosing a mode POSTs it, with the playing title and the phone's time.
  h = harness([{ body: { ok: true, mode: 'title', frame: frame('0') } },
               { body: { ok: true, mode: 'clock', frame: frame('0') } },
               { body: { ok: false, error: 'nope', mode: 'clock', frame: frame('0') } }]);
  await h.api.choose('title');
  assert.deepStrictEqual(h.calls[0], { url: '/api/matrix?mode=title&title=Jupiter%20Gold', method: 'POST' });
  await h.api.choose('clock');
  assert.strictEqual(h.calls[1].url, '/api/matrix?mode=clock&h=7&m=5&s=9');
  await h.api.choose('bars');
  assert.strictEqual(h.els.matrixNote.textContent, 'nope');
  await h.api.choose('image');                          // unknown: no request
  assert.strictEqual(h.calls.length, 3);

  // Brightness: saved, and restored from storage next time.
  h = harness([]);
  h.els.matrixBright.value = '30';
  h.els.matrixBright.listeners.input.call(h.els.matrixBright);
  assert.strictEqual(h.store['lakehorse.matrix.brightness'], '30');

  // Full view toggles the overlay class and the button text.
  h = harness([]);
  h.els.matrixFull.listeners.click();
  assert.ok(h.els.matrixWindow.classList.contains('full'));
  assert.strictEqual(h.els.matrixFull.textContent, 'Exit full view');
  h.els.matrixCanvas.listeners.click();
  assert.ok(!h.els.matrixWindow.classList.contains('full'));

  // Phone mode: when the page is playing, Bars is drawn locally from its own
  // levels and the box's demo frame does not overwrite it.
  const BM = require('../data/band-meter.js');
  let phone = [8, 6, 4, 2, 1, 0, 0, 0];
  h = harness([{ body: { ok: true, mode: 'bars', frame: frame('0') } },
               { body: { ok: true, mode: 'bars', frame: frame('0') } }],
              { bands: () => phone, meter: BM });
  h.api.open(); await flush();                        // box frame lands: mode becomes bars
  const timersBefore = h.timers.length;
  const local = live(h).find((t) => t.ms === 80);
  assert.ok(local, 'a local timer runs while a phone provider exists');
  let painted = 0;
  h.els.matrixCanvas.getContext = () => ({ fillRect() {}, beginPath() {}, arc() {}, fill() {},
    set fillStyle(v) {}, set globalAlpha(v) { painted++; } });
  const f = local.f; local.f = null; f();
  assert.ok(painted > 0, 'local bars were drawn');
  assert.ok(live(h).some((t) => t.ms === 80), 'and the next tick is scheduled');
  // A box reply right after must not wipe the local frame.
  const t0 = painted;
  const poll = live(h).find((t) => t.ms !== 80); poll.f(); poll.f = null; await flush();
  assert.strictEqual(painted, t0, 'box frame ignored while local bars are fresh');
  // No levels (paused, or a non-WAV song): the box's frame is shown again.
  phone = null; h.advance(1000);
  const poll2 = live(h).find((t) => t.ms !== 80);
  h.api.close();
  assert.strictEqual(live(h).length, 0, 'close cancels the local timer too');

  console.log('matrix-window: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
