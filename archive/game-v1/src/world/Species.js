// Who actually lives in Lake Superior.
//
// This is a table, not a system. Every fish in the game is one of these rows fed
// through the same boids code, which is why adding a species is four lines here
// and nothing anywhere else.
//
// `hover` is height above the local seabed, not an absolute depth. The floor
// swings by thirty units across the bowl, so a fish pinned to y = -58 would be
// buried in one place and mid-water in another; a longnose sucker that stays two
// units off the bottom is a bottom feeder everywhere.
//
// The roster is real. Lamprey are in it because they belong in an honest account
// of this lake — they came up the Welland Canal and collapsed the trout fishery —
// and because a parasite that drifts through your headlights is worth more as
// atmosphere than any invented monster would be. It never guides you anywhere.

export const SPECIES = [
  {
    id: 'trout', name: 'lake trout',
    color: 0x5f7a6a, belly: 0xa9b6a4, size: 0.95,
    hover: [5, 22], school: [8, 16], speed: [2.6, 5.4],
    role: 'guide',
  },
  {
    id: 'whitefish', name: 'lake whitefish',
    color: 0x93a6ad, belly: 0xdfe6e4, size: 0.8,
    hover: [3, 13], school: [12, 26], speed: [2.2, 4.6],
    role: 'guide',
  },
  {
    id: 'sturgeon', name: 'lake sturgeon',
    color: 0x4a4535, belly: 0x8a8064, size: 2.4,
    hover: [1.2, 4.5], school: [1, 2], speed: [1.4, 2.6],
    role: 'elder',        // over a century old; it gives the last clue
  },
  {
    id: 'burbot', name: 'burbot',
    color: 0x584a34, belly: 0x9c8f6a, size: 1.15,
    hover: [0.5, 2.4], school: [1, 3], speed: [1.6, 3.2],
    role: 'ambient',
  },
  {
    id: 'walleye', name: 'walleye',
    color: 0x7a6a3a, belly: 0xd8cf9a, size: 0.9,
    hover: [2, 9], school: [4, 9], speed: [2.4, 5.0],
    role: 'ambient',
  },
  {
    id: 'perch', name: 'yellow perch',
    color: 0xc2a03c, belly: 0xe8d78a, size: 0.5,
    hover: [3, 11], school: [16, 34], speed: [2.0, 4.4],
    role: 'ambient',
  },
  {
    id: 'sucker', name: 'longnose sucker',
    color: 0x4f4438, belly: 0x8c7f6c, size: 0.85,
    hover: [0.4, 2.0], school: [5, 11], speed: [1.5, 3.0],
    role: 'ambient',
  },
  {
    id: 'smelt', name: 'rainbow smelt',
    color: 0xa9c4cc, belly: 0xf0f6f4, size: 0.34,
    hover: [6, 26], school: [26, 44], speed: [3.0, 6.5],
    role: 'ambient',     // big flickering bait balls; the analyser's best showcase
  },
  {
    id: 'siscowet', name: 'siscowet',
    color: 0x3b4a44, belly: 0x76867c, size: 1.25,
    hover: [2, 9], school: [3, 7], speed: [1.8, 3.6],
    deepOnly: true,      // the fat deep-water trout — below the thermocline only
    role: 'ambient',
  },
  {
    id: 'lamprey', name: 'sea lamprey',
    color: 0x2e2b2c, belly: 0x4a4446, size: 1.1,
    hover: [2, 16], school: [1, 2], speed: [2.0, 4.2],
    eel: true,           // long and thin, and it swims like it
    role: 'dread',       // never a guide. It is not here to help you.
  },
];

export const byId = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];

/** Species allowed to carry a clue, in the order the clue chain wants them. */
export const CLUE_SPECIES = ['trout', 'whitefish', 'sturgeon'];
