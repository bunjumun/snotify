/* Lakehorse Radio: the virtual matrix window.
 *
 * Shows exactly what the box's 8x8 LED matrix would show, from /api/matrix
 * (src/matrix_api.h), so it works with no matrix attached. Mode buttons, a
 * brightness slider and a full view.
 *
 * Why it is shaped like this:
 *   * Nothing is requested while the window is closed. The small preview
 *     button that opens it is painted from the last frame seen (or dark) and
 *     never fetches, because the box answers one request at a time and the
 *     speaker's audio is the thing that must not wait.
 *   * While open it polls one request at a time (the next is scheduled only
 *     after the last answers), about four a second, doubling the wait up to 2 s
 *     when replies are slow and recovering when they are not. It stops when
 *     the tab is hidden and resumes when it is shown again.
 *   * Brightness is the page's own: the frame carries intensity only, so the
 *     slider just scales how strongly each light is drawn. It is not sent to
 *     the box (there is no real matrix to dim yet).
 *   * "Full view" is a CSS overlay, with the Fullscreen API tried as well.
 *     iPhone Safari has no Fullscreen API for ordinary elements, so the
 *     overlay is the version that works everywhere.
 *
 * Split like speaker-panel.js: pure helpers first (tested without a page),
 * then attach() for the DOM side. `opts` for attach exists for tests:
 * { fetch, setTimeout, clearTimeout, now, doc, storage, date }.
 */

