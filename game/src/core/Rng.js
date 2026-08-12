// Seeded randomness.
//
// One generator drives chest placement, baggie anchors, fish spawns and log-page
// positions, so `?seed=abc123` reproduces a run exactly and the band can post a
// seed for people to race. Everything that decides *where* something is must
// draw from here — a stray Math.random() anywhere in worldgen silently breaks
// the guarantee and it's miserable to track down afterwards.
//
// Presentation randomness (bubble jitter, silt drift, sparkle scatter) should
// use Math.random() on purpose: it doesn't affect the run and seeding it would
// only make two players' screens identical for no benefit.

/** xmur3 — turns an arbitrary string into a well-mixed 32-bit seed. */
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32 — small, fast, statistically fine for scattering props. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  /** @param {string} [seed] omit for a fresh random run */
  constructor(seed) {
    this.seed = seed || Rng.makeSeed();
    this.next = mulberry32(hashSeed(this.seed)());
  }

  /** Short, unambiguous, easy to read aloud or type from a phone screen. */
  static makeSeed() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no l/i/o/0/1
    let s = '';
    for (let i = 0; i < 7; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
    return s;
  }

  float(min = 0, max = 1) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.float(min, max + 1)); }
  bool(chance = 0.5) { return this.next() < chance; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Fisher-Yates on a copy — callers usually still want the original order. */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Uniform point in a disc — for scattering across the seabed. */
  inDisc(radius) {
    const r = radius * Math.sqrt(this.next());
    const a = this.next() * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
}

/** Reads ?seed= off the URL so a shared link lands on the same layout. */
export function seedFromUrl() {
  const p = new URLSearchParams(location.search).get('seed');
  return p ? p.trim().toLowerCase().slice(0, 24) : null;
}
