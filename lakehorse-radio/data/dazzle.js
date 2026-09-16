/* Lakehorse Radio — the same dazzle camouflage generator the band site paints
 * its pages with (core.js, "Dazzle generator"), copied rather than shared.
 *
 * This page is a classic script served off the box's own flash with often no
 * internet behind it at all, so nothing here can import core.js from the
 * band site or fetch anything from a CDN — the whole generator has to be
 * self-contained. What follows is the pure-function half of core.js's
 * version verbatim (the maths owes nothing to a DOM, so there is nothing to
 * port, only to copy); the one function that is NOT copied is paintDazzle()
 * itself, which reads the band's own design settings (schemeScale, schemeInk)
 * that have no meaning here — see paintRadioDazzle() at the bottom instead,
 * which picks fixed values sized for this page rather than a per-band knob.
 *
 * Real dazzle camouflage is not a barcode. A hull was divided into irregular
 * panels by straight cuts at conflicting angles, and each panel was painted
 * either flat black/white or striped at ITS OWN angle with bands of uneven
 * width — the point being that no two adjacent panels agree about which way
 * the ship is facing. Repeating a single stripe pattern gets none of that, so
 * the pattern is generated instead of written by hand.
 *
 * Everything is seeded, so a surface paints identically for a given seed.
 * paintRadioDazzle() draws a fresh seed on each load, same as the band site
 * does — no two visits are painted alike.
 */

