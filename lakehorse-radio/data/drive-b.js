/* Lakehorse Radio: DRIVE B, the files recovered from the crashed ENIAS.
 *
 * Why it is shaped like this:
 *   * The alignment total lives on the box (src/alignment_box.cpp). This page
 *     only reads it, from /api/status, the one call the page already makes for
 *     everything else. It is asked ONLY while this window is open: once when
 *     it opens, again about a second after the song changes (a song is
 *     credited when it ends or is skipped), and on a slow timer. A closed
 *     window makes no requests at all, and a hidden tab pauses the timer.
 *   * The files are not in the code. They come from drive-b.json (name,
 *     threshold in alignment percent, kind text | download | link, and the
 *     content or URL), so the story can change by editing one file. A missing
 *     or malformed file leaves the window open with the lattice and the
 *     percent working and a note where the list would be.
 *   * Balloons only hint ("Pattern drift detected...") and never state the
 *     rule; the rule is in Help (alignment-scoring). The event log is built
 *     from what this page sees: the total went up, or a song changed and it
 *     did not. The box is not asked for a log.
 *   * The lattice uses the matrix engine's node order (src/matrix_engine.cpp,
 *     alignmentCell): outward from the bottom left, one diagonal at a time.
 *     test/drive-b.test.js pins the same first cells as the native test. Each
 *     unlocked node sits at a fixed offset from its grid spot (hashed from the
 *     node number, so nothing jitters between redraws).
 *
 * Pure helpers first (tested without a page), then attach().
 */
