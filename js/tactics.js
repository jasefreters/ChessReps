// Tactical Weaknesses: puzzle sets grouped by the weakness they exploit, a
// puzzle player (hint, solution, retry), and a setup board for adding your
// own puzzles. Your own puzzles stay in this browser; they aren't published.

import { Chess } from './chesslib.js';
import { Board } from './board.js';
import { PIECES } from './pieces.js';

let setsPromise = null;
function loadSets() {
  if (!setsPromise) {
    setsPromise = fetch(new URL('../data/puzzles.json', import.meta.url))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        setsPromise = null;
        throw err;
      });
  }
  return setsPromise;
}

/** The weakness each puzzle exploits, revealed once the puzzle is finished. */
const WEAKNESSES = {
  hanging: { name: 'Unprotected pieces', text: 'A piece nobody defends can simply be taken, or attacked with tempo.' },
  line: { name: 'Pieces on the same line', text: 'Pieces lined up on a rank, file or diagonal invite pins, skewers and discovered attacks.' },
  king: { name: 'Exposed king', text: 'A king with few defenders or no escape squares is open to checks and mating attacks.' },
  trapped: { name: 'Trapped pieces', text: 'A piece with no safe squares can be attacked and won.' },
  overload: { name: 'Overworked defenders', text: 'A defender doing two jobs can be lured away or removed.' },
  fork: { name: 'Double attacks', text: 'One move that attacks two targets at once, such as a fork by a knight, queen or pawn.' },
};

/** Every puzzle in one list, easiest first. Themes stay hidden so each puzzle is a mystery. */
function mixed(sets) {
  const seen = new Set();
  const all = [];
  for (const c of sets.categories) for (const p of c.puzzles) if (!seen.has(p.id)) { seen.add(p.id); all.push({ ...p, weakness: c.id }); }
  return all.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));
}

const uciMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const colorName = (c) => (c === 'w' ? 'White' : 'Black');
const RANK = { shown: 0, helped: 1, clean: 2 };

function fromLichess(p, i, n) {
  const moves = p.moves.split(' ');
  return {
    id: p.id, title: `Puzzle ${i + 1} of ${n}`, meta: `Rated ${p.rating}`,
    fen: p.fen, lead: moves[0], line: moves.slice(1), url: `https://lichess.org/training/${p.id}`,
    weakness: p.weakness || null,
  };
}

function fromMine(p, i, n) {
  return { id: p.id, title: p.title || `Puzzle ${i + 1}`, meta: `${i + 1} of ${n}`, fen: p.fen, lead: null, line: p.line, weakness: p.weakness || null };
}

/** The solution in notation with real move numbers, e.g. "12... Bxd2+ 13. Bxd2 Qxg4". */
function solutionText(p) {
  const c = new Chess(p.fen);
  if (p.lead) c.move(uciMove(p.lead));
  let n = Number(c.fen().split(' ')[5]) || 1;
  const parts = [];
  p.line.forEach((u, i) => {
    const turn = c.turn();
    const mv = c.move(uciMove(u));
    if (turn === 'w') parts.push(`${n}. ${mv.san}`);
    else {
      parts.push(i === 0 ? `${n}... ${mv.san}` : mv.san);
      n++;
    }
  });
  return parts.join(' ');
}

