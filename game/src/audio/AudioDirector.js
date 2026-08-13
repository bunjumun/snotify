// Audio.
//
// Graph:
//
//        ┌─ musicBus ─┐
//   in ──┼─ sfxBus   ─┼──► phaser ──► lowpass ──► reverb ──► master ──► out
//        └─ ambBus   ─┘       ▲           ▲
//                          (uTrip)     (uTrip, breath, depth)
//
// Three decisions worth knowing about:
//
// 0. The music is a record, not a soundtrack. Every track in music.json plays in
//    order, crossfading into the next, and loops at the end. The game never
//    switches songs to signal your state — mood is applied as an effect (the phaser
//    on a bong, the lowpass as you drown) over whatever happens to be playing, so
//    a visitor who came from the band's page hears the album straight through.
//
// 1. Music streams through an <audio> element and a MediaElementAudioSourceNode
//    rather than fetch + decodeAudioData. The mixes are ~10 MB and Supabase
//    serves them `cache-control: no-cache`, so decoding up front would mean a ten
//    megabyte wait before a single note on every single load. An element streams
//    and starts in a second — and MediaElementSource still gives us the full
//    graph, so the phaser, the lowpass and the ducking all work on it exactly as
//    they would on a decoded buffer. It needs crossOrigin='anonymous', and the
//    bucket already returns access-control-allow-origin: *.
//
// 2. Every sound effect is synthesised. No SFX files ship at all, which keeps the
//    game tiny and means it is never silent while waiting on a network.

import { CFG } from '../../config.js';

// The same public bucket S'music uses. Inlined rather than imported from core.js
// so the game's boot doesn't depend on the site's shared layer loading first —
// it's four lines, and the coupling isn't worth it.
const SUPA_URL = 'https://twgukeyoayfqldnojrkg.supabase.co';
const SUPA_KEY = 'sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG';   // publishable — safe to ship
/**
 * A few milliseconds of silence as a data: URI, built rather than pasted in as
 * a wall of base64 so it can be read and checked. Its only job is to give an
 * <audio> element something valid to play during the tap that unlocks sound —
 * see _ensureDecks(). Cached after the first call; the bytes never change.
 */
let _silent = null;
function silentWav(ms = 50) {
  if (_silent) return _silent;
  const rate = 8000, n = Math.ceil((rate * ms) / 1000);
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);        // PCM
  v.setUint16(22, 1, true);        // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);     // byte rate: 8-bit mono, so == sample rate
  v.setUint16(32, 1, true);        // block align
  v.setUint16(34, 8, true);        // bits per sample
  tag(36, 'data'); v.setUint32(40, n, true);
  const bytes = new Uint8Array(buf);
  bytes.fill(128, 44);             // 8-bit PCM silence sits at 128, not 0
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  _silent = `data:audio/wav;base64,${btoa(s)}`;
  return _silent;
}

