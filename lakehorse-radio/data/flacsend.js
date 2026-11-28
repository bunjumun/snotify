/* Lakehorse Radio: turns the converted 16-bit WAV into FLAC for the trip.
 *
 * The box's Wi-Fi is the slow part of an upload (about 36 KB/s), and FLAC is
 * lossless, so the box can give back exactly the WAV that left this page: it
 * decodes the .flac once the transfer is done (src/flac_convert.cpp). If the
 * encoder cannot load or the result is not smaller, the WAV goes as it is, so
 * a song is never refused over this.
 *
 * The encoder (libflac.js, about 84 KB gzipped) is loaded only when an upload
 * starts: every visitor would otherwise download it with the page.
 */

(function () {
  'use strict';

  var CHUNK_BYTES = 1024 * 1024;     // WAV bytes read and encoded per round
  var HEADER_SCAN_BYTES = 64 * 1024;
  var ENCODER_SCRIPT = 'libflac.min.wasm.js';

  function u32(v, o) { return v.getUint32(o, true); }
  function u16(v, o) { return v.getUint16(o, true); }

  /* {rate, channels, dataStart, dataBytes} for a 16-bit PCM WAV, else null. */
  function parseWav(buf) {
    var v = new DataView(buf);
    if (buf.byteLength < 44 || u32(v, 0) !== 0x46464952 || u32(v, 8) !== 0x45564157) return null;
    var fmt = null;
    var pos = 12;
    while (pos + 8 <= buf.byteLength) {
      var id = u32(v, pos), size = u32(v, pos + 4);
      if (id === 0x20746d66 && pos + 24 <= buf.byteLength) {        // 'fmt '
        fmt = { tag: u16(v, pos + 8), channels: u16(v, pos + 10), rate: u32(v, pos + 12), bits: u16(v, pos + 22) };
      } else if (id === 0x61746164) {                                // 'data'
        if (!fmt || fmt.tag !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.channels > 2) return null;
        return { rate: fmt.rate, channels: fmt.channels, dataStart: pos + 8, dataBytes: size };
      }
      pos += 8 + size + (size & 1);
    }
    return null;
  }

  var loading = null;
  /* Resolves with the ready libflac global, loading its script once. */
  function loadEncoder() {
    if (window.Flac) return window.LakehorseFlacEncode.ready(window.Flac);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = ENCODER_SCRIPT;
        s.onload = resolve;
        s.onerror = function () { loading = null; reject(new Error('the FLAC encoder did not load')); };
        document.body.appendChild(s);
      });
    }
    return loading.then(function () { return window.LakehorseFlacEncode.ready(window.Flac); });
  }

  /* Encodes `wav` (a Blob) to FLAC. Resolves {blob, name} or, when FLAC is not
   * possible or not smaller, {blob: wav, name} unchanged with `fallback` set.
   * `load` is injectable for tests. */
  function fromWav(wav, name, onProgress, load) {
    var enc = window.LakehorseFlacEncode;
    var unchanged = function () { return { blob: wav, name: name, fallback: true }; };
    return wav.slice(0, HEADER_SCAN_BYTES).arrayBuffer().then(function (head) {
      var h = parseWav(head);
      if (!h || h.dataBytes === 0) return unchanged();
      var frameBytes = h.channels * 2;
      var dataBytes = Math.min(h.dataBytes, wav.size - h.dataStart);
      dataBytes -= dataBytes % frameBytes;
      return (load || loadEncoder)().then(function (Flac) {
        var parts = [];
        var e = enc.create(Flac, {
          rate: h.rate, channels: h.channels, totalFrames: dataBytes / frameBytes,
          sink: function (b) { parts.push(b); }
        });
        function next(done) {
          if (done >= dataBytes) return e.finish();
          var n = Math.min(CHUNK_BYTES - (CHUNK_BYTES % frameBytes), dataBytes - done);
          return wav.slice(h.dataStart + done, h.dataStart + done + n).arrayBuffer().then(function (ab) {
            return e.write(new Int16Array(ab));
          }).then(function () {
            if (onProgress) onProgress((done + n) / dataBytes);
            return next(done + n);
          });
        }
        return next(0).then(function () {
          var blob = new Blob(parts, { type: 'audio/flac' });
          if (blob.size >= wav.size) return unchanged();
          return { blob: blob, name: name.replace(/\.[^.]*$/, '') + '.flac', fallback: false };
        });
      });
    }).catch(function () { return unchanged(); });
  }

  var api = { fromWav: fromWav, parseWav: parseWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.LakehorseFlacSend = api;
})();
