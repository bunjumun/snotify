/* gif-codec.js — a small GIF reader and writer, no dependencies.
 *
 * Why this exists: Line Displacer reads a picture's pixel values, so an
 * animated GIF has to be split into whole frames before the effect can touch
 * it, and the result has to be stitched back together afterwards. The browser
 * can show a GIF but will not hand its frames over (ImageDecoder is not in
 * every browser we care about), and pulling in a library for ~250 lines of
 * well-specified format would add a dependency to a site whose whole deploy
 * is `git push`. So the format is handled here.
 *
 * Reader: GifCodec.decode(arrayBuffer) -> { width, height, frames: [{ rgba, delay }] }
 *   Every frame is returned already composited onto the full canvas, with
 *   disposal methods and transparency applied, so a frame is a complete
 *   picture rather than a patch. `delay` is in milliseconds.
 *
 * Writer: GifCodec.createEncoder(width, height) -> { addFrame(rgba, delayMs), finish() }
 *   One palette shared by every frame (a per-frame palette makes flat colours
 *   shimmer between frames). Colours are binned to 5 bits a channel to build
 *   the palette by median cut, but each palette entry is the true average of
 *   the 8-bit colours in its bin, so a pure background stays pure.
 *   addFrame is cheap and synchronous; the caller yields between frames.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- reader

  function lzwDecode(minCode, data, pixelCount) {
    const clear = 1 << minCode, eoi = clear + 1;
    const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    const out = new Uint8Array(pixelCount);
    for (let i = 0; i < clear; i++) suffix[i] = i;
    let codeSize = minCode + 1, next = eoi + 1;
    let bitBuf = 0, bitCnt = 0, pos = 0, op = 0, prev = -1, first = 0;
    while (op < pixelCount) {
      while (bitCnt < codeSize) {
        if (pos >= data.length) return out;
        bitBuf |= data[pos++] << bitCnt; bitCnt += 8;
      }
      let code = bitBuf & ((1 << codeSize) - 1);
      bitBuf >>>= codeSize; bitCnt -= codeSize;
      if (code === clear) { codeSize = minCode + 1; next = eoi + 1; prev = -1; continue; }
      if (code === eoi) break;
      if (prev === -1) { out[op++] = suffix[code]; prev = code; first = code; continue; }
      const inCode = code;
      let sp = 0;
      if (code >= next) { stack[sp++] = first; code = prev; }
      while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[sp++] = first;
      while (sp > 0 && op < pixelCount) out[op++] = stack[--sp];
      if (next < 4096) {
        prefix[next] = prev; suffix[next] = first; next++;
        if (next === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prev = inCode;
    }
    return out;
  }

  function decode(buffer) {
    const b = new Uint8Array(buffer);
    const sig = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF');
    const width = b[6] | (b[7] << 8), height = b[8] | (b[9] << 8);
    let p = 10;
    const flags = b[p++]; p += 2; // background index, aspect ratio
    let globalTable = null;
    if (flags & 0x80) {
      const n = 3 << ((flags & 7) + 1);
      globalTable = b.subarray(p, p + n); p += n;
    }
    const frames = [];
    const canvas = new Uint8ClampedArray(width * height * 4); // starts transparent
    let gce = null;

    while (p < b.length) {
      const tag = b[p++];
      if (tag === 0x3B) break;
      if (tag === 0x21) {
        const label = b[p++];
        if (label === 0xF9 && b[p] >= 4) {
          const f = b[p + 1];
          gce = { disposal: (f >> 2) & 7, transparent: (f & 1) ? b[p + 4] : -1,
                  delay: (b[p + 2] | (b[p + 3] << 8)) * 10 };
        }
        while (b[p] !== 0 && p < b.length) p += b[p] + 1;
        p++;
        continue;
      }
      if (tag !== 0x2C) break;
      const left = b[p] | (b[p + 1] << 8), top = b[p + 2] | (b[p + 3] << 8);
      const w = b[p + 4] | (b[p + 5] << 8), h = b[p + 6] | (b[p + 7] << 8);
      const lf = b[p + 8]; p += 9;
      let table = globalTable;
      if (lf & 0x80) {
        const n = 3 << ((lf & 7) + 1);
        table = b.subarray(p, p + n); p += n;
      }
      const minCode = b[p++];
      const chunks = []; let total = 0;
      while (b[p] !== 0 && p < b.length) {
        chunks.push(b.subarray(p + 1, p + 1 + b[p])); total += b[p]; p += b[p] + 1;
      }
      p++;
      const data = new Uint8Array(total);
      let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
      const idx = lzwDecode(minCode, data, w * h);

      const g = gce || { disposal: 0, transparent: -1, delay: 100 };
      const saved = g.disposal === 3 ? canvas.slice() : null;
      // Row order: interlaced frames store rows in four passes.
      const rowOf = new Int32Array(h);
      if (lf & 0x40) {
        let r = 0;
        for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]])
          for (let y = s; y < h; y += st) rowOf[r++] = y;
      } else for (let y = 0; y < h; y++) rowOf[y] = y;

      for (let r = 0; r < h; r++) {
        const y = top + rowOf[r];
        if (y >= height) continue;
        for (let x = 0; x < w; x++) {
          const cx = left + x; if (cx >= width) continue;
          const c = idx[r * w + x];
          if (c === g.transparent || !table) continue;
          const d = (y * width + cx) * 4;
          canvas[d] = table[c * 3]; canvas[d + 1] = table[c * 3 + 1];
          canvas[d + 2] = table[c * 3 + 2]; canvas[d + 3] = 255;
        }
      }
      frames.push({ rgba: canvas.slice(), delay: g.delay });

      if (g.disposal === 2) {
        for (let y = top; y < Math.min(height, top + h); y++)
          for (let x = left; x < Math.min(width, left + w); x++)
            canvas.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      } else if (g.disposal === 3 && saved) canvas.set(saved);
      gce = null;
    }
    return { width, height, frames };
  }

  // ---------------------------------------------------------------- writer

  function lzwEncode(indices, minCode, push) {
    const clear = 1 << minCode, eoi = clear + 1;
    let codeSize = minCode + 1, next = eoi + 1;
    const keys = new Int32Array(8192).fill(-1), vals = new Uint16Array(8192);
    let cur = 0, curBits = 0;
    const emit = (code) => {
      cur |= code << curBits; curBits += codeSize;
      while (curBits >= 8) { push(cur & 255); cur >>>= 8; curBits -= 8; }
    };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i], key = (prefix << 8) | k;
      let h = ((prefix << 4) ^ k) & 8191, found = -1;
      while (keys[h] !== -1) { if (keys[h] === key) { found = vals[h]; break; } h = (h + 1) & 8191; }
      if (found !== -1) { prefix = found; continue; }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        keys.fill(-1); codeSize = minCode + 1; next = eoi + 1;
      } else {
        if (next >= (1 << codeSize)) codeSize++;
        keys[h] = key; vals[h] = next++;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (curBits > 0) push(cur & 255);
  }

  // Median cut over a 15-bit colour histogram.
  function buildPalette(count, sr, sg, sb) {
    const bins = [];
    for (let i = 0; i < 32768; i++) if (count[i]) bins.push(i);
    const chan = (i, c) => c === 0 ? (i >> 10) & 31 : c === 1 ? (i >> 5) & 31 : i & 31;
    let boxes = [bins];
    const weight = (bx) => { let n = 0; for (const i of bx) n += count[i]; return n; };
    while (boxes.length < 256) {
      let best = -1, bw = 0;
      boxes.forEach((bx, i) => { if (bx.length > 1) { const w = weight(bx); if (w > bw) { bw = w; best = i; } } });
      if (best < 0) break;
      const bx = boxes[best];
      let bc = 0, br = -1;
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0;
        for (const i of bx) { const v = chan(i, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > br) { br = hi - lo; bc = c; }
      }
      bx.sort((a, b) => chan(a, bc) - chan(b, bc));
      let acc = 0, cut = 1; const half = bw / 2;
      for (let j = 0; j < bx.length - 1; j++) { acc += count[bx[j]]; cut = j + 1; if (acc >= half) break; }
      boxes.splice(best, 1, bx.slice(0, cut), bx.slice(cut));
    }
    const pal = new Uint8Array(256 * 3);
    boxes.forEach((bx, n) => {
      let c = 0, r = 0, g = 0, bl = 0;
      for (const i of bx) { c += count[i]; r += sr[i]; g += sg[i]; bl += sb[i]; }
      pal[n * 3] = Math.round(r / c); pal[n * 3 + 1] = Math.round(g / c); pal[n * 3 + 2] = Math.round(bl / c);
    });
    return { pal, size: boxes.length };
  }

  function createEncoder(width, height) {
    const count = new Float64Array(32768), sr = new Float64Array(32768),
          sg = new Float64Array(32768), sb = new Float64Array(32768);
    const frames = []; // { bins: Uint16Array, delay }

    return {
      addFrame(rgba, delayMs) {
        const n = width * height, bins = new Uint16Array(n);
        for (let i = 0, s = 0; i < n; i++, s += 4) {
          const r = rgba[s], g = rgba[s + 1], b = rgba[s + 2];
          const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          bins[i] = k; count[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
        }
        frames.push({ bins, delay: delayMs });
      },
      finish() {
        const { pal, size } = buildPalette(count, sr, sg, sb);
        // Nearest palette entry for every bin that occurs, found once.
        const map = new Uint8Array(32768);
        for (let k = 0; k < 32768; k++) {
          if (!count[k]) continue;
          const r = sr[k] / count[k], g = sg[k] / count[k], b = sb[k] / count[k];
          let best = 0, bd = 1e9;
          for (let j = 0; j < size; j++) {
            const dr = pal[j * 3] - r, dg = pal[j * 3 + 1] - g, db = pal[j * 3 + 2] - b;
            const d = dr * dr + dg * dg + db * db;
            if (d < bd) { bd = d; best = j; }
          }
          map[k] = best;
        }
        const out = [];
        const push = (v) => out.push(v);
        const u16 = (v) => { out.push(v & 255, (v >> 8) & 255); };
        for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
        u16(width); u16(height);
        out.push(0xF7, 0, 0); // global table, 256 entries
        for (let i = 0; i < 768; i++) out.push(pal[i]);
        out.push(0x21, 0xFF, 11); for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0));
        out.push(3, 1, 0, 0, 0); // loop forever
        for (const f of frames) {
          out.push(0x21, 0xF9, 4, 0x04); // disposal 1: leave in place
          u16(Math.max(2, Math.round(f.delay / 10))); out.push(0, 0);
          out.push(0x2C); u16(0); u16(0); u16(width); u16(height); out.push(0);
          out.push(8);
          const idx = new Uint8Array(f.bins.length);
          for (let i = 0; i < idx.length; i++) idx[i] = map[f.bins[i]];
          const bytes = [];
          lzwEncode(idx, 8, (v) => bytes.push(v));
          for (let i = 0; i < bytes.length; i += 255) {
            const n = Math.min(255, bytes.length - i);
            out.push(n); for (let j = 0; j < n; j++) out.push(bytes[i + j]);
          }
          out.push(0);
        }
        out.push(0x3B);
        return new Uint8Array(out);
      }
    };
  }

  root.GifCodec = { decode, createEncoder };
})(typeof window !== 'undefined' ? window : globalThis);
