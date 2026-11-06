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
 * Positions to drill: everything due (including learning cards coming due in
 * the next few minutes), plus the unseen positions in `newKeys` (the lines
 * currently being memorised).
 */
export function computeTargets(rep, now, newKeys) {
  const targets = new Set();
  for (const key of bfsOrder(rep)) {
    if (!isUserPosition(rep, key)) continue;
    const c = rep.cards[key];
    if (!c || c.state === 'new') {
      if (newKeys && newKeys.has(key)) targets.add(key);
    } else if (c.due <= now + LOOKAHEAD) {
      targets.add(key);
    }
  }
  return targets;
}

/** Weight of an opponent move: named theory behind it (ready-made repertoires) or main line first. */
function edgeWeight(rep, key, san, index) {
  const w = rep.weights && rep.weights[`${key}|${san}`];
  return w || (index === 0 ? 2 : 1);
}

/**
 * Every complete line, from the first move to the end, most likely first.
 * `prob` multiplies the share of each opponent reply along the way, so the
 * lines you are most likely to meet come first.
 */
export function lines(rep, limit = 2000) {
  const out = [];
  const seen = new Set([rep.root]);
  const walk = (key, moves, keys, prob) => {
    if (out.length >= limit) return;
    const list = edges(rep, key).filter(([, e]) => !seen.has(e.to));
    if (!list.length) {
      if (moves.length) out.push({ moves, keys, endKey: key, prob });
      return;
    }
    const opponent = sideToMove(key) !== rep.color;
    const total = opponent ? list.reduce((a, [san], i) => a + edgeWeight(rep, key, san, i), 0) : 1;
    list.forEach(([san, e], i) => {
      seen.add(e.to);
      walk(e.to, [...moves, san], [...keys, key], prob * (opponent ? edgeWeight(rep, key, san, i) / total : 1));
      seen.delete(e.to);
    });
  };
  walk(rep.root, [], [], 1);
  out.forEach((l, i) => {
    l.order = i;
    l.id = l.moves.join(' ');
    l.userKeys = l.keys.filter((k) => sideToMove(k) === rep.color);
  });
  return out.sort((a, b) => b.prob - a.prob || a.order - b.order);
}

/** 'memorised' (every move of yours graduated), 'learning' (some seen) or 'new'. */
export function lineStatus(rep, line) {
  let seen = 0;
  let learned = 0;
  for (const k of line.userKeys) {
    const c = rep.cards[k];
    if (c && c.state !== 'new') seen++;
    if (c && c.state === 'review') learned++;
  }
  if (learned === line.userKeys.length) return 'memorised';
  return seen ? 'learning' : 'new';
}

/** The `n` highest-priority lines not yet memorised, and their unseen positions. */
export function activeBatch(rep, n = 3) {
  const all = lines(rep);
  const active = all.filter((l) => lineStatus(rep, l) !== 'memorised').slice(0, n);
  const newKeys = new Set();
  for (const l of active) {
    for (const k of l.userKeys) {
      const c = rep.cards[k];
      if (!c || c.state === 'new') newKeys.add(k);
    }
  }
  return { all, active, newKeys };
}

/** A line's name: the deepest named opening along it, if the repertoire has names. */
export function lineName(rep, line) {
  if (!rep.names) return null;
  const keys = [...line.keys, line.endKey];
  for (let i = keys.length - 1; i >= 0; i--) if (rep.names[keys[i]]) return rep.names[keys[i]];
  return null;
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
