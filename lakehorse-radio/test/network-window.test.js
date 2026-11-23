// Tests for data/network-window.js. Run: node test/network-window.test.js
'use strict';
const assert = require('assert');
const N = require('../data/network-window.js');

// ---- pure ----
assert.strictEqual(N.signalBars(-40), 4);
assert.strictEqual(N.signalBars(-55), 4);
assert.strictEqual(N.signalBars(-56), 3);
assert.strictEqual(N.signalBars(-65), 3);
assert.strictEqual(N.signalBars(-75), 2);
assert.strictEqual(N.signalBars(-76), 1);
assert.strictEqual(N.signalBars(-100), 1);

const arranged = N.arrange([
  { ssid: 'far', rssi: -80, open: false },
  { ssid: '', rssi: -30 },                       // hidden network: dropped
  { ssid: 'home', rssi: -70, open: false },
  { ssid: 'home', rssi: -45, open: false },      // same name, stronger channel
  { ssid: 'cafe', rssi: -60, open: true },
  null, { rssi: -20 }, { ssid: 7 }
]);
assert.deepStrictEqual(arranged.map((n) => n.ssid), ['home', 'cafe', 'far']);
assert.strictEqual(arranged[0].rssi, -45);        // strongest copy kept
assert.strictEqual(arranged[1].open, true);
assert.deepStrictEqual(N.arrange(undefined), []);
assert.deepStrictEqual(N.arrange('nope'), []);
assert.deepStrictEqual(N.arrange([{ ssid: 'x' }]).map((n) => n.rssi), [-100]);  // no strength given

assert.strictEqual(N.passwordLabel('', false), 'Password');
assert.strictEqual(N.passwordLabel('home', false), 'Password for home');
assert.strictEqual(N.passwordLabel('cafe', true), 'cafe is open, no password needed');

// ---- current network (pure) ----
const joined = { station: 'connected', ssid: 'barnternet', ip: '192.168.0.38', rssi: -58,
  stationChannel: 6, mdns: 'lakehorseradio.local', apSsid: 'Lakehorse Radio', apIp: '192.168.4.1',
  apChannel: 6, hasSavedNetwork: true, viaAccessPoint: false };
assert.strictEqual(N.headline(joined), 'Connected to barnternet');
assert.deepStrictEqual(N.currentRows(joined).map((r) => r[0]),
  ['Network', 'Signal', 'Address', 'Name', 'Channel', 'Hotspot']);
assert.strictEqual(N.currentRows(joined)[1][1], '3 of 4 bars (-58 dBm)');
assert.strictEqual(N.currentRows(joined)[3][1], 'lakehorseradio.local');
const failed = Object.assign({}, joined, { station: 'failed', lastFailure: 'wrong password', ip: '' });
assert.strictEqual(N.headline(failed), 'Could not join barnternet: wrong password');
assert.deepStrictEqual(N.currentRows(failed).map((r) => r[0]), ['Network', 'Name', 'Hotspot']);
const none = { station: 'idle', ssid: '', hasSavedNetwork: false, mdns: 'lakehorseradio.local', apSsid: 'Lakehorse Radio', apIp: '192.168.4.1', apChannel: 1 };
assert.strictEqual(N.headline(none), 'Not on a network');
assert.strictEqual(N.currentRows(none)[0][1], 'none saved');
// Degenerate input must not throw or claim a connection.
assert.strictEqual(N.headline(null), 'No answer from the box');
assert.deepStrictEqual(N.currentRows(null), []);
assert.strictEqual(N.headline({ station: 'connected' }), 'Connected');  // no ssid in the reply
assert.ok(!N.currentRows({ station: 'connected', ssid: 'x', rssi: 0 }).some((r) => r[0] === 'Signal'));  // 0 dBm = no reading

// Who may change the network: the hotspot, or a device that holds the pairing key.
assert.strictEqual(N.canChange({ viaAccessPoint: true }, false), true);
assert.strictEqual(N.canChange({ viaAccessPoint: false }, true), true);
assert.strictEqual(N.canChange({ viaAccessPoint: false }, false), false);
assert.strictEqual(N.canChange(null, true), false);

// ---- attach, against a fake page ----
function fakePage() {
  const els = {};
  const mk = (id, extra) => {
    const e = Object.assign({
      id, value: '', checked: false, type: '', children: [], listeners: {}, attrs: {},
      classList: { s: new Set(), toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      addEventListener(t, f) { this.listeners[t] = f; },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); }
    }, extra || {});
    let t = '';
    Object.defineProperty(e, 'textContent', { get() { return t; }, set(v) { t = v; if (v === '') { this.children = []; this.cleared = true; } } });
    els[id] = e;
    return e;
  };
  ['netHeadline', 'netFacts', 'forgetBtn', 'netList', 'netNote', 'ssid', 'ssidManual', 'pass', 'passLabel', 'showPass', 'cancelBtn', 'setupStatus'].forEach((i) => mk(i));
  const doc = { createElement: (tag) => mk('new-' + Math.random(), { tag, className: '' }) };
  // Like a real page: an element emptied out of netList can no longer be found by id.
  const lookup = (id) => (id === 'netNote' && !els.netList.children.includes(els.netNote) && els.netList.cleared) ? null : els[id];
  const api = N.attach(lookup, { doc });
  return { els, api };
}
const rowsOf = (p) => p.els.netList.children.filter((c) => c.tag === 'button');

