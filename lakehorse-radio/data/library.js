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
    files.forEach(function (f) {
      var li = document.createElement('li');
      li.className = 'track' + (f.name === playingName ? ' playing' : '');

      var title = document.createElement('span');
      title.className = 't';
      title.textContent = f.name;                       // never innerHTML: a name is data
      var size = document.createElement('span');
      size.className = 'state';
      size.textContent = megabytes(f.size);

      var del = document.createElement('button');
      del.className = 'btn';
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

  // Starts each song behind a cushion of downloaded audio; see buffering.js.
  var buffer = null;
  function playerStatus(text) {
    var el = $('playerStatus');
    el.textContent = text;
    el.className = 'status';
  }

  function play(name) {
    playingName = name;
    if (!buffer) buffer = window.LakehorseBuffer.attach($('player'), playerStatus);
    buffer.start('/sd/' + encodeURIComponent(name));
    load();
  }

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
    $('player').addEventListener('ended', function () {
      var i = files.findIndex(function (f) { return f.name === playingName; });
      if (i >= 0 && i + 1 < files.length) play(files[i + 1].name);
    });
    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(setupKey)
      .catch(function () { setupKey(null); })
      .then(load);   // after the flags are known, so the upload button state is right
  }

  init();
})();
