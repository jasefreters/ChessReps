// A repertoire is a graph of positions. Each node lists the moves you have
// prepared from that position, so transpositions share one node.
//
// rep = {
//   id, name, color: 'w' | 'b', created,
//   root: positionKey,
//   nodes: { [positionKey]: { moves: { [san]: { uci, to: positionKey } } } },
//   cards: { [positionKey]: card }   // scheduling state for your-turn positions
// }

import { LOOKAHEAD } from './srs.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Position identity: placement, side to move, castling, en passant (no move counters). */
export function posKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function keyToFen(key) {
  return `${key} 0 1`;
}

export function sideToMove(key) {
  return key.split(' ')[1];
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function createRepertoire({ name, color }) {
  const root = posKey(START_FEN);
  return { id: uid(), name, color, created: Date.now(), root, nodes: { [root]: { moves: {} } }, cards: {} };
}

/** Add a chess.js Move made from `fromKey`. */
export function addMove(rep, fromKey, move) {
  const toKey = posKey(move.after);
  if (!rep.nodes[fromKey]) rep.nodes[fromKey] = { moves: {} };
  const moves = rep.nodes[fromKey].moves;
  const added = !moves[move.san];
  if (added) moves[move.san] = { uci: move.from + move.to + (move.promotion || ''), to: toKey };
  if (!rep.nodes[toKey]) rep.nodes[toKey] = { moves: {} };
  return { toKey, added };
}

export function edges(rep, key) {
  const node = rep.nodes[key];
  return node ? Object.entries(node.moves) : [];
}

export function isUserPosition(rep, key) {
  return sideToMove(key) === rep.color && edges(rep, key).length > 0;
}

/** Remove one move, then drop positions no longer reachable from the start. */
export function removeMove(rep, fromKey, san) {
  const node = rep.nodes[fromKey];
  if (!node || !node.moves[san]) return;
  delete node.moves[san];
  prune(rep);
}

export function prune(rep) {
  const seen = new Set(bfsOrder(rep));
  for (const key of Object.keys(rep.nodes)) if (!seen.has(key)) delete rep.nodes[key];
  for (const key of Object.keys(rep.cards)) if (!isUserPosition(rep, key)) delete rep.cards[key];
}

export function bfsOrder(rep) {
  const order = [rep.root];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    for (const [, e] of edges(rep, order[i])) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        order.push(e.to);
      }
    }
  }
  return order;
}

export function stats(rep, now = Date.now()) {
  let positions = 0, due = 0, fresh = 0, nextDue = Infinity;
  for (const key of bfsOrder(rep)) {
    if (!isUserPosition(rep, key)) continue;
    positions++;
    const c = rep.cards[key];
    if (!c || c.state === 'new') fresh++;
    else if (c.due <= now) due++;
    else nextDue = Math.min(nextDue, c.due);
  }
  return { positions, due, fresh, nextDue };
}

/**
 * Positions to drill this session: everything due (including learning cards
 * coming due in the next few minutes), plus up to `newBudget` new positions,
 * earliest in the opening first.
 */
export function computeTargets(rep, now, newBudget) {
  const targets = new Set();
  let budget = newBudget;
  for (const key of bfsOrder(rep)) {
    if (!isUserPosition(rep, key)) continue;
    const c = rep.cards[key];
    if (!c || c.state === 'new') {
      if (budget > 0) {
        targets.add(key);
        budget--;
      }
    } else if (c.due <= now + LOOKAHEAD) {
      targets.add(key);
    }
  }
  return targets;
}

/** How many targets can still be reached from `key` (including itself). */
export function countReachable(rep, key, targets) {
  if (!targets.size) return 0;
  const stack = [key];
  const seen = new Set(stack);
  let n = 0;
  while (stack.length) {
    const k = stack.pop();
    if (targets.has(k)) n++;
    for (const [, e] of edges(rep, k)) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return n;
}

/** Choose an opponent reply, weighted toward branches with more to drill. */
export function pickOpponentMove(rep, key, targets, rand = Math.random) {
  const options = edges(rep, key)
    .map(([san, e]) => ({ san, edge: e, weight: countReachable(rep, e.to, targets) }))
    .filter((o) => o.weight > 0);
  if (!options.length) return null;
  const total = options.reduce((a, o) => a + o.weight, 0);
  let r = rand() * total;
  for (const o of options) {
    r -= o.weight;
    if (r < 0) return o;
  }
  return options[options.length - 1];
}

/** "1. e4", "1... e5" for a move at `ply` (0 = White's first move). */
export function formatMove(ply, san) {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}. ${san}` : `${n}... ${san}`;
}
