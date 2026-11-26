// Tests for data/help.js, data/frame.js and data/lens.js. Run: node test/help.test.js
'use strict';
const assert = require('assert');
const H = require('../data/help.js');
const F = require('../data/frame.js');
const L = require('../data/lens.js');

// ---- normalize: a bad file never throws, it just gives nothing ----
assert.strictEqual(H.normalize(null), null);
assert.strictEqual(H.normalize('x'), null);
assert.strictEqual(H.normalize({}), null);
assert.strictEqual(H.normalize({ entries: 4 }), null);
const n = H.normalize({ entries: { a: { title: 'A', text: 'aa' }, b: { text: '' }, c: 7, d: { text: 'dd' } }, index: [{ group: 'G', ids: ['a', 3, 'd'] }, 'junk', { group: 5 }] });
assert.deepStrictEqual(Object.keys(n.entries), ['a', 'd']);
assert.strictEqual(n.entries.d.title, 'd');           // missing title falls back to the id
assert.deepStrictEqual(n.index, [{ group: 'G', ids: ['a', 'd'] }]);
assert.deepStrictEqual(H.normalize({ entries: {}, index: 'no' }).index, []);

// ---- helpIdFor walks up to the nearest data-help ----
const win = { parentNode: null, getAttribute: (k) => (k === 'data-help' ? 'win-player' : null) };
const title = { parentNode: win, getAttribute: () => null };
const btn = { parentNode: win, getAttribute: (k) => (k === 'data-help' ? 'play-next' : null) };
assert.strictEqual(H.helpIdFor(btn), 'play-next');
assert.strictEqual(H.helpIdFor(title), 'win-player');   // the title bar explains the window
assert.strictEqual(H.helpIdFor({ parentNode: null, getAttribute: () => null }), '');
assert.strictEqual(H.helpIdFor(null), '');

// ---- bubbleFor ----
const help = H.normalize({ entries: { x: { title: 'X', text: 'about x' } } });
assert.deepStrictEqual(H.bubbleFor(help, 'x'), { title: 'X', text: 'about x' });
assert.ok(/been written/.test(H.bubbleFor(help, 'nope').text));
assert.ok(/could not be loaded/.test(H.bubbleFor(null, 'x').text));
assert.ok(/Nothing here/.test(H.bubbleFor(help, '').text));

// ---- placeBubble stays on the screen ----
const view = { width: 375, height: 667 };
let p = H.placeBubble({ left: 10, top: 100, bottom: 130, width: 40 }, view, 100);
assert.ok(p.left >= 8 && p.left + p.width <= 375 - 8);
assert.strictEqual(p.top, 138);                          // below the thing
p = H.placeBubble({ left: 300, top: 600, bottom: 640, width: 60 }, view, 100);
assert.ok(p.top + 100 <= 667 - 8 && p.top < 600);       // no room below: above
assert.ok(p.left + p.width <= 375 - 8);
p = H.placeBubble({ left: 0, top: 0, bottom: 0, width: 0 }, { width: 200, height: 300 }, 90);
assert.ok(p.width <= 200 - 16 && p.top >= 8);

// ---- the frame ----
assert.strictEqual(F.closeLabel('PLAYER.EXE'), 'Close PLAYER.EXE');
assert.strictEqual(F.closeLabel(''), 'Close');
assert.ok(/<svg/.test(F.SKULL) && /e9e5d6/.test(F.SKULL));
function el(extra) {
  return Object.assign({ attrs: {}, children: [], dataset: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; },
    querySelector(sel) { return this.found && this.found[sel] || null; },
    insertBefore(c, ref) { this.inserted = [c, ref]; } }, extra || {});
}
const x = el();
const bar = el({ found: { '.win-x': x }, parentNode: { dataset: { title: 'NETWORK.EXE' } } });
F.decorate({ querySelectorAll: () => [bar], createElement: () => el() });
assert.ok(/<svg/.test(x.innerHTML));
assert.strictEqual(x.attrs['aria-label'], 'Close NETWORK.EXE');
assert.strictEqual(bar.inserted[0].attrs['data-help'], 'whatsthis');
assert.strictEqual(bar.inserted[0].className, 'win-help');
assert.strictEqual(bar.inserted[1], x);                  // the ? sits before the close button
// A bar that already has one is not given a second.
const bar2 = el({ found: { '.win-x': el(), '.win-help': el() }, parentNode: {} });
F.decorate({ querySelectorAll: () => [bar2], createElement: () => el() });
assert.strictEqual(bar2.inserted, undefined);

