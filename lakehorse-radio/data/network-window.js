/* Lakehorse Radio: the network list in the Network window.
 *
 * Draws the scan results as tappable rows with signal bars, keeps the chosen
 * network in the hidden #ssid field (which app.js's save() already reads), and
 * adds a show-password box, a cancel button and the "box drops its own Wi-Fi
 * while it joins" note. app.js still owns the scan and the save; it hands the
 * results here.
 *
 * Why a list and not the old <select>: a phone's select is a modal wheel that
 * hides the rest of the form, and the person choosing is usually reading the
 * network name off a router label. Rows stay on screen with the password box.
 *
 * Pure helpers first (tested without a page), then attach().
 */

(function (root) {
  'use strict';

  // Pure: 1 to 4 bars from signal strength in dBm.
  function signalBars(rssi) {
    if (rssi >= -55) return 4;
    if (rssi >= -65) return 3;
    if (rssi >= -75) return 2;
    return 1;
  }

  // Pure: scan results ready to draw: hidden networks (no name) dropped, the
  // same name seen on several channels kept once at its strongest, strongest
  // first. A malformed reply gives an empty list rather than an exception.
  function arrange(networks) {
    var best = {};
    (Array.isArray(networks) ? networks : []).forEach(function (n) {
      if (!n || typeof n.ssid !== 'string' || !n.ssid) return;
      var rssi = typeof n.rssi === 'number' ? n.rssi : -100;
      if (!best[n.ssid] || rssi > best[n.ssid].rssi) {
        best[n.ssid] = { ssid: n.ssid, rssi: rssi, open: !!n.open };
      }
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.rssi - a.rssi; });
  }

  // Pure: the label over the password box.
  function passwordLabel(ssid, open) {
    if (!ssid) return 'Password';
    return open ? ssid + ' is open, no password needed' : 'Password for ' + ssid;
  }

  // Pure: the one line over the facts.
  function headline(s) {
    if (!s || typeof s !== 'object') return 'No answer from the box';
    if (s.station === 'connected') return s.ssid ? 'Connected to ' + s.ssid : 'Connected';
    if (s.lastFailure) return 'Could not join ' + (s.ssid || 'a network') + ': ' + s.lastFailure;
    return 'Not on a network';
  }

  // Pure: [label, value] pairs for the current-network card, from /api/status.
  // Only facts the reply actually carries: no address while not connected, no
  // signal when the radio reports 0 dBm (which means "no reading", not strong).
  function currentRows(s) {
    if (!s || typeof s !== 'object') return [];
    var on = s.station === 'connected';
    var rows = [['Network', s.ssid || 'none saved']];
    if (on && typeof s.rssi === 'number' && s.rssi < 0) {
      rows.push(['Signal', signalBars(s.rssi) + ' of 4 bars (' + s.rssi + ' dBm)']);
    }
    if (on && s.ip) rows.push(['Address', s.ip]);
    if (s.mdns) rows.push(['Name', s.mdns]);
    if (on && s.stationChannel) rows.push(['Channel', String(s.stationChannel)]);
    if (s.apSsid) {
      rows.push(['Hotspot', s.apSsid + (s.apIp ? ' (' + s.apIp + ', channel ' + s.apChannel + ')' : '')]);
    }
    return rows;
  }

  // Pure: may this visitor change the network? The firmware's rule: from the
  // hotspot, or with the pairing key. The page mirrors it so it does not offer
  // a form the box would refuse.
  function canChange(s, hasKey) {
    return !!(s && (s.viaAccessPoint || hasKey));
  }

  function attach(el, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var chosen = null;     // the arranged entry for the selected row, or null
    // Held from the start: emptying the list detaches this element, after which
    // looking it up by id finds nothing.
    var noteEl = el('netNote');
    var rows = [];

    function pick(n) {
      chosen = n;
      el('ssid').value = n ? n.ssid : '';
      if (n) el('ssidManual').value = '';
      el('passLabel').textContent = passwordLabel(n && n.ssid, n && n.open);
      rows.forEach(function (r) {
        var on = !!n && r.net.ssid === n.ssid;
        r.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        r.btn.classList.toggle('on', on);
      });
    }

    function bars(rssi) {
      var n = signalBars(rssi);
      var s = doc.createElement('span');
      s.className = 'bars';
      s.setAttribute('aria-hidden', 'true');
      for (var i = 1; i <= 4; i++) {
        var b = doc.createElement('i');
        b.className = i <= n ? 'lit' : '';
        s.appendChild(b);
      }
      return s;
    }

    // Replaces the rows with these scan results.
    function render(networks) {
      var list = el('netList');
      list.textContent = '';
      rows = [];
      var nets = arrange(networks);
      noteEl.textContent = nets.length ? '' : 'Nothing found. Type the name below.';
      list.appendChild(noteEl);
      nets.forEach(function (n) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'netrow';
        b.setAttribute('aria-pressed', 'false');
        var name = doc.createElement('span');
        name.textContent = n.ssid + (n.open ? '  (open)' : '');
        b.appendChild(name);
        b.appendChild(bars(n.rssi));
        b.addEventListener('click', function () { pick(n); });
        list.appendChild(b);
        rows.push({ btn: b, net: n });
      });
      // Keep the choice across a rescan if that network is still there.
      var still = chosen && nets.filter(function (n) { return n.ssid === chosen.ssid; })[0];
      pick(still || null);
    }

    // Replaces the rows with a message (scanning, could not scan).
    function note(text) {
      var list = el('netList');
      list.textContent = '';
      rows = [];
      noteEl.textContent = text;
      list.appendChild(noteEl);
    }

    // Replaces the current-network card from a /api/status reply.
    function showCurrent(s) {
      el('netHeadline').textContent = headline(s);
      var facts = el('netFacts');
      facts.textContent = '';
      currentRows(s).forEach(function (r) {
        var dt = doc.createElement('dt');
        dt.textContent = r[0];
        var dd = doc.createElement('dd');
        dd.textContent = r[1];
        facts.appendChild(dt);
        facts.appendChild(dd);
      });
      el('forgetBtn').hidden = !(s && s.hasSavedNetwork);
    }

    el('showPass').addEventListener('change', function () {
      el('pass').type = this.checked ? 'text' : 'password';
    });
    el('cancelBtn').addEventListener('click', function () {
      pick(null);
      el('ssidManual').value = '';
      el('pass').value = '';
      el('showPass').checked = false;
      el('pass').type = 'password';
      el('setupStatus').textContent = '';
    });
    // Typing a name means "not one of the rows".
    el('ssidManual').addEventListener('input', function () { if (this.value) pick(null); });

    return { render: render, note: note, showCurrent: showCurrent, pick: pick, selected: function () { return chosen; } };
  }

  var instance = null;
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('netList')) {
    instance = attach(function (id) { return document.getElementById(id); });
  }

  var exported = {
    signalBars: signalBars, arrange: arrange, passwordLabel: passwordLabel, headline: headline, currentRows: currentRows,
    canChange: canChange, attach: attach,
    // For app.js, which owns the scan: no-ops until the page has the window.
    render: function (n) { if (instance) instance.render(n); },
    note: function (t) { if (instance) instance.note(t); },
    showCurrent: function (st) { if (instance) instance.showCurrent(st); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseNetworkWindow = exported;
})(typeof window !== 'undefined' ? window : globalThis);
