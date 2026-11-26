/* Lakehorse Radio: the Bluetooth speaker panel.
 *
 * Talks to /api/speaker (src/speaker_api.h): which speaker the box plays to,
 * finding and choosing another, connect and disconnect, and Bluetooth on/off.
 *
 * Split in two so the part with the decisions can be tested without a page:
 *   view(info)  -> what the panel should say and offer, from one status reply;
 *   attach(...) -> the DOM side: draws a view, wires the buttons, polls.
 *
 * Bluetooth off is not a live switch. The box saves it and restarts (the
 * firmware explains why in bt_speaker.h), so the page says so, waits, and
 * reloads itself.
 *
 * `opts` for attach exists for tests: { fetch, setInterval, setTimeout,
 * confirm, reload }. The page passes only the element lookup.
 */

(function (root) {
  'use strict';

  var POLL_MS = 3000;
  var RESTART_RELOAD_MS = 12000;

  function byStrength(a, b) { return b.rssi - a.rssi; }

  // Pure: one /api/speaker reply in, everything the panel shows out.
  function view(info) {
    if (!info || !info.built) return { visible: false };
    var name = info.speaker || 'the speaker';
    var v = {
      visible: true,
      bluetooth: !!info.bluetooth,
      powerLabel: info.bluetooth ? 'Turn Bluetooth off' : 'Turn Bluetooth on',
      linkLabel: '',
      linkAction: '',
      findLabel: info.scanning ? 'Searching...' : 'Find speakers',
      findEnabled: !!info.bluetooth && !info.scanning,
      optimized: !info.bluetooth,
      optimizeNote: info.bluetooth
        ? 'Streaming to this device, not a speaker? Tick this to turn Bluetooth off. Songs load several times faster.'
        : 'Bluetooth is off. Untick to use a speaker again.',
      speakers: [],
      note: ''
    };

    if (!info.bluetooth) {
      v.status = 'Bluetooth is off. Songs play on this device at full speed.';
      return v;
    }

    if (info.connected) {
      v.status = 'Connected to ' + name + '.';
      v.linkLabel = 'Disconnect';
      v.linkAction = 'disconnect';
    } else if (info.searching) {
      v.status = 'Looking for ' + name + '. Switch it on (pairing mode the first time).';
      v.linkLabel = 'Stop looking';
      v.linkAction = 'disconnect';
    } else {
      v.status = name + ' is not connected.';
      v.linkLabel = 'Connect';
      v.linkAction = 'connect';
    }

    v.speakers = (info.found || []).slice().sort(byStrength).map(function (f) {
      return { name: f.name, current: f.name === info.speaker };
    });
    v.note = info.scanning && v.speakers.length === 0
      ? 'Searching for speakers nearby...'
      : 'While Bluetooth is on, songs load slowly on this device. Turn it off to play them here.';
    return v;
  }

  function attach(el, opts) {
    opts = opts || {};
    var doFetch = opts.fetch || root.fetch.bind(root);
    var every = opts.setInterval || root.setInterval.bind(root);
    var later = opts.setTimeout || root.setTimeout.bind(root);
    var ask = opts.confirm || root.confirm.bind(root);
    var reload = opts.reload || function () { root.location.reload(); };
    var onChange = opts.onChange || function () {};
    var restarting = false;
    var bluetoothOn = null;  // from the last reply; null until one arrives

    function call(path, method) {
      return doFetch(path, { method: method || 'POST', cache: 'no-store' })
        .then(function (r) { return r.json(); });
    }

    function draw(info) {
      if (restarting) return;
      var v = view(info);
      el('speakerPanel').hidden = !v.visible;
      if (!v.visible) return;
      bluetoothOn = v.bluetooth;
      el('spkStatus').textContent = v.status;
      el('spkLink').hidden = !v.linkAction;
      el('spkLink').textContent = v.linkLabel;
      el('spkLink').dataset.action = v.linkAction;
      el('spkFind').hidden = !v.bluetooth;
      el('spkFind').disabled = !v.findEnabled;
      el('spkFind').textContent = v.findLabel;
      el('spkPower').textContent = v.powerLabel;
      // The Optimize box is the same switch as spkPower, shown as the page's
      // one control for it. Absent in older markup, so optional.
      if (el('spkOptimize')) {
        el('spkOptimize').checked = v.optimized;
        el('spkOptNote').textContent = v.optimizeNote;
      }
      el('spkNote').textContent = (info && info.error) ? info.error : (v.bluetooth ? v.note : '');
      var list = el('spkList');
      list.textContent = '';
      v.speakers.forEach(function (s) {
        var li = list.ownerDocument.createElement('li');
        var b = list.ownerDocument.createElement('button');
        b.className = 'btn';
        b.type = 'button';
        if (b.setAttribute) b.setAttribute('data-help', 'spk-device');
        b.textContent = s.current ? s.name + ' (chosen)' : 'Play on ' + s.name;
        b.addEventListener('click', function () { command('/api/speaker/choose?name=' + encodeURIComponent(s.name)); });
        li.appendChild(b);
        list.appendChild(li);
      });
      onChange(info);
    }

    function refresh() {
      return call('/api/speaker', 'GET').then(draw).catch(function () { /* box busy; next poll */ });
    }

    function command(path) {
      return call(path).then(draw).catch(function () { el('spkNote').textContent = 'Lost touch with the box.'; });
    }

    function togglePower() {
      if (bluetoothOn === null) return Promise.resolve();
      var turningOn = !bluetoothOn;
      var msg = turningOn
        ? 'Turn Bluetooth on? The box restarts (about 10 seconds). Songs on this device will load slowly while it is on.'
        : 'Turn Bluetooth off? The box restarts (about 10 seconds) and stops playing on the speaker.';
      if (!ask(msg)) return Promise.resolve();
      return call('/api/speaker/bluetooth?on=' + (turningOn ? 1 : 0)).then(function (d) {
        if (!d.ok) { el('spkNote').textContent = d.error || 'the box refused'; return; }
        restarting = true;
        el('spkStatus').textContent = 'Restarting the box...';
        later(reload, RESTART_RELOAD_MS);
      });
    }

    el('spkLink').addEventListener('click', function () {
      command('/api/speaker/' + this.dataset.action);
    });
    el('spkFind').addEventListener('click', function () { command('/api/speaker/scan'); });
    el('spkPower').addEventListener('click', togglePower);
    if (el('spkOptimize')) {
      el('spkOptimize').addEventListener('change', function () {
        var box = this;
        // A declined confirm leaves nothing changed, so put the box back to
        // what the box itself says rather than leaving it ticked the wrong way.
        togglePower().then(function () { if (!restarting && bluetoothOn !== null) box.checked = !bluetoothOn; });
      });
    }

    every(refresh, POLL_MS);
    return { refresh: refresh, togglePower: togglePower };
  }

  var exported = { view: view, attach: attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseSpeakerPanel = exported;
})(typeof window !== 'undefined' ? window : globalThis);