function publicUrl(p) {
  if (!p) return null;
  if (/^(https?:|data:|blob:)/.test(p)) return p;
  return `${SUPA_URL}/storage/v1/object/public/tracks/`
    + p.replace(/^tracks\//, '').split('/').map(encodeURIComponent).join('/');
}

export class AudioDirector {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.ok = true;
    // low/mid/high are levels. `kick` is a transient — how far the bottom end
    // has jumped above its own running floor — and it is the one worth having:
    // a level makes things glow, an onset makes them hit, and everything in the
    // world that flashes should flash on the beat rather than on the volume.
    this.react = { low: 0, mid: 0, high: 0, kick: 0 };
    this._lowFloor = 0;
    this.playlist = [];      // [{title, version, url}] in the band's running order
    this.index = -1;
    this.decks = [];         // two of them; see _makeDeck
    this.deck = 0;           // which one is live
    this.onTrack = null;     // (track, index, total) => void — the HUD listens
    this._advancing = false;
    this._heartbeat = null;
    this._hbWanted = false;  // panic says heartbeat; the pause menu only mutes it
    this._fails = 0;         // consecutive tracks that wouldn't load
    // Set properly by loadMusic(), but the chest can be opened before the
    // manifest has landed and `treasure` must not throw on the payoff screen.
    this._treasureTitles = [];
    this.treasureName = null;
    this._t = 0;

    const c = this.ctx;

    // ---- Master ----
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(c.destination);

    // ---- Reverb ----
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(CFG.audio.reverb.seconds, CFG.audio.reverb.decay);
    this.reverbWet = c.createGain();
    this.reverbWet.gain.value = CFG.audio.reverb.wet;
    this.reverb.connect(this.reverbWet).connect(this.master);

    // ---- The choke ----
    // Open by default so the record plays clean. It only closes when breath drops
    // under 20% — at which point the music going muffled and distant IS the
    // warning, and it lands far harder than a permanent underwater filter ever did.
    this.lowpass = c.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = CFG.audio.lowpass.open;
    this.lowpass.Q.value = CFG.audio.lowpass.q;
    this.lowpass.connect(this.master);
    this.lowpass.connect(this.reverb);

    // ---- Phaser ----
    this._buildPhaser();

    // ---- Buses ----
    this.buses = {};
    for (const name of ['music', 'sfx', 'ambience']) {
      const g = c.createGain();
      g.gain.value = CFG.audio.volumes[name];
      g.connect(this.phaserIn);
      this.buses[name] = g;
    }

    // ---- Analyser ----
    // Tapped off the music bus, not inserted in series, so it can never colour
    // the signal. This is what makes the kelp sway and the god-rays pulse.
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = CFG.audio.analyser.fftSize;
    this.analyser.smoothingTimeConstant = CFG.audio.analyser.smoothing;
    // Fed from the deck gains in _makeDeck(), NOT from the music bus — the bus
    // carries the listener's volume slider, and tapping downstream of it means
    // turning the music down also stops the kelp swaying and the god-rays
    // pulsing. The deck gain is the crossfade, which is exactly what we want to
    // see: whatever is actually playing, at full scale, however loud it is.
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);

    this._startAmbience();
  }

  /**
   * Six cascaded allpass stages with an LFO sweeping them together, mixed against
   * the dry signal. Wet amount is driven by uTrip, so it swells with the rainbow
   * and bleeds out over the same sixty-second taper — sound and picture are the
   * same number, not two things kept in sync.
   */
  _buildPhaser() {
    const c = this.ctx;
    const P = CFG.audio.phaser;

    this.phaserIn = c.createGain();
    this.dry = c.createGain();
    this.wet = c.createGain();
    this.wet.gain.value = 0;

    this.phaserIn.connect(this.dry).connect(this.lowpass);

    let node = this.phaserIn;
    this.stages = [];
    for (let i = 0; i < P.stages; i++) {
      const ap = c.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = P.baseFreq * (1 + i * 0.35);
      ap.Q.value = 0.6;
      node.connect(ap);
      node = ap;
      this.stages.push(ap);
    }
    node.connect(this.wet).connect(this.lowpass);

    // Feedback around the chain is what turns a mild sweep into a proper whoosh.
    this.feedback = c.createGain();
    this.feedback.gain.value = P.feedback;
    node.connect(this.feedback).connect(this.stages[0]);

    this.lfo = c.createOscillator();
    this.lfo.frequency.value = P.rateHz;
    this.lfoDepth = c.createGain();
    this.lfoDepth.gain.value = P.depth;
    this.lfo.connect(this.lfoDepth);
    for (const s of this.stages) this.lfoDepth.connect(s.frequency);
    this.lfo.start();
  }

  /** Noise burst with an exponential decay — a serviceable room without an IR file. */
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /**
   * MUST be called from inside a user gesture — browsers block audio otherwise.
   *
   * Resuming the context is only half of it, and the missing half is why the
   * game was silent on phones. On iOS the permission is granted per MEDIA
   * ELEMENT, not per page: an <audio> element has to have had play() called on
   * it during a real gesture before anything may start it programmatically
   * later. The decks used to be built inside loadMusic(), which runs off the
   * back of two network fetches — so by the time they existed the tap was long
   * over, every play() was rejected by autoplay policy, and _play()'s catch
   * swallowed it. Silence, and not one line in the console.
   *
   * So the decks are built and primed HERE, and deliberately before the first
   * await: user activation does not reliably survive an await on iOS, so
   * anything that needs the gesture has to happen in the same synchronous turn
   * as the tap itself.
   */
  async unlock() {
    this._ensureDecks();          // synchronous, and must stay that way
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { this.ok = false; }
    }
    return this.ok;
  }

  /**
   * Build the two decks once, and hand each a moment of silence so iOS marks it
   * as user-started. Idempotent: loadMusic() calls it too, in case audio was
   * unlocked some other way.
   */
  _ensureDecks() {
    if (this.decks.length) return;
    this.decks = [this._makeDeck(), this._makeDeck()];
    const quiet = silentWav();
    for (const d of this.decks) {
      d.el.src = quiet;
      // Called synchronously inside the gesture — that call is the whole point,
      // not whether it resolves. Changing src afterwards keeps the permission.
      d.el.play().then(() => d.el.pause()).catch(() => { /* not an iOS device */ });
    }
  }

  // ------------------------------------------------------------------- music

  /**
   * Reads game/music.json and plays it as a record: every track, in the order
   * the band listed them, crossfading one into the next and looping at the end.
   *
   * Two <audio> elements, not one. A MediaElementAudioSourceNode is bound to its
   * element for life and can't be created twice for the same one, so the decks
   * are built once up front and only ever have their `src` swapped. That also
   * gets the crossfade for free: while deck A is finishing, deck B is already
   * streaming the next track.
   *
   * @returns {Promise<number>} how many tracks are in the running order
   */
  async loadMusic() {
    const manifest = await this._readManifest();
    // One title or several — the chest can hold more than one track — and the
    // name of the release they belong to, which is what the reward screen says.
    this._treasureTitles = [manifest.treasure].flat().filter(Boolean);
    this.treasureName = manifest.treasureName || null;

    // Live first. game_tracks() returns the CURRENT top of each stack, so a new
    // mix is in the game on the next load with nothing to remember. music.json
    // pins filenames, which are stale the day after they're written — it's the
    // fallback for before v18 is applied, and for when the network isn't there.
    const live = await this._liveTracks();
    this.source = live.length ? 'live' : 'manifest';

    this.playlist = (live.length ? live : manifest.tracks || [])
      .filter((t) => t && t.src)
      .map((t) => ({
        title: t.title || 'Lakehorse',
        version: t.version || '',
        url: publicUrl(t.src),
      }));
    if (CFG.audio.playlist.shuffle) this.playlist = shuffled(this.playlist);
    if (!this.playlist.length) return 0;

    this._ensureDecks();          // normally already built and primed by unlock()
    this._play(0);
    return this.playlist.length;
  }

  /** The static running order that ships with the game. Also holds `treasure`. */
  async _readManifest() {
    try {
      const r = await fetch(new URL('../../music.json', import.meta.url));
      return await r.json();
    } catch {
      return {};
    }
  }

  /**
   * The newest mix of every song the band has flagged for the game.
   *
   * Public by necessity — a page anyone can view can't hold a band password —
   * and safe because the flag is per song: the function can only ever reach
   * songs someone deliberately put in the game. See supabase/schema-v18.sql.
   *
   * Returns [] on anything at all: a 404 because v18 hasn't been applied yet, a
   * dead network, a band with nothing flagged. Every one of those falls through
   * to music.json, so the record still plays.
   */
  async _liveTracks() {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/rpc/game_tracks`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ b: CFG.audio.band }),
      });
      if (!r.ok) return [];
      const rows = await r.json();
      return Array.isArray(rows) ? rows.filter((t) => t && t.src) : [];
    } catch {
      return [];
    }
  }

  _makeDeck() {
    const el = new Audio();
    el.crossOrigin = 'anonymous';   // required, and the bucket already sends ACAO:*
    el.preload = 'auto';

    const src = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.buses.music);
    gain.connect(this.analyser);   // pre-fader tap; see the note in the constructor

    // Backstop. If a track's duration never resolves — a stream, a container the
    // browser won't measure — the crossfade window in update() never opens, and
    // without this the record would simply stop at the end of track one.
    el.addEventListener('ended', () => this._advance());
    // A dead URL shouldn't end the album either; skip to the next one.
    el.addEventListener('error', () => this._trackFailed());
    // Proof one actually started, which is what clears the failure count.
    el.addEventListener('playing', () => { this._fails = 0; });

    return { el, src, gain };
  }

  /** Put track `i` on the idle deck and crossfade to it. */
  _play(i, fade = 0.8) {
    if (!this.playlist.length) return;
    const track = this.playlist[i];
    const next = this.decks[this.deck ^ 1];
    const prev = this.decks[this.deck];
    const now = this.ctx.currentTime;

    // A one-track playlist has nothing to cross into but itself, and crossfading
    // a song with a second copy of the same song is worse than a clean loop.
    next.el.loop = this.playlist.length === 1;
    next.el.src = track.url;
    // A fresh src already starts at zero, so this is belt and braces — but on a
    // element that hasn't loaded metadata yet some WebKit builds throw
    // InvalidStateError rather than storing a pending seek, and an exception
    // here would jump straight over the play() below and leave _advancing stuck
    // true, which stops the record for the rest of the session.
    try { next.el.currentTime = 0; } catch { /* seek before metadata; harmless */ }
    next.el.play().catch(() => { /* autoplay policy or a dead URL; stay quiet */ });

    next.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setTargetAtTime(1, now, Math.max(0.05, fade / 3));
    if (prev !== next) {
      prev.gain.gain.cancelScheduledValues(now);
      prev.gain.gain.setTargetAtTime(0, now, Math.max(0.05, fade / 3));
      // Let the fade finish before stopping it, or the tail gets chopped.
      const el = prev.el;
      setTimeout(() => { if (this.decks[this.deck].el !== el) el.pause(); }, fade * 1000 + 400);
    }

    this.deck ^= 1;
    this.index = i;
    this._advancing = false;
    if (this.onTrack) this.onTrack(track, i, this.playlist.length);
  }

  _advance() {
    if (this._advancing || this.playlist.length < 2) return;
    this._advancing = true;
    this._play((this.index + 1) % this.playlist.length, CFG.audio.playlist.crossfade);
  }

  /**
   * A track that wouldn't load moves the record on — but only while there is
   * somewhere to move to. Without the count, a running order whose URLs have all
   * gone bad (a renamed bucket, a mix pulled from the game) turns into a loop:
   * every error advances, every advance loads another dead URL and errors, and
   * the thing spins through the playlist as fast as the network can refuse it,
   * flashing a new title card each time. The count is cleared by the `playing`
   * event, so one good track puts the full budget back.
   */
  _trackFailed() {
    if (this.playlist.length < 2) return;
    if (++this._fails >= this.playlist.length) {
      console.warn('[lakehorse] no track in the running order would load — running on the procedural bed');
      return;
    }
    this._advance();
  }

  /**
   * Watch the live deck for the end of the track. Called from update(), so it
   * costs two number comparisons a frame and needs no timers to keep in sync.
   */
  _pumpPlaylist() {
    if (this.playlist.length < 2 || this._advancing) return;
    const el = this.decks[this.deck]?.el;
    if (!el || !el.duration || !isFinite(el.duration)) return;
    if (el.duration - el.currentTime <= CFG.audio.playlist.crossfade) this._advance();
  }

  /** Skip forward — wired to the HUD's track readout. */
  skip() { if (this.playlist.length > 1) { this._advancing = false; this._advance(); } }

  get nowPlaying() { return this.playlist[this.index] || null; }

  /**
   * What the treasure chest gives away — a list, because it can be more than
   * one track. Named by `treasure` in music.json, which takes a title or an
   * array of them; otherwise the record's opening track, which is the sane
   * default for an album where track one is the single.
   *
   * Titles that aren't in the running order are skipped rather than faked, so
   * un-flagging a song from the game can never leave a dead download button on
   * the last screen of it.
   */
  get treasure() {
    if (!this.playlist.length) return [];
    const want = this._treasureTitles;
    if (want.length) {
      const hits = want
        .map((title) => this.playlist.find((t) => t.title === title))
        .filter(Boolean);
      if (hits.length) return hits;
    }
    return [this.playlist[0]];
  }

  // ------------------------------------------------------------------ ambience

  /** A filtered-noise bed plus a low drone. Costs nothing and is never silent. */
  _startAmbience() {
    const c = this.ctx;
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    // Brown-ish noise: integrating white noise tilts it toward the low end,
    // which is what moving water actually sounds like.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    const noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 420;
    const ng = c.createGain();
    ng.gain.value = 0.5;
    noise.connect(nf).connect(ng).connect(this.buses.ambience);
    noise.start();

    // A slow drone under it, so the lake has a pitch as well as a texture.
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 48;
    const og = c.createGain();
    og.gain.value = 0.1;
    osc.connect(og).connect(this.buses.ambience);
    osc.start();

    const lfo = c.createOscillator();
    lfo.frequency.value = 0.06;
    const lg = c.createGain();
    lg.gain.value = 0.05;
    lfo.connect(lg).connect(og.gain);
    lfo.start();
  }

  // ----------------------------------------------------------------------- sfx

  /**
   * Synthesised one-shots. No files, no loading, no 404s.
   *
   * Every case detunes by a few percent per invocation. Without it a repeated
   * sound is bit-identical every single time, and the ear reads exact repetition
   * as synthetic faster than it reads any amount of wrong timbre — ten baggies in
   * a row was ten copies of one waveform. `chest` opts out, because its chord is
   * the one sound in the game that is a reward rather than information and it
   * should ring true each time.
   *
   * @param {string} name
   * @param {{force?:number}} [opts] 0..1 strength, where a sound has a range
   */
  sfx(name, opts = {}) {
    if (!this.ok) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = this.buses.sfx;
    const force = Math.min(1, Math.max(0, opts.force ?? 1));

    const detune = name === 'chest' ? 1 : 1 + (Math.random() - 0.5) * 0.09;

    const tone = (freq, dur, type = 'sine', vol = 0.3, glideTo = null) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq * detune, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo * detune), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    };

    const noise = (dur, freq, vol = 0.25) => {
      const len = Math.floor(c.sampleRate * dur);
      const b = c.createBuffer(1, len, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource();
      s.buffer = b;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq * detune;
      const g = c.createGain();
      g.gain.value = vol;
      s.connect(f).connect(g).connect(out);
      s.start(t);
    };

    switch (name) {
      // The tail beat. The most frequent sound in the game by a wide margin and
      // for a long time the only action with no sound at all, which quietly made
      // the main verb feel like a button that wasn't wired up.
      //
      // Water displaced by something large, so: a low body with a fast decay and
      // no tone in it. Anything pitched here turns swimming into a UI click, and
      // anything longer smears into the next beat at the rate people actually
      // tap. Deliberately quiet. It fires several times a second and the job is
      // to be felt rather than heard.
      case 'kick':        noise(0.13, 190 + force * 90, 0.09 + force * 0.05); break;

      // Half a tonne of horse into silt. The thud carries the weight and the
      // noise carries the cloud; the pitch drop is what makes it read as ground
      // rather than as another animal.
      case 'thud':
        noise(0.28 + force * 0.2, 240, 0.1 + force * 0.22);
        tone(96, 0.24 + force * 0.16, 'sine', 0.1 + force * 0.16, 44);
        break;

      case 'baggie':      tone(520, 0.16, 'triangle', 0.25, 880); break;
      case 'lighter':     noise(0.35, 2600, 0.3); tone(120, 0.4, 'sawtooth', 0.18, 60); break;
      case 'fish':        tone(700, 0.3, 'sine', 0.16, 460); break;
      case 'warn':        tone(220, 0.5, 'triangle', 0.2, 160); break;
      case 'grip_lost':   noise(0.4, 300, 0.35); tone(90, 0.5, 'square', 0.14, 50); break;
      case 'grip_regain': tone(320, 0.2, 'sine', 0.18, 520); break;
      // Through the thermocline. Going down is a body-sized slew of cold water
      // with the pitch falling away under it; coming up is the same shape
      // released. Both are quiet on purpose — this is a threshold rather than an
      // impact, and it happens often enough in a run that anything bright would
      // wear through by the second crossing.
      case 'cold_in':     noise(0.30, 240, 0.15); tone(150, 0.45, 'sine', 0.11, 70); break;
      case 'cold_out':    noise(0.20, 380, 0.09); tone(190, 0.30, 'sine', 0.09, 300); break;
      // A slate lifted off the bottom: a scrape, then a small clear note.
      case 'page':        noise(0.22, 1400, 0.16); tone(880, 0.3, 'sine', 0.13, 1320); break;
      // Iron hinge, then the chord. The one sound in the game allowed to be a
      // reward rather than information.
      case 'chest':
        noise(0.5, 240, 0.22);
        [262, 392, 523, 659].forEach((f, i) => tone(f, 1.6 - i * 0.1, 'triangle', 0.13));
        break;
      case 'bong':        this._bong(); break;
      default: break;
    }
  }

  /** Bubbling draw, then the exhale. */
  _bong() {
    const c = this.ctx;
    const t = c.currentTime;
    for (let i = 0; i < 22; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const at = t + i * 0.055 + Math.random() * 0.02;
      o.type = 'sine';
      o.frequency.setValueAtTime(180 + Math.random() * 320, at);
      o.frequency.exponentialRampToValueAtTime(90 + Math.random() * 90, at + 0.1);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.16, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      o.connect(g).connect(this.buses.sfx);
      o.start(at); o.stop(at + 0.18);
    }
  }

  heartbeat(on) {
    this._hbWanted = on;
    this._beat(on);
  }

  /** Start or stop the timer without changing whether panic still wants it. */
  _beat(on) {
    if (on && !this._heartbeat) {
      this._heartbeat = setInterval(() => {
        const c = this.ctx, t = c.currentTime;
        for (const [off, vol] of [[0, 0.4], [0.16, 0.26]]) {
          const o = c.createOscillator(); const g = c.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(64, t + off);
          o.frequency.exponentialRampToValueAtTime(36, t + off + 0.16);
          g.gain.setValueAtTime(0, t + off);
          g.gain.linearRampToValueAtTime(vol, t + off + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);
          o.connect(g).connect(this.buses.sfx);
          o.start(t + off); o.stop(t + off + 0.3);
        }
      }, 900);
    } else if (!on && this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
  }

  // ---------------------------------------------------------------------- trip

  // The trip does not change the song. It phases the one already playing and
  // sweeps the filter across it, both off uTrip — so the record keeps running
  // through the whole sequence and comes back out the other side where it was.
  tripStart() { this.sfx('bong'); }
  tripTaper() { /* the camera is coming home; uTrip does the rest in update() */ }
  tripEnd() { /* likewise */ }

  death() {
    this.heartbeat(false);
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0.15, now, 0.6);
    this.lowpass.frequency.setTargetAtTime(180, now, 0.8);
  }

  /** Undo death(). The filter recovers on its own in update(); master doesn't. */
  revive() {
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
  }

  /**
   * The pause menu. It also silences the heartbeat, which otherwise thumps away
   * behind the settings panel forever: breath doesn't drain while paused, so the
   * panic state never changes, and the state CHANGE is the only thing that would
   * have switched it off. Resuming restores it only if breath is still low.
   */
  duck(on) {
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(on ? 0.25 : 0.9, now, 0.12);
    this._beat(on ? false : this._hbWanted);
  }

  setVolume(bus, v) {
    const g = this.buses[bus];
    if (g) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // -------------------------------------------------------------------- update

  /**
   * @param {{panic:number, belowThermo:number, trip:number, speed:number}} s
   */
  update(dt, s) {
    if (!this.ok) return;
    this._t += dt;
    const A = CFG.audio;
    const now = this.ctx.currentTime;

    // ---- The one value ----
    // Phaser wet and the filter sweep both ride uTrip, so they bloom and fade
    // exactly with the picture.
    const trip = s.trip || 0;
    this.wet.gain.setTargetAtTime(trip * A.phaser.maxWet, now, 0.08);
    this.dry.gain.setTargetAtTime(1 - trip * 0.45, now, 0.08);

    // The choke. Wide open until breath falls under `chokeBelow`, then it closes
    // toward `panic` as the tank empties. The trip cancels it outright, because a
    // bong refills you and the sequence should never sound strangled.
    const frac = s.breathFraction ?? 1;
    const choke = clamp01((A.lowpass.chokeBelow - frac) / A.lowpass.chokeBelow) * (1 - trip);
    // Interpolate in LOG space. Pitch is logarithmic, so a linear ramp from 20kHz
    // to 380Hz spends almost its entire travel in the inaudible top octaves and
    // then collapses at the very end — you hear nothing, then everything. Going
    // exponential puts the halfway point at ~2.7kHz, where it's actually audible.
    let cutoff = A.lowpass.open * Math.pow(A.lowpass.panic / A.lowpass.open, choke);
    if (trip > 0.01) {
      // Wobble through the trip — the "whoa" in the middle of the sequence.
      cutoff *= 1 + Math.sin(this._t * 2.1) * 0.18 * trip;
    }
    this.lowpass.frequency.setTargetAtTime(Math.max(120, cutoff), now, 0.12);
    this.choke = choke;

    // ---- The record keeps playing ----
    this._pumpPlaylist();

    // ---- Analyser ----
    this.analyser.getByteFrequencyData(this._freq);
    const n = this._freq.length;
    this.react.low = avg(this._freq, 0, Math.floor(n * 0.08)) / 255;
    this.react.mid = avg(this._freq, Math.floor(n * 0.08), Math.floor(n * 0.35)) / 255;
    this.react.high = avg(this._freq, Math.floor(n * 0.35), n) / 255;

    // The floor tracks the low band slowly, so a sustained bass note sinks into
    // it and stops counting while a fresh hit still stands out. Fast attack and
    // a slow release on the result turns each onset into a flash with a tail,
    // which is what the lights want — an instantaneous value flickers.
    this._lowFloor += (this.react.low - this._lowFloor) * 0.045;
    const hit = clamp01((this.react.low - this._lowFloor) * 3.6);
    this.react.kick = Math.max(hit, this.react.kick * 0.86);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function avg(arr, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += arr[i];
  return to > from ? s / (to - from) : 0;
}
