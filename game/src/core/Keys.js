// Every localStorage key this build owns, in one place.
//
// Two reasons it exists, and the first is not optional. V2 shares an origin with
// the original game — they are two pages on the same band site — so an unprefixed
// key would have the two builds quietly overwriting each other's saves, and the
// album page would report one game's dives under the other's door. The prefix is
// what keeps them separate tenants of the same localStorage.
//
// The second reason is that the keys had no owner. Six of them were spelled out
// as literals across five files, so nothing could enumerate them: Progress.reset()
// wiped its own blob and left difficulty, quality, invert and the volumes behind,
// which made "start again" quietly mean "start again, mostly".
//
// A key that isn't here doesn't exist. Spell nothing out at the use site.

const NS = 'lakehorse.v2';

export const KEYS = {
  progress:       `${NS}.progress`,
  difficulty:     `${NS}.difficulty`,
  quality:        `${NS}.quality`,
  invert:         `${NS}.invert`,
  pendingSignups: `${NS}.pendingSignups`,

  /** One per audio bus, so this one is built rather than looked up. */
  vol: (bus) => `${NS}.vol.${bus}`,
};

/**
 * Every fixed key, for a wipe that actually wipes. Excludes the volumes, which
 * are per-bus and are better cleared by the caller that knows the bus names.
 */
export function fixedKeys() {
  return Object.values(KEYS).filter(v => typeof v === 'string');
}
