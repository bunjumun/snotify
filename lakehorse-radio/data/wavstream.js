/* Lakehorse Radio: plays a WAV off the box over two connections at once.
 *
 * Why this exists. One HTTP connection from the box tops out around
 * 100-130 KB/s (measured 2026-11-21, Mac on the same Wi-Fi), and a 16-bit
 * stereo WAV needs 176 KB/s at 44.1 kHz or 192 KB/s at 48 kHz. An <audio>
 * element only ever uses one connection, so a WAV drains any cushion and
 * stalls: 9.5 s to start, then a stall at 90 s that outlasted 30 s. Two
 * connections in parallel measured 190-300 KB/s together, which is enough.
 * A third is refused by the box (503, out of heap for its read buffer), so
 * PARALLEL stays at 2.
 *
 * So for WAVs the page fetches the data in fixed-size byte ranges, two at a
 * time, turns each range of 16-bit PCM into an AudioBuffer and schedules them
 * back to back on one AudioContext. AAC files are small enough for <audio>
 * and do not come through here.
 *
 * Stalls are handled like buffering.js: hold until START_SECONDS is ready,
 * and if the data runs dry, suspend the context (which freezes its clock, so
 * everything already scheduled stays in place), double the cushion, resume.
 *
 * When a song is fully downloaded the next one's opening seconds are fetched,
 * so the next song starts without a wait.
 */

