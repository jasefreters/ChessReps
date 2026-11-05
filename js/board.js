// A small interactive chessboard: click or drag to move, promotion picker,
// last-move and feedback highlights, and arrows.

import { PIECES } from './pieces.js';
import { play } from './sound.js';

const FILES = 'abcdefgh';
const SVGNS = 'http://www.w3.org/2000/svg';

export class Board {
  /**
   * @param {HTMLElement} el
   * @param {{ onMove?: (m: {from: string, to: string, promotion?: string}) => boolean,
   *           canMove?: (color: 'w'|'b') => boolean }} opts
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.orientation = 'w';
    this.game = null;
    this.pieces = {};
    this.selected = null;
    this.lastMove = null;
    this.marks = {};
    this.arrows = [];
    this.drag = null;
    this.ghost = null;

    el.classList.add('board');
    el.replaceChildren();
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.squares = [];
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      this.grid.appendChild(d);
      this.squares.push(d);
    }
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.setAttribute('class', 'board-arrows');
    this.svg.setAttribute('aria-hidden', 'true');
    this.promo = document.createElement('div');
    this.promo.className = 'board-promo';
    this.promo.hidden = true;
    el.append(this.grid, this.svg, this.promo);

    this.grid.addEventListener('pointerdown', (e) => this.onDown(e));
    this.grid.addEventListener('pointermove', (e) => this.onDrag(e));
    this.grid.addEventListener('pointerup', (e) => this.onUp(e));
    this.grid.addEventListener('pointercancel', () => this.cancelDrag());
    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setOrientation(color) {
    this.orientation = color;
    this.render();
  }

  flip() {
    this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
  }

  /** Show the position of a chess.js instance (also used for legal moves). */
  setGame(game, lastMove = null) {
    const before = this.pieces;
    this.game = game;
    this.lastMove = lastMove;
    this.selected = null;
    this.pieces = {};
    for (const row of game.board()) {
      for (const p of row) if (p) this.pieces[p.square] = p.color + p.type.toUpperCase();
    }
    // Sound only when a move actually changed the position.
    const changed = Object.keys(before).length !== Object.keys(this.pieces).length ||
      Object.entries(this.pieces).some(([sq, p]) => before[sq] !== p);
    if (lastMove && changed && Object.keys(before).length) {
      if (game.inCheck()) play('check');
      else play(Object.keys(this.pieces).length < Object.keys(before).length ? 'capture' : 'move');
    }
    this.promo.hidden = true;
    this.render();
  }

  /** Show pieces without a game (position setup). `map` is square -> 'wK' etc. */
  setPieces(map) {
    this.game = null;
    this.lastMove = null;
    this.selected = null;
    this.pieces = { ...map };
    this.render();
  }

  setArrows(list) {
    this.arrows = list;
    this.renderArrows();
  }

  mark(square, kind, ms = 0) {
    if (kind === 'bad') play('wrong');
    if (kind === 'good') play('correct');
    this.marks[square] = kind;
    this.render();
    if (ms) {
      setTimeout(() => {
        if (this.marks[square] === kind) {
          delete this.marks[square];
          this.render();
        }
      }, ms);
    }
  }

  clearMarks() {
    this.marks = {};
    this.render();
  }

  squareAt(index) {
    const row = Math.floor(index / 8);
    const col = index % 8;
    return this.orientation === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
  }

  indexOf(sq) {
    const col = FILES.indexOf(sq[0]);
    const rank = Number(sq[1]);
    return this.orientation === 'w' ? (8 - rank) * 8 + col : (rank - 1) * 8 + (7 - col);
  }

  legalFrom(sq) {
    return sq && this.game ? this.game.moves({ square: sq, verbose: true }) : [];
  }

  render() {
    const dests = new Set(this.legalFrom(this.selected).map((m) => m.to));
    for (let i = 0; i < 64; i++) {
      const sq = this.squareAt(i);
      const d = this.squares[i];
      const file = FILES.indexOf(sq[0]);
      const rank = Number(sq[1]);
      let cls = 'sq ' + ((file + rank) % 2 === 1 ? 'dark' : 'light');
      if (this.lastMove && (sq === this.lastMove[0] || sq === this.lastMove[1])) cls += ' last';
      if (sq === this.selected) cls += ' selected';
      if (dests.has(sq)) cls += this.pieces[sq] ? ' dest capture' : ' dest';
      if (this.marks[sq]) cls += ' mark-' + this.marks[sq];
      d.className = cls;
      d.dataset.square = sq;

      const kids = [];
      const p = this.pieces[sq];
      if (p) {
        const img = document.createElement('div');
        img.className = 'piece' + (this.drag && this.drag.active && this.drag.from === sq ? ' lifted' : '');
        img.style.backgroundImage = `url("${PIECES[p]}")`;
        kids.push(img);
      }
      if (i >= 56) kids.push(coord('coord-file', sq[0]));
      if (i % 8 === 0) kids.push(coord('coord-rank', sq[1]));
      d.replaceChildren(...kids);
    }
    this.renderArrows();
  }

