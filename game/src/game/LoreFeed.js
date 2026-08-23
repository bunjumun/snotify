// The lore, live from the band's active draft.
//
// The story is written in the Band assets page and one draft is marked active.
// This fetches that draft and parses the fish/diver exchanges out of it, so
// editing the document changes what the fish say — no rebuild, no redeploy, no
// second copy of the story to keep in step. Promote a new draft and the next
// conversation in the game is the new one.
//
// Two rules it follows, and each one exists because the alternative is worse:
//
//  1. FALL BACK, ALWAYS. No network, no draft promoted, a document with no
//     exchanges in it — any of those and the game uses the LORE table compiled
//     into Clues.js. The fish must never run out of things to say because a
//     database was slow.
//  2. FETCH ONCE, AT SESSION START, THEN HOLD. Same rule as LogFeed: a draft
//     promoted mid-session must not change what the fish are already saying
//     under a player's nose. The story for this session is whatever was live
//     the moment it started; a new session (or a hard reload) is what picks
//     up a promoted draft. Until 23 Aug this re-checked on every narrative
//     beat instead, on a short TTL — changed at his word, in the outbox, on
//     the "band lore not the live version" bug.
//
// The parse is deliberately loose. Prose stays prose; only lines that announce
// themselves as a question or an answer are picked up, in pairs, in order:
//
//   Q: / A:        Ask: / Say:        Fish: / Diver:
//
// A document that is pure prose parses to nothing, which means it changes
// nothing — writing the story badly for the parser cannot break the game.

