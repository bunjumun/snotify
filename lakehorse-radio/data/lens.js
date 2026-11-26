/* Lakehorse Radio: the screen look switch (tube or clean).
 *
 * The tube look (scanlines, fringing, noise, rim, rolling band) is all CSS
 * on a few inline layers in index.html. This file only remembers which look
 * the visitor wants, on this phone, and sets or clears the `lens-clean`
 * class on <html>, which hides every layer. Nothing is fetched.
 */
(function (root) {
  'use strict';

  var KEY = 'lakehorse.lens';

  // Pure: the stored text to a look. Anything unknown is the default, tube.
  function parseLook(text) { return text === 'clean' ? 'clean' : 'tube'; }
  function otherLook(look) { return look === 'clean' ? 'tube' : 'clean'; }
  function labelFor(look) { return 'Screen: ' + look; }

  function attach(el, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var store = opts.storage;
    function read() { try { return parseLook((store || root.localStorage).getItem(KEY)); } catch (e) { return 'tube'; } }
    function write(look) { try { (store || root.localStorage).setItem(KEY, look); } catch (e) { /* not remembered */ } }
    var look = read();
    function apply() {
      doc.documentElement.classList.toggle('lens-clean', look === 'clean');
      var b = el('startLens');
      if (b) { b.textContent = labelFor(look); b.setAttribute('aria-pressed', look === 'clean' ? 'true' : 'false'); }
    }
    apply();
    var b = el('startLens');
    if (b) b.addEventListener('click', function () { look = otherLook(look); write(look); apply(); });
    return { look: function () { return look; }, toggle: function () { look = otherLook(look); write(look); apply(); } };
  }

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('startLens')) {
    attach(function (id) { return document.getElementById(id); });
  }

  var exported = { parseLook: parseLook, otherLook: otherLook, labelFor: labelFor, attach: attach, KEY: KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseLens = exported;
})(typeof window !== 'undefined' ? window : globalThis);