let p = fakePage();
p.api.render([{ ssid: 'home', rssi: -45, open: false }, { ssid: 'cafe', rssi: -60, open: true }]);
assert.strictEqual(rowsOf(p).length, 2);
assert.strictEqual(rowsOf(p)[0].children[0].textContent, 'home');
assert.strictEqual(rowsOf(p)[1].children[0].textContent, 'cafe  (open)');
// Signal bars: four <i>, the lit ones marked.
assert.deepStrictEqual(rowsOf(p)[0].children[1].children.map((i) => i.className), ['lit', 'lit', 'lit', 'lit']);
assert.deepStrictEqual(rowsOf(p)[1].children[1].children.map((i) => i.className), ['lit', 'lit', 'lit', '']);

// Tapping a row chooses it: hidden field, label, pressed state, typed name cleared.
p.els.ssidManual.value = 'typed';
rowsOf(p)[0].listeners.click();
assert.strictEqual(p.els.ssid.value, 'home');
assert.strictEqual(p.els.ssidManual.value, '');
assert.strictEqual(p.els.passLabel.textContent, 'Password for home');
assert.strictEqual(rowsOf(p)[0].attrs['aria-pressed'], 'true');
assert.strictEqual(rowsOf(p)[1].attrs['aria-pressed'], 'false');
rowsOf(p)[1].listeners.click();
assert.strictEqual(p.els.ssid.value, 'cafe');
assert.strictEqual(p.els.passLabel.textContent, 'cafe is open, no password needed');
assert.strictEqual(rowsOf(p)[0].attrs['aria-pressed'], 'false');

// A rescan keeps the choice when the network is still there, drops it when not.
p.api.render([{ ssid: 'cafe', rssi: -50, open: true }, { ssid: 'new', rssi: -70 }]);
assert.strictEqual(p.els.ssid.value, 'cafe');
assert.strictEqual(rowsOf(p).filter((r) => r.attrs['aria-pressed'] === 'true').length, 1);
p.api.render([{ ssid: 'new', rssi: -70 }]);
assert.strictEqual(p.els.ssid.value, '');
assert.strictEqual(p.els.passLabel.textContent, 'Password');

// Nothing found says so, and the list holds only the note.
p.api.render([]);
assert.strictEqual(rowsOf(p).length, 0);
assert.ok(/Nothing found/.test(p.els.netNote.textContent));
p.api.note('Scanning...');
assert.strictEqual(p.els.netNote.textContent, 'Scanning...');
assert.strictEqual(rowsOf(p).length, 0);

// Typing a name deselects the rows; an empty field does not.
p = fakePage();
p.api.render([{ ssid: 'home', rssi: -45 }]);
rowsOf(p)[0].listeners.click();
p.els.ssidManual.value = '';
p.els.ssidManual.listeners.input.call(p.els.ssidManual);
assert.strictEqual(p.els.ssid.value, 'home');
p.els.ssidManual.value = 'other';
p.els.ssidManual.listeners.input.call(p.els.ssidManual);
assert.strictEqual(p.els.ssid.value, '');

// Show password flips the field type.
p.els.showPass.checked = true;
p.els.showPass.listeners.change.call(p.els.showPass);
assert.strictEqual(p.els.pass.type, 'text');
p.els.showPass.checked = false;
p.els.showPass.listeners.change.call(p.els.showPass);
assert.strictEqual(p.els.pass.type, 'password');

// Cancel clears the choice, the typed name, the password and the message.
p.api.render([{ ssid: 'home', rssi: -45 }]);
rowsOf(p)[0].listeners.click();
p.els.pass.value = 'secret';
p.els.setupStatus.textContent = 'Could not save.';
p.els.showPass.checked = true;
p.els.cancelBtn.listeners.click();
assert.strictEqual(p.els.ssid.value, '');
assert.strictEqual(p.els.pass.value, '');
assert.strictEqual(p.els.pass.type, 'password');
assert.strictEqual(p.els.showPass.checked, false);
assert.strictEqual(p.els.setupStatus.textContent, '');

// The current-network card: headline, one dt/dd pair per fact, Forget only with a saved network.
p = fakePage();
p.api.showCurrent(joined);
assert.strictEqual(p.els.netHeadline.textContent, 'Connected to barnternet');
assert.strictEqual(p.els.netFacts.children.length, 12);   // 6 rows x (dt + dd)
assert.strictEqual(p.els.forgetBtn.hidden, false);
p.api.showCurrent(none);
assert.strictEqual(p.els.netFacts.children.length, 6);    // facts replaced, not appended
assert.strictEqual(p.els.forgetBtn.hidden, true);
p.api.showCurrent(null);
assert.strictEqual(p.els.netHeadline.textContent, 'No answer from the box');
assert.strictEqual(p.els.netFacts.children.length, 0);

console.log('network-window: all passed');