(function () {
  'use strict';

  // mulberry32 — small, fast, and identical across browsers for a given seed.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Ships were painted in more than black and white — most schemes carried a
  // mid grey or two, which is what lets shapes read as separate planes rather
  // than as one flat cutout. `tones` is how many steps sit between the two ends.
  function dazzlePalette(ink, ground, tones) {
    // Reads #rgb, #rrggbb and rgb()/rgba() alike, and carries the alpha through.
    const parse = function (c) {
      const s = String(c).trim();
      const fn = s.match(/^rgba?\(([^)]+)\)$/i);
      if (fn) {
        const p = fn[1].split(/[,\/\s]+/).filter(Boolean).map(Number);
        return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 && isFinite(p[3]) ? p[3] : 1];
      }
      const m = s.replace('#', '');
      const px = m.length < 6 ? m.split('').map(function (x) { return x + x; }).join('') : m;
      return [0, 2, 4].map(function (i) { return parseInt(px.slice(i, i + 2), 16); })
        .concat(px.length >= 8 ? parseInt(px.slice(6, 8), 16) / 255 : 1);
    };
    const a = parse(ink), b = parse(ground);
    const out = [];
    const n = Math.max(2, Math.min(4, tones | 0));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const v = a.map(function (x, j) { return x + (b[j] - x) * t; });
      out.push('rgba(' + Math.round(v[0]) + ',' + Math.round(v[1]) + ',' + Math.round(v[2])
        + ',' + (+v[3].toFixed(3)) + ')');
    }
    return out; // [ink … ground]
  }

  // Cut a convex polygon with a line, keeping the side the normal points away
  // from (Sutherland-Hodgman against a single edge).
  function clipHalf(poly, nx, ny, d) {
    const out = [];
    const dist = function (pt) { return nx * pt[0] + ny * pt[1] - d; };
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], nxt = poly[(i + 1) % poly.length];
      const dc = dist(cur), dn = dist(nxt);
      if (dc <= 0) out.push(cur);
      if ((dc < 0 && dn > 0) || (dc > 0 && dn < 0)) {
        const t = dc / (dc - dn);
        out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
      }
    }
    return out;
  }
  function polyArea(p) {
    return Math.abs(p.reduce(function (s, cur, i) {
      const n = p[(i + 1) % p.length];
      return s + (cur[0] * n[1] - n[0] * cur[1]);
    }, 0)) / 2;
  }

  // Split the canvas into irregular panels by repeated cuts. Each cut runs
  // through a point inside the panel it divides, at an angle picked from a set
  // that deliberately conflicts.
  function dazzlePanels(w, h, n, rand, conflict) {
    conflict = conflict === undefined ? 1 : conflict;
    let panels = [[[0, 0], [w, 0], [w, h], [0, h]]];
    // At full conflict the cuts disagree as widely as possible; wound down,
    // they converge on one prevailing angle and the scheme calms into stripes
    // across a few big plates.
    const base = 104;
    const angles = [18, 62, 108, 143, 74, 127, 35, 158]
      .map(function (a) { return base + (a - base) * conflict; });
    for (let i = 0; i < n; i++) {
      // bias towards cutting the biggest panel, so nothing stays a huge slab
      panels.sort(function (a, b) { return polyArea(b) - polyArea(a); });
      const idx = Math.floor(rand() * Math.min(3, panels.length));
      const poly = panels[idx];
      const cx = poly.reduce(function (s, p) { return s + p[0]; }, 0) / poly.length;
      const cy = poly.reduce(function (s, p) { return s + p[1]; }, 0) / poly.length;
      // jitter the pivot so cuts don't all pass through panel centres
      const px = cx + (rand() - 0.5) * w * 0.35;
      const py = cy + (rand() - 0.5) * h * 0.35;
      const th = angles[Math.floor(rand() * angles.length)] * Math.PI / 180;
      const nx = Math.cos(th), ny = Math.sin(th);
      const d = nx * px + ny * py;
      const a = clipHalf(poly, nx, ny, d);
      const b = clipHalf(poly, -nx, -ny, -d);
      if (a.length >= 3 && b.length >= 3 && polyArea(a) > 60 && polyArea(b) > 60) {
        panels.splice(idx, 1, a, b);
      }
    }
    return panels;
  }

  // One panel's paint: flat, or stripes at this panel's own angle with widths
  // that never settle into a rhythm.
  function dazzlePanelSVG(poly, i, rand, pal, scale, conflict, stripeBase) {
    const pts = poly.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    const xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
    const cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    const cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    const span = Math.hypot(Math.max.apply(null, xs) - Math.min.apply(null, xs),
      Math.max.apply(null, ys) - Math.min.apply(null, ys));
    const flip = rand() < 0.22; // some panels stay unstriped
    // Two tones drawn from the palette: the plate and whatever is ruled on it.
    const gi = Math.floor(rand() * pal.length);
    let si = Math.floor(rand() * pal.length);
    if (si === gi) si = (gi + 1 + Math.floor(rand() * (pal.length - 1))) % pal.length;
    const ground = pal[gi], ink = pal[si];
    const base = flip ? ink : ground;
    let out = '<g clip-path="url(#dp' + i + ')"><rect x="' + (cx - span).toFixed(1) + '" y="' + (cy - span).toFixed(1) + '" '
      + 'width="' + (span * 2).toFixed(1) + '" height="' + (span * 2).toFixed(1) + '" fill="' + base + '"/>';
    if (!flip) {
      // Conflict also governs how far this panel's ruling may swing away from
      // the scheme's prevailing angle: at 0 every panel is ruled the same way.
      const ang = (stripeBase + (rand() - 0.5) * 360 * conflict).toFixed(1);
      out += '<g transform="rotate(' + ang + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')">';
      let x = cx - span;
      let guard = 0;
      while (x < cx + span && guard++ < 90) {
        // Uneven bands: a wide one, a hairline, a medium.
        const bar = (3 + rand() * 8.5) * scale;
        const gap = (3 + rand() * 10) * scale;
        out += '<rect x="' + x.toFixed(1) + '" y="' + (cy - span).toFixed(1) + '" '
          + 'width="' + bar.toFixed(1) + '" height="' + (span * 2).toFixed(1) + '" fill="' + ink + '"/>';
        x += bar + gap;
      }
      out += '</g>';
    }
    return { defs: '<clipPath id="dp' + i + '"><polygon points="' + pts + '"/></clipPath>', body: out + '</g>' };
  }

  // A whole scheme, as standalone SVG markup.
  function dazzleSVG(opts) {
    opts = opts || {};
    const w = opts.w === undefined ? 1200 : opts.w;
    const h = opts.h === undefined ? 120 : opts.h;
    const seed = opts.seed === undefined ? 1 : opts.seed;
    const cuts = opts.cuts === undefined ? 7 : opts.cuts;
    const ink = opts.ink === undefined ? '#ffffff' : opts.ink;
    const ground = opts.ground === undefined ? '#08080a' : opts.ground;
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const stretch = opts.stretch === undefined ? true : opts.stretch;
    const tones = opts.tones === undefined ? 2 : opts.tones;
    const conflict = opts.conflict === undefined ? 1 : opts.conflict;

    const rand = rng(seed);
    const pal = dazzlePalette(ink, ground, tones);
    const panels = dazzlePanels(w, h, cuts, rand, conflict);
    const stripeBase = rand() * 360; // the scheme's prevailing ruling
    let defs = '', body = '';
    panels.forEach(function (poly, i) {
      const part = dazzlePanelSVG(poly, i, rand, pal, scale, conflict, stripeBase);
      defs += part.defs; body += part.body;
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" '
      + 'viewBox="0 0 ' + w + ' ' + h + '"' + (stretch ? ' preserveAspectRatio="none"' : '') + '>'
      + '<defs>' + defs + '</defs><rect width="' + w + '" height="' + h + '" fill="' + ground + '"/>' + body + '</svg>';
  }
  // …and the same thing ready to drop into background-image.
  function dazzleURL(opts) {
    return 'url("data:image/svg+xml,' + encodeURIComponent(dazzleSVG(opts)).replace(/'/g, '%27') + '")';
  }

  // Paints this page's background. No band design settings to read (this box
  // serves one band only, off its own flash) — fixed values sized for a
  // phone-width page instead. Translucent white ink over the page's own dark
  // background, same as the band site's page-wide scheme, so it reads as a
  // texture rather than fighting the text on top of it.
  function paintRadioDazzle() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    document.body.style.setProperty('--dazzle-bg', dazzleURL({
      w: 1200, h: 1600, seed: seed, cuts: 11, scale: 1, ink: 'rgba(255,255,255,0.05)', ground: 'rgba(0,0,0,0)',
    }));
  }

  window.paintRadioDazzle = paintRadioDazzle;
})();
