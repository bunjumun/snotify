// Tests for data/drive-b.js and data/drive-b.json. Run: node test/drive-b.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../data/drive-b.js');

// ---- node order: the same first cells as test/test_matrix (alignmentCell) ----
const want = [[0, 7], [0, 6], [1, 7], [0, 5], [1, 6], [2, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
want.forEach((w, n) => assert.deepStrictEqual([D.nodeCell(n).col, D.nodeCell(n).row], w, 'node ' + n));
assert.deepStrictEqual(D.nodeCell(63), { col: 7, row: 0 });
assert.strictEqual(D.nodeCell(64), null);
assert.strictEqual(D.nodeCell(-1), null);
assert.strictEqual(D.nodeCell(1.5), null);
const seen = new Set();
for (let n = 0; n < 64; n++) { const c = D.nodeCell(n); seen.add(c.row * 8 + c.col); }
assert.strictEqual(seen.size, 64);

// ---- reading the box's reply ----
assert.deepStrictEqual(D.readAlignment({ alignment: { points: 2400, nodes: 24, percent: 37 } }), { points: 2400, nodes: 24, percent: 37 });
assert.deepStrictEqual(D.readAlignment({ alignment: { points: 99999 } }), { points: 6400, nodes: 64, percent: 100 });
assert.deepStrictEqual(D.readAlignment({ alignment: { points: -5 } }), { points: 0, nodes: 0, percent: 0 });
assert.strictEqual(D.readAlignment({ alignment: { points: 'x' } }), null);
assert.strictEqual(D.readAlignment({}), null);
assert.strictEqual(D.readAlignment(null), null);
assert.strictEqual(D.readAlignment({ alignment: { points: NaN } }), null);

// ---- lattice: locked teal and joined; unlocked rings off the grid, fixed ----
let m = D.latticeModel(0);
assert.strictEqual(m.locked.length, 0);
assert.strictEqual(m.rings.length, 64);
assert.strictEqual(m.lines.length, 0);
m = D.latticeModel(24);
assert.strictEqual(m.locked.length, 24);
assert.strictEqual(m.rings.length, 40);
assert.ok(m.lines.length > 24 && m.lines.length < 60);
m = D.latticeModel(64);
assert.strictEqual(m.rings.length, 0);
assert.strictEqual(m.lines.length, 2 * 8 * 7);          // a full grid of neighbours
assert.strictEqual(D.latticeModel(500).locked.length, 64);  // held at the full lattice
assert.strictEqual(D.latticeModel(-3).locked.length, 0);
// Offsets are fixed: the same call twice is identical, and rings are not on the grid.
assert.deepStrictEqual(D.latticeModel(10), D.latticeModel(10));
const ring = D.latticeModel(0).rings[30];
assert.strictEqual(ring.n, 30);
const home = D.nodeCell(30);
assert.ok(Math.abs(ring.x - (10 + 15.5 * home.col)) <= 3.6 && Math.abs(ring.y - (10 + 15.5 * home.row)) <= 3.6);
// A ring keeps the same place whether or not other nodes are locked.
assert.deepStrictEqual(D.latticeModel(3).rings.find((r) => r.n === 30), ring);
// The svg: numbers only, snap and flash classes only where asked.
let svg = D.latticeSvg(24, -1, -1);
assert.strictEqual((svg.match(/fill="#5fd0b0"/g) || []).length, 24);
assert.strictEqual((svg.match(/stroke="#ff6b2c"/g) || []).length, 40);
assert.ok(!/snap/.test(svg));
svg = D.latticeSvg(24, 23, 23);
assert.strictEqual((svg.match(/class="snap/g) || []).length, 1);
assert.strictEqual((svg.match(/snap flash/g) || []).length, 1);
assert.ok(!/[<>]/.test(svg.replace(/<[^>]*>/g, '')));

// ---- drive-b.json: the shipped seed ----
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'drive-b.json'), 'utf8'));
const parsed = D.parseDrive(seed);
assert.deepStrictEqual(parsed.files.map((f) => f.name), ['LOG_0417.TXT', 'CREW_MANIFEST.DAT', 'TX_PROMO.WAV', 'SHOW_TICKETS.LNK']);
const th = parsed.files.map((f) => f.threshold);
assert.strictEqual(th[0], 0);
assert.ok(th.every((t, i) => i === 0 || t > th[i - 1]), 'thresholds rise');
assert.deepStrictEqual(parsed.files.map((f) => f.kind), ['text', 'text', 'download', 'link']);
parsed.files.filter((f) => f.kind === 'text').forEach((f) => assert.ok(/PLACEHOLDER/.test(f.content)));
assert.ok(/PLACEHOLDER/.test(parsed.files[3].url));

// ---- malformed input: dropped, never thrown ----
assert.strictEqual(D.parseDrive(null), null);
assert.strictEqual(D.parseDrive('x'), null);
assert.strictEqual(D.parseDrive({}), null);
assert.strictEqual(D.parseDrive({ files: 'no' }), null);
assert.deepStrictEqual(D.parseDrive({ files: [] }).files, []);
const rough = D.parseDrive({ files: [
  null, 5, { name: 'A', kind: 'text', threshold: 10 },              // text without content
  { name: 'B', kind: 'zip', threshold: 10, content: 'x' },          // unknown kind
  { name: 'C', kind: 'text', threshold: 101, content: 'x' },        // threshold out of range
  { name: 'D', kind: 'text', threshold: 'x', content: 'x' },
  { name: 'E', kind: 'link', threshold: 5, url: 'javascript:alert(1)' },
  { name: 'F', kind: 'link', threshold: 5, url: '//evil.example/x' },
  { name: 'G', kind: 'download', threshold: 5 },
  { name: 'ok.TXT', kind: 'text', threshold: 5.9, content: 'fine' },
  { name: 'ok2', kind: 'link', threshold: 0, url: 'https://example.com/a' }
] });
assert.deepStrictEqual(rough.files.map((f) => f.name), ['ok.TXT', 'ok2']);
assert.strictEqual(rough.files[0].threshold, 5);

// ---- garbling ----
const full = D.garble('CREW_MANIFEST.DAT', 1);
assert.notStrictEqual(full, 'CREW_MANIFEST.DAT');          // a locked name always keeps a bad char
assert.strictEqual(D.garble('CREW_MANIFEST.DAT', 0.3), D.garble('CREW_MANIFEST.DAT', 0.3));  // fixed
const bad = (s, name) => s.split('').filter((c, i) => c !== name[i]).length;
const name = 'CREW_MANIFEST.DAT';
assert.ok(bad(D.garble(name, 0), name) >= 4, 'half garbled at the start');
assert.ok(bad(D.garble(name, 0), name) > bad(D.garble(name, 0.9), name), 'clears as it resolves');
assert.strictEqual(D.garble(name, 0).length, name.length);
assert.ok(D.garble(name, 0).includes('.') && D.garble(name, 0).includes('_'));
assert.strictEqual(D.garble('', 0), '');

// ---- a file's state ----
const f = { name: 'TX_PROMO.WAV', threshold: 60, kind: 'download', url: 'x' };
let st = D.fileState(f, 0);
assert.strictEqual(st.unlocked, false);
assert.strictEqual(st.status, 'corrupt');
assert.notStrictEqual(st.name, f.name);
st = D.fileState(f, 30);
assert.strictEqual(st.status, 'aligning 50%');
st = D.fileState(f, 59);
assert.ok(/^aligning 9/.test(st.status));
assert.strictEqual(st.unlocked, false);
st = D.fileState(f, 60);
assert.deepStrictEqual(st, { unlocked: true, name: 'TX_PROMO.WAV', status: 'recovered', tone: 'ok' });
assert.strictEqual(D.fileState({ name: 'A.TXT', threshold: 0 }, 0).unlocked, true);
assert.strictEqual(D.fileState({ name: 'S.LNK', threshold: 100 }, 99).unlocked, false);
assert.strictEqual(D.fileState({ name: 'S.LNK', threshold: 100 }, 100).unlocked, true);

// ---- the log and the balloons ----
assert.deepStrictEqual(D.eventLines(null, 0, false).map((l) => l.text), ['> drive mounted']);
assert.deepStrictEqual(D.eventLines(100, 200, true).map((l) => l.text), ['> LAKEHORSE signal accepted']);
assert.deepStrictEqual(D.eventLines(100, 200, false).map((l) => l.text), ['> game signal accepted']);
assert.deepStrictEqual(D.eventLines(100, 110, true).map((l) => l.text), ['> weak signal. weights nudged']);
assert.deepStrictEqual(D.eventLines(100, 100, true).map((l) => l.text), ['> pattern unrecognized. no change']);
assert.deepStrictEqual(D.eventLines(100, 100, false), []);
assert.ok(/Weights settling/.test(D.balloon(10, true)));
assert.ok(/complete/.test(D.balloon(100, false)));
['Pattern drift', 'Awaiting'].forEach(() => {});
[0, 10, 50, 99].forEach((p) => [true, false].forEach((j) => {
  const b = D.balloon(p, j);
  assert.ok(!/100|points|node|flagged|percent/i.test(b), 'a balloon never states the rule: ' + b);
}));

// ---- the window: no request while closed, one status read per refresh ----
function el(extra) {
  const e = Object.assign({ hidden: false, innerHTML: '', children: [], listeners: {}, attrs: {},
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); } },
    appendChild(c) { this.children.push(c); }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.listeners[t] = f; } }, extra || {});
  Object.defineProperty(e, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
  return e;
}
function harness(statusReplies, fileReply) {
  const els = {};
  ['win-driveb', 'driveFiles', 'driveViewer', 'driveViewerName', 'driveViewerText', 'driveViewerClose', 'drivePercent',
    'driveCount', 'driveNet', 'driveBalloon', 'driveLog', 'nowPlaying'].forEach((id) => { els[id] = el(); });
  els.driveViewer.hidden = true;
  els['win-driveb'].hidden = true;
  const calls = [], timers = [], opened = [];
  const doc = { hidden: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; },
    createElement: () => el({ rel: '', click() { calls.push('click:' + this.href); } }) };
  const fetchImpl = (url) => {
    calls.push(url);
    if (url === 'drive-b.json') return fileReply instanceof Error ? Promise.reject(fileReply) : Promise.resolve({ ok: true, json: () => Promise.resolve(fileReply) });
    const r = statusReplies.shift();
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(r) });
  };
  const api = D.attach((id) => els[id], { doc, fetch: fetchImpl, open: (u) => opened.push(u),
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (h) => { if (timers[h - 1]) timers[h - 1].f = null; } });
  return { els, api, calls, timers, opened, doc };
}
const st0 = (points) => ({ alignment: { points } });
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  let h = harness([st0(2400)], seed);
  assert.deepStrictEqual(h.calls, [], 'nothing is requested until the window opens');
  h.api.open();
  await tick(); await tick();
  assert.deepStrictEqual(h.calls, ['drive-b.json', '/api/status']);
  assert.strictEqual(h.els.drivePercent.textContent, '37%');
  assert.strictEqual(h.els.driveCount.textContent, '24 of 64 nodes locked');
  assert.strictEqual((h.els.driveNet.innerHTML.match(/#5fd0b0"\/>/g) || []).length >= 24, true);
  assert.strictEqual(h.els.driveFiles.children.length, 4);
  assert.ok(h.timers.some((t) => t.ms === 20000 && t.f), 'a slow timer is armed while open');
  const rows = h.els.driveFiles.children;
  assert.strictEqual(rows[0].children[1].textContent, 'recovered');       // LOG at 0
  assert.strictEqual(rows[1].children[1].textContent, 'recovered');       // 25 <= 37
  assert.notStrictEqual(rows[2].children[0].textContent, 'TX_PROMO.WAV'); // 60 > 37 still garbled
  assert.ok(/^aligning|corrupt/.test(rows[2].children[1].textContent));
  assert.strictEqual(h.els.driveLog.children.length, 1);

  // A locked file stutters and shows the read error; an unlocked text file opens.
  rows[2].listeners.click();
  assert.ok(rows[2].classList.s.has('stutter'));
  assert.strictEqual(rows[2].children[1].textContent, 'read error: try after the next track');
  rows[0].listeners.click();
  assert.strictEqual(h.els.driveViewer.hidden, false);
  assert.strictEqual(h.els.driveViewerName.textContent, 'LOG_0417.TXT');
  assert.ok(/PLACEHOLDER/.test(h.els.driveViewerText.textContent));
  h.els.driveViewerClose.listeners.click();
  assert.strictEqual(h.els.driveViewer.hidden, true);
  assert.strictEqual(h.opened.length, 0);

  // Closing stops the timers; reopening reads again.
  h.api.close();
  const asking = () => h.timers.filter((t) => t.f && (t.ms === 20000 || t.ms === 1500));
  assert.strictEqual(asking().length, 0, 'close cancels every timer that would ask the box');
  const before = h.calls.length;
  h.api.songChanged();                                       // closed: no request is scheduled
  assert.strictEqual(asking().length, 0);
  assert.strictEqual(h.calls.length, before);

  // A song change while open refreshes once, after a short wait; the total rising logs it and animates.
  h = harness([st0(2400), st0(2500)], seed);
  h.api.open();
  await tick(); await tick();
  h.api.songChanged();
  const song = h.timers.find((t) => t.ms === 1500 && t.f);
  assert.ok(song, 'refresh is scheduled about a second after the song changes');
  song.f();
  await tick(); await tick();
  assert.strictEqual(h.els.drivePercent.textContent, '39%');
  assert.deepStrictEqual(h.els.driveLog.children.map((c) => c.textContent), ['> drive mounted', '> LAKEHORSE signal accepted']);
  assert.ok(/snap flash/.test(h.els.driveNet.innerHTML), 'the new node snaps in and flashes');
  assert.strictEqual((h.els.driveNet.innerHTML.match(/class="snap/g) || []).length, 1);
  assert.ok(/Audio input accepted/.test(h.els.driveBalloon.textContent));

  // A song that did not raise it: the unrecognised line.
  h = harness([st0(2400), st0(2400)], seed);
  h.api.open(); await tick(); await tick();
  h.api.songChanged(); h.timers.find((t) => t.ms === 1500 && t.f).f(); await tick(); await tick();
  assert.strictEqual(h.els.driveLog.children[1].textContent, '> pattern unrecognized. no change');

  // A hidden tab pauses; one request at a time; a failed read keeps the old picture.
  h = harness([new Error('down'), st0(100)], seed);
  h.api.open(); await tick(); await tick();
  assert.strictEqual(h.els.drivePercent.textContent, '0%');
  h.doc.hidden = true;
  assert.strictEqual(h.api.refresh() instanceof Promise, true);
  const n1 = h.calls.length; await tick();
  assert.strictEqual(h.calls.length, n1, 'hidden: no request');
  h.doc.hidden = false;
  await h.api.refresh();
  assert.strictEqual(h.els.drivePercent.textContent, '1%');

  // A missing or malformed drive-b.json: the window still works.
  for (const bad of [new Error('404'), { nope: 1 }, 'text', { files: 'x' }]) {
    h = harness([st0(500)], bad);
    h.api.open(); await tick(); await tick(); await tick();
    assert.strictEqual(h.els.drivePercent.textContent, '7%');
    assert.ok(/could not be read/.test(h.els.driveFiles.children[0].textContent));
  }

  // Download and link kinds.
  h = harness([st0(6400)], seed);
  h.api.open(); await tick(); await tick();
  const r2 = h.els.driveFiles.children;
  assert.strictEqual(r2[2].children[0].textContent, 'TX_PROMO.WAV');
  r2[2].listeners.click();
  assert.ok(h.calls.includes('click:drive-b.json'));
  r2[3].listeners.click();
  assert.deepStrictEqual(h.opened, ['https://example.com/PLACEHOLDER-show-tickets']);

  // Pinned values after an unreadable status keep the earlier reading.
  console.log('drive-b: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