export function createTactics(ctx) {
  const { app, getData, persist, toast, esc, plural, go } = ctx;
  let board = null;
  let s = null; // player or editor state

  function cleanup() {
    if (s && s.timer) clearTimeout(s.timer);
    s = null;
    board = null;
  }

  function progressFor(ids) {
    const prog = getData().puzzleProgress;
    let solved = 0;
    let clean = 0;
    for (const id of ids) {
      if (prog[id]) solved++;
      if (prog[id] && prog[id].result === 'clean') clean++;
    }
    return { solved, clean };
  }

  // ------------------------------------------------------------ index

  async function renderIndex() {
    const mine = getData().myPuzzles;
    const mineProg = progressFor(mine.map((p) => p.id));
    app.innerHTML = `
    <section class="home">
      <div class="today tactics-hero">
        <div class="today-text">
          <p class="eyebrow">Tactical Weaknesses</p>
          <h1>Spot the weakness, then find the forcing move</h1>
          <p class="sub">There's no label telling you what to look for, just like in a real game. Find what's wrong in your opponent's position, then look for checks, captures and threats. Hint shows which piece to move; Solution plays out the answer.</p>
        </div>
      </div>
      <ul class="rep-list" id="tac-sets"><li class="empty">Loading puzzles…</li></ul>

      <div class="section-head">
        <h2 class="section-title">My puzzles</h2>
        <p class="hint">Puzzles you add are saved in this browser only and aren't published on the site, so this is the place for puzzles from your own books. They're included in your backup file.</p>
      </div>
      <div class="row">
        <a class="btn primary" href="#puzzle-new">Add a puzzle</a>
        ${mine.length ? `<a class="btn" href="#puzzles-mine">Solve my puzzles</a><span class="hint">${mine.length} added · ${mineProg.solved} solved</span>` : ''}
      </div>
      ${mine.length ? `<ul class="my-puzzles">${mine.map((p) => `
        <li><span>${esc(p.title || 'Untitled puzzle')}</span>
          <button class="btn ghost small" type="button" data-tac="delete" data-id="${esc(p.id)}">${s && s.confirm === p.id ? 'Confirm delete' : 'Delete'}</button></li>`).join('')}
      </ul>` : ''}
    </section>`;

    const list = document.getElementById('tac-sets');
    try {
      const sets = await loadSets();
      if (document.getElementById('tac-sets') !== list) return;
      const all = mixed(sets);
      const pr = progressFor(all.map((p) => p.id));
      const pct = Math.round((pr.solved / all.length) * 100);
      const label = pr.solved ? (pr.solved < all.length ? 'Continue' : 'Practise again') : 'Start';
      list.innerHTML = `
        <li class="rep">
          <div class="rep-main">
            <h3><a href="#puzzles-all">Mixed puzzles</a></h3>
            <p class="meta"><span>${plural(all.length, 'puzzle')}</span><span>Rated ${all[0].rating}–${all[all.length - 1].rating}, easiest first</span><span>${pr.solved} solved</span><span>${pr.clean} first try</span></p>
            <div class="bar" role="img" aria-label="${pct}% solved"><span style="width:${pct}%"></span></div>
          </div>
          <div class="rep-actions"><a class="btn ${pr.solved < all.length ? 'primary' : ''}" href="#puzzles-all">${label}</a></div>
        </li>`;
      list.insertAdjacentHTML('afterend', `<p class="hint credit">Puzzles from the <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess puzzle database</a> (public domain).</p>`);
    } catch {
      if (document.getElementById('tac-sets') === list) {
        list.innerHTML = "<li class=\"empty\">The puzzles couldn't be loaded. Check your connection and reload the page.</li>";
      }
    }
  }

  // ------------------------------------------------------------ player

  async function renderSet(setId) {
    const hash = location.hash;
    let puzzles;
    let name;
    let blurb = '';
    if (setId === 'mine') {
      const mine = getData().myPuzzles;
      puzzles = mine.map((p, i) => fromMine(p, i, mine.length));
      name = 'My puzzles';
    } else {
      app.innerHTML = '<p class="loading">Loading puzzles…</p>';
      let sets;
      try {
        sets = await loadSets();
      } catch {
        app.innerHTML = "<p class=\"empty\">The puzzles couldn't be loaded. Check your connection and reload the page.</p>";
        return;
      }
      if (location.hash !== hash) return;
      const all = mixed(sets);
      puzzles = all.map((p, i) => fromLichess(p, i, all.length));
      name = 'Mixed puzzles';
    }
    if (!puzzles.length) return go('tactics');

    app.innerHTML = `
    <section class="workspace">
      <div class="board-col"><div id="board" class="board-host"></div></div>
      <aside class="panel" id="pz-panel" aria-live="polite"></aside>
    </section>`;
    board = new Board(document.getElementById('board'), {
      canMove: (c) => Boolean(s && s.awaiting && c === s.userColor),
      onMove: playerMove,
    });
    const prog = getData().puzzleProgress;
    const firstOpen = puzzles.findIndex((p) => !prog[p.id]);
    s = { kind: 'player', setId, name, blurb, puzzles, i: firstOpen < 0 ? 0 : firstOpen, timer: null };
    startPuzzle();
  }

  function startPuzzle() {
    clearTimeout(s.timer);
    const p = s.puzzles[s.i];
    Object.assign(s, {
      p, chess: new Chess(p.fen), idx: 0, mistakes: 0, hinted: false, shown: false,
      done: false, awaiting: false, played: [], lastMove: null,
    });
    s.userColor = p.lead ? (s.chess.turn() === 'w' ? 'b' : 'w') : s.chess.turn();
    board.marks = {};
    board.setArrows([]);
    board.setOrientation(s.userColor);
    board.setGame(s.chess, null);
    if (p.lead) {
      setStatus('Watch your opponent\'s move', '', 'wait');
      s.timer = setTimeout(() => {
        const mv = s.chess.move(uciMove(p.lead));
        s.lastMove = [mv.from, mv.to];
        board.setGame(s.chess, s.lastMove);
        s.awaiting = true;
        setStatus(`${colorName(s.userColor)} to move`, `Your opponent played ${mv.san}. Find the best move.`, 'ask');
      }, 700);
    } else {
      s.awaiting = true;
      setStatus(`${colorName(s.userColor)} to move`, 'Find the best move.', 'ask');
    }
  }

  function playerMove(m) {
    if (!s || s.kind !== 'player' || !s.awaiting) return false;
    const test = new Chess(s.chess.fen());
    let mv;
    try {
      mv = test.move(m);
    } catch {
      return false;
    }
    const uci = mv.from + mv.to + (mv.promotion || '');
    const last = s.idx === s.p.line.length - 1;
    if (uci !== s.p.line[s.idx] && !(last && test.isCheckmate())) {
      s.mistakes++;
      board.mark(mv.to, 'bad', 700);
      setStatus(`${mv.san} isn't it`, 'Try again, or use Hint or Solution.', 'bad');
      return false;
    }
    s.chess.move(m);
    s.played.push(mv.san);
    s.idx++;
    s.lastMove = [mv.from, mv.to];
    s.awaiting = false;
    board.marks = {};
    board.setGame(s.chess, s.lastMove);
    board.mark(mv.to, 'good', 600);
    if (s.idx >= s.p.line.length) {
      solved();
      return true;
    }
    setStatus('Correct', `${mv.san}. Keep going.`, 'good');
    s.timer = setTimeout(() => {
      if (!s || s.kind !== 'player') return;
      const r = s.chess.move(uciMove(s.p.line[s.idx]));
      s.played.push(r.san);
      s.idx++;
      s.lastMove = [r.from, r.to];
      board.setGame(s.chess, s.lastMove);
      if (s.idx >= s.p.line.length) return solved();
      s.awaiting = true;
      setStatus('Correct', `Your opponent replied ${r.san}. Find the next move.`, 'ask');
    }, 550);
    return true;
  }

  function record(result) {
    const data = getData();
    const prev = data.puzzleProgress[s.p.id];
    if (!prev || RANK[result] > RANK[prev.result]) data.puzzleProgress[s.p.id] = { result, at: Date.now() };
    persist();
  }

  function solved() {
    s.done = true;
    s.awaiting = false;
    board.setArrows([]);
    const result = s.shown ? 'shown' : s.mistakes || s.hinted ? 'helped' : 'clean';
    record(result);
    const title = { clean: 'Solved first try', helped: 'Solved', shown: 'Solution' }[result];
    setStatus(title, solutionText(s.p), result === 'shown' ? 'done' : 'good');
  }

  function hint() {
    if (!s.awaiting) return;
    s.hinted = true;
    board.mark(s.p.line[s.idx].slice(0, 2), 'hint');
    setStatus('Hint', 'Move the highlighted piece.', 'ask');
  }

  function showSolution() {
    if (s.done || (!s.awaiting && s.idx === 0 && s.p.lead)) return;
    s.shown = true;
    s.awaiting = false;
    clearTimeout(s.timer);
    setStatus('Solution', solutionText(s.p), 'done');
    const stepMove = () => {
      if (!s || s.kind !== 'player') return;
      if (s.idx >= s.p.line.length) return solved();
      const u = s.p.line[s.idx];
      board.marks = {};
      board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'answer' }]);
      s.timer = setTimeout(() => {
        if (!s || s.kind !== 'player') return;
        const mv = s.chess.move(uciMove(u));
        s.played.push(mv.san);
        s.idx++;
        s.lastMove = [mv.from, mv.to];
        board.setArrows([]);
        board.setGame(s.chess, s.lastMove);
        renderPanel();
        s.timer = setTimeout(stepMove, 600);
      }, 700);
    };
    stepMove();
  }

  function setStatus(title, text, tone) {
    s.status = { title, text, tone };
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById('pz-panel');
    if (!panel || !s || s.kind !== 'player') return;
    const n = s.puzzles.length;
    const pr = progressFor(s.puzzles.map((p) => p.id));
    const res = getData().puzzleProgress[s.p.id];
    const badge = res ? `<span class="side-chip">${{ clean: 'Solved first try', helped: 'Solved with help', shown: 'Solution seen' }[res.result]}</span>` : '';
    panel.innerHTML = `
      <a class="back" href="#tactics">← Tactical Weaknesses</a>
      <div class="panel-head">
        <p class="eyebrow">${esc(s.name)}</p>
        <h2 class="panel-title">${esc(s.p.title)}</h2>
        <p class="meta"><span>${esc(s.p.meta)}</span><span>${pr.solved} of ${n} solved</span></p>
        ${badge}
      </div>
      ${s.blurb ? `<p class="hint">${esc(s.blurb)}</p>` : ''}
      <div class="status tone-${s.status.tone}">
        <p class="status-title">${esc(s.status.title)}</p>
        <p class="status-text">${esc(s.status.text)}</p>
      </div>
      <div class="row">
        <button class="btn" type="button" data-tac="hint" ${s.awaiting && !s.hinted ? '' : 'disabled'}>Hint</button>
        <button class="btn" type="button" data-tac="solution" ${s.done || s.shown ? 'disabled' : ''}>Solution</button>
        <button class="btn ghost" type="button" data-tac="retry">Retry</button>
      </div>
      <div class="row">
        <button class="btn" type="button" data-tac="prev" ${n > 1 ? '' : 'disabled'}>← Previous</button>
        <button class="btn ${s.done ? 'primary' : ''}" type="button" data-tac="next" ${n > 1 ? '' : 'disabled'}>Next puzzle →</button>
      </div>
      ${s.done && WEAKNESSES[s.p.weakness] ? `
      <div class="weakness">
        <p class="label">The weakness</p>
        <p class="weakness-name">${esc(WEAKNESSES[s.p.weakness].name)}</p>
        <p class="hint">${esc(WEAKNESSES[s.p.weakness].text)}</p>
      </div>` : ''}
      <div class="block">
        <h3 class="label">Moves played</h3>
        ${s.played.length ? `<p class="line">${s.played.map((m) => `<span class="ply">${esc(m)}</span>`).join(' ')}</p>` : '<p class="empty">None yet</p>'}
      </div>
      ${s.p.url && s.done ? `<p class="hint"><a href="${s.p.url}" target="_blank" rel="noopener">Open this puzzle on Lichess</a></p>` : ''}`;
  }

  // ------------------------------------------------------------ editor

  const TOOLS = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

  function renderEditor() {
    app.innerHTML = `
    <section class="workspace">
      <div class="board-col">
        <div id="board" class="board-host"></div>
        <div class="board-bar"><button class="btn" type="button" data-tac="ed-flip">Flip board</button></div>
      </div>
      <aside class="panel" id="pe-panel"></aside>
    </section>`;
    s = { kind: 'editor', step: 'setup', pieces: {}, tool: 'wP', side: 'w', title: '', chess: null, fen: null, line: [], sans: [], lastMove: null, msg: '' };
    board = new Board(document.getElementById('board'), {
      onSquareClick: placePiece,
      canMove: () => s && s.kind === 'editor' && s.step === 'record',
      onMove: recordMove,
    });
    board.setPieces(s.pieces);
    renderEditorPanel();
  }

  function placePiece(sq) {
    if (!s || s.step !== 'setup') return;
    if (s.tool === 'erase' || s.pieces[sq] === s.tool) delete s.pieces[sq];
    else s.pieces[sq] = s.tool;
    board.setPieces(s.pieces);
  }

  function buildFen() {
    let fen = '';
    for (let r = 8; r >= 1; r--) {
      let empty = 0;
      for (const f of 'abcdefgh') {
        const p = s.pieces[f + r];
        if (!p) { empty++; continue; }
        if (empty) { fen += empty; empty = 0; }
        fen += p[0] === 'w' ? p[1] : p[1].toLowerCase();
      }
      if (empty) fen += empty;
      if (r > 1) fen += '/';
    }
    const P = s.pieces;
    let castle = '';
    if (P.e1 === 'wK' && P.h1 === 'wR') castle += 'K';
    if (P.e1 === 'wK' && P.a1 === 'wR') castle += 'Q';
    if (P.e8 === 'bK' && P.h8 === 'bR') castle += 'k';
    if (P.e8 === 'bK' && P.a8 === 'bR') castle += 'q';
    return `${fen} ${s.side} ${castle || '-'} - 0 1`;
  }

  function piecesFromChess(c) {
    const map = {};
    for (const row of c.board()) for (const p of row) if (p) map[p.square] = p.color + p.type.toUpperCase();
    return map;
  }

  function recordMove(m) {
    if (!s || s.step !== 'record') return false;
    let mv;
    try {
      mv = s.chess.move(m);
    } catch {
      return false;
    }
    s.line.push(mv.from + mv.to + (mv.promotion || ''));
    s.sans.push(mv.san);
    s.lastMove = [mv.from, mv.to];
    board.setGame(s.chess, s.lastMove);
    renderEditorPanel();
    return true;
  }

  function renderEditorPanel() {
    const panel = document.getElementById('pe-panel');
    if (!panel || !s || s.kind !== 'editor') return;
    if (s.step === 'setup') {
      panel.innerHTML = `
        <a class="back" href="#tactics">← Tactical Weaknesses</a>
        <div class="panel-head"><p class="eyebrow">Add a puzzle · step 1 of 2</p><h2 class="panel-title">Set up the position</h2></div>
        <p class="hint">Pick a piece, then click squares to place it. Click a piece again to remove it.</p>
        <div class="palette" role="group" aria-label="Pieces">
          ${TOOLS.map((t) => `<button type="button" class="palette-btn ${s.tool === t ? 'on' : ''}" data-tac="tool" data-tool="${t}" aria-label="${colorName(t[0])} ${{ K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' }[t[1]]}" style="background-image:url(&quot;${PIECES[t]}&quot;)"></button>`).join('')}
          <button type="button" class="palette-btn erase ${s.tool === 'erase' ? 'on' : ''}" data-tac="tool" data-tool="erase">Erase</button>
        </div>
        <fieldset class="field side-pick">
          <legend>To move</legend>
          <label><input type="radio" name="pe-side" id="pe-white" value="w" ${s.side === 'w' ? 'checked' : ''}> White</label>
          <label><input type="radio" name="pe-side" id="pe-black" value="b" ${s.side === 'b' ? 'checked' : ''}> Black</label>
        </fieldset>
        <div class="row">
          <button class="btn ghost" type="button" data-tac="ed-clear">Clear board</button>
          <button class="btn ghost" type="button" data-tac="ed-startpos">Starting position</button>
        </div>
        <div class="field">
          <label for="pe-fen">Or paste a FEN</label>
          <div class="row"><input id="pe-fen" spellcheck="false" autocomplete="off" placeholder="r1bqkbnr/pppp1ppp/2n5/4p3/…"><button class="btn" type="button" data-tac="ed-fen">Load</button></div>
        </div>
        <p class="form-msg" role="status">${esc(s.msg)}</p>
        <button class="btn primary" type="button" data-tac="ed-next">Next: play the solution</button>`;
    } else {
      panel.innerHTML = `
        <a class="back" href="#tactics">← Tactical Weaknesses</a>
        <div class="panel-head"><p class="eyebrow">Add a puzzle · step 2 of 2</p><h2 class="panel-title">Play the solution</h2></div>
        <p class="hint">Play the winning moves on the board, including your opponent's replies. The puzzle starts with ${colorName(s.side)} to move.</p>
        <div class="block">
          <h3 class="label">Solution</h3>
          ${s.sans.length ? `<p class="line">${s.sans.map((m) => `<span class="ply">${esc(m)}</span>`).join(' ')}</p>` : '<p class="empty">No moves yet</p>'}
        </div>
        <div class="row">
          <button class="btn ghost" type="button" data-tac="ed-undo" ${s.sans.length ? '' : 'disabled'}>Undo move</button>
          <button class="btn ghost" type="button" data-tac="ed-back">Back to setup</button>
        </div>
        <div class="field">
          <label for="pe-weak">Weakness (shown after solving)</label>
          <select id="pe-weak">
            <option value="">Not set</option>
            ${Object.entries(WEAKNESSES).map(([id, w]) => `<option value="${id}" ${s.weakness === id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="pe-title">Name</label>
          <input id="pe-title" maxlength="80" value="${esc(s.title)}" placeholder="Chapter 1 · Puzzle 1">
        </div>
        <p class="form-msg" role="status">${esc(s.msg)}</p>
        <button class="btn primary" type="button" data-tac="ed-save" ${s.sans.length ? '' : 'disabled'}>Save puzzle</button>`;
    }
  }

  // ------------------------------------------------------------ events

  const handlers = {
    hint: () => hint(),
    solution: () => showSolution(),
    retry: () => startPuzzle(),
    next: () => { s.i = (s.i + 1) % s.puzzles.length; startPuzzle(); },
    prev: () => { s.i = (s.i - 1 + s.puzzles.length) % s.puzzles.length; startPuzzle(); },
    delete: (el) => {
      const id = el.dataset.id;
      if (!s || s.confirm !== id) {
        s = { kind: 'index', confirm: id };
        renderIndex();
        return;
      }
      const data = getData();
      data.myPuzzles = data.myPuzzles.filter((p) => p.id !== id);
      delete data.puzzleProgress[id];
      persist();
      s = null;
      renderIndex();
      toast('Puzzle deleted');
    },
    tool: (el) => { s.tool = el.dataset.tool; renderEditorPanel(); },
    'ed-flip': () => board.flip(),
    'ed-clear': () => { s.pieces = {}; s.msg = ''; board.setPieces(s.pieces); renderEditorPanel(); },
    'ed-startpos': () => { s.pieces = piecesFromChess(new Chess()); s.side = 'w'; s.msg = ''; board.setPieces(s.pieces); renderEditorPanel(); },
    'ed-fen': () => {
      const text = document.getElementById('pe-fen').value.trim();
      try {
        const c = new Chess(text);
        s.pieces = piecesFromChess(c);
        s.side = c.turn();
        s.msg = 'Position loaded.';
      } catch (err) {
        s.msg = `That FEN couldn't be read: ${err.message}`;
      }
      board.setPieces(s.pieces);
      renderEditorPanel();
    },
    'ed-next': () => {
      const fen = buildFen();
      try {
        s.chess = new Chess(fen);
      } catch (err) {
        s.msg = `This position isn't legal yet: ${err.message}`;
        renderEditorPanel();
        return;
      }
      if (s.chess.isGameOver()) {
        s.msg = 'There are no moves to play in this position. Check the pieces and who is to move.';
        renderEditorPanel();
        return;
      }
      s.fen = s.chess.fen();
      s.step = 'record';
      s.line = [];
      s.sans = [];
      s.msg = '';
      board.opts.onSquareClick = null;
      board.setOrientation(s.side);
      board.setGame(s.chess, null);
      renderEditorPanel();
    },
    'ed-undo': () => {
      s.chess.undo();
      s.line.pop();
      s.sans.pop();
      board.setGame(s.chess, null);
      renderEditorPanel();
    },
    'ed-back': () => {
      s.step = 'setup';
      s.msg = '';
      board.opts.onSquareClick = placePiece;
      board.setPieces(s.pieces);
      renderEditorPanel();
    },
    'ed-save': () => {
      const title = document.getElementById('pe-title').value.trim();
      const data = getData();
      const weakness = document.getElementById('pe-weak').value || null;
      data.myPuzzles.push({ id: `my-${Math.random().toString(36).slice(2, 10)}`, title, weakness, fen: s.fen, line: s.line.slice(), created: Date.now() });
      persist();
      toast(`Saved ${title || 'puzzle'}`);
      // Ready for the next one: keep the editor open with a clear board.
      s.step = 'setup';
      s.pieces = {};
      s.title = '';
      s.msg = `Saved. ${data.myPuzzles.length} of your puzzles so far. Set up the next one, or go back to solve them.`;
      board.opts.onSquareClick = placePiece;
      board.setPieces(s.pieces);
      renderEditorPanel();
    },
  };

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tac]');
    if (!el || el.disabled) return;
    const fn = handlers[el.dataset.tac];
    if (fn && (s || el.dataset.tac === 'delete')) fn(el);
  });
  app.addEventListener('change', (e) => {
    if (s && s.kind === 'editor' && e.target.name === 'pe-side') s.side = e.target.value;
    if (s && s.kind === 'editor' && e.target.id === 'pe-weak') s.weakness = e.target.value;
  });
  app.addEventListener('input', (e) => {
    if (s && s.kind === 'editor' && e.target.id === 'pe-title') s.title = e.target.value;
  });

  return { renderIndex, renderSet, renderEditor, cleanup };
}