// ---- attach: What's this? mode with a fake page ----
function page(fetchImpl) {
  const els = {};
  ['helpCatcher', 'helpBubble', 'helpBubbleTitle', 'helpBubbleText', 'win-help', 'helpList'].forEach((id) => {
    els[id] = el({ hidden: true, textContent: '', style: {}, offsetHeight: 80, children: [],
      appendChild(c) { this.children.push(c); } });
  });
  els.helpBubbleTitle.hidden = false;
  const docListeners = {};
  const target = { parentNode: win, getAttribute: (k) => (k === 'data-help' ? 'x' : null), getBoundingClientRect: () => ({ left: 20, top: 40, bottom: 80, width: 60 }) };
  const classes = new Set();
  const doc = {
    documentElement: { clientWidth: 375, clientHeight: 667, classList: { toggle(c, on) { on ? classes.add(c) : classes.delete(c); } } },
    elementFromPoint: () => target,
    addEventListener(t, f) { docListeners[t] = f; },
    createElement: () => el({ textContent: '', appendChild(c) { this.children.push(c); } })
  };
  const api = H.attach((id) => els[id], { doc, fetch: fetchImpl });
  return { els, api, doc, classes, docListeners };
}
const ok = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: { x: { title: 'X', text: 'about x' } }, index: [{ group: 'G', ids: ['x'] }] }) });
(async () => {
  let calls = 0;
  let pg = page(() => { calls++; return ok(); });
  assert.strictEqual(calls, 0, 'no request until help is used');
  await pg.api.turnOn();
  assert.strictEqual(pg.els.helpCatcher.hidden, false);
  assert.ok(pg.classes.has('asking'));
  assert.ok(/What's this\? is on/.test(pg.els.helpBubbleText.textContent));
  await pg.api.ask(30, 50);                                // the next tap
  assert.strictEqual(pg.els.helpCatcher.hidden, true);     // mode ends after one tap
  assert.strictEqual(pg.els.helpBubbleTitle.textContent, 'X');
  assert.strictEqual(pg.els.helpBubbleText.textContent, 'about x');
  assert.strictEqual(pg.els.helpBubble.hidden, false);
  assert.ok(pg.els.helpBubble.style.top);
  assert.strictEqual(calls, 1, 'help.json is fetched once');

  // The Help window builds one entry per index line.
  pg = page(ok);
  pg.api.buildIndex();
  await pg.api.load();
  await new Promise((r) => setImmediate(r));
  const kinds = pg.els.helpList.children.map((c) => c.className);
  assert.deepStrictEqual(kinds, ['label', 'helpentry']);

  // A missing or broken help.json never throws, and the bubble says so.
  for (const bad of [() => Promise.reject(new Error('down')), () => Promise.resolve({ ok: false }),
    () => Promise.resolve({ ok: true, json: () => Promise.resolve('junk') })]) {
    pg = page(bad);
    await pg.api.turnOn();
    assert.ok(/could not be loaded/.test(pg.els.helpBubbleText.textContent));
    await pg.api.ask(1, 1);
    assert.ok(/could not be loaded/.test(pg.els.helpBubbleText.textContent));
  }

  // ---- lens ----
  assert.strictEqual(L.parseLook('clean'), 'clean');
  assert.strictEqual(L.parseLook('weird'), 'tube');
  assert.strictEqual(L.parseLook(null), 'tube');
  assert.strictEqual(L.otherLook('tube'), 'clean');
  assert.strictEqual(L.labelFor('clean'), 'Screen: clean');
  const store = {};
  const classes2 = new Set();
  const btn2 = el({ textContent: '' });
  const lensApi = L.attach(() => btn2, {
    doc: { documentElement: { classList: { toggle(c, on) { on ? classes2.add(c) : classes2.delete(c); } } } },
    storage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }
  });
  assert.strictEqual(lensApi.look(), 'tube');
  assert.ok(!classes2.has('lens-clean'));
  btn2.listeners.click();
  assert.ok(classes2.has('lens-clean'));
  assert.strictEqual(store[L.KEY], 'clean');
  assert.strictEqual(btn2.textContent, 'Screen: clean');
  const lens2 = L.attach(() => el(), {                       // remembered across loads
    doc: { documentElement: { classList: { toggle(c, on) { on ? classes2.add(c) : classes2.delete(c); } } } },
    storage: { getItem: (k) => store[k] || null, setItem() {} }
  });
  assert.strictEqual(lens2.look(), 'clean');
  // Blocked storage never throws.
  const bad = L.attach(() => el(), { doc: { documentElement: { classList: { toggle() {} } } }, storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } });
  assert.strictEqual(bad.look(), 'tube');
  bad.toggle();

  console.log('help: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
