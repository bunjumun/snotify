/* Lakehorse Radio — the music stored on the box's SD card.
 *
 * Lists, plays, uploads and deletes the files the box keeps itself. A classic
 * script like app.js, for the same reason: it has to run inside a phone's
 * cut-down captive-portal webview with nothing to import.
 *
 * Uploading converts first (wavconvert.js, shared with tools/song-prep.html).
 * The band's masters are 24-bit WAV, which is a third
 * bigger than it needs to be and which several phones will not play. The page
 * rewrites any 24/32-bit PCM or float WAV as ordinary 16-bit PCM before it
 * leaves the browser, so the box only ever stores files it can serve to any
 * player, and an upload crosses the barn Wi-Fi a third lighter. The sample rate
 * and channel count are kept as they are: resampling in a browser would need
 * the whole file decoded into memory, which a phone cannot do for a 7 minute
 * mix, and 48 kHz 16-bit is perfectly good.
 *
 * Writing needs the box's pairing key (header X-Lakehorse-Key), the same one
 * the playlist push uses. It is handed out only on the box's own hotspot, so
 * this page fetches it there once and keeps it in localStorage.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KEY_STORE = 'lakehorse.radio.key';
  var files = [];
  var playingName = '';
  var uploadEnabled = false;  // from /api/status, like keyRequired
  var keyRequired = false;   // from /api/status; the box decides, not the page

  function say(msg, kind) {
    var el = $('sdStatus');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function megabytes(n) { return (n / (1024 * 1024)).toFixed(n > 1e8 ? 0 : 1) + ' MB'; }

  function key() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* private mode */ } }

  // ---------- Listing ----------

  function render(doc) {
    var list = $('sdList');
    list.textContent = '';
    files = doc.files || [];

    $('sdSpace').textContent = doc.mounted
      ? megabytes(doc.freeBytes) + ' free of ' + megabytes(doc.totalBytes)
      : 'No SD card in the box';
    $('sdUpload').hidden = !doc.mounted || !uploadEnabled;

    if (!doc.mounted) return;
    if (!files.length) {
      var empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'Nothing stored on the box yet.';
      list.appendChild(empty);
      return;
    }

    files.sort(function (a, b) { return a.name.localeCompare(b.name); });
    trackNames = files.map(function (f) { return f.name; });
    if (player) player.setTracks(trackNames);
    files.forEach(function (f) {
      var li = document.createElement('li');
      li.className = 'track' + (f.name === playingName ? ' playing' : '');
      li.dataset.name = f.name;
      li.setAttribute('data-help', 'sd-track');

      var title = document.createElement('span');
      title.className = 't';
      title.textContent = f.name;                       // never innerHTML: a name is data
      var size = document.createElement('span');
      size.className = 'state';
      size.textContent = megabytes(f.size);

      var del = document.createElement('button');
      del.className = 'btn';
      del.setAttribute('data-help', 'sd-delete');
      del.textContent = 'Delete';
      del.addEventListener('click', function (ev) { ev.stopPropagation(); remove(f.name); });

      li.appendChild(title);
      li.appendChild(size);
      li.appendChild(del);
      li.addEventListener('click', function () { play(f.name); });
      list.appendChild(li);
    });
  }

  function load() {
    return fetch('/api/sd', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { say('Could not read the box\'s storage.', 'err'); });
  }

  // ---------- Playing ----------
  //
  // Everything goes through player.js, so these controls work the same for
  // every song and will keep working when on-box playback (player-box.js)
  // replaces the browser backend: that swap is the createPlayer line below.
  var VOLUME_STORE = 'lakehorse.radio.volume';
  var player = null;
  var reporter = null;
  var seekDragging = false;
  var duration = 0;

  function playerStatus(text) {
    var el = $('playerStatus');
    el.textContent = text;
    el.className = 'status';
  }

  function clock(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function showProgress(pos, dur, playing) {
    duration = dur;
    $('playTime').textContent = clock(pos) + ' / ' + clock(dur);
    $('playToggle').textContent = playing ? 'Pause' : 'Play';
    if (!seekDragging) $('playSeek').value = dur ? Math.round(1000 * pos / dur) : 0;
  }

  function showTrack(name) {
    playingName = name || '';
    $('nowPlaying').textContent = name || '';
    showProgress(0, 0, !!name);   // a new song starts at the left, not where the last one was
    $('playerBar').hidden = !name;
    var rows = $('sdList').querySelectorAll('li.track');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('playing', rows[i].dataset.name === playingName);
    }
  }

  function savedVolume() {
    try {
      var v = localStorage.getItem(VOLUME_STORE);
      return v === null ? 1 : Number(v);
    } catch (e) { return 1; }
  }

  // Where songs play: this device's browser, or the box's own Bluetooth
  // speaker. Remembered per device. Switching stops the old backend first, so
  // the two never play at once.
  var PLAY_ON_STORE = 'lakehorse.radio.playOn';
  var trackNames = [];

  function savedPlayOn() {
    try { return localStorage.getItem(PLAY_ON_STORE) === 'box' ? 'box' : 'browser'; }
    catch (e) { return 'browser'; }
  }

  // The box remembers its own volume across power cuts, so when the page
  // takes over the box it adopts that volume instead of pushing the page's.
  // (The slider writes localStorage only when moved, so adopting is not
  // saving.) Falls back to the page's volume if the box does not answer.
  var buildToken = 0;

  function makePlayer(kind, volume) {
    var backend = kind === 'box'
      ? window.LakehorseBoxPlayer.create()
      : window.LakehorseBrowserPlayer.create($('player'));
    // Songs this page plays count toward the alignment total (align-report.js).
    // The box counts its own, so a box player gets no tracker.
    var AR = window.LakehorseAlignReport;
    reporter = kind !== 'box' && AR ? AR.createTracker(AR.poster(function (u, o) { return fetch(u, o); })) : null;
    var tracker = reporter;
    player = window.LakehorsePlayer.createPlayer(backend, {
      progress: function (pos, dur, isPlaying) { showProgress(pos, dur, isPlaying); if (tracker) tracker.progress(pos, dur, isPlaying); },
      status: playerStatus,
      track: function (name) { showTrack(name); if (tracker) tracker.track(name); }
    }, volume);
    // The matrix window asks this for bars while this page is the one playing.
    window.LakehorsePhoneBands = kind === 'box' ? null : function () { return backend.bands ? backend.bands() : null; };
    player.setTracks(trackNames);
    $('playVolume').value = Math.round(player.volume() * 100);
  }

  window.addEventListener('pagehide', function () { if (reporter) reporter.flush(); });

  function buildPlayer(kind) {
    var carried = player ? player.volume() : savedVolume();
    if (player) player.stop();
    var token = ++buildToken;
    if (kind !== 'box') { makePlayer(kind, carried); return; }
    fetch('/api/player', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.ok && isFinite(d.volume) ? d.volume : carried; })
      .catch(function () { return carried; })
      .then(function (v) { if (token === buildToken) makePlayer(kind, v); });
  }

  // With Bluetooth switched off the box has no speaker, so "the box's
  // speaker" is greyed out and anyone left on it is moved to this device.
  function matchPlayOnToBluetooth(info) {
    var boxOption = $('playOn').querySelector('option[value="box"]');
    boxOption.disabled = !info.bluetooth;
    if (!info.bluetooth && $('playOn').value === 'box') {
      $('playOn').value = 'browser';
      try { localStorage.setItem(PLAY_ON_STORE, 'browser'); } catch (e) { /* private mode */ }
      buildPlayer('browser');
    }
  }

  function setupPlayOn() {
    window.LakehorseBoxPlayer.probe().then(function (built) {
      if (!built) return;
      $('playOnRow').hidden = false;
      window.LakehorseSpeakerPanel.attach($, { onChange: matchPlayOnToBluetooth }).refresh();
      $('playOn').value = savedPlayOn();
      if (savedPlayOn() === 'box') buildPlayer('box');
      $('playOn').addEventListener('change', function () {
        try { localStorage.setItem(PLAY_ON_STORE, this.value); } catch (e) { /* private mode */ }
        buildPlayer(this.value);
        playerStatus('');
      });
    });
  }

  function setupPlayer() {
    buildPlayer('browser');
    setupPlayOn();
    $('playVolume').value = Math.round(player.volume() * 100);
    $('playToggle').addEventListener('click', function () { player.toggle(); });
    $('playNext').addEventListener('click', function () { player.next(); });
    $('playSeek').addEventListener('input', function () { seekDragging = true; });
    $('playSeek').addEventListener('change', function () {
      seekDragging = false;
      player.seek(duration * this.value / 1000);
    });
    $('playVolume').addEventListener('input', function () {
      var v = player.setVolume(this.value / 100);
      try { localStorage.setItem(VOLUME_STORE, String(v)); } catch (e) { /* private mode */ }
    });
  }

  function play(name) { player.play(name); }

  function remove(name) {
    if (!confirm('Delete ' + name + ' from the box?')) return;
    fetch('/api/sd/delete?name=' + encodeURIComponent(name), {
      method: 'POST', headers: { 'X-Lakehorse-Key': key() }
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'delete failed');
        say('Deleted ' + name + '.', 'ok');
      })
      .catch(function (e) { say(e.message, 'err'); })
      .then(load);
  }

  // ---------- Upload ----------

  function send(blob, name, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      // The raw file as the body, name in the query: the box parses this far
      // faster than a multipart form.
      xhr.open('POST', '/api/sd/upload?name=' + encodeURIComponent(name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Lakehorse-Key', key());
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onerror = function () { reject(new Error('the connection to the box dropped')); };
      xhr.onload = function () {
        var d = {};
        try { d = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status === 200 && d.ok) return resolve(d);
        reject(new Error(d.error || ('the box answered ' + xhr.status)));
      };
      xhr.send(blob);
    });
  }

  function uploadAll(list) {
    if (keyRequired && !key()) { say('Enter the pairing key first (see the note below).', 'err'); return; }
    var bar = $('sdBar');
    var chosen = Array.prototype.slice.call(list);
    $('sdPick').disabled = true;

    chosen.reduce(function (chain, file, i) {
      return chain.then(function () {
        var label = '(' + (i + 1) + '/' + chosen.length + ') ' + file.name;
        say(label + ': preparing...', '');
        bar.hidden = false; bar.value = 0;
        return window.LakehorseWav.toBlob(file, function (p) { bar.value = p * 0.5; say(label + ': converting...', ''); })
          .then(function (r) {
            say(label + ': uploading ' + megabytes(r.blob.size) +
                (r.note ? ' (' + r.note + ')' : '') + '...', '');
            return send(r.blob, file.name, function (p) { bar.value = 0.5 + p * 0.5; });
          })
          .then(function () { say(label + ': stored.', 'ok'); return load(); });
      });
    }, Promise.resolve())
      .catch(function (e) { say('Upload failed: ' + e.message, 'err'); })
      .then(function () {
        bar.hidden = true;
        $('sdPick').disabled = false;
        $('sdFile').value = '';
        load();
      });
  }

  // ---------- Pairing key ----------

  function setupKey(status) {
    var box = $('sdKeyRow');
    keyRequired = !!(status && status.sdNeedsKey);
    uploadEnabled = !!(status && status.sdUpload);
    if (keyRequired && !key() && status.viaAccessPoint) {
      // On the hotspot the box hands the key over by itself.
      fetch('/api/pair').then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { setKey(d.key); box.hidden = true; }
      });
    }
    box.hidden = !keyRequired || !!key();
    $('sdKeySave').addEventListener('click', function () {
      var v = $('sdKey').value.trim();
      if (v) { setKey(v); box.hidden = true; say('Key saved on this device.', 'ok'); }
    });
  }

  function init() {
    if (!$('sdList')) return;
    $('sdPick').addEventListener('click', function () { $('sdFile').click(); });
    $('sdFile').addEventListener('change', function () {
      if (this.files.length) uploadAll(this.files);
    });
    setupPlayer();
    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(setupKey)
      .catch(function () { setupKey(null); })
      .then(load);   // after the flags are known, so the upload button state is right
  }

  init();
})();
