// Ready-made repertoires, built from the Lichess opening library
// (data/openings.json). Each takes every named line in one opening family.
// To add another, append an entry: name pattern, required first moves and side.

import { numbered } from './library.js';

export const PRESETS = [
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defence',
    color: 'b',
    family: /^Caro-Kann Defense/,
    starts: 'e4 c6',
  },
  {
    id: 'kings-gambit',
    name: "King's Gambit",
    color: 'w',
    family: /^King's Gambit/,
    starts: 'e4 e5 f4',
  },
];

export function presetLines(preset, openings) {
  return openings.filter((o) => preset.family.test(o.name) && (o.moves === preset.starts || o.moves.startsWith(`${preset.starts} `)));
}

/** All the preset's lines as one PGN text, one game per line. */
export function presetPgn(preset, openings) {
  return presetLines(preset, openings).map((o) => `${numbered(o.moves)} *`).join('\n');
}
