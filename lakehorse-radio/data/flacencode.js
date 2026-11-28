/* Lakehorse Radio: 16-bit PCM to FLAC in the browser.
 *
 * Why: the barn Wi-Fi is the bottleneck for uploads, and FLAC is about half the
 * size of the WAV it came from. Chrome cannot do this itself (checked
 * 2026-11-27: AudioEncoder.isConfigSupported({codec:'flac'}) is false), so this
 * wraps libflac.js (libflac.min.wasm.js + .wasm, MIT, from libflacjs 5.6.0,
 * about 84 KB gzipped together).
 *
 * It only ever sees the finished shape, 16-bit PCM at whatever rate and channel
 * count wavconvert.js produced. Sample rate conversion and mixing stay in
 * wavconvert.js; FLAC is lossless, so the box gets back exactly those samples.
 *
 * The library is injected (`Flac`), so Node tests can run the same code the page
 * does. Output goes to a sink piece by piece, with the same back-pressure shape
 * as wavconvert.convert().
 */

(function () {
  'use strict';

  var DEFAULT_LEVEL = 5;   // libFLAC's own default: fast, within ~1% of level 8 on music
  var BITS = 16;

  /* Resolves with the ready library: the global in a browser, or the argument. */
  function ready(Flac) {
    if (!Flac) return Promise.reject(new Error('the FLAC encoder did not load'));
    if (Flac.isReady()) return Promise.resolve(Flac);
    return new Promise(function (resolve) {
      Flac.on('ready', function () { resolve(Flac); });
    });
  }

  /* Encodes interleaved Int16 chunks. Returns {write(Int16Array), finish()}.
   * opts: {rate, channels, totalFrames, level, sink}. totalFrames, when known,
   * goes into the header so a decoder knows the length without reading to the end. */
  function create(Flac, opts) {
    var level = opts.level === undefined ? DEFAULT_LEVEL : opts.level;
    var enc = Flac.create_libflac_encoder(opts.rate, opts.channels, BITS, level,
                                          opts.totalFrames || 0, false, 0);
    if (!enc) throw new Error('could not start the FLAC encoder');
    var failure = null;
    var bytesOut = 0;
    var pieces = [];
    var status = Flac.init_encoder_stream(enc, function (data) {
      var copy = new Uint8Array(data);      // the library reuses its buffer
      bytesOut += copy.length;
      pieces.push(copy);
    });
    if (status !== 0) {
      Flac.FLAC__stream_encoder_delete(enc);
      throw new Error('could not start the FLAC encoder (status ' + status + ')');
    }

    function drain() {
      var parts = pieces;
      pieces = [];
      return parts.reduce(function (p, b) {
        return p.then(function () { return opts.sink(b); });
      }, Promise.resolve());
    }

    return {
      write: function (samples) {
        if (failure) return Promise.reject(failure);
        var wide = new Int32Array(samples.length);   // libFLAC wants 32-bit slots
        for (var i = 0; i < samples.length; i++) wide[i] = samples[i];
        if (!Flac.FLAC__stream_encoder_process_interleaved(enc, wide, samples.length / opts.channels)) {
          failure = new Error('the FLAC encoder failed (state ' + Flac.FLAC__stream_encoder_get_state(enc) + ')');
          return Promise.reject(failure);
        }
        return drain();
      },
      finish: function () {
        var ok = Flac.FLAC__stream_encoder_finish(enc);
        Flac.FLAC__stream_encoder_delete(enc);
        if (!ok && !failure) failure = new Error('the FLAC encoder could not finish');
        if (failure) return Promise.reject(failure);
        return drain().then(function () { return { bytes: bytesOut }; });
      }
    };
  }

  var api = { ready: ready, create: create, DEFAULT_LEVEL: DEFAULT_LEVEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.LakehorseFlacEncode = api;
})();
