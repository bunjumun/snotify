// tool.js — the bar across the top of every tool, injected rather than pasted.
//
// Each tool page carries two lines: this script and tool.css. Everything a
// tool has in common with its siblings — the title bar, the way back to
// Sn'Album, the dazzle mark — comes from here, so the set stays uniform even
// as tools are added or replaced.
//
// The name comes from the page's own <title> (anything before an em dash),
// and the back link carries the band through so you land where you started.
//
// The bar also carries "Offline copy", for anyone, not only an admin: it
// fetches this page's own source (not the live DOM, which holds the bar and
// whatever state the tool is in), swaps every stylesheet and script it
// references for the file's contents, and saves the result as one HTML file
// that needs nothing else. That covers tool.css, tool.js and the two CDN
// libraries the ZIP tools use. A copy flags itself with window.MPF_OFFLINE, so
// its bar has no Offline button and its way back points at the live site. A tool
// can also pass data into its copy (window.__mpfOfflineData); see buildOffline.
(() => {
  const OFFLINE = window.MPF_OFFLINE || null;
  const band = new URLSearchParams(location.search).get('b') || '';
  // The way back is worked out from where THIS script lives, not from the page
  // that loaded it. A page in tools/ gets the same answer either way, but the
  // frozen V.1 and V.2 sit in archive/tools-v1/, where '../index.html' would
  // point at a file that does not exist. currentScript is still set for a
  // deferred classic script while it runs; the plain path is the fallback.
  const here = document.currentScript && document.currentScript.src;
  const index = OFFLINE ? OFFLINE.index : here ? new URL('../index.html', here).href : '../index.html';
  const home = index + (band ? '?b=' + encodeURIComponent(band) : '');
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

  // ---- Offline copy ----
  // "VJ Mixer V.1" -> vj-mixer-v1.html. The version has to be in the name,
  // because V.2 and V.3 are both a file called visualizer.html.
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tool';

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url.split('?')[0].split('/').pop() + ' ' + r.status);
    return r.text();
  }

  async function buildOffline() {
    const pageUrl = location.href.split('#')[0];
    let html = await fetchText(pageUrl);
    const parts = [];
    const rx = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>|<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>/gi;
    let m;
    while ((m = rx.exec(html))) {
      const url = (m[0].match(/\b(?:href|src)=["']([^"']+)["']/i) || [])[1];
      if (url && !/^data:/i.test(url)) parts.push({ tag: m[0], url: new URL(url, pageUrl).href, css: /^<link/i.test(m[0]) });
    }
    const bodies = await Promise.all(parts.map(p => fetchText(p.url)));
    // Replacements go through a function: minified libraries are full of "$&" and "$1".
    parts.forEach((p, i) => {
      const code = bodies[i];
      const inline = p.css
        ? '<style>\n' + code.replace(/<\/style/gi, '<\\/style') + '\n</style>'
        : '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
      html = html.replace(p.tag, () => inline);
    });
    const flag = '<script>window.MPF_OFFLINE=' + JSON.stringify({ index, from: pageUrl, saved: new Date().toISOString().slice(0, 10) }).replace(/</g, '\\u003c') + ';</script>';
    // A tool can hand over data to carry in the copy (the FX tool's saved presets) by
    // defining window.__mpfOfflineData; the copy reads it back from window.MPF_OFFLINE_DATA.
    let extra = {};
    try { extra = (typeof window.__mpfOfflineData === 'function' && window.__mpfOfflineData()) || {}; } catch (e) {}
    const data = '<script>window.MPF_OFFLINE_DATA=' + JSON.stringify(extra).replace(/</g, '\\u003c') + ';</script>';
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, h => h + '\n' + flag + '\n' + data) : flag + data + html;
    const note = '<!-- Offline copy of "' + name.replace(/-->/g, '') + '", saved from ' + location.origin + location.pathname + ' on ' + new Date().toISOString().slice(0, 10) + '. Everything it needs is in this file. -->\n';
    return html.replace(/<html/i, h => note + h);
  }
  window.__mpfOffline = { build: buildOffline, slug };       // also what the tests drive

  const DL_TIP = 'Download this tool as one HTML file that runs offline, with nothing else to install.';
  async function saveOffline(btn) {
    const label = btn.querySelector('.tb-dl-t');
    const say = (t, tip) => { label.textContent = t; btn.title = tip || DL_TIP; };
    btn.disabled = true; say('Saving…');
    try {
      const url = URL.createObjectURL(new Blob([await buildOffline()], { type: 'text/html' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: slug + '.html' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('Saved');
    } catch (err) {
      console.warn('Offline copy failed:', err);
      say('Could not save', 'Could not gather every part of this tool (' + err.message + '). Check the connection and try again.');
    }
    setTimeout(() => { btn.disabled = false; say('Offline copy'); }, 2500);
  }

  const bar = document.createElement('div');
  bar.id = 'toolbar';
  bar.innerHTML = `<div class="tb-mark">${mark(name.length * 7919 + name.charCodeAt(0))}</div>`
                + `<h1>${name.replace(/[<>&]/g, '')}</h1>`
                + `<span class="tb-spacer"></span>`
                + (OFFLINE ? '' : `<button type="button" class="tb-dl" title="${DL_TIP}"><span class="tb-dl-i">⤓</span><span class="tb-dl-t">Offline copy</span></button>`)
                + `<a class="tb-back" href="${home}">← Sn'Album</a>`;
  const dl = bar.querySelector('.tb-dl');
  if (dl) dl.onclick = () => saveOffline(dl);
  const put = () => document.body.insertBefore(bar, document.body.firstChild);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put);
})();
