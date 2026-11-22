// Tests for data/speaker-panel.js. Run: node test/speaker-panel.test.js
'use strict';
const assert = require('assert');
const P = require('../data/speaker-panel.js');

const base = { ok: true, built: true, bluetooth: true, connected: false, scanning: false,
               searching: false, speaker: 'ML301', found: [] };
const info = (o) => Object.assign({}, base, o);

// Minimal DOM stand-in: elements by id, with the few properties attach() uses.
function fakeDom() {
  const els = {};
  const doc = {
    createElement() {
      const e = { children: [], listeners: {}, textContent: '', ownerDocument: doc,
                  addEventListener(t, f) { this.listeners[t] = f; },
                  appendChild(c) { this.children.push(c); } };
      return e;
    }
  };
  ['speakerPanel', 'spkStatus', 'spkLink', 'spkFind', 'spkPower', 'spkNote', 'spkList'].forEach((id) => {
    const e = doc.createElement();
    e.dataset = {};
    Object.defineProperty(e, 'textContent', {
      get() { return this._t || ''; },
      set(v) { this._t = v; if (v === '') this.children = []; }
    });
    els[id] = e;
  });
  return { el: (id) => els[id], els };
}

function fakeBox(reply) {
  const box = {
    calls: [], reply, timers: [], timeouts: [], confirmAnswer: true, reloaded: false,
    fetch(url, init) {
      box.calls.push([init.method, url]);
      return Promise.resolve({ json: () => Promise.resolve(box.reply) });
    },
    setInterval(fn) { box.timers.push(fn); },
    setTimeout(fn, ms) { box.timeouts.push([fn, ms]); },
    confirm() { return box.confirmAnswer; },
    reload() { box.reloaded = true; }
  };
  return box;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const tests = {
  'hidden when the box has no Bluetooth build'() {
    assert.strictEqual(P.view(info({ built: false })).visible, false);
    assert.strictEqual(P.view(null).visible, false);
  },

  'connected offers disconnect'() {
    const v = P.view(info({ connected: true }));
    assert.strictEqual(v.status, 'Connected to ML301.');
    assert.strictEqual(v.linkAction, 'disconnect');
  },

  'not connected offers connect'() {
    const v = P.view(info({}));
    assert.strictEqual(v.linkAction, 'connect');
    assert.ok(v.status.indexOf('not connected') > 0);
  },

  'searching can be stopped'() {
    const v = P.view(info({ searching: true }));
    assert.strictEqual(v.linkAction, 'disconnect');
    assert.ok(v.status.indexOf('Looking for ML301') === 0);
  },

  'bluetooth off offers only turning it back on'() {
    const v = P.view(info({ bluetooth: false, connected: false }));
    assert.strictEqual(v.linkAction, '');
    assert.strictEqual(v.findEnabled, false);
    assert.strictEqual(v.powerLabel, 'Turn Bluetooth on');
    assert.ok(v.status.indexOf('full speed') > 0);
  },

  'speakers are listed strongest first and the chosen one is marked'() {
    const v = P.view(info({ found: [{ name: 'Far', rssi: -90 }, { name: 'ML301', rssi: -40 }] }));
    assert.deepStrictEqual(v.speakers, [{ name: 'ML301', current: true }, { name: 'Far', current: false }]);
  },

  'find is disabled while a scan is running'() {
    const v = P.view(info({ scanning: true }));
    assert.strictEqual(v.findEnabled, false);
    assert.strictEqual(v.findLabel, 'Searching...');
    assert.ok(v.note.indexOf('Searching') === 0);
  },

  async 'choosing a found speaker posts its encoded name'() {
    const box = fakeBox(info({ found: [{ name: 'Big Speaker', rssi: -50 }] }));
    const dom = fakeDom();
    const p = P.attach(dom.el, box);
    await p.refresh();
    const button = dom.els.spkList.children[0].children[0];
    assert.strictEqual(button.textContent, 'Play on Big Speaker');
    button.listeners.click();
    await flush();
    assert.deepStrictEqual(box.calls[box.calls.length - 1], ['POST', '/api/speaker/choose?name=Big%20Speaker']);
  },

  async 'the link button posts what the view decided'() {
    const box = fakeBox(info({ connected: true }));
    const dom = fakeDom();
    await P.attach(dom.el, box).refresh();
    dom.els.spkLink.listeners.click.call(dom.els.spkLink);
    await flush();
    assert.deepStrictEqual(box.calls[box.calls.length - 1], ['POST', '/api/speaker/disconnect']);
  },

  async 'turning bluetooth off asks, posts, then reloads after the restart'() {
    const box = fakeBox(info({}));
    const dom = fakeDom();
    const p = P.attach(dom.el, box);
    await p.refresh();
    await p.togglePower();
    assert.deepStrictEqual(box.calls[box.calls.length - 1], ['POST', '/api/speaker/bluetooth?on=0']);
    assert.strictEqual(dom.els.spkStatus.textContent, 'Restarting the box...');
    box.timeouts[0][0]();
    assert.strictEqual(box.reloaded, true);
  },

  async 'declining the restart sends nothing'() {
    const box = fakeBox(info({ bluetooth: false }));
    box.confirmAnswer = false;
    const dom = fakeDom();
    const p = P.attach(dom.el, box);
    await p.refresh();
    const before = box.calls.length;
    await p.togglePower();
    assert.strictEqual(box.calls.length, before);
  },

  async 'a refusal is shown, not a restart'() {
    const box = fakeBox(info({}));
    const dom = fakeDom();
    const p = P.attach(dom.el, box);
    await p.refresh();
    box.reply = { ok: false, error: 'could not save the setting' };
    await p.togglePower();
    assert.strictEqual(dom.els.spkNote.textContent, 'could not save the setting');
    assert.strictEqual(box.timeouts.length, 0);
  }
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('ok  ', name); }
    catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