const ASK = /^\s*(?:[-*>#\s]*)(?:q|ask|fish|them)\s*[:—-]\s*(.+)$/i;
const SAY = /^\s*(?:[-*>#\s]*)(?:a|say|diver|him|reply)\s*[:—-]\s*(.+)$/i;

export class LoreFeed {
  /**
   * @param {string} band
   * @param {string} supaUrl
   * @param {string} supaKey publishable — lore_active() is public by design
   */
  constructor(band, supaUrl, supaKey) {
    this.band = band;
    this.url = supaUrl;
    this.key = supaKey;

    /** @type {{ask:string,say:string}[]|null} null until a draft says otherwise */
    this.exchanges = null;
    this.draftName = null;
    this.updated = null;
    this.source = 'built-in';
  }

  /** Fetch once. Called at session start; never again during play. */
  async refresh() {
    try { await this._fetch(); } catch { /* the built-in lore stands */ }
  }

  async _fetch() {
    const r = await fetch(`${this.url}/rest/v1/rpc/lore_active`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ b: this.band }),
    });
    if (!r.ok) return;                      // 404 = v19 not applied yet
    const doc = await r.json();
    if (!doc || !doc.body) return;          // no draft promoted

    this.draftName = doc.name || null;
    this.updated = doc.updated || null;

    // Written exchanges win — they're exact, and exactness is the reason to
    // write them. Failing that, the prose itself becomes the conversation.
    const found = parseExchanges(doc.body);
    if (found.length) {
      this.exchanges = found;
      this.source = 'live';
      return;
    }
    const prose = proseExchanges(doc.body);
    if (prose.length) {
      this.exchanges = prose;
      this.source = 'live-prose';
    }
  }

  /**
   * What the fish should be working from. Hands back the live list when there
   * is one and the game's own table when there isn't, so callers never have to
   * ask which of those happened.
   */
  lines(fallback) {
    return this.exchanges && this.exchanges.length ? this.exchanges : fallback;
  }
}

/**
 * Pull ask/say pairs out of a document.
 *
 * An ask with no answer under it is dropped rather than shown alone — half an
 * exchange reads as a bug, and the whole point of the format is that the fish
 * asks and the diver answers. Answers can run over several lines; the next
 * marker ends them.
 */
export function parseExchanges(text) {
  const out = [];
  let ask = null, say = null;

  const flush = () => {
    if (ask && say) out.push({ ask: tidy(ask), say: tidy(say) });
    ask = null; say = null;
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const a = raw.match(ASK);
    if (a) { flush(); ask = a[1]; continue; }
    const s = raw.match(SAY);
    // A second answer under the same question adds a line rather than replacing
    // one — writing an answer as two A: lines is a reasonable thing to do, and
    // silently throwing the first one away is not a reasonable thing to answer
    // it with.
    if (s) { if (ask) say = say == null ? s[1] : say + '  ' + s[1]; continue; }
    // A blank line closes whatever was open; anything else continues it.
    if (!raw.trim()) { flush(); continue; }
    if (say != null) say += ' ' + raw.trim();
    else if (ask != null) ask += ' ' + raw.trim();
  }
  flush();
  return out;
}

/**
 * Turn plain prose into a conversation.
 *
 * The band writes stories, not dialogue trees. A lore document that only counts
 * when it's been marked up in Q:/A: pairs is a document that will quietly stop
 * being the source of truth the first time someone writes a paragraph — which
 * is exactly what happened, so this is the fix: a draft of pure prose still
 * changes what the game says.
 *
 * It works because of WHO is talking. The diver is high, holding onto a horse,
 * being asked by fish where he came from — a man in that state reciting his own
 * history a sentence at a time is not a failure of dialogue writing, it's the
 * scene. So the fish ask open questions (below) and he answers with the next
 * piece of the document, in order. Keep asking and the story comes out in
 * sequence, which turns the doc into something you unspool by talking to fish.
 *
 * Headings, rules and the front matter are dropped: a fish solemnly reciting
 * "---- EXCHANGES ----" is the one outcome nobody wants.
 */
export function proseExchanges(text, maxChars = 190) {
  const out = [];
  let n = 0;
  for (const para of String(text).split(/\n\s*\n/)) {
    const clean = para.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (isHeading(clean)) continue;

    // Sentence-ish. Splitting on the punctuation keeps quotes and song titles
    // in brackets intact, which a naive split on '.' would tear apart.
    const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [clean];
    let chunk = '';
    const push = () => {
      const s = chunk.trim();
      chunk = '';
      if (s.length < 40) return;                  // a fragment isn't an answer
      out.push({ ask: PROMPTS[n++ % PROMPTS.length], say: tidy(breakLine(s)) });
    };
    for (const s of sentences) {
      if (chunk && (chunk + ' ' + s).length > maxChars) push();
      chunk += (chunk ? ' ' : '') + s.trim();
    }
    push();
  }
  return out;
}

/** Titles, rules, and the all-caps banner lines people put in documents. */
function isHeading(s) {
  if (/^[-=_*~#\s]+$/.test(s)) return true;                 // ---- a rule ----
  if (s.length < 40 && !/[.!?]$/.test(s)) return true;       // a short title
  if (s === s.toUpperCase() && s.length < 80) return true;   // A BANNER LINE
  return false;
}

/**
 * These are the fish, and they have to work against any sentence at all — so
 * none of them asks about anything specific. They're the sound of someone
 * leaning in, which is all they need to be.
 */
const PROMPTS = [
  'You were saying. Go on.',
  'And then what?',
  'Say that part again, slower.',
  'What else do you know?',
  'Keep talking. Nobody down here is in a hurry.',
  'That is not the whole of it.',
  'Tell me the next bit.',
  'Go on, diver.',
];

/** One line break near the middle, so a long answer lands in two beats. */
function breakLine(s) {
  if (s.length < 96) return s;
  const mid = Math.floor(s.length / 2);
  const at = s.lastIndexOf(' ', mid + 24);
  return at > 24 ? s.slice(0, at) + '  ' + s.slice(at + 1) : s;
}

/**
 * The HUD renders these as HTML, so a document written by a person has to be
 * made safe before it goes in. Tags out, then the one piece of markup the game
 * actually wants back: a line break where the writer left a double space or a
 * pipe, because these lines are read in two beats.
 */
function tidy(s) {
  return s
    .replace(/[<>]/g, '')
    .replace(/\s*\|\s*/g, '<br>')
    .replace(/\s{2,}/g, '<br>')
    .trim();
}
