// PGN import (with variations) and export for repertoires.

import { Chess } from './chesslib.js';
import { addMove, edges, posKey, START_FEN } from './repertoire.js';

const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;

export function tokenizePgn(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') {
      const j = text.indexOf(']', i);
      const end = j < 0 ? n : j;
      tokens.push({ t: 'tag', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === '{') {
      const j = text.indexOf('}', i);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (ch === ';' || (ch === '%' && (i === 0 || text[i - 1] === '\n'))) {
      const j = text.indexOf('\n', i);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (ch === '(') { tokens.push({ t: 'open' }); i++; continue; }
    if (ch === ')') { tokens.push({ t: 'close' }); i++; continue; }

    let j = i;
    while (j < n && !/[\s(){};[\]]/.test(text[j])) j++;
    const word = text.slice(i, j);
    i = j === i ? i + 1 : j;

    if (RESULT.test(word)) { tokens.push({ t: 'result' }); continue; }
    if (/^\$\d+$/.test(word)) continue; // NAG
    let san = word.replace(/^\d+\.+/, ''); // move number, possibly glued: "12.Nf3"
    san = san.replace(/[!?]+/g, '');
    if (!san || /^[\d.]+$/.test(san)) continue;
    san = san.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    tokens.push({ t: 'move', v: san });
  }
  return tokens;
}

/**
 * Merge every line (main line and variations) of every game in `text`
 * into `rep`. Games that start from a custom position are skipped.
 */
export function importPgn(rep, text) {
  const tokens = tokenizePgn(text);
  const result = { games: 0, added: 0, skipped: 0, errors: [] };
  const chess = new Chess();
  let headers = {};
  let stack = null;
  let skipGame = false;

  const begin = () => {
    const fen = headers.FEN;
    skipGame = Boolean(fen) && posKey(fen) !== rep.root;
    if (skipGame) result.skipped++;
    else result.games++;
    stack = [{ fen: fen || START_FEN, before: null, dead: false }];
  };
  const end = () => {
    stack = null;
    headers = {};
    skipGame = false;
  };

  for (const tok of tokens) {
    if (tok.t === 'tag') {
      if (stack) end(); // new game started without a result token
      const m = /^\s*(\w+)\s+"(.*)"\s*$/.exec(tok.v);
      if (m) headers[m[1]] = m[2];
      continue;
    }
    if (tok.t === 'result') {
      if (stack && stack.length === 1) end();
      continue;
    }
    if (!stack) begin();
    if (skipGame) continue;

    const frame = stack[stack.length - 1];
    if (tok.t === 'open') {
      // A variation replaces the last move played on the enclosing line.
      stack.push({ fen: frame.before, before: null, dead: frame.dead || frame.before === null });
      continue;
    }
    if (tok.t === 'close') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (frame.dead) continue;

    let move;
    try {
      chess.load(frame.fen);
      move = chess.move(tok.v);
    } catch {
      move = null;
    }
    if (!move) {
      frame.dead = true;
      if (result.errors.length < 5) result.errors.push(`"${tok.v}" isn't legal in that position, so the rest of that line was skipped.`);
      continue;
    }
    if (addMove(rep, posKey(frame.fen), move).added) result.added++;
    frame.before = frame.fen;
    frame.fen = move.after;
  }
  return result;
}

/** Write the repertoire as one PGN game with variations. */
export function exportPgn(rep) {
  const out = [];
  const seen = new Set([rep.root]);
  const num = (ply, san, force) => {
    const n = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) return `${n}. ${san}`;
    return force ? `${n}... ${san}` : san;
  };

  const line = (key, ply, forceNumber) => {
    const list = edges(rep, key);
    if (!list.length) return;
    const [mainSan, main] = list[0];
    const mainSeen = seen.has(main.to);
    seen.add(main.to);
    out.push(num(ply, mainSan, forceNumber));
    for (const [san, e] of list.slice(1)) {
      out.push('(' + num(ply, san, true));
      if (seen.has(e.to)) out.push('{transposes}');
      else {
        seen.add(e.to);
        line(e.to, ply + 1, false);
      }
      out[out.length - 1] += ')';
    }
    if (mainSeen) out.push('{transposes}');
    else line(main.to, ply + 1, list.length > 1);
  };
  line(rep.root, 0, false);
  out.push('*');

  const wrapped = [];
  let row = '';
  for (const tok of out) {
    if (row && row.length + tok.length + 1 > 79) {
      wrapped.push(row);
      row = tok;
    } else row = row ? `${row} ${tok}` : tok;
  }
  if (row) wrapped.push(row);

  const name = rep.name.replace(/["\\]/g, '');
  const side = rep.color === 'w' ? 'White' : 'Black';
  return `[Event "${name}"]\n[Site "Book Moves"]\n[White "${side === 'White' ? 'Repertoire' : '?'}"]\n[Black "${side === 'Black' ? 'Repertoire' : '?'}"]\n[Result "*"]\n\n${wrapped.join('\n')}\n`;
}
