/* Lakehorse Radio: the on-box backend for player.js. NOT BUILT YET (v2).
 *
 * In v2 the box plays songs itself, out of a speaker (Bluetooth A2DP per the
 * v2 list in HANDOFF.md), and the page becomes a remote. This file is the
 * seam for that: it already has the backend shape player.js expects, so
 * when the firmware side exists, only the bodies below change and the page,
 * its buttons and player.js stay as they are.
 *
 * Expected shape once built: each call becomes a request to the box (e.g.
 * POST /api/player/play?name=...), and progress comes back by polling or an
 * event stream. Until then it reports itself unavailable and does nothing.
 */

(function (root) {
  'use strict';

  var NOT_YET = 'Playing on the box itself is not built yet.';

  function create() {
    var events = null;
    return {
      name: 'box',
      available: false,
      connect: function (e) { events = e; },
      play: function () {
        if (events) events.status(NOT_YET);
        return Promise.reject(new Error(NOT_YET));
      },
      pause: function () {},
      resume: function () {},
      seek: function () {},
      setVolume: function () {},
      stop: function () {}
    };
  }

  root.LakehorseBoxPlayer = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
