// Coverage rule from SHELL-AND-MATRIX-PLAN.md: every interactive element has a
// data-help that exists in help.json, and every help.json entry is reachable
// from an element or the Help index. Run: node test/help-coverage.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const data = path.join(__dirname, '..', 'data');
const html = fs.readFileSync(path.join(data, 'index.html'), 'utf8');
const help = JSON.parse(fs.readFileSync(path.join(data, 'help.json'), 'utf8'));
const ids = Object.keys(help.entries);

// ---- the file itself ----
assert.strictEqual(help.version, 1);
ids.forEach((id) => {
  const e = help.entries[id];
  assert.ok(/^[a-z0-9-]+$/.test(id), 'id shape: ' + id);
  assert.ok(typeof e.title === 'string' && e.title.length > 0, 'title: ' + id);
  assert.ok(typeof e.text === 'string' && e.text.length > 20, 'text: ' + id);
  assert.ok(!/—/.test(e.title + e.text), 'no em dash: ' + id);
});

// ---- elements in index.html ----
const tags = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(button|a|input|select|textarea|summary)\b([^>]*)>/g)];
const interactive = tags.filter((m) => {
  const attrs = m[2];
  if (m[1] === 'a') return /\bhref=/.test(attrs);
  if (m[1] === 'input') return !/type="hidden"/.test(attrs);
  return true;
});
assert.ok(interactive.length > 40, 'found the page controls (' + interactive.length + ')');
const used = new Set();
interactive.forEach((m) => {
  const own = [...m[2].matchAll(/\bdata-help="([^"]*)"/g)];
  assert.strictEqual(own.length, 1, 'exactly one data-help on <' + m[1] + m[2].slice(0, 70) + '>');
  assert.ok(help.entries[own[0][1]], 'unknown help id ' + own[0][1]);
  used.add(own[0][1]);
});
// Any other element that carries data-help (windows, drive net, tray) must exist too.
[...html.matchAll(/\bdata-help="([^"]*)"/g)].forEach((m) => {
  assert.ok(help.entries[m[1]], 'unknown help id ' + m[1]);
  used.add(m[1]);
});
// Every window has its own entry.
[...html.matchAll(/<section class="win[^"]*" id="[^"]+"([^>]*)>/g)].forEach((m) => {
  assert.ok(/data-help="win-/.test(m[1]), 'window without data-help: ' + m[1]);
});

// ---- elements the scripts create ----
fs.readdirSync(data).filter((f) => f.endsWith('.js')).forEach((f) => {
  fs.readFileSync(path.join(data, f), 'utf8').split('\n').forEach((line) => {
    if (!/data-help|dataset\.help/.test(line)) return;
    [...line.matchAll(/'([a-z0-9-]+)'/g)].forEach((m) => {
      if (m[1] === 'data-help') return;
      assert.ok(help.entries[m[1]], f + ' uses unknown help id ' + m[1]);
      used.add(m[1]);
    });
  });
});

// ---- the Help index ----
assert.ok(Array.isArray(help.index) && help.index.length >= 4);
const indexed = new Set();
help.index.forEach((g) => g.ids.forEach((i) => {
  assert.ok(help.entries[i], 'index lists unknown id ' + i);
  indexed.add(i);
}));
// The features with no on-screen control are stated in the index.
['boot-button-pairing', 'power-on-pairing', 'speaker-buttons', 'saved-networks', 'phone-hotspot',
  'hotspot-setup-boot', 'alignment-scoring', 'band-tracks-json'].forEach((i) => assert.ok(indexed.has(i), 'index has ' + i));

// ---- every entry reachable ----
ids.forEach((id) => assert.ok(used.has(id) || indexed.has(id), 'help entry nothing points at: ' + id));

console.log('help-coverage: all passed (' + interactive.length + ' controls, ' + ids.length + ' entries)');