(function (root) {
  'use strict';

  var SIZE = 8;
  var PIXELS = SIZE * SIZE;
  var BASE_MS = 250;
  var MAX_MS = 2000;
  var LOCAL_MS = 80;       // phone-mode bars are drawn here, about 12 a second
  var LOCAL_HOLD_MS = 400; // the box's frame stays out of the way this long after one
  var SLOW_MS = 350;       // a reply slower than this doubles the wait
  var BRIGHT_KEY = 'lakehorse.matrix.brightness';
  var DEFAULT_TITLE = 'LAKEHORSE';
  var MODES = ['off', 'bars', 'title', 'dazzle', 'clock', 'test', 'alignment'];

  // Pure: a frame string in, 64 levels (0..15) out; null when it is not a
  // frame, so a garbled reply draws nothing instead of a wrong picture.
  function parseFrame(frame) {
    if (typeof frame !== 'string' || frame.length !== PIXELS) return null;
    var out = [];
    for (var i = 0; i < PIXELS; i++) {
      var v = parseInt(frame.charAt(i), 16);
      if (isNaN(v)) return null;
      out.push(v);
    }
    return out;
  }

  // Pure: how long to wait before the next poll, from the last wait and how
  // long the reply took (or -1 for a failure).
  function nextDelay(current, tookMs) {
    if (tookMs < 0 || tookMs > SLOW_MS) return Math.min(MAX_MS, current * 2);
    return Math.max(BASE_MS, Math.round(current / 2));
  }

  // Pure: brightness slider (1..100) and a level (0..15) to a light's alpha.
  // A lit light is never invisible at the lowest setting, and a dark one is
  // always drawn as a dim socket by the caller, not by this.
  function lightAlpha(level, brightnessPct) {
    if (!level) return 0;
    var b = Math.max(1, Math.min(100, brightnessPct)) / 100;
    return Math.max(0.08, (level / 15) * b);
  }

  // Pure: the text sent for the title mode, from what the player says it is
  // playing.
  function titleFor(nowPlaying) {
    var t = (nowPlaying || '').replace(/\.[A-Za-z0-9]{2,4}$/, '').trim();
    return t || DEFAULT_TITLE;
  }

  // Pure: the phone's time of day as the endpoint's parameters.
  function clockQuery(date) {
    return 'h=' + date.getHours() + '&m=' + date.getMinutes() + '&s=' + date.getSeconds();
  }

  // Pure: the request that selects a mode, or '' for a mode we do not offer.
  function modeRequest(mode, nowPlaying, date) {
    if (MODES.indexOf(mode) < 0) return '';
    var q = 'mode=' + mode;
    if (mode === 'title') q += '&title=' + encodeURIComponent(titleFor(nowPlaying));
    if (mode === 'clock') q += '&' + clockQuery(date);
    return '/api/matrix?' + q;
  }

  // Pure: the box's "index:rrggbb" corner colours as {index: '#rrggbb'}; junk
  // entries are skipped.
  function parseColors(list) {
    var out = {};
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length; i++) {
      var m = /^(\d{1,2}):([0-9a-f]{6})$/i.exec(String(list[i]));
      if (m && +m[1] < PIXELS) out[+m[1]] = '#' + m[2];
    }
    return out;
  }

  function paint(canvas, levels, brightnessPct, colors) {
    var ctx = canvas && canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var cell = canvas.width / SIZE;
    var r = cell * 0.38;
    ctx.fillStyle = '#080a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < PIXELS; i++) {
      var cx = (i % SIZE) * cell + cell / 2;
      var cy = Math.floor(i / SIZE) * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.2832);
      ctx.fillStyle = '#1a1d1b';  // the socket
      ctx.fill();
      var a = lightAlpha(levels ? levels[i] : 0, brightnessPct);
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.fillStyle = (colors && colors[i]) || '#ff6b2c';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function attach(el, opts) {
    opts = opts || {};
    var doFetch = opts.fetch || root.fetch.bind(root);
    var later = opts.setTimeout || root.setTimeout.bind(root);
    var cancel = opts.clearTimeout || root.clearTimeout.bind(root);
    var now = opts.now || function () { return Date.now(); };
    var doc = opts.doc || root.document;
    var storage = opts.storage;
    var makeDate = opts.date || function () { return new Date(); };
    // Phone mode: the page plays the music, so the box has no samples. Bars
    // are then worked out here (band-meter.js) from the page's own audio and
    // drawn locally; the box's demo pattern is ignored while that is going on.
    function hasPhone() { return !!opts.bands || typeof root.LakehorsePhoneBands === 'function'; }
    var phoneBands = opts.bands || function () {
      return typeof root.LakehorsePhoneBands === 'function' ? root.LakehorsePhoneBands() : null;
    };
    var meter = opts.meter || root.LakehorseBandMeter;
    var localTimer = null;
    var localAt = -1e9;

    var isOpen = false;
    var inFlight = false;
    var timer = null;
    var delay = BASE_MS;
    var levels = null;      // last good frame
    var colors = null;      // per-light colours, only while the box is in Test mode
    var brightness = 70;
    var mode = '';
    var full = false;

    try {
      var saved = parseInt((storage || root.localStorage).getItem(BRIGHT_KEY), 10);
      if (saved >= 1 && saved <= 100) brightness = saved;
    } catch (e) { /* private window or blocked storage: keep the default */ }
    el('matrixBright').value = String(brightness);

    function say(msg) { el('matrixNote').textContent = msg || ''; }

    function redraw() {
      paint(el('matrixCanvas'), levels, brightness, colors);
      paint(el('matrixPreview'), levels, brightness, colors);
    }

    function showMode(m) {
      mode = m;
      var buttons = el('matrixModes').children;
      for (var i = 0; i < buttons.length; i++) {
        var on = buttons[i].dataset.mode === m;
        buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        if (buttons[i].classList) buttons[i].classList.toggle('primary', on);
      }
      say(m === 'bars' ? 'Bars follow the music (from the box in speaker mode, from this page in phone mode, WAV songs); otherwise a demo pattern.' : '');
    }

    function take(reply) {
      var f = parseFrame(reply && reply.frame);
      if (!f) return false;
      if (reply.mode && reply.mode !== mode) showMode(reply.mode);
      if (mode === 'bars' && now() - localAt < LOCAL_HOLD_MS) return true;  // phone bars are showing
      levels = f;
      colors = reply.mode === 'test' ? parseColors(reply.colors) : null;
      redraw();
      return true;
    }

    // One local frame, when this page is playing and Bars is selected.
    function localTick() {
      localTimer = null;
      if (!isOpen) return;
      if (mode === 'bars' && meter && !(doc && doc.hidden)) {
        var lv = null;
        try { lv = phoneBands(); } catch (e) { lv = null; }
        var f = lv && parseFrame(meter.barsFrame(lv));
        if (f) { levels = f; localAt = now(); redraw(); }
      }
      localTimer = hasPhone() ? later(localTick, LOCAL_MS) : null;
    }

    function schedule() {
      if (isOpen && localTimer === null && hasPhone()) localTimer = later(localTick, LOCAL_MS);
      if (timer !== null) { cancel(timer); timer = null; }
      if (!isOpen || (doc && doc.hidden)) return;
      timer = later(poll, delay);
    }

    function poll() {
      timer = null;
      if (!isOpen || inFlight || (doc && doc.hidden)) return;
      inFlight = true;
      var started = now();
      doFetch('/api/matrix', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          inFlight = false;
          if (take(d)) { delay = nextDelay(delay, now() - started); say(mode === 'bars' ? 'Bars follow the music (from the box in speaker mode, from this page in phone mode, WAV songs); otherwise a demo pattern.' : ''); }
          else delay = nextDelay(delay, -1);
          schedule();
        })
        .catch(function () {
          inFlight = false;
          delay = nextDelay(delay, -1);
          say('Lost touch with the box. Trying again...');
          schedule();
        });
    }

    function choose(m) {
      var path = modeRequest(m, el('nowPlaying') ? el('nowPlaying').textContent : '', makeDate());
      if (!path) return Promise.resolve();
      return doFetch(path, { method: 'POST', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok === false) { say(d.error || 'The box refused that.'); return; }
          take(d);
        })
        .catch(function () { say('Lost touch with the box.'); });
    }

    function setFull(on) {
      full = !!on;
      el('matrixWindow').classList.toggle('full', full);
      el('matrixFull').textContent = full ? 'Exit full view' : 'Full view';
      var w = el('matrixWindow');
      try {
        if (full && w.requestFullscreen) w.requestFullscreen().catch(function () {});
        else if (full && w.webkitRequestFullscreen) w.webkitRequestFullscreen();
        else if (!full && doc && doc.fullscreenElement && doc.exitFullscreen) doc.exitFullscreen();
      } catch (e) { /* the overlay is the fallback and is already showing */ }
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      delay = BASE_MS;
      el('matrixWindow').hidden = false;
      redraw();
      poll();
      if (localTimer === null && hasPhone()) localTimer = later(localTick, LOCAL_MS);
    }

    function close() {
      if (full) setFull(false);
      isOpen = false;
      if (timer !== null) { cancel(timer); timer = null; }
      if (localTimer !== null) { cancel(localTimer); localTimer = null; }
      el('matrixWindow').hidden = true;
    }

    var modeButtons = el('matrixModes').children;
    for (var i = 0; i < modeButtons.length; i++) {
      (function (b) { b.addEventListener('click', function () { choose(b.dataset.mode); }); })(modeButtons[i]);
    }
    el('matrixOpen').addEventListener('click', function () { if (isOpen) close(); else open(); });
    el('matrixClose').addEventListener('click', close);
    el('matrixFull').addEventListener('click', function () { setFull(!full); });
    el('matrixCanvas').addEventListener('click', function () { if (full) setFull(false); });
    el('matrixBright').addEventListener('input', function () {
      brightness = Math.max(1, Math.min(100, parseInt(this.value, 10) || 1));
      try { (storage || root.localStorage).setItem(BRIGHT_KEY, String(brightness)); } catch (e) { /* not saved */ }
      redraw();
    });
    // The real panel's brightness lives on the box: send it when the slider is
    // released, not on every nudge. A failed send is harmless (the page still
    // previews the value) and the next release tries again.
    el('matrixBright').addEventListener('change', function () {
      doFetch('/api/matrix?bright=' + brightness, { method: 'POST' }).catch(function () {});
    });
    if (doc && doc.addEventListener) {
      doc.addEventListener('visibilitychange', function () {
        if (!isOpen) return;
        if (doc.hidden) { if (timer !== null) { cancel(timer); timer = null; } }
        else { delay = BASE_MS; poll(); }
      });
      doc.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && full) setFull(false); });
    }

    redraw();  // dark sockets in the preview, with no request
    return { open: open, close: close, isOpen: function () { return isOpen; }, choose: choose };
  }

  // On the page itself, wire up as soon as the script runs (it sits at the end
  // of the body, so the elements exist). Not under test, where there is no page.
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('matrixOpen')) {
    attach(function (id) { return document.getElementById(id); });
  }

  var exported = {
    parseFrame: parseFrame, nextDelay: nextDelay, lightAlpha: lightAlpha,
    titleFor: titleFor, clockQuery: clockQuery, modeRequest: modeRequest,
    attach: attach, MODES: MODES, parseColors: parseColors
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseMatrixWindow = exported;
})(typeof window !== 'undefined' ? window : globalThis);