  renderArrows() {
    this.svg.replaceChildren();
    for (const a of this.arrows) {
      const path = document.createElementNS(SVGNS, 'polygon');
      path.setAttribute('points', arrowPoints(this.center(a.from), this.center(a.to)));
      path.setAttribute('class', `arrow arrow-${a.kind || 'main'}`);
      this.svg.appendChild(path);
    }
  }

  center(sq) {
    const i = this.indexOf(sq);
    return [(i % 8) + 0.5, Math.floor(i / 8) + 0.5];
  }

  squareFromEvent(e) {
    const r = this.grid.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
    const col = Math.floor(x / (r.width / 8));
    const row = Math.floor(y / (r.height / 8));
    return this.squareAt(row * 8 + col);
  }

  canMovePiece(sq) {
    const p = this.pieces[sq];
    if (!p || !this.game || p[0] !== this.game.turn()) return false;
    return this.opts.canMove ? this.opts.canMove(p[0]) : true;
  }

  onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.promo.hidden) return;
    const sq = this.squareFromEvent(e);
    if (!sq) return;
    if (this.opts.onSquareClick) {
      e.preventDefault();
      this.opts.onSquareClick(sq);
      return;
    }
    if (this.selected && this.selected !== sq && this.legalFrom(this.selected).some((m) => m.to === sq)) {
      e.preventDefault();
      this.tryMove(this.selected, sq);
      return;
    }
    if (this.canMovePiece(sq)) {
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.drag = { from: sq, x: e.clientX, y: e.clientY, active: false, wasSelected, id: e.pointerId };
      try { this.grid.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.render();
      return;
    }
    this.selected = null;
    this.render();
  }

  onDrag(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.active = true;
      this.ghost = document.createElement('div');
      this.ghost.className = 'piece ghost';
      this.ghost.style.backgroundImage = `url("${PIECES[this.pieces[d.from]]}")`;
      this.el.appendChild(this.ghost);
      this.render();
    }
    const r = this.el.getBoundingClientRect();
    const s = r.width / 8;
    this.ghost.style.width = `${s}px`;
    this.ghost.style.height = `${s}px`;
    this.ghost.style.transform = `translate(${e.clientX - r.left - s / 2}px, ${e.clientY - r.top - s / 2}px)`;
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { this.grid.releasePointerCapture(d.id); } catch { /* ignore */ }
    this.removeGhost();
    const sq = this.squareFromEvent(e);
    if (d.active) {
      if (sq && sq !== d.from) {
        this.tryMove(d.from, sq);
        return;
      }
      this.render();
      return;
    }
    if (d.wasSelected) this.selected = null;
    this.render();
  }

  cancelDrag() {
    this.drag = null;
    this.removeGhost();
    this.render();
  }

  removeGhost() {
    if (this.ghost) this.ghost.remove();
    this.ghost = null;
  }

  tryMove(from, to) {
    const legal = this.legalFrom(from).filter((m) => m.to === to);
    if (!legal.length) {
      this.selected = this.canMovePiece(to) ? to : null;
      this.render();
      return;
    }
    if (legal.some((m) => m.promotion)) {
      this.askPromotion(from, to, this.game.turn());
      return;
    }
    this.commit({ from, to });
  }

  commit(m) {
    this.selected = null;
    const ok = this.opts.onMove ? this.opts.onMove(m) : false;
    if (!ok) this.render();
  }

  askPromotion(from, to, color) {
    this.promo.replaceChildren();
    const label = document.createElement('p');
    label.textContent = 'Promote to';
    this.promo.appendChild(label);
    const row = document.createElement('div');
    row.className = 'promo-row';
    const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
    for (const t of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'promo-btn';
      b.setAttribute('aria-label', names[t]);
      b.style.backgroundImage = `url("${PIECES[color + t.toUpperCase()]}")`;
      b.addEventListener('click', () => {
        this.promo.hidden = true;
        this.commit({ from, to, promotion: t });
      });
      row.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn ghost small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.promo.hidden = true;
      this.selected = null;
      this.render();
    });
    this.promo.append(row, cancel);
    this.promo.hidden = false;
  }
}

function coord(cls, text) {
  const s = document.createElement('span');
  s.className = `coord ${cls}`;
  s.textContent = text;
  return s;
}

function arrowPoints([ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const shaft = 0.09;
  const head = 0.24;
  const headLen = 0.42;
  const sx = ax + ux * 0.18;
  const sy = ay + uy * 0.18;
  const ex = bx - ux * 0.08;
  const ey = by - uy * 0.08;
  const hx = ex - ux * headLen;
  const hy = ey - uy * headLen;
  const pts = [
    [sx + nx * shaft, sy + ny * shaft],
    [hx + nx * shaft, hy + ny * shaft],
    [hx + nx * head, hy + ny * head],
    [ex, ey],
    [hx - nx * head, hy - ny * head],
    [hx - nx * shaft, hy - ny * shaft],
    [sx - nx * shaft, sy - ny * shaft],
  ];
  return pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');
}
