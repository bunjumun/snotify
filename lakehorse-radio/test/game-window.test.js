// Tests for data/game-window.js. Run: node test/game-window.test.js
'use strict';
const assert = require('assert');
const G = require('../data/game-window.js');

assert.strictEqual(G.describe({ status: 200 }).ready, true);
assert.strictEqual(G.describe({ status: 404 }).ready, false);
assert.ok(/copy the game folder/i.test(G.describe({ status: 404 }).note));
assert.ok(/no sd card/i.test(G.describe({ status: 503 }).note));
assert.strictEqual(G.describe(null).ready, false);   // request failed: not ready, never "fine"

function page() {
  const link = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const note = { textContent: '' };
  return { link, note, el: (id) => ({ gameLaunch: link, gameNote: note })[id] };
}

(async () => {
  let p = page();
  let d = await G.attach(p.el, (url, init) => {
    assert.strictEqual(url, '/game/index.html');
    assert.strictEqual(init.headers.Range, 'bytes=0-0');
    return Promise.resolve({ status: 200 });
  });
  assert.strictEqual(d.ready, true);
  assert.strictEqual(p.link.attrs['aria-disabled'], undefined);

  p = page();
  d = await G.attach(p.el, () => Promise.reject(new Error('offline')));
  assert.strictEqual(d.ready, false);
  assert.strictEqual(p.link.attrs['aria-disabled'], 'true');
  assert.ok(p.note.textContent.length > 0);
  console.log('game-window: ok');
})();
