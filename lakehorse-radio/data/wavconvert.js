/* Lakehorse Radio: WAV conversion and track naming, shared by two pages.
 *
 * Used by the box's own page (library.js, for uploads) and by the song-prep
 * tool (tools/song-prep.html, which writes straight onto the SD card from a
 * computer). One copy, so the two can never disagree about what a stored file
 * looks like.
 *
 * Conversion, default 'wav16': any 24/32-bit PCM or 32/64-bit float WAV is rewritten as plain
 * 16-bit PCM with triangular dither. The band's masters are 24-bit, which is a
 * third bigger than it needs to be and which several phones will not play.
 * Sample rate and channel count are kept: resampling would need the whole file
 * decoded into memory, which a phone cannot do for a seven minute mix, and
 * 48 kHz 16-bit plays everywhere. The source is read a few MB at a time and
 * handed to a sink as it goes, so a 120 MB master never sits in memory whole
 * unless the caller asks for a Blob.
 *
 * Conversion 'wav44': any audio file the browser can decode becomes 44.1 kHz
 * 16-bit stereo WAV, the shape a Bluetooth (A2DP) speaker takes, so the box can
 * one day play it to a speaker with no decoder or resampler of its own. This is
 * song-prep's default. It decodes the whole song in memory, so it is for a
 * computer, not a phone; see the section below.
 *
 * Conversion 'aac': any readable WAV is encoded to AAC at 160 kbps. Small, and
 * fine for playback in a listener's browser, but the box cannot decode it, so
 * it will never play through a speaker attached to the box.
 *
 * Naming: safeName() mirrors src/track_name.cpp exactly. The box serves only a
 * file whose name survives those rules unchanged, so a file saved under any
 * other name would sit on the card and never appear in the player.
 */

