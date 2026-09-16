/* Lakehorse Radio — the player and the setup page.
 *
 * A classic script, not a module. It is served off the box's own flash over a
 * link that frequently has no internet behind it, so there is nothing to import
 * from and no bundler in the way. Keeping it a plain script also means it runs
 * inside the cut-down webview a phone opens for a captive portal, where module
 * loading is one more thing that can quietly fail.
 *
 * The one genuinely awkward truth this page has to handle: a phone joined to
 * the box's own hotspot has no route to the internet, and the music lives on
 * the internet. So the page works out which way the listener arrived and says
 * what that means, rather than presenting a player that silently will not play.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // The band's own public track list. Passwordless by design, and the only
  // endpoint that is, so the box can offer a live catalogue without holding
  // any credential of its own.
  var SUPA_URL = 'https://twgukeyoayfqldnojrkg.supabase.co';
  var SUPA_KEY = 'sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG';
  var STORAGE_PREFIX = SUPA_URL + '/storage/v1/object/public/tracks/';

  var tracks = [];
  var current = -1;
  var status = null;

  function say(el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  /* Percent-encodes each path segment but leaves the separators alone, which is
   * what the band site's own publicUrl() does. Encoding the whole string would
   * turn the slashes into %2F and every track would 404. */
  function publicUrl(path) {
    if (!path) return '';
    if (/^https?:/.test(path)) return path;
    return STORAGE_PREFIX + path.replace(/^tracks\//, '')
      .split('/').map(encodeURIComponent).join('/');
  }

  /* Only formats a phone will actually stream. The band's library holds some
   * large uncompressed masters, and a fifty megabyte wav on a barn connection
   * looks exactly like a broken player. */
  function isStreamable(url) {
    return /\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.test(url);
  }

  function renderTracks() {
    var list = $('tracks');
    list.textContent = '';

    if (!tracks.length) {
      var empty = document.createElement('li');
      empty.className = 'banner warn';
      empty.textContent = 'No tracks yet. Push a playlist to this box to fill it.';
      list.appendChild(empty);
      return;
    }

    tracks.forEach(function (t, i) {
      var li = document.createElement('li');
      li.className = 'track' + (i === current ? ' playing' : '');

      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(i + 1);

      // A track's linked art, when the release it came from has any -- see
      // style.css's .cov/.covph. src is set from the network (Supabase),
      // never trusted further than an <img> tag; a broken or absent image
      // just falls back to the placeholder rather than showing as broken.
      var art;
      if (t.cover) {
        art = document.createElement('img');
        art.className = 'cov';
        art.src = t.cover;
        art.alt = '';
        art.loading = 'lazy';
        art.addEventListener('error', function () {
          var ph = document.createElement('span');
          ph.className = 'covph';
          art.replaceWith(ph);
        });
      } else {
        art = document.createElement('span');
        art.className = 'covph';
      }

      // textContent throughout rather than innerHTML: track titles come off the
      // network and are not ours to trust.
      var title = document.createElement('span');
      title.className = 't';
      title.textContent = t.title;

      var state = document.createElement('span');
      state.className = 'state';
      state.textContent = i === current ? 'playing' : '';

      li.appendChild(n);
      li.appendChild(art);
      li.appendChild(title);
      li.appendChild(state);
      li.addEventListener('click', function () { play(i); });
      list.appendChild(li);
    });
  }

  function play(i) {
    if (i < 0 || i >= tracks.length) return;
    current = i;
    var player = $('player');
    player.src = tracks[i].url;
    renderTracks();

    var attempt = player.play();
    if (attempt && attempt.catch) {
      attempt.catch(function (err) {
        // Two very different causes land here and the listener deserves to be
        // told which. A phone on the box's hotspot cannot reach the internet at
        // all; a phone that has simply not been tapped yet is blocked by the
        // browser's autoplay rule.
        if (status && status.viaAccessPoint) {
          say($('playerStatus'),
              'Could not load that track. You are connected straight to the box, '
              + 'which has no internet of its own. See the note above.', 'err');
        } else {
          say($('playerStatus'), 'Tap play to start. ' + (err && err.name ? err.name : ''), '');
        }
      });
    }
  }

  function loadStoredPlaylist() {
    return fetch('/api/playlist', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (doc) {
        tracks = (doc.tracks || []).filter(function (t) {
          return t && t.url && isStreamable(t.url);
        });
        renderTracks();
      })
      .catch(function () {
        say($('playerStatus'), 'Could not read the playlist from the box.', 'err');
      });
  }

  /* Pulls the live list straight from the band's library. Only works when the
   * phone has a route to the internet, which is exactly the case this button
   * is for: someone on the barn network wanting whatever was added today. */
  function refreshFromLibrary() {
    var btn = $('refreshBtn');
    btn.disabled = true;
    say($('playerStatus'), 'Asking the band library...', '');

    fetch(SUPA_URL + '/rest/v1/rpc/game_tracks', {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(function (r) {
        if (!r.ok) throw new Error('library returned ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        var fresh = (rows || []).map(function (row) {
          return { title: row.title, url: publicUrl(row.src) };
        }).filter(function (t) { return isStreamable(t.url); });

        if (!fresh.length) {
          say($('playerStatus'), 'The library had nothing streamable to add.', 'warn');
          return;
        }
        tracks = fresh;
        current = -1;
        renderTracks();
        say($('playerStatus'), 'Loaded ' + fresh.length + ' tracks from the library.', 'ok');
      })
      .catch(function () {
        say($('playerStatus'),
            'Could not reach the band library. That usually means this phone has '
            + 'no internet right now.', 'err');
      })
      .then(function () { btn.disabled = false; });
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
        'That hotspot has no internet of its own, and the music streams from the web, '
        + 'so playback needs your phone to keep its mobile data switched on. If a setup '
        + 'sheet opened this page, close it and open the same address in your normal '
        + 'browser, because that sheet cannot play audio. The tidier option is to put '
        + 'the box on the same Wi-Fi as you, below.'));
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

  function loadScan(again) {
    if (!again) scanTries = 0;
    fetch('/api/scan', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (doc) {
        var sel = $('ssid');

        if (doc.error) {
          sel.innerHTML = '<option value="">Could not scan, type the name below</option>';
          say($('setupStatus'), doc.error, 'err');
          return;
        }

        if (doc.scanning) {
          if (++scanTries > SCAN_TRIES_MAX) {
            sel.innerHTML = '<option value="">Scan did not finish, type the name below</option>';
            say($('setupStatus'),
                'The box could not finish scanning, which it often cannot while it '
                + 'is already trying to join a network. Type the name in instead.', 'err');
            return;
          }
          sel.innerHTML = '<option value="">Scanning...</option>';
          setTimeout(function () { loadScan(true); }, 1800);
          return;
        }
        sel.textContent = '';
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = (doc.networks && doc.networks.length)
          ? 'Choose a network' : 'Nothing found, type it below';
        sel.appendChild(blank);

        (doc.networks || []).forEach(function (n) {
          var o = document.createElement('option');
          o.value = n.ssid;
          o.textContent = n.ssid + '  (' + n.rssi + ' dBm, ch' + n.channel + ')'
            + (n.open ? '  open' : '');
          sel.appendChild(o);
        });
      })
      .catch(function () {
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
      headers: { 'Content-Type': 'application/json' },
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
                'On ' + s.ssid + ' at ' + s.ip + '. Reach it at ' + mdns
                + ' from anything on that network. Setting up a box next time '
                + 'can also be done once over USB, with no hotspot needed.', 'ok');
            return;
          }

          if (s.lastFailure) {
            say($('setupStatus'),
                'Could not join ' + ssid + ': ' + s.lastFailure
                + '. Check the password and that ' + ssid + ' is in range.', 'err');
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
                + ssid + ' and moved its hotspot. Try ' + mdns + ' from that '
                + 'network. Setting up a box next time can also be done once '
                + 'over USB, with no hotspot needed.', 'ok');
            return;
          }
          if (++tries > WATCH_TRIES_MAX) return;
          setTimeout(poll, 3000);
        });
    })();
  }

  function init() {
    // dazzle.js is a separate <script>, loaded before this one, and exposes
    // exactly this one global -- see its header for why it's a copy of the
    // band site's generator rather than a shared import.
    if (window.paintRadioDazzle) window.paintRadioDazzle();

    $('player').addEventListener('ended', function () {
      if (current + 1 < tracks.length) play(current + 1);
    });
    $('refreshBtn').addEventListener('click', refreshFromLibrary);
    $('saveBtn').addEventListener('click', save);
    $('rescanBtn').addEventListener('click', loadScan);

    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        status = s;
        describeNetwork(s);

        // Setup is only offered to someone on the box's own hotspot, which is
        // the same proximity rule the firmware enforces. Showing the form to
        // everyone on the barn network would just produce refusals.
        if (s.viaAccessPoint) {
          $('setup').hidden = false;
          $('setupIntro').textContent = s.hasSavedNetwork
            ? 'This box already remembers a network. Saving a new one replaces it.'
            : 'This box has not been put on a network yet.';
          // Prefill with the box's real current name, so the field shows the
          // truth rather than a placeholder that might not match.
          if (s.hostname) $('host').value = s.hostname;
          loadScan();
        }
      })
      .catch(function () {
        $('banner').className = 'banner err';
        $('banner').textContent = 'Could not talk to the box.';
      });

    loadStoredPlaylist();
  }

  init();
})();
