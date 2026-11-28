/* Lakehorse Radio — the player and the setup page.
 *
 * A classic script, not a module. It is served off the box's own flash over a
 * link that frequently has no internet behind it, so there is nothing to import
 * from and no bundler in the way. Keeping it a plain script also means it runs
 * inside the cut-down webview a phone opens for a captive portal, where module
 * loading is one more thing that can quietly fail.
 *
 * The music itself is handled by library.js: it is stored on the box's SD card
 * and played straight from it, so nothing here needs the internet. This file
 * is the network banner and the Wi-Fi setup form.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var status = null;

  // The pairing key library.js stores after visiting the hotspot once. It is
  // what lets the box accept a network change from the home Wi-Fi.
  var KEY_STORE = 'lakehorse.radio.key';
  function pairKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function authHeaders(extra) {
    var h = Object.assign({}, extra || {});
    var k = pairKey();
    if (k) h['X-Lakehorse-Key'] = k;
    return h;
  }

  function say(el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function describeNetwork(s) {
    var banner = $('banner');

    if (s.viaAccessPoint) {
      banner.className = 'banner warn';
      banner.innerHTML = '';
      var b = document.createElement('b');
      b.textContent = 'You are connected straight to the box. ';
      banner.appendChild(b);
      banner.appendChild(document.createTextNode(
        'The music is stored on the box, so it plays from here. If a setup sheet opened '
        + 'this page and playback will not start, open the same address in your normal '
        + 'browser, because that sheet cannot play audio. To use the box from your own '
        + 'Wi-Fi, put it on that network below.'));
      return;
    }

    banner.className = 'banner';
    banner.innerHTML = '';
    if (s.station === 'connected') {
      banner.textContent = 'The box is on ' + s.ssid + ' (channel ' + s.stationChannel
        + ') at ' + s.ip + '. Reachable at ' + s.mdns + '.';
    } else if (s.lastFailure) {
      banner.className = 'banner err';
      banner.textContent = 'The box tried ' + (s.ssid || 'a network')
        + ' and could not join: ' + s.lastFailure + '.';
    } else {
      banner.textContent = 'The box is not on a network yet. Join its "' + s.apSsid
        + '" hotspot (channel ' + s.apChannel + ') to set it up.';
    }
  }

  // Bounded on purpose. The radio refuses to scan while it is busy associating,
  // so a scan can legitimately never finish; polling forever would leave the
  // network list saying "Scanning..." for ever with no way to tell that apart
  // from a slow scan. After this many tries we say so and point at the field
  // below, which always works.
  var SCAN_TRIES_MAX = 8;
  var scanTries = 0;

  // Results go to the list in network-window.js, which also keeps the chosen
  // network in the hidden #ssid field that save() reads.
  function loadScan(again) {
    var list = window.LakehorseNetworkWindow;
    if (!again) scanTries = 0;
    fetch('/api/scan', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (doc) {
        if (doc.error) {
          list.note('Could not scan. Type the name below.');
          say($('setupStatus'), doc.error, 'err');
          return;
        }

        if (doc.scanning) {
          if (++scanTries > SCAN_TRIES_MAX) {
            list.note('The scan did not finish. Type the name below.');
            say($('setupStatus'),
                'The box could not finish scanning, which it often cannot while it '
                + 'is already trying to join a network. Type the name in instead.', 'err');
            return;
          }
          list.note('Scanning...');
          setTimeout(function () { loadScan(true); }, 1800);
          return;
        }
        list.render(doc.networks);
      })
      .catch(function () {
        list.note('Could not scan. Type the name below.');
        say($('setupStatus'), 'Could not scan for networks.', 'err');
      });
  }

  function save() {
    var ssid = $('ssidManual').value.trim() || $('ssid').value;
    if (!ssid) {
      say($('setupStatus'), 'Pick a network or type its name first.', 'err');
      return;
    }
    var host = $('host').value.trim();

    $('saveBtn').disabled = true;
    say($('setupStatus'), 'Saving...', '');

    fetch('/api/wifi', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      // Only send a name if one was typed, so leaving the field alone keeps
      // whatever the box is already called rather than resetting it.
      body: JSON.stringify(host
        ? { ssid: ssid, password: $('pass').value, hostname: host }
        : { ssid: ssid, password: $('pass').value })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || 'rejected');
        // Deliberately does not claim success at connecting. The box retunes its
        // hotspot to the new network's channel a moment from now, which drops
        // this very phone, so a confident "connected" here would often be the
        // last thing the listener saw before the page stopped responding.
        say($('setupStatus'),
            'Saved. Trying ' + ssid + ' now, this takes a few seconds...', 'ok');
        watchConnection(ssid, res.d.mdns || 'lakehorseradio.local');
      })
      .catch(function (err) {
        say($('setupStatus'), 'Could not save. ' + (err.message || ''), 'err');
      })
      .then(function () { $('saveBtn').disabled = false; });
  }


  /* Watches what actually happened after a save.
   *
   * This exists because the box used to fail in complete silence. A wrong
   * password looks exactly like a slow connection looks exactly like a box that
   * never got the request, and the only way anyone could tell them apart was a
   * USB cable and a serial monitor. Now the radio's own reason comes back.
   *
   * Note the box may stop answering partway through, and that is the GOOD
   * outcome: joining a network retunes the hotspot to that network's channel,
   * which drops this phone. So losing contact is reported as probable success,
   * not as an error. */
  var WATCH_TRIES_MAX = 12;

  function watchConnection(ssid, mdns) {
    var tries = 0;
    var lost = 0;

    (function poll() {
      fetch('/api/status', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          lost = 0;

          if (s.station === 'connected') {
            say($('setupStatus'),
                'On ' + s.ssid + ' at ' + s.ip + '. Switch this phone to ' + s.ssid
                + ' too, then tap Open in browser, or go to ' + mdns + '.', 'ok');
            showCurrent(s);
            return;
          }

          if (s.lastFailure) {
            say($('setupStatus'),
                'Could not join ' + ssid + ': ' + s.lastFailure + '. '
                + NET().joinFailureHint(s.lastFailure), 'err');
            return;
          }

          if (++tries > WATCH_TRIES_MAX) {
            say($('setupStatus'),
                'Still trying. Check ' + mdns + ' in a moment.', '');
            return;
          }
          setTimeout(poll, 3000);
        })
        .catch(function () {
          // Two lost polls in a row almost certainly means the hotspot retuned,
          // which is what happens when it works.
          if (++lost >= 2) {
            say($('setupStatus'),
                'The box stopped answering here, which usually means it joined '
                + ssid + '. Switch this phone to ' + ssid + ', then open ' + mdns
                + '. If that name does not load, the box is still reachable at its '
                + 'address on ' + ssid + ', shown in the Network window there.', 'ok');
            return;
          }
          if (++tries > WATCH_TRIES_MAX) return;
          setTimeout(poll, 3000);
        });
    })();
  }

  var NET = function () { return window.LakehorseNetworkWindow; };

  function showCurrent(s) { if (NET()) NET().showCurrent(s); }

  // Draws everything that depends on /api/status: banner, current-network card,
  // and whether the join form is offered. Called at load and by Refresh.
  function applyStatus(s) {
    status = s;
    // Shared with drive-b.js (loaded late) so it never needs a request of its own.
    window.__lhStatus = s;
    try { document.dispatchEvent(new CustomEvent('lh-status', { detail: s })); } catch (e) { /* old browser: Drive B asks when opened */ }
    describeNetwork(s);
    showCurrent(s);
    if (s.mdns) $('netHostName').textContent = s.mdns;
    // The shell decides first-run from the same reply; see shell.js.
    if (window.LakehorseShell) window.LakehorseShell.onStatus(s);

    // The form is offered to whoever the firmware would accept: someone on the
    // box's own hotspot, or a device that already holds the pairing key. Showing
    // it to anyone else would just produce refusals.
    var allowed = NET() && NET().canChange(s, !!pairKey());
    $('hostNote').hidden = !s.hostMode;
    // Offered only while there is a network to leave.
    $('hostBtn').hidden = !(allowed && s.station === 'connected' && !s.hostMode);
    $('setup').hidden = !allowed;
    // Pairing stays on offer to a phone with no key even when setup is open to
    // everyone: a paired phone keeps working if the lock is turned back on.
    var needsPair = !pairKey();
    $('setupAway').hidden = allowed && !needsPair;
    $('pairIntro').textContent = allowed
      ? 'Optional: pair this phone with the box, so it can still change networks if the box is locked later. On the box\'s own hotspot this works at once; elsewhere hold the BOOT button for 3 seconds, or unplug and replug the box, then tap within 2 minutes.'
      : $('pairIntro').dataset.locked;
    if (!allowed) {
      // An unpaired phone is refused by the box, so do not offer it the button.
      $('forgetBtn').hidden = true;
      return;
    }
    $('setupIntro').textContent = 'Any Wi-Fi works: your home network, a venue\'s, or your '
      + 'phone\'s hotspot. The box remembers up to 5 and joins whichever is in range, with '
      + 'Bluetooth still playing.';
    // Prefill with the box's real current name, so the field shows the
    // truth rather than a placeholder that might not match.
    if (s.hostname && !$('host').value) $('host').value = s.hostname;
    if (s.viaAccessPoint) {
      if (!scanStarted) { scanStarted = true; loadScan(); }
    } else if (!scanStarted) {
      // Not automatic here: a scan retunes the radio, which can stutter a song
      // playing off the box. It runs when asked.
      NET().note('Tap Scan networks to look. Scanning can interrupt the music for a few seconds.');
    }
  }
  var scanStarted = false;

  function refresh() {
    return fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(applyStatus)
      .catch(function () {
        $('banner').className = 'banner err';
        $('banner').textContent = 'Could not talk to the box.';
        showCurrent(null);
      });
  }

  // Posts one saved network's name to a /api/wifi route. Form-encoded, which
  // is what the firmware reads with getParam(..., true).
  function postNet(path, ssid) {
    return fetch(path, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: 'ssid=' + encodeURIComponent(ssid)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) { if (!res.ok) throw new Error(res.d.error || 'rejected'); });
  }

  function forget(ssid) {
    var name = ssid || (status && status.ssid);
    if (!name) return;
    var saved = (status && Array.isArray(status.saved)) ? status.saved : [];
    var others = saved.filter(function (n) { return n !== name; }).length;
    var onIt = status && status.station === 'connected' && status.ssid === name;
    var msg = 'Forget ' + name + '?';
    if (onIt) {
      msg += others
        ? ' The box will leave it and try your other saved networks, so this page may stop answering.'
        : ' It is the only saved network: the box will leave it and start its own "'
          + ((status && status.apSsid) || 'Lakehorse Radio') + '" hotspot.';
    }
    if (!window.confirm(msg)) return;
    say($('netCurrentStatus'), 'Forgetting ' + name + '...', '');
    postNet('/api/wifi/forget', name)
      .then(function () {
        say($('netCurrentStatus'), 'Forgot ' + name + '.', 'ok');
        setTimeout(refresh, onIt ? 4000 : 300);
      })
      .catch(function (err) {
        say($('netCurrentStatus'), 'Could not forget it. ' + (err.message || ''), 'err');
      });
  }

  // Puts the box on its own hotspot without forgetting anything it knows.
  function hostNow() {
    if (!window.confirm('Put the box on its own network, "Lakehorse Radio"? It leaves '
        + (status && status.ssid ? status.ssid : 'its network') + ' (it is kept in the saved list), '
        + 'so this page stops answering here. Join "Lakehorse Radio" on this phone and open http://192.168.4.1/.')) return;
    say($('netCurrentStatus'), 'Switching to its own network...', '');
    fetch('/api/wifi/host', { method: 'POST', headers: authHeaders() })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || 'refused');
        say($('netCurrentStatus'), 'Done. Join "Lakehorse Radio" on this phone, then open http://192.168.4.1/.', 'ok');
      })
      .catch(function (err) {
        say($('netCurrentStatus'), 'Could not switch. ' + (err.message || ''), 'err');
      });
  }

  function useNow(ssid) {
    if (!window.confirm('Join ' + ssid + ' now? The box leaves its current network, '
        + 'so this page will stop answering here. Switch this phone to ' + ssid + ' too.')) return;
    say($('netCurrentStatus'), 'Joining ' + ssid + '...', '');
    postNet('/api/wifi/use', ssid)
      .then(function () {
        say($('netCurrentStatus'), 'Joining ' + ssid + '. Switch this phone to ' + ssid
          + ', then open ' + ((status && status.mdns) || 'lakehorseradio.local') + '.', 'ok');
        watchConnection(ssid, (status && status.mdns) || 'lakehorseradio.local');
      })
      .catch(function (err) {
        say($('netCurrentStatus'), 'Could not switch. ' + (err.message || ''), 'err');
      });
  }

  // Pairs this phone while the box's pairing window is open (BOOT button held,
  // or just powered on). The key is kept for this address only, which is why a
  // phone paired on the box's hotspot is not paired at lakehorseradio.local.
  function pair() {
    say($('pairStatus'), 'Pairing...', '');
    fetch('/api/pair', { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.key) throw new Error(res.d.error || 'refused');
        try { localStorage.setItem(KEY_STORE, res.d.key); } catch (e) { /* private mode */ }
        say($('pairStatus'), 'Paired.', 'ok');
        refresh();
      })
      .catch(function (err) {
        say($('pairStatus'), 'The box said no: ' + (err.message || '')
          + '. Hold BOOT for 3 seconds, then tap Pair again within 2 minutes.', 'err');
      });
  }

  // network-window.js draws the saved rows and calls these.
  window.LakehorseNetActions = { use: useNow, forget: forget };

  function init() {
    // dazzle.js is a separate <script>, loaded before this one, and exposes
    // exactly this one global -- see its header for why it's a copy of the
    // band site's generator rather than a shared import.
    if (window.paintRadioDazzle) window.paintRadioDazzle();

    $('saveBtn').addEventListener('click', save);
    $('rescanBtn').addEventListener('click', function () { loadScan(); });
    $('netRefresh').addEventListener('click', function () { say($('netCurrentStatus'), ''); refresh(); });
    $('forgetBtn').addEventListener('click', function () { forget(status && status.ssid); });
    $('hostBtn').addEventListener('click', hostNow);
    $('pairBtn').addEventListener('click', pair);
    refresh();
  }

  init();
})();
