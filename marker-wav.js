/* marker-wav.js — a song's comments, as a WAV that Logic Pro turns into markers.
 *
 * (CR-128.) Mix notes are most useful next to the DAW. The .txt export gets them
 * onto the screen beside Logic; this gets them onto Logic's own timeline. The
 * file it writes is silent apart from a low ding at the bounce start and a higher
 * ding at every comment, and it carries an embedded marker at each ding. Drop it
 * on a track, then Navigate > Other > Import Marker from Audio File, and every
 * comment becomes a Logic marker you can jump to. The dings are only there so a
 * misplaced region is audible as well as visible.
 *
 * No DOM in here and no network: this file is the maths and the file format,
 * music.html is the surface. That split is also what lets a Node script parse
 * the output byte for byte, which is how it was checked.
 *
 * WHY RIFF `cue ` + `LIST/adtl/labl`, AND NOT A TEXT FILE OR A MIDI FILE.
 * It is the one marker format Logic reads straight from a WAV, and it was
 * verified there on 2026-10-09 (a 12 second test file, a 48 character label with
 * a colon in it, markers landing on the dings). Positions are SAMPLE FRAMES, so
 * they are relative to the region's own start, which is why the file can go
 * anywhere on the timeline and the markers still land on the dings. It also means
 * a sample-rate mismatch with the project misplaces them: the dialog makes the
 * rate a choice and tells him to match Logic. That mismatch has not been tried.
 *
 * WHY TIME IS TAKEN FROM THE COMMENT, NOT FROM THE .txt.
 * The export prints m:ss, which floors to whole seconds (`fmt` in core.js). The
 * comment's own `time` is a float, so building from the data keeps the
 * sub-second position instead of rounding every marker back up to a bar line.
 *
 * KNOWN LIMITS, all deliberate:
 *  - One start offset serves every mix. An older mix with a different intro
 *    length drifts by the difference. A per-mix offset is the fix if it bites.
 *  - Bar.beat maths assumes bar 1 is project 0:00 and a constant tempo. A tempo
 *    change, or a project that starts before bar 1, breaks the bar numbers; the
 *    time offset stays right in both cases. 8-based meters count as Logic does
 *    as far as known, and wants confirming once in a 6/8 session.
 *  - Labels are UTF-8. Only ASCII and a colon have been seen to survive in Logic.
 */
