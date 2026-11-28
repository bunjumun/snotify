/* Lakehorse Radio: the control flow of a sliced upload, with pause and cancel.
 *
 * Split out of library.js so it can be tested in Node: everything that touches
 * the network (one POST of one slice) and the clock (the retry delay) is handed
 * in, so a test can drive it with a fake box. A classic script like the others,
 * for the same reason: it runs in a phone's cut-down captive-portal webview.
 *
 * One song goes as a run of short POSTs, each naming its offset; a slice that
 * fails is sent again from where the card says it is (why slices at all: see
 * library.js). Pause finishes the slice already in flight and then waits, so
 * the .part file on the card stays consistent and Resume carries on from the
 * same offset. Cancel aborts the slice in flight and stops; removing the .part
 * file is the caller's job, because only the caller knows the route.
 */

(function () {
  'use strict';

  var SLICE_BYTES = 256 * 1024;
  var SLICE_TRIES = 10;

  function cancelled() {
    var e = new Error('upload cancelled');
    e.cancelled = true;
    return e;
  }

  /* deps:
   *   post(blob, name, offset, size, onProgress, track) -> Promise<{status, d}>
   *        rejects only when no HTTP answer came; calls track(abortFn) so Cancel
   *        can cut the slice off mid-flight
   *   delay(ms) -> Promise
   *   say(text, kind), megabytes(n)  for the status line
   * Returns {run, pause, resume, cancel, isPaused, isCancelled}. */
  function create(deps) {
    var paused = false;
    var stopped = false;
    var wake = null;        // resolves the wait while paused
    var abortSlice = null;  // cuts off the slice in flight

    function release() { if (wake) { var w = wake; wake = null; w(); } }

    function pause() { if (!stopped) paused = true; }
    function resume() { paused = false; release(); }
    function cancel() {
      stopped = true;
      paused = false;
      if (abortSlice) abortSlice();
      release();
    }

    // Resolves at once unless paused; throws if cancelled while waiting.
    function gate() {
      if (stopped) return Promise.reject(cancelled());
      if (!paused) return Promise.resolve();
      return new Promise(function (resolve) { wake = resolve; }).then(gate);
    }

    function run(blob, name, onProgress, onPaused) {
      var size = blob.size;
      if (size === 0) return Promise.reject(new Error('the file is empty'));
      function giveUp(msg, offset) {
        return new Error(msg + ' (stopped at ' + deps.megabytes(offset) + ' of ' + deps.megabytes(size) + ')');
      }
      function step(offset, failures) {
        var wasPaused = paused;
        if (wasPaused && onPaused) onPaused(true, offset);
        return gate().then(function () {
          if (wasPaused && onPaused) onPaused(false, offset);
          return slice(offset, failures);
        });
      }
      function slice(offset, failures) {
        var end = Math.min(offset + SLICE_BYTES, size);
        function retry(msg, from) {
          if (stopped) throw cancelled();
          if (failures + 1 >= SLICE_TRIES) throw giveUp(msg, offset);
          deps.say(msg + ', retrying from ' + deps.megabytes(from) + '...', '');
          return deps.delay(1000 * (failures + 1)).then(function () { return step(from, failures + 1); });
        }
        return deps.post(blob.slice(offset, end), name, offset, size, function (p) {
          onProgress((offset + p * (end - offset)) / size);
        }, function (abortFn) { abortSlice = abortFn; }).then(function (r) {
          abortSlice = null;
          if (stopped) throw cancelled();
          if (r.status === 200 && r.d.ok) {
            if (typeof r.d.done !== 'boolean') {
              return offset === 0 ? { legacy: true } : Promise.reject(giveUp('unexpected reply from the box', offset));
            }
            if (r.d.done) return r.d;
            return step(end, 0);
          }
          if (r.status === 409 && typeof r.d.received === 'number' && r.d.received < offset) {
            return retry(r.d.error, r.d.received);
          }
          if (r.status === 503) return retry('the box is busy', offset);
          throw new Error(r.d.error || ('the box answered ' + r.status));
        }, function (e) {
          abortSlice = null;
          if (stopped) throw cancelled();
          return retry(e.message, offset);
        });
      }
      return step(0, 0);
    }

    return {
      run: run, pause: pause, resume: resume, cancel: cancel,
      isPaused: function () { return paused; },
      isCancelled: function () { return stopped; }
    };
  }

  var api = { create: create, SLICE_BYTES: SLICE_BYTES, SLICE_TRIES: SLICE_TRIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.LakehorseSlices = api;
})();