(function () {
  'use strict';

  var CHUNK_BYTES = 4 * 1024 * 1024;     // how much of the source to read at a time
  var HEADER_SCAN_BYTES = 256 * 1024;    // where to look for the fmt and data chunks
  var NAME_MAX_LEN = 100;                // cfg::TRACK_FILE_NAME_MAX_LEN
  var AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|opus)$/i;

  function ascii(view, at, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(at + i));
    return s;
  }

  /* Walks the RIFF chunks at the start of the file. Resolves with
   * {format, channels, rate, bits, dataStart, dataBytes}, or null when this is
   * not a WAV we can read. format is 1 for PCM, 3 for float. */
  function readHeader(file) {
    return file.slice(0, HEADER_SCAN_BYTES).arrayBuffer().then(function (buf) {
      var v = new DataView(buf);
      if (buf.byteLength < 12 || ascii(v, 0, 4) !== 'RIFF' || ascii(v, 8, 4) !== 'WAVE') return null;
      var fmt = null;
      var pos = 12;
      while (pos + 8 <= buf.byteLength) {
        var id = ascii(v, pos, 4);
        var size = v.getUint32(pos + 4, true);
        if (id === 'fmt ' && pos + 8 + 16 <= buf.byteLength) {
          var tag = v.getUint16(pos + 8, true);
          // WAVE_FORMAT_EXTENSIBLE hides the real tag in the sub-format GUID.
          if (tag === 0xFFFE && size >= 26) tag = v.getUint16(pos + 8 + 24, true);
          fmt = { format: tag, channels: v.getUint16(pos + 10, true),
                  rate: v.getUint32(pos + 12, true), bits: v.getUint16(pos + 22, true) };
        } else if (id === 'data' && fmt) {
          // A streamed WAV can declare 0 or 0xFFFFFFFF; trust the file length.
          var avail = file.size - (pos + 8);
          fmt.dataStart = pos + 8;
          fmt.dataBytes = (size === 0 || size > avail) ? avail : size;
          return fmt;
        }
        pos += 8 + size + (size & 1);
      }
      return null;
    });
  }

  function needsConversion(h) {
    if (!h || h.channels < 1) return false;
    return (h.format === 1 && (h.bits === 24 || h.bits === 32)) ||
           (h.format === 3 && (h.bits === 32 || h.bits === 64));
  }

  function header16(channels, rate, dataBytes) {
    var b = new ArrayBuffer(44);
    var v = new DataView(b);
    function put(at, s) { for (var i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); }
    put(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); put(8, 'WAVE');
    put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, channels, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true);
    v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, dataBytes, true);
    return b;
  }

  /* One sample to 16 bits with triangular dither, the textbook way to drop bit
   * depth without leaving distortion on quiet tails. `x` is already scaled so
   * that full scale is +-32768. */
  function to16(x) {
    var n = Math.round(x + Math.random() - Math.random());
    return n > 32767 ? 32767 : (n < -32768 ? -32768 : n);
  }

  function convertSamples(view, count, h) {
    var out = new Int16Array(count);
    var i;
    if (h.format === 1 && h.bits === 24) {
      for (i = 0; i < count; i++) {
        var o = i * 3;
        out[i] = to16((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 256);
      }
    } else if (h.format === 1 && h.bits === 32) {
      for (i = 0; i < count; i++) out[i] = to16(view.getInt32(i * 4, true) / 65536);
    } else if (h.format === 3 && h.bits === 32) {
      for (i = 0; i < count; i++) out[i] = to16(view.getFloat32(i * 4, true) * 32768);
    } else if (h.format === 3 && h.bits === 64) {
      for (i = 0; i < count; i++) out[i] = to16(view.getFloat64(i * 8, true) * 32768);
    }
    return out;
  }

  // ---------- AAC ----------
  //
  // Written when the box seemed to send songs at only 40-85 KB/s, below the
  // 176-192 KB/s a 16-bit WAV needs. Later measurements (2026-11-21) found
  // 222-250 KB/s on one connection, and wavstream.js plays WAV over two, so WAV
  // streams fine and AAC is now only the small option for browser playback.
  // AAC at 160 kbps is 20 KB/s and near-transparent. Encoded with the browser's
  // own WebCodecs AudioEncoder in ADTS framing, which is a plain .aac file every
  // browser plays, so no encoder or muxer library is needed.

  // 160 kbps is 20 KB/s. Five one-minute runs from the box measured 25.6, 36,
  // 42, 46 and 46 KB/s (from a Mac on the same Wi-Fi), so 160 keeps at least
  // a quarter in hand in the worst minute and about double typically; the
  // pre-buffer covers the dips. 256 (32 KB/s) and 192 (24 KB/s) did not.
  var AAC_BITRATE = 160000;
  var AAC_QUEUE_MAX = 2;   // encoder inputs allowed to queue before waiting

  function readable(h) {
    return !!h && h.channels >= 1 &&
      ((h.format === 1 && (h.bits === 16 || h.bits === 24 || h.bits === 32)) ||
       (h.format === 3 && (h.bits === 32 || h.bits === 64)));
  }

  /* Interleaved WAV samples to the planar float layout AudioData wants. */
  function toPlanarFloat(view, frames, h) {
    var ch = h.channels;
    var bytes = h.bits >> 3;
    var out = new Float32Array(frames * ch);
    for (var f = 0; f < frames; f++) {
      for (var c = 0; c < ch; c++) {
        var o = (f * ch + c) * bytes;
        var x;
        if (h.format === 1) {
          if (bytes === 2) x = view.getInt16(o, true) / 32768;
          else if (bytes === 3) x = (view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 8388608;
          else x = view.getInt32(o, true) / 2147483648;
        } else {
          x = bytes === 4 ? view.getFloat32(o, true) : view.getFloat64(o, true);
        }
        out[c * frames + f] = x;
      }
    }
    return out;
  }

  function aacConfig(h) {
    return { codec: 'mp4a.40.2', sampleRate: h.rate, numberOfChannels: h.channels,
             bitrate: AAC_BITRATE, aac: { format: 'adts' } };
  }

  /* True when this browser can encode this WAV to AAC. */
  function canEncodeAac(h) {
    if (!readable(h) || typeof AudioEncoder !== 'function') return Promise.resolve(false);
    return AudioEncoder.isConfigSupported(aacConfig(h))
      .then(function (r) { return !!r.supported; }, function () { return false; });
  }

  function encodeAac(file, h, sink, onProgress) {
    var pending = [];
    var failure = null;
    var bytesOut = 0;
    var encoder = new AudioEncoder({
      output: function (chunk) {
        var b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        pending.push(b);
      },
      error: function (e) { failure = e; }
    });
    encoder.configure(aacConfig(h));

    function check() { if (failure) throw failure; }

    // Hands finished frames to the sink in order, one write at a time.
    function drain() {
      var parts = pending;
      pending = [];
      return parts.reduce(function (p, b) {
        return p.then(function () { bytesOut += b.length; return sink(b); });
      }, Promise.resolve());
    }

    function settle() {
      check();
      if (encoder.encodeQueueSize <= AAC_QUEUE_MAX) return drain();
      return new Promise(function (r) { setTimeout(r, 0); }).then(settle);
    }

    var frameBytes = (h.bits >> 3) * h.channels;
    var frames = Math.floor(h.dataBytes / frameBytes);
    var stepFrames = Math.max(1, Math.floor(CHUNK_BYTES / frameBytes));
    var end = h.dataStart + frames * frameBytes;

    function next(frame) {
      if (frame >= frames) return Promise.resolve();
      var n = Math.min(stepFrames, frames - frame);
      var at = h.dataStart + frame * frameBytes;
      return file.slice(at, at + n * frameBytes).arrayBuffer().then(function (buf) {
        check();
        var data = new AudioData({
          format: 'f32-planar', sampleRate: h.rate, numberOfFrames: n,
          numberOfChannels: h.channels, timestamp: Math.round(frame * 1e6 / h.rate),
          data: toPlanarFloat(new DataView(buf), n, h)
        });
        encoder.encode(data);
        data.close();
        onProgress((at + n * frameBytes - h.dataStart) / (end - h.dataStart));
        return settle().then(function () { return next(frame + n); });
      });
    }

    return next(0)
      .then(function () { return encoder.flush(); })
      .then(function () { check(); return drain(); })
      .then(function () {
        encoder.close();
        return { converted: true, codec: 'aac', header: h, bytes: bytesOut };
      }, function (e) {
        try { encoder.close(); } catch (ignored) { /* already closed */ }
        throw e;
      });
  }

  // ---------- WAV 44.1 kHz / 16-bit / stereo ("Bluetooth-ready") ----------
  //
  // One fixed shape for everything on the card, chosen for the box rather than
  // the listener: an A2DP source sends 44.1 kHz 16-bit stereo, so a file
  // already in that shape can go from the card to a speaker with no decoder,
  // no resampler and no channel mixing on the ESP32, which has neither the RAM
  // nor the CPU to spare for them while it is also serving Wi-Fi.
  //
  // The resampling is the browser's, not ours: decodeAudioData on a context
  // running at 44.1 kHz returns the audio already resampled, and it reads MP3,
  // M4A, AAC and Ogg as well as WAV, so every format the card accepts comes out
  // the same. Rendering through an OfflineAudioContext with a 2-channel
  // destination then applies the Web Audio mixing rules (mono becomes L=R,
  // 5.1 folds down), which are better than anything worth writing here.
  //
  // The price is memory: the whole song is decoded at once, about 150 MB for a
  // seven minute mix. That is fine for song-prep on a computer and is why the
  // box's own upload page keeps 'wav16', which streams.
  var BT_RATE = 44100;
  var BT_CHANNELS = 2;
  var BT_BLOCK_FRAMES = 1 << 20;   // frames converted per sink write, ~4 MB out

  /* True when a WAV header is already exactly the Bluetooth shape, so it can be
   * copied rather than decoded and dithered a second time. */
  function isBtReady(h) {
    return !!h && h.format === 1 && h.bits === 16 &&
           h.rate === BT_RATE && h.channels === BT_CHANNELS;
  }

  /* Two float channels to interleaved, dithered 16-bit PCM, for `n` frames
   * starting at `start`. */
  function interleave16(left, right, start, n) {
    var out = new Int16Array(n * 2);
    for (var i = 0; i < n; i++) {
      out[2 * i] = to16(left[start + i] * 32768);
      out[2 * i + 1] = to16(right[start + i] * 32768);
    }
    return out;
  }

  /* The decoded song as a 2-channel AudioBuffer at 44.1 kHz. A stereo decode is
   * used as it is; anything else is rendered through the mixer. */
  function decodeToStereo(bytes) {
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (typeof Offline !== 'function') {
      return Promise.reject(new Error('this browser cannot convert audio; use Chrome or Edge'));
    }
    var probe = new Offline(BT_CHANNELS, 1, BT_RATE);
    return probe.decodeAudioData(bytes).then(function (buf) {
      if (!buf || buf.length === 0) throw new Error('the file has no audio in it');
      if (buf.numberOfChannels === BT_CHANNELS) return buf;
      var mix = new Offline(BT_CHANNELS, buf.length, BT_RATE);
      var src = mix.createBufferSource();
      src.buffer = buf;
      src.connect(mix.destination);
      src.start();
      return mix.startRendering();
    }, function () {
      throw new Error('this browser cannot read this file as audio');
    });
  }

  function encodeBtWav(file, sink, onProgress) {
    return file.arrayBuffer().then(function (bytes) {
      onProgress(0.1);
      return decodeToStereo(bytes);
    }).then(function (buf) {
      onProgress(0.5);
      var left = buf.getChannelData(0);
      var right = buf.getChannelData(1);
      var frames = buf.length;
      var dataBytes = frames * BT_CHANNELS * 2;
      function next(at) {
        if (at >= frames) {
          return { converted: true, codec: 'wav44', bytes: 44 + dataBytes,
                   header: { format: 1, bits: 16, rate: BT_RATE, channels: BT_CHANNELS } };
        }
        var n = Math.min(BT_BLOCK_FRAMES, frames - at);
        return Promise.resolve(sink(interleave16(left, right, at, n))).then(function () {
          onProgress(0.5 + 0.5 * (at + n) / frames);
          return next(at + n);
        });
      }
      return Promise.resolve(sink(header16(BT_CHANNELS, BT_RATE, dataBytes)))
        .then(function () { return next(0); });
    });
  }

  /* Describes what convert() will do, without doing it. */
  function inspect(file) {
    if (!/\.wav$/i.test(file.name)) return Promise.resolve({ header: null, convert: false });
    return readHeader(file).then(function (h) {
      return { header: h, convert: needsConversion(h) };
    });
  }

  /* Feeds the finished file to `sink` piece by piece (an ArrayBuffer, typed
   * array or Blob each time); sink may return a promise to apply backpressure.
   * A file that needs no conversion is passed through as one Blob. Resolves
   * with {converted, codec, header, bytes}.
   *
   * options.format:
   *   'wav16' (default) rewrites deep WAVs as 16-bit WAV at their own rate;
   *   'wav44' turns any audio the browser can read into 44.1 kHz 16-bit
   *           stereo WAV, copying a WAV that is already exactly that;
   *   'aac'   encodes any readable WAV to AAC.
   * Under wav16 and aac, non-WAV files are copied. */
  function convert(file, sink, onProgress, options) {
    onProgress = onProgress || function () {};
    var format = (options && options.format) || 'wav16';
    if (format === 'wav44') {
      return inspect(file).then(function (info) {
        if (!isBtReady(info.header)) return encodeBtWav(file, sink, onProgress);
        return Promise.resolve(sink(file)).then(function () {
          onProgress(1);
          return { converted: false, header: info.header, bytes: file.size };
        });
      });
    }
    if (format === 'aac' && /\.wav$/i.test(file.name)) {
      return readHeader(file).then(function (h) {
        return canEncodeAac(h).then(function (ok) {
          if (!ok) throw new Error('this browser cannot encode this file to AAC; choose WAV instead');
          return encodeAac(file, h, sink, onProgress);
        });
      });
    }
    return inspect(file).then(function (info) {
      if (!info.convert) {
        return Promise.resolve(sink(file)).then(function () {
          onProgress(1);
          return { converted: false, header: info.header, bytes: file.size };
        });
      }
      var h = info.header;
      var sampleBytes = h.bits >> 3;
      var frameBytes = sampleBytes * h.channels;
      var frames = Math.floor(h.dataBytes / frameBytes);
      var step = Math.max(1, Math.floor(CHUNK_BYTES / frameBytes)) * frameBytes;
      var end = h.dataStart + frames * frameBytes;
      var outData = frames * h.channels * 2;

      function next(at) {
        if (at >= end) return { converted: true, header: h, bytes: 44 + outData };
        var to = Math.min(at + step, end);
        return file.slice(at, to).arrayBuffer().then(function (buf) {
          var samples = convertSamples(new DataView(buf), (to - at) / sampleBytes, h);
          return Promise.resolve(sink(samples)).then(function () {
            onProgress((to - h.dataStart) / (end - h.dataStart));
            return next(to);
          });
        });
      }
      return Promise.resolve(sink(header16(h.channels, h.rate, outData)))
        .then(function () { return next(h.dataStart); });
    });
  }

  /* Convenience for uploads and downloads: the whole result as one Blob. */
  function toBlob(file, onProgress, options) {
    var parts = [];
    return convert(file, function (p) { parts.push(p); }, onProgress, options).then(function (r) {
      var type = r.codec === 'aac' ? 'audio/aac' : 'audio/wav';
      return { blob: r.converted ? new Blob(parts, { type: type }) : file,
               note: !r.converted ? '' : r.codec === 'aac' ? 'encoded to AAC'
                                       : r.codec === 'wav44' ? 'converted to 44.1 kHz 16-bit stereo'
                                       : 'converted from ' + r.header.bits + '-bit' };
    });
  }

  /* The name a file is saved under for a given format: under wav44 everything
   * becomes .wav, a WAV encoded to AAC becomes .aac, and otherwise the
   * extension is kept. */
  function outputExtension(name, format) {
    var ext = (String(name).match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (format === 'wav44') return '.wav';
    return format === 'aac' && ext === '.wav' ? '.aac' : ext;
  }

  /* Mirrors trackname::sanitise() in src/track_name.cpp. Returns
   * {ok, name, reason}. */
  function safeName(raw) {
    var base = String(raw || '').split(/[\/\\]/).pop();
    if (!base) return { ok: false, reason: 'the file has no name' };
    if (base.length > NAME_MAX_LEN) return { ok: false, reason: 'the file name is too long' };
    if (base.charAt(0) === '.') return { ok: false, reason: 'hidden files cannot be stored' };
    var clean = base.replace(/[^A-Za-z0-9 ._()\-]/g, '_');
    if (!AUDIO_EXT.test(clean)) {
      return { ok: false, reason: 'only wav, mp3, m4a, aac, ogg and opus files can be stored' };
    }
    return { ok: true, name: clean };
  }

  var api = {
    inspect: inspect,
    convert: convert,
    toBlob: toBlob,
    canEncodeAac: canEncodeAac,
    outputExtension: outputExtension,
    AAC_BITRATE: AAC_BITRATE,
    safeName: safeName,
    NAME_MAX_LEN: NAME_MAX_LEN,
    // Exposed for test/wavconvert.test.js; the pages do not use these.
    isBtReady: isBtReady,
    interleave16: interleave16,
    header16: header16,
    BT_RATE: BT_RATE
  };
  // Node runs the tests; the browser gets the global, as before.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.LakehorseWav = api;
})();