(function (root) {
  'use strict';

  var SIZE = 8;
  var NODES = SIZE * SIZE;
  var MAX_POINTS = 6400;
  var VIEW = 128;
  var PITCH = 15.5;
  var ORIGIN = 10;
  var DRIFT = 7;                 // an unlocked ring is up to half of this off its spot
  var FILE = 'drive-b.json';
  var READ_ERROR = 'read error: try after the next track';
  var READ_ERROR_MS = 4000;
  var STUTTER_MS = 450;
  var SLOW_MS = 20000;
  var SONG_DELAY_MS = 1500;
  var LOG_LINES = 4;
  var KINDS = ['text', 'download', 'link'];
  var JUNK = ['#', '%', '▓', '?', '$'];
  // The drive's own name. It is shown scrambled and clears up as the alignment
  // rises, so the percent can be read off the desktop without opening anything.
  var TITLE = 'STAR SHIP ENIAS HARD DRIVE';
  var OLD_TITLES_SEEN_KEY = 'lh-driveb-pct';

  function hash32(a, b) {
    var h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  }

  function textHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h >>> 0;
  }

  // Pure: cell of node n (0..63), row 0 on top, the matrix engine's order.
  function nodeCell(n) {
    if (!(n >= 0 && n < NODES) || n !== Math.floor(n)) return null;
    var k = 0;
    for (var d = 0; d <= 2 * (SIZE - 1); d++) {
      var lo = d > SIZE - 1 ? d - (SIZE - 1) : 0;
      var hi = d < SIZE - 1 ? d : SIZE - 1;
      for (var col = lo; col <= hi; col++) {
        if (k === n) return { col: col, row: SIZE - 1 - (d - col) };
        k++;
      }
    }
    return null;
  }

  // Pure: what the status reply says, or null if it is not usable. Points are
  // held to 0..6400 and the rest is worked out from them, so a odd reply can
  // never draw more than the full lattice.
  function readAlignment(status) {
    var a = status && status.alignment;
    if (!a || typeof a.points !== 'number' || !isFinite(a.points)) return null;
    var points = Math.max(0, Math.min(MAX_POINTS, Math.floor(a.points)));
    return { points: points, nodes: Math.floor(points / 100), percent: Math.floor(points * 100 / MAX_POINTS) };
  }

  // Pure: the lattice as plain data in a 128 unit box.
  function latticeModel(nodes) {
    var locked = {}, i;
    var n = Math.max(0, Math.min(NODES, nodes | 0));
    var cells = [];
    for (i = 0; i < NODES; i++) cells.push(nodeCell(i));
    var out = { locked: [], rings: [], lines: [] };
    function pos(c) { return ORIGIN + PITCH * c; }
    for (i = 0; i < n; i++) locked[cells[i].row * SIZE + cells[i].col] = true;
    for (i = 0; i < NODES; i++) {
      var c = cells[i];
      var x = pos(c.col), y = pos(c.row);
      if (i < n) {
        out.locked.push({ n: i, x: x, y: y });
        if (c.col + 1 < SIZE && locked[c.row * SIZE + c.col + 1]) out.lines.push({ x1: x, y1: y, x2: pos(c.col + 1), y2: y });
        if (c.row + 1 < SIZE && locked[(c.row + 1) * SIZE + c.col]) out.lines.push({ x1: x, y1: y, x2: x, y2: pos(c.row + 1) });
      } else {
        var h = hash32(i, 0x51ED);
        out.rings.push({ n: i, x: x + ((h % 1000) / 1000 - 0.5) * DRIFT, y: y + (((h >>> 10) % 1000) / 1000 - 0.5) * DRIFT });
      }
    }
    return out;
  }

  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  // Pure: the SVG body for the lattice. Only numbers go in, so it is safe as
  // markup. `fresh` is the first node number that just locked (or -1), `flash`
  // the node to flash (or -1).
  function latticeSvg(nodes, fresh, flash) {
    var m = latticeModel(nodes);
    var s = '';
    m.lines.forEach(function (l) {
      s += '<line x1="' + f1(l.x1) + '" y1="' + f1(l.y1) + '" x2="' + f1(l.x2) + '" y2="' + f1(l.y2) + '" stroke="#5fd0b0" stroke-width="1" opacity=".6"/>';
    });
    m.rings.forEach(function (r) {
      s += '<circle cx="' + f1(r.x) + '" cy="' + f1(r.y) + '" r="2.4" fill="none" stroke="#ff6b2c" stroke-width="1" opacity=".75"/>';
    });
    var homeless = latticeModel(0).rings;
    m.locked.forEach(function (c) {
      var cls = '';
      var style = '';
      if (fresh >= 0 && c.n >= fresh) {
        var from = homeless[c.n];
        cls = ' class="snap' + (c.n === flash ? ' flash' : '') + '"';
        style = ' style="--dx:' + f1(from.x - c.x) + 'px;--dy:' + f1(from.y - c.y) + 'px"';
      }
      s += '<circle cx="' + f1(c.x) + '" cy="' + f1(c.y) + '" r="3.2" fill="#5fd0b0"' + cls + style + '/>';
    });
    return s;
  }

  // Pure: drive-b.json to { files }, or null when it is not usable. A file
  // that is not valid is dropped; the rest still show.
  function safeUrl(u) {
    return typeof u === 'string' && /^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|[A-Za-z0-9_.\-][A-Za-z0-9_.\-\/]*)$/.test(u)
      && !/^javascript:/i.test(u);
  }
  function parseDrive(data) {
    if (!data || !Array.isArray(data.files)) return null;
    var files = [];
    data.files.forEach(function (f) {
      if (!f || typeof f.name !== 'string' || !f.name || f.name.length > 40) return;
      if (KINDS.indexOf(f.kind) < 0) return;
      var t = typeof f.threshold === 'number' && isFinite(f.threshold) ? Math.floor(f.threshold) : NaN;
      if (!(t >= 0 && t <= 100)) return;
      if (f.kind === 'text') {
        if (typeof f.content !== 'string') return;
        files.push({ name: f.name, threshold: t, kind: 'text', content: f.content });
      } else {
        if (!safeUrl(f.url)) return;
        files.push({ name: f.name, threshold: t, kind: f.kind, url: f.url });
      }
    });
    return { files: files };
  }

  // Pure: a name with some letters replaced by junk. progress runs 0 (about
  // half garbled) to 1 (clean). A name that is still locked always keeps at
  // least one bad character, so it never looks recovered by accident.
  function garble(name, progress) {
    var p = Math.max(0, Math.min(1, progress));
    var seed = textHash(name);
    var cut = 45 + p * 55;
    var chars = name.split('');
    var worst = -1, worstScore = -1, any = false;
    for (var i = 0; i < chars.length; i++) {
      if (chars[i] === '.' || chars[i] === '_') continue;
      var score = hash32(seed, i) % 100;
      if (score > worstScore) { worstScore = score; worst = i; }
      if (score >= cut) { chars[i] = JUNK[hash32(seed, i + 100) % JUNK.length]; any = true; }
    }
    if (!any && worst >= 0) chars[worst] = JUNK[hash32(seed, worst + 100) % JUNK.length];
    return chars.join('');
  }

  // Pure: the drive's name at an alignment percent. Each letter has its own
  // fixed point (1..100) at which it comes clean, from a hash of its position,
  // so the same percent always reads the same and a higher one never hides a
  // letter a lower one showed. Spaces are never scrambled, so the shape of the
  // name is visible. At 100 every letter is clean; at 0 none is.
  function titleAt(percent) {
    var p = Math.max(0, Math.min(100, Math.floor(percent) || 0));
    var at = [], last = -1, i;
    for (i = 0; i < TITLE.length; i++) {
      at.push(TITLE.charAt(i) === ' ' ? 0 : 1 + hash32(i, 0x7173) % 99);
      if (last < 0 || at[i] > at[last]) last = i;
    }
    at[last] = 100;               // the name is only whole at exactly 100
    var out = '';
    for (i = 0; i < TITLE.length; i++) {
      var c = TITLE.charAt(i);
      out += (c === ' ' || p >= at[i]) ? c : JUNK[hash32(i, 0x9d1) % JUNK.length];
    }
    return out;
  }

  // Pure: how one file looks at this alignment percent.
  function fileState(file, percent) {
    if (percent >= file.threshold) return { unlocked: true, name: file.name, status: 'recovered', tone: 'ok' };
    var p = file.threshold > 0 ? percent / file.threshold : 1;
    return {
      unlocked: false,
      name: garble(file.name, p),
      status: p < 0.4 ? 'corrupt' : 'aligning ' + Math.floor(p * 100) + '%',
      tone: 'warn'
    };
  }

  // Pure: log lines for a change in the total. `prev` is the earlier points
  // (or null before the first reading) and `songSeen` whether a song changed
  // since. Returns a list, oldest first.
  function eventLines(prev, points, songSeen) {
    if (prev === null) return [{ text: '> drive mounted', tone: 'dim' }];
    var gained = points - prev;
    if (gained >= 100) return [{ text: songSeen ? '> LAKEHORSE signal accepted' : '> game signal accepted', tone: 'ok' }];
    if (gained > 0) return [{ text: '> weak signal. weights nudged', tone: 'ok' }];
    if (songSeen) return [{ text: '> pattern unrecognized. no change', tone: 'dim' }];
    return [];
  }

  // Pure: the hint balloon under the files.
  function balloon(percent, justGained) {
    if (percent >= 100) return 'Alignment complete. Every file reads clean.';
    if (justGained) return 'Pattern drift detected. Audio input accepted. Weights settling.';
    if (percent === 0) return 'Pattern drift detected. The net is waiting for a signal.';
    return 'Pattern drift detected. Weights settling.';
  }

  function attach(el, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var doFetch = opts.fetch || root.fetch.bind(root);
    var later = opts.setTimeout || root.setTimeout.bind(root);
    var cancel = opts.clearTimeout || root.clearTimeout.bind(root);
    var openUrl = opts.open || function (u) { root.open(u, '_blank', 'noopener'); };

    var isOpen = false, inFlight = false, timer = null, songTimer = null;
    var files = null;          // parsed drive-b.json; null until read, [] if unusable
    var filesLoaded = false;
    var align = null;          // last good reading
    var songSeen = false;
    var log = [];
    var justGained = false;
    var erroring = null;       // name of the file showing the read error

    function visible() { return !(doc && doc.hidden); }

    // Paints the scrambled name everywhere the drive is named: window title bar,
    // taskbar label, desktop icon, Start entry. Cheap and only when it changes.
    var shownTitle = null;
    function paintTitle(percent) {
      var t = titleAt(percent);
      if (t === shownTitle) return;
      var win = el('win-driveb');
      if (!win) return;
      var bar = win.querySelector ? win.querySelector('.win-name') : null;
      if (bar && bar.lastChild) bar.lastChild.textContent = t;
      var old = shownTitle || (win.dataset && win.dataset.title) || '';
      if (win.dataset) win.dataset.title = t;
      var x = win.querySelector ? win.querySelector('.win-x') : null;
      if (x) x.setAttribute('aria-label', 'Close Drive B');
      if (doc && doc.querySelectorAll) {
        Array.prototype.forEach.call(doc.querySelectorAll('[data-open="win-driveb"] span, #tasks .task'), function (n) {
          if (n.classList && n.classList.contains('task')) { if (n.textContent === old) n.textContent = t; return; }
          n.textContent = t;
        });
        var start = doc.querySelector('.startitems [data-open="win-driveb"]');
        if (start) start.textContent = t;
      }
      shownTitle = t;
    }

    // The percent the page last knew, kept across visits so the name is right
    // on first paint. The box is the truth; this only avoids a flash.
    function remembered() {
      try { var v = Number(root.localStorage && root.localStorage.getItem(OLD_TITLES_SEEN_KEY)); return v >= 0 && v <= 100 ? Math.floor(v) : 0; } catch (e) { return 0; }
    }
    function remember(percent) {
      try { if (root.localStorage) root.localStorage.setItem(OLD_TITLES_SEEN_KEY, String(percent)); } catch (e) { /* private mode: fine */ }
    }
    // Any status reply (app.js shares the one it already asks for) moves the name.
    function onStatus(status) {
      var r = readAlignment(status);
      if (!r) return;
      remember(r.percent);
      paintTitle(r.percent);
    }
    paintTitle(remembered());
    if (root.__lhStatus) onStatus(root.__lhStatus);
    if (doc && doc.addEventListener) doc.addEventListener('lh-status', function (ev) { onStatus(ev.detail); });

    function pushLog(lines) {
      lines.forEach(function (l) { log.push(l); });
      if (log.length > LOG_LINES) log = log.slice(log.length - LOG_LINES);
    }

    function renderLog() {
      var box = el('driveLog');
      box.textContent = '';
      log.forEach(function (l) {
        var d = doc.createElement('div');
        d.className = 'log-' + l.tone;
        d.textContent = l.text;
        box.appendChild(d);
      });
    }

    function renderFiles() {
      var box = el('driveFiles');
      box.textContent = '';
      if (!files || !files.length) {
        var n = doc.createElement('p');
        n.className = 'muted';
        n.textContent = filesLoaded ? "Drive B's file list could not be read." : 'Mounting...';
        box.appendChild(n);
        return;
      }
      var percent = align ? align.percent : 0;
      files.forEach(function (f) {
        var st = fileState(f, percent);
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'drivefile' + (st.unlocked ? '' : ' locked');
        b.setAttribute('data-help', 'driveb-file');
        var name = doc.createElement('span');
        name.className = 'dfname';
        name.textContent = st.name;
        var stat = doc.createElement('span');
        stat.className = 'dfstat ' + st.tone;
        stat.textContent = erroring === f.name ? READ_ERROR : st.status;
        b.appendChild(name);
        b.appendChild(stat);
        b.addEventListener('click', function () { tap(f, st, b); });
        box.appendChild(b);
      });
    }

    function render(fresh, flash) {
      var a = align || { points: 0, nodes: 0, percent: 0 };
      el('drivePercent').textContent = a.percent + '%';
      el('driveCount').textContent = a.nodes + ' of ' + NODES + ' nodes locked';
      el('driveNet').innerHTML = latticeSvg(a.nodes, fresh, flash);
      el('driveNet').setAttribute('aria-label', 'Network of ' + NODES + ' nodes, ' + a.nodes + ' aligned');
      el('driveBalloon').textContent = balloon(a.percent, justGained);
      renderFiles();
      renderLog();
    }

    function tap(f, st, button) {
      if (!st.unlocked) {
        erroring = f.name;
        button.classList.add('stutter');
        renderStatusOnly(button, READ_ERROR);
        later(function () { button.classList.remove('stutter'); }, STUTTER_MS);
        later(function () { if (erroring === f.name) { erroring = null; renderFiles(); } }, READ_ERROR_MS);
        return;
      }
      if (f.kind === 'text') {
        el('driveViewerName').textContent = f.name;
        el('driveViewerText').textContent = f.content;
        el('driveViewer').hidden = false;
      } else if (f.kind === 'download') {
        var a = doc.createElement('a');
        a.href = f.url;
        a.setAttribute('download', f.name);
        a.rel = 'noopener';
        if (a.click) a.click();
      } else {
        openUrl(f.url);
      }
    }

    function renderStatusOnly(button, text) {
      var kids = button.children || [];
      if (kids[1]) kids[1].textContent = text;
    }

    function take(status) {
      var r = readAlignment(status);
      if (!r) return false;
      var prev = align ? align.points : null;
      var lines = eventLines(prev, r.points, songSeen);
      var changed = prev === null || r.points !== prev;
      var gained = prev !== null && r.points > prev;
      var oldNodes = prev === null ? 0 : Math.floor(prev / 100);
      var snap = gained && r.nodes > oldNodes ? oldNodes : -1;
      var flash = snap >= 0 && r.points - prev >= 100 ? r.nodes - 1 : -1;
      pushLog(lines);
      songSeen = false;
      align = r;
      remember(r.percent);
      paintTitle(r.percent);
      justGained = gained;
      if (changed || lines.length) {
        render(snap, flash);
      }
      return true;
    }

    function schedule() {
      if (timer !== null) { cancel(timer); timer = null; }
      if (!isOpen || !visible()) return;
      timer = later(refresh, SLOW_MS);
    }

    function refresh() {
      timer = null;
      if (!isOpen || inFlight || !visible()) return Promise.resolve(false);
      inFlight = true;
      return doFetch('/api/status', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (s) { inFlight = false; var ok = take(s); schedule(); return ok; })
        .catch(function () { inFlight = false; schedule(); return false; });
    }

    function loadFiles() {
      if (filesLoaded) return Promise.resolve();
      // no-cache: see help.js; the story file changes without the page changing.
      return doFetch(FILE, { cache: 'no-cache' })
        .then(function (r) { return r.ok === false ? null : r.json(); })
        .catch(function () { return null; })
        .then(function (d) {
          var p = parseDrive(d);
          files = p ? p.files : [];
          filesLoaded = true;
          renderFiles();
        });
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      render(-1, -1);
      loadFiles();
      refresh();
    }

    function close() {
      isOpen = false;
      if (timer !== null) { cancel(timer); timer = null; }
      if (songTimer !== null) { cancel(songTimer); songTimer = null; }
      el('driveViewer').hidden = true;
    }

    function songChanged() {
      songSeen = true;
      if (!isOpen) return;
      if (songTimer !== null) cancel(songTimer);
      songTimer = later(function () { songTimer = null; refresh(); }, SONG_DELAY_MS);
    }

    el('driveViewerClose').addEventListener('click', function () { el('driveViewer').hidden = true; });
    var win = el('win-driveb');
    if (typeof root.MutationObserver === 'function') {
      if (win) {
        new root.MutationObserver(function () { if (win.hidden) close(); else open(); })
          .observe(win, { attributes: true, attributeFilter: ['hidden'] });
      }
      var np = el('nowPlaying');
      if (np) {
        var last = np.textContent;
        new root.MutationObserver(function () {
          if (np.textContent !== last) { last = np.textContent; songChanged(); }
        }).observe(np, { childList: true, characterData: true, subtree: true });
      }
    }
    if (doc && doc.addEventListener) {
      doc.addEventListener('visibilitychange', function () {
        if (!isOpen) return;
        if (doc.hidden) { if (timer !== null) { cancel(timer); timer = null; } } else refresh();
      });
    }
    if (win && !win.hidden) open();
    return { open: open, close: close, refresh: refresh, songChanged: songChanged, isOpen: function () { return isOpen; }, take: take };
  }

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('win-driveb')) {
    attach(function (id) { return document.getElementById(id); });
  }

  var exported = {
    nodeCell: nodeCell, readAlignment: readAlignment, latticeModel: latticeModel, latticeSvg: latticeSvg,
    parseDrive: parseDrive, titleAt: titleAt, TITLE: TITLE, garble: garble, fileState: fileState, eventLines: eventLines, balloon: balloon,
    attach: attach, READ_ERROR: READ_ERROR, FILE: FILE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseDriveB = exported;
})(typeof window !== 'undefined' ? window : globalThis);
