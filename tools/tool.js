// tool.js — the bar across the top of every tool, injected rather than pasted.
//
// Each tool page carries two lines: this script and tool.css. Everything a
// tool has in common with its siblings — the title bar, the way back to
// Sn'Album, the dazzle mark — comes from here, so the set stays uniform even
// as tools are added or replaced.
//
// The name comes from the page's own <title> (anything before an em dash),
// and the back link carries the band through so you land where you started.
(() => {
  const band = new URLSearchParams(location.search).get('b') || '';
  const home = '../index.html' + (band ? '?b=' + encodeURIComponent(band) : '');
  const name = (document.title || 'Tool').split('—')[0].split('|')[0].trim();

  // A small dazzle chip, generated the same way the site's is: irregular
  // panels, per-panel stripe angles. Self-contained so a tool page does not
  // have to load core.js just to draw a 26px square.
  function mark(seed){
    let a = seed >>> 0;
    const rnd = () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    let g = '';
    for (let i = 0; i < 5; i++){
      const ang = Math.floor(rnd() * 180);
      const x = -20 + rnd() * 40;
      let bars = '';
      for (let w = x; w < 60; w += 2 + rnd() * 7) bars += `<rect x="${w.toFixed(1)}" y="-20" width="${(1 + rnd() * 3).toFixed(1)}" height="80" fill="#fff"/>`;
      g += `<g transform="rotate(${ang} 20 20)" clip-path="url(#m${i})">${bars}</g>`;
    }
    const clips = [0,1,2,3,4].map(i => {
      const x1 = rnd() * 40, x2 = rnd() * 40;
      return `<clipPath id="m${i}"><polygon points="${x1},0 40,0 40,40 ${x2},40"/></clipPath>`;
    }).join('');
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">`
         + `<defs>${clips}</defs><rect width="40" height="40" fill="#08080a"/>${g}</svg>`;
  }

  const bar = document.createElement('div');
  bar.id = 'toolbar';
  bar.innerHTML = `<div class="tb-mark">${mark(name.length * 7919 + name.charCodeAt(0))}</div>`
                + `<h1>${name.replace(/[<>&]/g, '')}</h1>`
                + `<span class="tb-spacer"></span>`
                + `<a class="tb-back" href="${home}">← Sn'Album</a>`;
  const put = () => document.body.insertBefore(bar, document.body.firstChild);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put);
})();
