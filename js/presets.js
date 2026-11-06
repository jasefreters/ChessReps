// Ready-made repertoires, built from the Lichess opening library
// (data/openings.json). Each takes the named lines in one opening family and
// trims them to a playable repertoire: one move for your side in every
// position (the one with the most named theory behind it, unless `prefer`
// says otherwise), and every reply your opponent might play.
// To add another family, append an entry.

import { Chess } from './chesslib.js';
import { numbered } from './library.js';
import { importPgn } from './pgn.js';
import * as R from './repertoire.js';

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
    prefer: {
      'e4 e5 f4 exf4 Nf3 g5': 'h4', // Kieseritzky, not the Muzio knight sacrifice
      'e4 e5 f4 exf4 Nf3 d6': 'd4', // main line against the Fischer Defence
    },
  },
];

export function presetLines(preset, openings) {
  return openings.filter((o) => preset.family.test(o.name) && (o.moves === preset.starts || o.moves.startsWith(`${preset.starts} `)));
}

/** { full, rep, lines }: every named line, and the trimmed repertoire. */
export function buildPreset(preset, openings) {
  const lines = presetLines(preset, openings);
  const full = R.createRepertoire({ name: preset.name, color: preset.color });
  importPgn(full, lines.map((o) => `${numbered(o.moves)} *`).join('\n'));

  // How many named lines pass through each move.
  const count = {};
  for (const o of lines) {
    let k = full.root;
    for (const san of o.moves.split(' ')) {
      const e = full.nodes[k] && full.nodes[k].moves[san];
      if (!e) break;
      count[`${k}|${san}`] = (count[`${k}|${san}`] || 0) + 1;
      k = e.to;
    }
  }
  const prefer = {};
  for (const [path, san] of Object.entries(preset.prefer || {})) {
    const c = new Chess();
    for (const m of path.split(' ')) c.move(m);
    prefer[R.posKey(c.fen())] = san;
  }

  const rep = JSON.parse(JSON.stringify(full));
  for (const [k, node] of Object.entries(rep.nodes)) {
    if (R.sideToMove(k) !== preset.color) continue;
    const sans = Object.keys(node.moves);
    if (sans.length < 2) continue;
    const keep = prefer[k] && node.moves[prefer[k]]
      ? prefer[k]
      : sans.reduce((a, b) => ((count[`${k}|${b}`] || 0) > (count[`${k}|${a}`] || 0) ? b : a));
    for (const s of sans) if (s !== keep) delete node.moves[s];
  }
  R.prune(rep);
  return { full, rep, lines: lines.length };
}

/** Add every move of `source` that `target` lacks. Returns how many were added. */
export function mergeInto(target, source) {
  let added = 0;
  for (const [key, node] of Object.entries(source.nodes)) {
    if (!target.nodes[key]) target.nodes[key] = { moves: {} };
    for (const [san, e] of Object.entries(node.moves)) {
      if (!target.nodes[key].moves[san]) {
        target.nodes[key].moves[san] = { ...e };
        added++;
      }
      if (!target.nodes[e.to]) target.nodes[e.to] = { moves: {} };
    }
  }
  return added;
}

/**
 * Trim a repertoire added before trimming existed: drop your-side moves that
 * came from the full preset but aren't in the trimmed one. Moves you added
 * yourself are kept. Returns how many of your moves were removed.
 */
export function trimExisting(target, built) {
  const before = R.stats(target).positions;
  for (const [key, node] of Object.entries(target.nodes)) {
    if (R.sideToMove(key) !== target.color) continue;
    const fromPreset = built.full.nodes[key];
    if (!fromPreset) continue;
    const kept = built.rep.nodes[key];
    for (const san of Object.keys(node.moves)) {
      if (fromPreset.moves[san] && !(kept && kept.moves[san])) delete node.moves[san];
    }
  }
  R.prune(target);
  return before - R.stats(target).positions;
}