(function (global) {
  'use strict';

  // Every tunable lives here, each with the reason it has that value.
  const CFG = {
    // Mono keeps the file small (96 KB per second at 48 kHz) and Logic only
    // needs the markers, not a stereo image of a ding.
    channels: 1,
    sampleRates: [48000, 44100],
    defaultRate: 48000,
    // Room after the last marker so the final ding rings out and the region
    // does not end on top of it.
    tailSec: 3,
    // Summed in a float buffer then clipped; 0.8 leaves headroom when two
    // comments sit a few milliseconds apart and their dings overlap.
    gain: 0.8,
    // 2 ms: just enough to take the click off the front of a ding.
    attackSec: 0.002,
    // Low and long for "the bounce starts here", high and short for "a
    // comment is here", so the two cannot be mistaken for one another by ear.
    start:   { freq: 440,  durSec: 0.6,  decay: 8 },
    comment: { freq: 1760, durSec: 0.35, decay: 12 },
    // A bell, not a sine: the inharmonic upper partials are what make it read
    // as a ding rather than a test tone.
    partials: [[1, 0.6], [2.76, 0.25], [5.4, 0.15]],
    // Long enough to read at a glance in Logic's marker list, short enough
    // that it is not cut off there. 200 is the ceiling the dialog allows.
    labelLen: 48,
    labelLenMin: 10,
    labelLenMax: 200,
    noText: '(no text)',
  };

  // ---------- labels ----------

  // Cut at the last space past the halfway point so a word is not sliced in
  // two, strip trailing punctuation so the ellipsis does not sit after a comma,
  // then add the ellipsis. A label with no space past halfway is cut hard.
  function shorten(s, n) {
    if (s.length <= n) return s;
    let cut = s.slice(0, n);
    const sp = cut.lastIndexOf(' ');
    if (sp > n * 0.5) cut = cut.slice(0, sp);
    return cut.replace(/[\s,.;:]+$/, '') + '…';
  }

  // ---------- tempo and bounce start ----------

  // BPM counts quarter notes, as Logic does; one beat is one bottom-number
  // note, so 6/8 at 120 has a beat of 0.25 s, not 0.5 s.
  function tempoOf(bpm, top, bottom) {
    const b = parseFloat(bpm);
    const t = +top || 4, d = +bottom || 4;
    return { bpm: b > 0 ? b : null, bpb: t, beatSec: b > 0 ? (60 / b) * (4 / d) : null };
  }

  function parseClock(s) {
    s = String(s).trim();
    if (!s) return NaN;
    if (s.includes(':')) return s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
    return Number(s);
  }

  // The bounce start, in project seconds. mode is 'none' | 'bar' | 'sec'.
  //   none -> the start ding sits at sample 0 and he places the region by hand
  //   bar  -> "5" or "5.3": the WAV begins at project start, silent until then
  //   sec  -> "7.5" or "0:07.5"
  // Returns {sec} or {sec:0, err}, plus {none:true} when no offset applies.
  function startOffset(mode, raw, t) {
    raw = String(raw || '').trim();
    if (mode === 'none' || !raw) return { sec: 0, none: true };
    if (mode === 'sec') {
      const s = parseClock(raw);
      return isFinite(s) && s >= 0
        ? { sec: s }
        : { sec: 0, err: 'Enter the start as seconds or m:ss, e.g. 0:07.5' };
    }
    if (!t.bpm) return { sec: 0, err: 'Set a BPM to use a bar position.' };
    const m = raw.match(/^(\d+)(?:\.(\d+))?$/);
    if (!m || +m[1] < 1) return { sec: 0, err: 'Enter the bar as 5 or bar.beat as 5.3' };
    const bar = +m[1], beat = m[2] ? +m[2] : 1;
    if (beat < 1 || beat > t.bpb) return { sec: 0, err: `Beat must be 1 to ${t.bpb}.` };
    return { sec: ((bar - 1) * t.bpb + (beat - 1)) * t.beatSec };
  }

  // "49.1" for a position in project seconds, or '' when there is no tempo. The
  // 1e-6 stops 8.9999999 s from reading as the beat before the one it is on.
  function barBeat(sec, t) {
    if (!t.bpm) return '';
    const beats = sec / t.beatSec + 1e-6;
    return `${Math.floor(beats / t.bpb) + 1}.${Math.floor(beats % t.bpb) + 1}`;
  }

  // ---------- markers ----------

  // One marker per comment, the start marker first, whatever the order given.
  // comments: [{time, text}] in song seconds; the ones he has ticked, nothing
  // else. Replies never come in here: a marker is a place, not a thread.
  function markersFromComments(comments, opts) {
    const n = Math.max(CFG.labelLenMin, Math.min(CFG.labelLenMax, +opts.labelLen || CFG.labelLen));
    const off = opts.offsetSec || 0, t = opts.tempo;
    const sorted = comments.slice().sort((a, b) => a.time - b.time);
    const bb0 = barBeat(off, t);
    const out = [{ time: off, label: 'BOUNCE START' + (bb0 ? ' ' + bb0 : ''), start: true }];
    for (const c of sorted) out.push({ time: off + c.time, label: labelFor(c, n, off, t) });
    return out;
  }

  function labelFor(c, n, off, t) {
    const bb = barBeat(off + c.time, t);
    const text = String(c.text || '').replace(/\s+/g, ' ').trim() || CFG.noText;
    return (bb ? bb + ' ' : '') + shorten(text, n);
  }

  // ---------- the file ----------

  function addDing(buf, sr, at, d, gain) {
    const p = Math.round(at * sr), n = Math.round(d.durSec * sr), atk = sr * CFG.attackSec;
    for (let i = 0; i < n && p + i < buf.length; i++) {
      const t = i / sr, env = Math.exp(-t * d.decay) * Math.min(1, i / atk);
      let s = 0;
      for (const [mult, amp] of CFG.partials) s += amp * Math.sin(2 * Math.PI * d.freq * mult * t);
      buf[p + i] += gain * env * s;
    }
  }

  // markers: [{time, label, start?}], time in project seconds. Returns the whole
  // file as a Uint8Array. Chunk order is fmt, data, cue, LIST, which is the order
  // Logic was verified against.
  //   cue : a count, then 24 bytes per point: id (1-based), position, "data", 0, 0,
  //         sample offset (the same frame again)
  //   LIST: "adtl", then per point a labl chunk: id, UTF-8 label, NUL, padded even
  function buildWav(markers, sr) {
    const last = markers.reduce((a, m) => Math.max(a, m.time), 0);
    const len = Math.ceil((last + CFG.tailSec) * sr);
    const buf = new Float32Array(len);
    for (const m of markers) addDing(buf, sr, m.time, m.start ? CFG.start : CFG.comment, CFG.gain);

    const enc = new TextEncoder();
    const labels = markers.map(m => enc.encode(m.label));
    const cueSize = 4 + markers.length * 24;
    let adtlSize = 4;
    for (const l of labels) { const b = 4 + l.length + 1; adtlSize += 8 + b + (b % 2); }
    const dataSize = len * 2;
    const total = 4 + (8 + 16) + (8 + dataSize) + (8 + cueSize) + (8 + adtlSize);
    const ab = new ArrayBuffer(8 + total), v = new DataView(ab);
    let o = 0;
    const str = s => { for (let i = 0; i < s.length; i++) v.setUint8(o++, s.charCodeAt(i)); };
    const u32 = x => { v.setUint32(o, x, true); o += 4; };
    const u16 = x => { v.setUint16(o, x, true); o += 2; };

    str('RIFF'); u32(total); str('WAVE');
    str('fmt '); u32(16); u16(1); u16(CFG.channels); u32(sr); u32(sr * 2); u16(2); u16(16);
    str('data'); u32(dataSize);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, buf[i]));
      v.setInt16(o, Math.round(s * 32767), true); o += 2;
    }
    str('cue '); u32(cueSize); u32(markers.length);
    markers.forEach((m, i) => {
      const p = Math.round(m.time * sr);
      u32(i + 1); u32(p); str('data'); u32(0); u32(0); u32(p);
    });
    str('LIST'); u32(adtlSize); str('adtl');
    labels.forEach((l, i) => {
      const b = 4 + l.length + 1;
      str('labl'); u32(b); u32(i + 1);
      new Uint8Array(ab, o, l.length).set(l); o += l.length;
      v.setUint8(o++, 0);
      if (b % 2) v.setUint8(o++, 0);
    });
    return new Uint8Array(ab);
  }

  // The site's own export swaps the same characters for a hyphen, so the two
  // downloads for one song sort side by side in his folder.
  function fileName(title) {
    return String(title || 'Comments').replace(/[\/\\:*?"<>|]/g, '-').trim() + ' markers.wav';
  }

  global.MARKERWAV = {
    CFG, shorten, tempoOf, parseClock, startOffset, barBeat,
    markersFromComments, labelFor, buildWav, fileName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
