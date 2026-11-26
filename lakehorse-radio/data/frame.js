/* Lakehorse Radio: the shared window frame, built once.
 *
 * Every window (.win) gets the same two title-bar controls from here, so no
 * window's markup repeats them and a new window gets them for free:
 *   * a "?" button, which turns on What's this? mode (help.js), and
 *   * a skull on the close button, drawn inline as SVG in the bone colour.
 * The close button keeps its 44 px target and an aria-label of "Close"
 * (the window's name is added for screen readers). Nothing here fetches.
 */
(function (root) {
  'use strict';

  // The skull from the Drive B mockup (design-ref/Drive.dc.html).
  var SKULL = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" style="display:block;margin:auto">'
    + '<path d="M12 2.5c-4.7 0-8 3.2-8 7.6 0 2.5 1.1 4.3 2.6 5.4v2.6c0 .8.6 1.4 1.4 1.4h8c.8 0 1.4-.6 1.4-1.4v-2.6c1.5-1.1 2.6-2.9 2.6-5.4 0-4.4-3.3-7.6-8-7.6z" fill="#e9e5d6"/>'
    + '<ellipse cx="8.7" cy="10.6" rx="2.2" ry="2.4" fill="#0c0e0d"/><ellipse cx="15.3" cy="10.6" rx="2.2" ry="2.4" fill="#0c0e0d"/>'
    + '<path d="M12 13.2l-1.2 2.2h2.4z" fill="#0c0e0d"/>'
    + '<path d="M9.6 17.2v2.3M12 17.2v2.3M14.4 17.2v2.3" stroke="#0c0e0d" stroke-width="1.1" stroke-linecap="round"/></svg>';

  // Pure: the aria-label for a window's close button.
  function closeLabel(title) { return title ? 'Close ' + title : 'Close'; }

  function decorate(doc) {
    var bars = doc.querySelectorAll('.win-title');
    Array.prototype.forEach.call(bars, function (bar) {
      var x = bar.querySelector('.win-x');
      if (x) {
        x.innerHTML = SKULL;
        var win = bar.parentNode;
        var name = win && win.dataset ? win.dataset.title : '';
        x.setAttribute('aria-label', closeLabel(name));
      }
      if (!bar.querySelector('.win-help')) {
        var q = doc.createElement('button');
        q.type = 'button';
        q.className = 'win-help';
        q.setAttribute('data-help', 'whatsthis');
        q.setAttribute('aria-label', "What's this?");
        q.textContent = '?';
        bar.insertBefore(q, x || null);
      }
    });
  }

  if (typeof document !== 'undefined' && document.querySelectorAll) decorate(document);

  var exported = { SKULL: SKULL, closeLabel: closeLabel, decorate: decorate };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehouseFrame = exported;
})(typeof window !== 'undefined' ? window : globalThis);