(function (root) {
  'use strict';

  var PARALLEL = 2;              // the box refuses a third concurrent stream
  var CHUNK_FRAMES = 65536;      // ~1.5 s per range at 44.1 kHz
  var HEADER_BYTES = 65536;      // enough for fmt + any LIST chunk before data
  var START_SECONDS = 4;         // cushion before a song starts
  var MAX_SECONDS = 64;          // largest cushion after repeated stalls
  var FETCH_AHEAD_SECONDS = 120; // never download further ahead than this
  var SCHEDULE_AHEAD_SECONDS = 6;// AudioBuffers built ahead of the playhead
  var LOW_WATER_SECONDS = 0.3;   // less than this scheduled = a stall
  var TICK_MS = 200;
  var RETRY_MS = 600;
  var RUNNING_WAIT_MS = 2000;   // how long a context may take to start before we give up on it
  var MAX_RETRIES = 8;

  /* ---- pure helpers (tested in test/wavstream.test.js) ---- */

  function ascii(view, at) {
    return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1),
                               view.getUint8(at + 2), view.getUint8(at + 3));
  }

  /* Reads a RIFF/WAVE header. Returns null for anything this player cannot
   * stream: only 16-bit integer PCM is handled (what song-prep writes). */
  function parseWavHeader(buffer, fileSize) {
    var view = new DataView(buffer);
    if (view.byteLength < 12 || ascii(view, 0) !== 'RIFF' || ascii(view, 8) !== 'WAVE') return null;
    var fmt = null;
    var at = 12;
    while (at + 8 <= view.byteLength) {
      var id = ascii(view, at);
      var size = view.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 24 <= view.byteLength) {
        fmt = {
          format: view.getUint16(at + 8, true),
          channels: view.getUint16(at + 10, true),
          sampleRate: view.getUint32(at + 12, true),
          blockAlign: view.getUint16(at + 20, true),
          bits: view.getUint16(at + 22, true)
        };
      } else if (id === 'data') {
        if (!fmt) return null;
        var isPcm = fmt.format === 1 || fmt.format === 0xFFFE;
        if (!isPcm || fmt.bits !== 16 || fmt.channels < 1 || fmt.blockAlign !== 2 * fmt.channels) return null;
        var dataStart = at + 8;
        var dataEnd = dataStart + size;
        if (fileSize && dataEnd > fileSize) dataEnd = fileSize;   // a header that overstates
        dataEnd -= (dataEnd - dataStart) % fmt.blockAlign;
        return {
          channels: fmt.channels,
          sampleRate: fmt.sampleRate,
          blockAlign: fmt.blockAlign,
          dataStart: dataStart,
          dataEnd: dataEnd,
          chunkBytes: CHUNK_FRAMES * fmt.blockAlign,
          chunkSeconds: CHUNK_FRAMES / fmt.sampleRate,
          chunkCount: Math.ceil((dataEnd - dataStart) / (CHUNK_FRAMES * fmt.blockAlign)),
          duration: (dataEnd - dataStart) / fmt.blockAlign / fmt.sampleRate
        };
      }
      at += 8 + size + (size & 1);
    }
    return null;
  }

  /* Byte range [first, last] (inclusive, as HTTP wants it) of chunk i. */
  function chunkRange(info, i) {
    var first = info.dataStart + i * info.chunkBytes;
    var last = Math.min(first + info.chunkBytes, info.dataEnd) - 1;
    return [first, last];
  }

  /* Interleaved little-endian int16 -> one Float32Array per channel. */
  function pcm16ToChannels(buffer, channels) {
    var samples = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2));
    var frames = Math.floor(samples.length / channels);
    var out = [];
    for (var c = 0; c < channels; c++) out.push(new Float32Array(frames));
    for (var f = 0, s = 0; f < frames; f++) {
      for (var ch = 0; ch < channels; ch++, s++) out[ch][f] = samples[s] / 32768;
    }
    return out;
  }

  function totalFromContentRange(header) {
    var m = /\/(\d+)\s*$/.exec(header || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  /* ---- network ---- */

  function fetchRange(url, first, last, signal) {
    return fetch(url, { headers: { Range: 'bytes=' + first + '-' + last }, cache: 'no-store', signal: signal })
      .then(function (r) {
        if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer().then(function (buf) {
          return { buf: buf, total: totalFromContentRange(r.headers.get('Content-Range')) };
        });
      });
  }

  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  /* Retries a chunk: the box answers 503 when its heap is briefly short. */
  function fetchRangeRetrying(url, first, last, signal, tries) {
    return fetchRange(url, first, last, signal).catch(function (err) {
      if (signal.aborted || (tries || 0) >= MAX_RETRIES) throw err;
      return wait(RETRY_MS).then(function () {
        return fetchRangeRetrying(url, first, last, signal, (tries || 0) + 1);
      });
    });
  }

  function loadHeader(url, signal) {
    return fetchRangeRetrying(url, 0, HEADER_BYTES - 1, signal).then(function (res) {
      var info = parseWavHeader(res.buf, res.total);
      if (!info) throw new Error('not a 16-bit PCM WAV');
      return info;
    });
  }

  /* A song being downloaded: chunks by index, fetched PARALLEL at a time, never
   * further than FETCH_AHEAD_SECONDS past `want` (the next chunk to play). */
  function Download(url, info, firstChunk, limitChunks) {
    this.url = url;
    this.info = info;
    this.chunks = new Map();
    this.next = firstChunk;        // next chunk index to request
    this.want = firstChunk;        // next chunk index the player needs
    this.limit = limitChunks || Infinity;
    this.inFlight = 0;
    this.failed = false;
    this.ctrl = new AbortController();
    this.onChunk = null;
  }

  Download.prototype.done = function () {
    return this.next >= this.info.chunkCount && this.inFlight === 0;
  };

  Download.prototype.pump = function () {
    var self = this;
    var aheadChunks = Math.ceil(FETCH_AHEAD_SECONDS / this.info.chunkSeconds);
    while (!this.ctrl.signal.aborted && this.inFlight < PARALLEL &&
           this.next < this.info.chunkCount && this.next < this.want + aheadChunks &&
           this.next < this.limit) {
      (function (i) {
        var r = chunkRange(self.info, i);
        self.inFlight++;
        self.next++;
        fetchRangeRetrying(self.url, r[0], r[1], self.ctrl.signal).then(function (res) {
          self.inFlight--;
          self.chunks.set(i, res.buf);
          self.pump();
          if (self.onChunk) self.onChunk();
        }, function () {
          self.inFlight--;
          if (!self.ctrl.signal.aborted) { self.failed = true; if (self.onChunk) self.onChunk(); }
        });
      })(this.next);
    }
  };

  /* Seconds of audio downloaded contiguously from chunk `from`. */
  Download.prototype.readySeconds = function (from) {
    var n = 0;
    while (this.chunks.has(from + n)) n++;
    return n * this.info.chunkSeconds;
  };

  Download.prototype.abort = function () { this.ctrl.abort(); };

  /* ---- player ---- */

  /* hooks: status(text), ended(), progress(position, duration, playing) */
  function createPlayer(hooks) {
    var ctx = null;
    var out = null;
    var dl = null;              // current Download
    var prefetched = null;      // { url, dl } opening of the next song
    var nextUrl = null;         // what to prefetch once dl is complete
    var sources = [];
    var schedIndex = 0;         // next chunk to turn into an AudioBuffer
    var schedTime = 0;          // context time where that chunk starts
    var baseIndex = 0;          // chunk the clock was anchored at
    var baseTime = 0;           // context time chunk baseIndex started
    var target = START_SECONDS;
    var state = 'idle';         // idle | holding | playing | paused | ended
    var generation = 0;
    var timer = null;
    var volume = 1;             // applied when the context is first made

    function ensureContext() {
      if (ctx) return;
      var AC = root.AudioContext || root.webkitAudioContext;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = volume;
      out.connect(ctx.destination);
    }

    /* Older iOS unlocks a context only once a sound has been started inside
     * the tap, so start one sample of silence there. Harmless elsewhere. */
    function unlock() {
      try {
        var src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(out);
        src.start(0);
      } catch (e) { /* nothing to unlock with; whenRunning() decides */ }
    }

    /* Resolves once the context runs, rejects if it is still not running
     * after RUNNING_WAIT_MS. resume() may return nothing on old WebKit. */
    function whenRunning(resumed) {
      if (ctx.state === 'running') return Promise.resolve();
      var waited = new Promise(function (r) { setTimeout(r, RUNNING_WAIT_MS); });
      return Promise.race([Promise.resolve(resumed), waited]).then(function () {
        if (ctx.state === 'running') return;
        return waited.then(function () {
          if (ctx.state !== 'running') throw new Error('Web Audio will not start (' + ctx.state + ')');
        });
      });
    }

    function stopSources() {
      sources.forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) { /* already stopped */ } });
      sources = [];
    }

    function position() {
      if (!dl) return 0;
      var p = baseIndex * dl.info.chunkSeconds + Math.max(0, ctx.currentTime - baseTime);
      if (state === 'holding' && schedIndex === baseIndex) p = baseIndex * dl.info.chunkSeconds;
      return Math.min(p, dl.info.duration);
    }

    function scheduledAhead() { return state === 'holding' && schedIndex === baseIndex ? 0 : schedTime - ctx.currentTime; }

    function scheduleReady() {
      var info = dl.info;
      // If the schedule ran fully dry (a stall noticed late), restart it just
      // ahead of now; a start time in the past would overlap the next chunk.
      var late = ctx.currentTime + 0.02 - schedTime;
      if (late > 0 && dl.chunks.has(schedIndex)) { schedTime += late + 0.03; baseTime += late + 0.03; }
      while (dl.chunks.has(schedIndex) && schedTime - ctx.currentTime < SCHEDULE_AHEAD_SECONDS) {
        var raw = dl.chunks.get(schedIndex);
        dl.chunks.delete(schedIndex);
        var chans = pcm16ToChannels(raw, info.channels);
        var buf = ctx.createBuffer(info.channels, chans[0].length, info.sampleRate);
        for (var c = 0; c < info.channels; c++) buf.getChannelData(c).set(chans[c]);
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(out);
        src.start(schedTime);
        var isLast = schedIndex === info.chunkCount - 1;
        src.onended = onSourceEnded(src, isLast, generation);
        sources.push(src);
        schedTime += buf.duration;
        schedIndex++;
        dl.want = schedIndex;
      }
      dl.pump();
    }

    function onSourceEnded(src, isLast, gen) {
      return function () {
        sources = sources.filter(function (s) { return s !== src; });
        if (isLast && gen === generation && state === 'playing') {
          state = 'ended';
          report();
          hooks.ended();
        }
      };
    }

    function report() {
      if (!dl) return;
      hooks.progress(position(), dl.info.duration, state === 'playing' || state === 'holding');
    }

    function release() {
      // Anchor the clock: the first unscheduled chunk starts a moment from now.
      if (schedIndex === baseIndex) {
        schedTime = ctx.currentTime + 0.05;
        baseTime = schedTime;
      }
      state = 'playing';
      hooks.status('');
      scheduleReady();
      if (ctx.state !== 'running') ctx.resume();
    }

    function hold(grow) {
      if (grow) target = Math.min(MAX_SECONDS, target * 2);
      state = 'holding';
      if (ctx.state === 'running' && schedIndex !== baseIndex) ctx.suspend();
    }

    function tick() {
      if (!dl) return;
      if (dl.failed) {
        hooks.status('Lost the connection to the box.');
        state = 'paused';
        ctx.suspend();
      }
      if (state === 'playing') {
        scheduleReady();
        var allScheduled = schedIndex >= dl.info.chunkCount;
        if (!allScheduled && scheduledAhead() < LOW_WATER_SECONDS) hold(true);
      }
      if (state === 'holding') {
        var ready = Math.max(0, scheduledAhead()) + dl.readySeconds(schedIndex);
        var restLeft = (dl.info.chunkCount - schedIndex) * dl.info.chunkSeconds;
        if (ready >= Math.min(target, restLeft - 0.01) || (dl.done() && dl.chunks.has(schedIndex))) release();
        else hooks.status('Buffering ' + Math.floor(ready) + ' of ' + target + ' s');
      }
      maybePrefetch();
      report();
    }

    function maybePrefetch() {
      if (!nextUrl || !dl.done() || (prefetched && prefetched.url === nextUrl)) return;
      if (prefetched && prefetched.dl) prefetched.dl.abort();
      var slot = { url: nextUrl, dl: null };
      prefetched = slot;
      loadHeader(slot.url, new AbortController().signal).then(function (info) {
        if (prefetched !== slot) return;
        slot.dl = new Download(slot.url, info, 0, Math.ceil((START_SECONDS + 2) / info.chunkSeconds));
        slot.dl.pump();
      }).catch(function () { if (prefetched === slot) prefetched = null; });
    }

    function begin(url, info, startChunk, adopted) {
      generation++;
      stopSources();
      if (dl && dl !== adopted) dl.abort();
      dl = adopted || new Download(url, info, startChunk);
      dl.limit = Infinity;
      dl.want = startChunk;
      dl.onChunk = tick;
      schedIndex = baseIndex = startChunk;
      target = START_SECONDS;
      state = 'holding';
      dl.pump();
      if (ctx.state !== 'running') ctx.resume();
      clearInterval(timer);
      timer = setInterval(tick, TICK_MS);
      tick();
    }

    return {
      /* Call inside a tap the first time: iOS only unlocks audio there.
       * Rejects if the context will not run (iOS refusing it), so the caller
       * can fall back to an <audio> element instead of playing silence. */
      start: function (url) {
        ensureContext();
        unlock();
        var resumed = ctx.resume();
        var gen = ++generation;
        stopSources();
        if (dl) dl.abort();
        dl = null;
        hooks.status('Starting...');
        return whenRunning(resumed).then(function () {
          if (gen !== generation) return false;
          if (prefetched && prefetched.url === url && prefetched.dl) {
            var p = prefetched;
            prefetched = null;
            begin(url, p.dl.info, 0, p.dl);
            return true;
          }
          if (prefetched && prefetched.dl) prefetched.dl.abort();
          prefetched = null;
          return loadHeader(url, new AbortController().signal).then(function (info) {
            if (gen !== generation) return false;
            begin(url, info, 0, null);
            return true;
          });
        });
      },
      seek: function (seconds) {
        if (!dl) return;
        var info = dl.info;
        var i = Math.max(0, Math.min(info.chunkCount - 1, Math.floor(seconds / info.chunkSeconds)));
        begin(dl.url, info, i, null);
      },
      pause: function () {
        if (!dl || state === 'paused' || state === 'ended') return;
        state = 'paused';
        ctx.suspend();
        hooks.status('');
        report();
      },
      resume: function () {
        if (!dl) return;
        if (state === 'ended') { this.seek(0); return; }
        if (state !== 'paused') return;
        state = 'playing';
        dl.failed = false;
        dl.pump();
        ctx.resume();
        tick();
      },
      toggle: function () {
        if (state === 'paused' || state === 'ended') this.resume();
        else this.pause();
      },
      /* 0 to 1. Kept across songs because the gain node outlives them. */
      setVolume: function (v) {
        volume = v;
        if (out) out.gain.value = v;
      },
      stop: function () {
        generation++;
        clearInterval(timer);
        stopSources();
        if (dl) dl.abort();
        dl = null;
        state = 'idle';
      },
      setNext: function (url) { nextUrl = url; },
      isWav: function (name) { return /\.wav$/i.test(name); }
    };
  }

  var api = {
    createPlayer: createPlayer,
    parseWavHeader: parseWavHeader,
    chunkRange: chunkRange,
    pcm16ToChannels: pcm16ToChannels,
    totalFromContentRange: totalFromContentRange,
    CHUNK_FRAMES: CHUNK_FRAMES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LakehorseWavStream = api;
})(typeof window !== 'undefined' ? window : globalThis);
