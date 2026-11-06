import { Chess } from './chesslib.js';
import { Board } from './board.js';
import * as R from './repertoire.js';
import { importPgn, exportPgn } from './pgn.js';
import { schedule, introduce, dayKey, startOfDay, DAY, MINUTE } from './srs.js';
import { loadData, saveData, defaultData, normalize } from './store.js';
import { SAMPLES } from './samples.js';
import { loadOpenings, searchOpenings, numbered, guessColor } from './library.js';
import { PRESETS, presetLines, presetPgn } from './presets.js';
import { createTactics } from './tactics.js';
import { play, soundOn, setSound } from './sound.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const storageNote = document.getElementById('storage-note');

const ICONS = {
  start: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4v12M15 4.5 8 10l7 5.5z"/></svg>',
  back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4.5 6 10l7 5.5z"/></svg>',
  flip: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3v13M3.5 12.5 7 16l3.5-3.5M13 17V4M9.5 7.5 13 4l3.5 3.5"/></svg>',
};

// ---------------------------------------------------------------- state

let storageOk = true;
let data = loadData();
if (!data) {
  data = defaultData();
  for (const sample of SAMPLES) {
    const rep = R.createRepertoire({ name: sample.name, color: sample.color });
    importPgn(rep, sample.pgn);
    data.repertoires.push(rep);
  }
  persist();
}

const ui = { pendingDelete: null, pendingRemove: null, pendingRestore: null };
let board = null;
let editor = null;
let session = null;
let toastTimer = null;
/** Pause before the opponent answers a correct move: just long enough to see your move land. */
const REPLY_DELAY = 150;

function persist() {
  storageOk = saveData(data);
  if (storageNote) storageNote.hidden = storageOk;
}

function refreshDaily() {
  const today = dayKey(Date.now());
  if (data.daily.date !== today) {
    data.daily = { date: today, newSeen: 0 };
    persist();
  }
}

function newBudget() {
  return Infinity; // no daily limit: training introduces new moves for as long as you keep going
}

function findRep(id) {
  return data.repertoires.find((r) => r.id === id) || null;
}

function hasWork(rep) {
  const s = R.stats(rep);
  return s.due > 0 || (s.fresh > 0 && newBudget() > 0);
}

// ---------------------------------------------------------------- helpers

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const colorName = (c) => (c === 'w' ? 'White' : 'Black');
const sideChip = (c) => `<span class="side-chip side-${c}">${colorName(c)}</span>`;

function when(ts) {
  if (!Number.isFinite(ts)) return '';
  const now = Date.now();
  const diff = ts - now;
  if (diff <= 0) return 'now';
  if (diff < 60 * MINUTE) return `in ${Math.max(1, Math.ceil(diff / MINUTE))} min`;
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
  if (days <= 0) return 'later today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function lineHtml(sans, clickable = false) {
  if (!sans.length) return '<p class="empty">Starting position</p>';
  const items = sans.map((san, i) => {
    const num = i % 2 === 0 ? `<span class="num">${i / 2 + 1}.</span>` : '';
    const cls = `ply${i === sans.length - 1 ? ' current' : ''}`;
    const body = esc(san);
    const ply = clickable
      ? `<button type="button" class="${cls}" data-act="ed-jump" data-idx="${i}">${body}</button>`
      : `<span class="${cls}">${body}</span>`;
    return `${num}${ply}`;
  });
  return `<p class="line">${items.join(' ')}</p>`;
}

const arrowOf = (edge, kind) => ({ from: edge.uci.slice(0, 2), to: edge.uci.slice(2, 4), kind });

// ---------------------------------------------------------------- routing

function route() {
  tactics.cleanup();
  if (session && session.timer) clearTimeout(session.timer);
  session = null;
  editor = null;
  board = null;
  ui.pendingDelete = ui.pendingRemove = ui.pendingRestore = null;
  const h = location.hash.replace(/^#/, '');
  document.querySelectorAll('.topbar nav a').forEach((a) => {
    const target = a.getAttribute('href').slice(1);
    const onTactics = h === 'tactics' || h.startsWith('puzzle');
    a.classList.toggle('active', target === 'tactics' ? onTactics : !onTactics);
  });
  if (h === 'tactics') tactics.renderIndex();
  else if (h === 'puzzle-new') tactics.renderEditor();
  else if (h.startsWith('puzzles-')) tactics.renderSet(h.slice(8));
  else if (h.startsWith('edit-')) renderEdit(h.slice(5));
  else if (h === 'train-all') renderTrain(null);
  else if (h.startsWith('train-')) renderTrain(h.slice(6));
  else renderHome();
  window.scrollTo(0, 0);
}

function go(hash) {
  if (location.hash === `#${hash}`) route();
  else location.hash = hash;
}

// ---------------------------------------------------------------- home

function renderHome() {
  refreshDaily();
  const now = Date.now();
  const budget = newBudget();
  const rows = data.repertoires.map((rep) => ({ rep, s: R.stats(rep, now) }));
  const due = rows.reduce((a, r) => a + r.s.due, 0);
  const fresh = rows.reduce((a, r) => a + r.s.fresh, 0);
  const newReady = Math.min(fresh, budget);
  const nextDue = Math.min(Infinity, ...rows.map((r) => r.s.nextDue));

  let headline;
  let sub;
  if (!rows.length) {
    headline = 'Start your first repertoire';
    sub = 'Create one below, then add moves on the board or paste a PGN.';
  } else if (due) {
    headline = `${plural(due, 'move')} to review`;
    sub = newReady ? `Plus ${plural(newReady, 'new move')} to learn.` : 'Review them before they slip.';
  } else if (newReady) {
    headline = `${plural(newReady, 'new move')} to learn`;
    sub = 'Nothing is due for review.';
  } else {
    headline = 'All caught up';
    sub = Number.isFinite(nextDue) ? `Next review ${when(nextDue)}.` : 'Add moves to a repertoire to start training.';
  }
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  app.innerHTML = `
  <section class="home">
    <div class="today">
      <div class="today-text">
        <p class="eyebrow">${esc(dateLabel)}</p>
        <h1>${esc(headline)}</h1>
        <p class="sub">${esc(sub)}</p>
      </div>
      <button class="btn primary big" type="button" data-act="train-all" ${due + newReady ? '' : 'disabled'}>Start training</button>
    </div>

    <h2 class="section-title">Repertoires</h2>
    ${rows.length ? `<ul class="rep-list">${rows.map(repRow).join('')}</ul>` : '<p class="empty">No repertoires yet.</p>'}

    <div class="section-head">
      <h2 class="section-title">Ready-made repertoires</h2>
      <p class="hint">Every named line in the opening from the Lichess library. Where several moves are listed for your side, training accepts any of them. New lines added later can be pulled in without losing progress.</p>
    </div>
    <ul class="rep-list" id="preset-list">${PRESETS.map((p) => presetRow(p, null)).join('')}</ul>

    <div class="home-tools">
      <form id="new-rep-form" class="card form" autocomplete="off">
        <h2>New repertoire</h2>
        ${pickerHtml('nr', 'Start from a named opening (optional)')}
        <div class="field">
          <label for="nr-name">Name</label>
          <input id="nr-name" name="name" required maxlength="60" placeholder="Queen's Gambit Declined">
        </div>
        <fieldset class="field side-pick">
          <legend>You play</legend>
          <label><input type="radio" id="nr-white" name="color" value="w" checked> White</label>
          <label><input type="radio" id="nr-black" name="color" value="b"> Black</label>
        </fieldset>
        <div class="field">
          <label for="nr-pgn">Moves in PGN (optional)</label>
          <textarea id="nr-pgn" name="pgn" rows="4" spellcheck="false" placeholder="1. d4 d5 2. c4 e6 (2... c6 3. Nf3) 3. Nc3 *"></textarea>
        </div>
        <div class="row">
          <label class="btn ghost file-btn">Load .pgn file<input type="file" id="nr-file" accept=".pgn,.txt" data-fill="nr-pgn" hidden></label>
          <button class="btn primary" type="submit">Create</button>
        </div>
      </form>

      <div class="card settings">
        <h2>Settings</h2>
        <h3>Backup</h3>
        <p class="hint">Your repertoires and progress are saved in this browser only. Download a backup to keep them safe or to move them to another device.</p>
        <div class="row">
          <button class="btn" type="button" data-act="backup">Download backup</button>
          <label class="btn ghost file-btn">Restore backup<input type="file" id="restore-file" accept=".json,application/json" hidden></label>
        </div>
        ${ui.pendingRestore ? `
        <div class="confirm" role="alert">
          <p>Replace everything here with the backup (${plural(ui.pendingRestore.repertoires.length, 'repertoire')})? Your current repertoires and progress will be lost.</p>
          <div class="row"><button class="btn danger" type="button" data-act="restore">Replace</button><button class="btn ghost" type="button" data-act="cancel">Cancel</button></div>
        </div>` : ''}
        <p class="form-msg" id="backup-msg" role="status"></p>
      </div>
    </div>
  </section>`;
  fillPresets();
}

// ---------------------------------------------------------------- ready-made repertoires

const presetCache = {};

function presetRow(p, info) {
  let action;
  if (!info) action = '<button class="btn" type="button" disabled>Loading…</button>';
  else if (!info.existing) action = `<button class="btn primary" type="button" data-act="preset-add" data-id="${p.id}">Add to my repertoires</button>`;
  else if (info.missing) action = `<button class="btn primary" type="button" data-act="preset-add" data-id="${p.id}">Add ${plural(info.missing, 'new move')}</button>`;
  else action = `<a class="btn" href="#edit-${info.existing.id}">Added · Edit</a>`;
  const meta = info
    ? `<span>${plural(info.lines, 'line')}</span><span>${plural(info.positions, 'move')} for you to learn</span>`
    : '<span>Counting lines…</span>';
  return `
  <li class="rep preset">
    <div class="rep-main">
      ${sideChip(p.color)}
      <h3>${esc(p.name)}</h3>
      <p class="meta">${meta}</p>
    </div>
    <div class="rep-actions">${action}</div>
  </li>`;
}

async function presetData(p) {
  if (!presetCache[p.id]) {
    const openings = await loadOpenings();
    const pgn = presetPgn(p, openings);
    const rep = R.createRepertoire({ name: p.name, color: p.color });
    importPgn(rep, pgn);
    presetCache[p.id] = { pgn, rep, lines: presetLines(p, openings).length, positions: R.stats(rep).positions };
  }
  return presetCache[p.id];
}

async function fillPresets() {
  const list = document.getElementById('preset-list');
  if (!list) return;
  try {
    const rows = [];
    for (const p of PRESETS) {
      const d = await presetData(p);
      const existing = data.repertoires.find((r) => r.presetId === p.id) || null;
      let missing = 0;
      if (existing) {
        for (const [key, node] of Object.entries(d.rep.nodes)) {
          for (const san of Object.keys(node.moves)) if (!existing.nodes[key]?.moves[san]) missing++;
        }
      }
      rows.push(presetRow(p, { lines: d.lines, positions: d.positions, existing, missing }));
    }
    if (document.getElementById('preset-list') === list) list.innerHTML = rows.join('');
  } catch {
    if (document.getElementById('preset-list') === list) {
      list.innerHTML = "<li class=\"empty\">The opening library couldn't be loaded. Check your connection and reload the page.</li>";
    }
  }
}

async function addPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const d = await presetData(p);
  let rep = data.repertoires.find((r) => r.presetId === p.id);
  if (rep) {
    const res = importPgn(rep, d.pgn);
    toast(`Added ${plural(res.added, 'new move')} to ${rep.name}`);
  } else {
    rep = R.createRepertoire({ name: p.name, color: p.color });
    rep.presetId = p.id;
    importPgn(rep, d.pgn);
    data.repertoires.push(rep);
    toast(`Added ${p.name}: ${plural(R.stats(rep).positions, 'move')} to learn`);
  }
  persist();
  renderHome();
}

function repRow({ rep, s }) {
  const learnable = Math.min(s.fresh, newBudget());
  const canTrain = s.due + learnable > 0;
  const label = s.due ? `Review ${s.due}` : learnable ? `Learn ${learnable} new` : 'Up to date';
  const trainBtn = `<button class="btn ${canTrain ? 'primary' : ''}" type="button" data-act="train" data-id="${rep.id}" ${canTrain ? '' : 'disabled'}>${label}</button>`;
  const next = !s.due && Number.isFinite(s.nextDue) ? `<span>Next review ${when(s.nextDue)}</span>` : '';
  return `
  <li class="rep">
    <div class="rep-main">
      ${sideChip(rep.color)}
      <h3><a href="#edit-${rep.id}">${esc(rep.name)}</a></h3>
      <p class="meta"><span>${plural(s.positions, 'move')}</span><span class="${s.due ? 'is-due' : ''}">${s.due} due</span><span>${s.fresh} new</span>${next}</p>
    </div>
    <div class="rep-actions">
      ${trainBtn}
      <a class="btn" href="#edit-${rep.id}">Edit</a>
      <button class="btn ghost" type="button" data-act="ask-delete" data-id="${rep.id}">Delete</button>
    </div>
    ${ui.pendingDelete === rep.id ? `
    <div class="confirm" role="alert">
      <p>Delete <strong>${esc(rep.name)}</strong> and all its progress? This can't be undone.</p>
      <div class="row"><button class="btn danger" type="button" data-act="delete" data-id="${rep.id}">Delete</button><button class="btn ghost" type="button" data-act="cancel">Cancel</button></div>
    </div>` : ''}
  </li>`;
}

// ---------------------------------------------------------------- editor

function renderEdit(id) {
  const rep = findRep(id);
  if (!rep) return go('home');
  app.innerHTML = `
  <section class="workspace">
    <div class="board-col">
      <div id="board" class="board-host"></div>
      <div class="board-bar">
        <button class="btn icon" type="button" data-act="ed-start" title="Back to start" aria-label="Back to start">${ICONS.start}</button>
        <button class="btn icon" type="button" data-act="ed-back" title="Back one move" aria-label="Back one move">${ICONS.back}</button>
        <button class="btn icon" type="button" data-act="flip" title="Flip board" aria-label="Flip board">${ICONS.flip}</button>
      </div>
    </div>
    <aside class="panel">
      <a class="back" href="#home">← All repertoires</a>
      <div class="panel-head">
        ${sideChip(rep.color)}
        <label class="sr-only" for="rep-name">Repertoire name</label>
        <input id="rep-name" class="title-input" value="${esc(rep.name)}" maxlength="60">
      </div>
      <div id="ed-body"></div>
      <details class="card tools">
        <summary>Add openings, import or export PGN</summary>
        ${pickerHtml('ed', 'Add a named opening')}
        <div class="field">
          <label for="ed-pgn">Paste PGN to add its lines here</label>
          <textarea id="ed-pgn" rows="5" spellcheck="false" placeholder="1. e4 e5 2. Nf3 Nc6 (2... d6) 3. Bb5 *"></textarea>
        </div>
        <div class="row">
          <label class="btn ghost file-btn">Load .pgn file<input type="file" id="ed-file" accept=".pgn,.txt" data-fill="ed-pgn" hidden></label>
          <button class="btn primary" type="button" data-act="ed-import">Add to repertoire</button>
        </div>
        <p class="form-msg" id="ed-msg" role="status"></p>
        <div class="row">
          <button class="btn" type="button" data-act="ed-copy">Copy as PGN</button>
          <button class="btn ghost" type="button" data-act="ed-download">Download .pgn</button>
        </div>
        <textarea id="ed-export" class="export" rows="5" readonly hidden aria-label="Repertoire as PGN"></textarea>
      </details>
    </aside>
  </section>`;
  board = new Board(document.getElementById('board'), { onMove: editorMove });
  board.setOrientation(rep.color);
  editor = { rep, keys: [rep.root], sans: [], lastMoves: [null] };
  updateEditor();
}

function updateEditor() {
  const { rep, keys, sans } = editor;
  const key = keys[keys.length - 1];
  const ply = sans.length;
  const yourTurn = R.sideToMove(key) === rep.color;
  const list = R.edges(rep, key);
  board.setGame(new Chess(R.keyToFen(key)), editor.lastMoves[editor.lastMoves.length - 1]);
  board.setArrows(list.map(([, e]) => arrowOf(e, yourTurn ? 'main' : 'alt')));
  const s = R.stats(rep);

  const items = list.map(([san]) => {
    const pending = ui.pendingRemove === san;
    return `
    <li>
      <button type="button" class="move-chip" data-act="ed-go" data-san="${esc(san)}">${esc(R.formatMove(ply, san))}</button>
      ${pending
        ? `<span class="confirm-inline">Remove it and every move after it?
            <button class="btn danger small" type="button" data-act="ed-remove" data-san="${esc(san)}">Remove</button>
            <button class="btn ghost small" type="button" data-act="ed-keep">Keep</button></span>`
        : `<button class="btn ghost small" type="button" data-act="ed-ask-remove" data-san="${esc(san)}" aria-label="Remove ${esc(san)}">Remove</button>`}
    </li>`;
  }).join('');

  document.getElementById('ed-body').innerHTML = `
    <p class="meta"><span>${plural(s.positions, 'move')}</span><span>${s.due} due</span><span>${s.fresh} new</span></p>
    <div class="block">
      <h3 class="label">Line</h3>
      ${lineHtml(sans, true)}
    </div>
    <div class="block">
      <h3 class="label">${yourTurn ? 'Your move here' : 'Opponent replies here'}</h3>
      ${list.length ? `<ul class="move-list">${items}</ul>` : `<p class="empty">${yourTurn
        ? 'Play the move you want to learn on the board.'
        : 'Play the replies you want to prepare for on the board, or leave this as the end of the line.'}</p>`}
      ${yourTurn && list.length > 1 ? `<p class="hint">You have ${list.length} moves here. Training accepts any of them.</p>` : ''}
      ${list.length ? `<p class="hint">${yourTurn ? 'Play a different move on the board to add an alternative.' : 'Play another reply on the board to add it.'}</p>` : ''}
    </div>`;
}

function editorMove(m) {
  const { rep, keys, sans } = editor;
  const key = keys[keys.length - 1];
  let mv;
  try {
    mv = new Chess(R.keyToFen(key)).move(m);
  } catch {
    return false;
  }
  const { toKey, added } = R.addMove(rep, key, mv);
  if (added) {
    persist();
    toast(`Added ${R.formatMove(sans.length, mv.san)}`);
  }
  keys.push(toKey);
  sans.push(mv.san);
  editor.lastMoves.push([mv.from, mv.to]);
  ui.pendingRemove = null;
  updateEditor();
  return true;
}

function editorGo(san) {
  const { rep, keys, sans } = editor;
  const edge = rep.nodes[keys[keys.length - 1]]?.moves[san];
  if (!edge) return;
  keys.push(edge.to);
  sans.push(san);
  editor.lastMoves.push([edge.uci.slice(0, 2), edge.uci.slice(2, 4)]);
  ui.pendingRemove = null;
  updateEditor();
}

function editorJump(count) {
  editor.keys = editor.keys.slice(0, count + 1);
  editor.sans = editor.sans.slice(0, count);
  editor.lastMoves = editor.lastMoves.slice(0, count + 1);
  ui.pendingRemove = null;
  updateEditor();
}

// ---------------------------------------------------------------- training

function renderTrain(id) {
  refreshDaily();
  if (id && !findRep(id)) return go('home');
  const queue = id ? [id] : data.repertoires.filter(hasWork).map((r) => r.id);
  app.innerHTML = `
  <section class="workspace">
    <div class="board-col"><div id="board" class="board-host"></div></div>
    <aside class="panel" id="train-panel" aria-live="polite"></aside>
  </section>`;
  board = new Board(document.getElementById('board'), {
    canMove: (c) => Boolean(session && session.awaiting && c === session.rep.color),
    onMove: trainMove,
  });
  session = {
    queue, qi: 0, rep: null, key: null, targets: new Set(),
    awaiting: false, intro: false, mistakes: 0, hinted: false, shown: false,
    line: [], lastMove: null, timer: null, emptyLines: 0, graded: 0, done: false,
    status: { title: '', text: '', tone: '' },
    stats: { reviewed: 0, correct: 0, learned: 0, lines: 0 },
  };
  nextRepertoire();
}

function nextRepertoire() {
  const s = session;
  while (s.qi < s.queue.length && !findRep(s.queue[s.qi])) s.qi++;
  if (s.qi >= s.queue.length) return finish();
  s.rep = findRep(s.queue[s.qi]);
  s.emptyLines = 0;
  board.setOrientation(s.rep.color);
  startLine();
}

function startLine() {
  const s = session;
  if (!s) return;
  s.targets = R.computeTargets(s.rep, Date.now(), newBudget());
  if (!s.targets.size || s.emptyLines >= 3) {
    s.qi++;
    nextRepertoire();
    return;
  }
  s.key = s.rep.root;
  s.line = [];
  s.lastMove = null;
  s.graded = 0;
  showTrainPosition();
  step();
}

function showTrainPosition() {
  board.marks = {};
  board.setArrows([]);
  board.setGame(new Chess(R.keyToFen(session.key)), session.lastMove);
}

function step() {
  const s = session;
  if (!s || s.done) return;
  const { rep, key } = s;
  if (R.countReachable(rep, key, s.targets) === 0) return endLine();

  if (R.sideToMove(key) !== rep.color) {
    const pick = R.pickOpponentMove(rep, key, s.targets);
    if (!pick) return endLine();
    s.awaiting = false;
    if (!s.line.length) setStatus('Opponent to move', `You play ${colorName(rep.color)}.`, 'wait');
    s.timer = setTimeout(() => {
      if (session !== s) return;
      s.line.push(pick.san);
      s.lastMove = [pick.edge.uci.slice(0, 2), pick.edge.uci.slice(2, 4)];
      s.key = pick.edge.to;
      showTrainPosition();
      step();
    }, s.line.length ? REPLY_DELAY : 450); // quick reply mid-line; a short pause at the start of a line
    return;
  }

  const moves = R.edges(rep, key);
  if (!moves.length) return endLine();
  const card = rep.cards[key];
  s.intro = !card || card.state === 'new';
  s.mistakes = 0;
  s.hinted = false;
  s.shown = false;
  s.awaiting = true;
  if (s.intro) {
    board.setArrows(moves.map(([, e]) => arrowOf(e, 'learn')));
    const names = moves.map(([san]) => R.formatMove(s.line.length, san)).join(' or ');
    setStatus('New move', `Your repertoire plays ${names} here. Play it on the board.`, 'new');
  } else {
    setStatus('Your move', `What do you play here as ${colorName(rep.color)}?`, 'ask');
  }
}

function trainMove(m) {
  const s = session;
  if (!s || !s.awaiting) return false;
  let mv;
  try {
    mv = new Chess(R.keyToFen(s.key)).move(m);
  } catch {
    return false;
  }
  const edge = s.rep.nodes[s.key]?.moves[mv.san];
  if (!edge) {
    s.mistakes++;
    board.mark(mv.to, 'bad', 700);
    if (s.intro) setStatus('Follow the arrow', `${mv.san} isn't the move in your repertoire. Play the arrowed move.`, 'bad');
    else if (s.mistakes >= 2) revealAnswer();
    else setStatus(`${mv.san} isn't in your repertoire`, 'Try again, or take a hint.', 'bad');
    return false;
  }

  const now = Date.now();
  const key = s.key;
  const wasTarget = s.targets.has(key);
  let title = 'Correct';
  let tone = 'good';
  if (s.intro) {
    s.rep.cards[key] = introduce(s.rep.cards[key], now);
    data.daily.newSeen++;
    s.stats.learned++;
    title = 'Learned';
    if (wasTarget) s.graded++;
  } else {
    const grade = s.mistakes || s.shown ? 'again' : s.hinted ? 'hard' : 'good';
    if (wasTarget || grade === 'again') {
      s.rep.cards[key] = schedule(s.rep.cards[key], grade, now);
      s.stats.reviewed++;
      if (grade === 'good') s.stats.correct++;
      if (wasTarget) s.graded++;
    }
    if (grade === 'hard') { title = 'Correct, with a hint'; tone = 'ok'; }
    if (grade === 'again') { title = "You'll see this one again soon"; tone = 'ok'; }
  }
  s.targets.delete(key);
  persist();

  s.awaiting = false;
  s.line.push(mv.san);
  s.lastMove = [mv.from, mv.to];
  s.key = edge.to;
  showTrainPosition();
  board.mark(mv.to, 'good', 600);
  setStatus(title, R.formatMove(s.line.length - 1, mv.san), tone);
  s.timer = setTimeout(() => { if (session === s) step(); }, 0);
  return true;
}

function revealAnswer() {
  const s = session;
  if (!s || !s.awaiting) return;
  s.shown = true;
  const moves = R.edges(s.rep, s.key);
  board.setArrows(moves.map(([, e]) => arrowOf(e, 'answer')));
  const names = moves.map(([san]) => R.formatMove(s.line.length, san)).join(' or ');
  setStatus('Here is your move', `Your repertoire plays ${names}. Play it to continue.`, 'bad');
}

function giveHint() {
  const s = session;
  if (!s || !s.awaiting) return;
  s.hinted = true;
  for (const [, e] of R.edges(s.rep, s.key)) board.mark(e.uci.slice(0, 2), 'hint');
  setStatus('Hint', 'Move the highlighted piece.', 'ask');
}

function endLine() {
  const s = session;
  if (!s) return;
  s.awaiting = false;
  s.stats.lines++;
  s.emptyLines = s.graded ? 0 : s.emptyLines + 1;
  if (s.graded) play('success');
  setStatus('Line complete', 'Next line coming up.', 'done');
  s.timer = setTimeout(() => { if (session === s) startLine(); }, 900);
}

function finish() {
  const s = session;
  if (!s) return;
  s.done = true;
  s.awaiting = false;
  clearTimeout(s.timer);
  board.setArrows([]);
  renderTrainPanel();
}

function setStatus(title, text, tone) {
  session.status = { title, text, tone };
  renderTrainPanel();
}

function renderTrainPanel() {
  const s = session;
  const panel = document.getElementById('train-panel');
  if (!s || !panel) return;
  const st = s.stats;
  const acc = st.reviewed ? `${Math.round((st.correct / st.reviewed) * 100)}%` : '–';
  const statsHtml = `
    <dl class="stats">
      ${s.done ? '' : `<div><dt>Left</dt><dd>${s.rep ? R.computeTargets(s.rep, Date.now(), newBudget()).size : 0}</dd></div>`}
      <div><dt>Reviewed</dt><dd>${st.reviewed}</dd></div>
      <div><dt>Accuracy</dt><dd>${acc}</dd></div>
      <div><dt>Learned</dt><dd>${st.learned}</dd></div>
    </dl>`;

  if (s.done) {
    const next = Math.min(Infinity, ...data.repertoires.map((r) => R.stats(r).nextDue));
    const didSomething = st.reviewed + st.learned > 0;
    const single = s.queue.length === 1 ? s.queue[0] : null;
    const pool = single ? [findRep(single)].filter(Boolean) : data.repertoires;
    const moreLeft = pool.reduce((a, r) => a + R.stats(r).fresh, 0);
    panel.innerHTML = `
      <a class="back" href="#home">← All repertoires</a>
      <p class="eyebrow">Session complete</p>
      <h1 class="panel-title">${didSomething ? 'Done for now' : 'Nothing to train'}</h1>
      ${statsHtml}
      <p class="hint">${Number.isFinite(next) ? `Next review ${esc(when(next))}.` : 'Add more moves to keep training.'}</p>
      <div class="row">
        ${moreLeft ? `<button class="btn primary" type="button" data-act="train" data-id="${single || ''}" ${single ? '' : 'data-all="1"'}>Keep going</button>` : ''}
        <a class="btn ${moreLeft ? '' : 'primary'}" href="#home">Back to repertoires</a>
      </div>`;
    return;
  }

  const canHelp = s.awaiting && !s.intro && !s.shown;
  panel.innerHTML = `
    <a class="back" href="#home">← All repertoires</a>
    <div class="panel-head">${sideChip(s.rep.color)}<h2 class="panel-title">${esc(s.rep.name)}</h2></div>
    <div class="dock">
      <div class="status tone-${s.status.tone}">
        <p class="status-title">${esc(s.status.title)}</p>
        <p class="status-text">${esc(s.status.text)}</p>
      </div>
      <div class="row dock-actions">
        <button class="btn" type="button" data-act="hint" ${canHelp && !s.hinted ? '' : 'disabled'}>Hint</button>
        <button class="btn" type="button" data-act="reveal" ${canHelp ? '' : 'disabled'}>Show move</button>
        <button class="btn ghost" type="button" data-act="end">End</button>
      </div>
    </div>
    ${statsHtml}
    <div class="block">
      <h3 class="label">This line</h3>
      ${lineHtml(s.line)}
    </div>`;
}

// ---------------------------------------------------------------- events

const actions = {
  'train-all': () => go('train-all'),
  train: (el) => go(el.dataset.all ? 'train-all' : `train-${el.dataset.id}`),
  'ask-delete': (el) => { ui.pendingDelete = el.dataset.id; renderHome(); },
  delete: (el) => {
    const rep = findRep(el.dataset.id);
    data.repertoires = data.repertoires.filter((r) => r.id !== el.dataset.id);
    ui.pendingDelete = null;
    persist();
    renderHome();
    if (rep) toast(`Deleted ${rep.name}`);
  },
  cancel: () => { ui.pendingDelete = null; ui.pendingRestore = null; renderHome(); },
  backup: () => download(`book-moves-backup-${dayKey(Date.now())}.json`, JSON.stringify(data, null, 1), 'application/json'),
  restore: () => {
    data = ui.pendingRestore;
    ui.pendingRestore = null;
    persist();
    renderHome();
    toast('Backup restored');
  },

  flip: () => board && board.flip(),
  'ed-start': () => editorJump(0),
  'ed-back': () => editorJump(Math.max(0, editor.sans.length - 1)),
  'ed-jump': (el) => editorJump(Number(el.dataset.idx) + 1),
  'ed-go': (el) => editorGo(el.dataset.san),
  'ed-ask-remove': (el) => { ui.pendingRemove = el.dataset.san; updateEditor(); },
  'ed-keep': () => { ui.pendingRemove = null; updateEditor(); },
  'ed-remove': (el) => {
    const key = editor.keys[editor.keys.length - 1];
    R.removeMove(editor.rep, key, el.dataset.san);
    ui.pendingRemove = null;
    persist();
    updateEditor();
    toast(`Removed ${el.dataset.san}`);
  },
  'ed-import': () => {
    const text = document.getElementById('ed-pgn').value;
    const msg = document.getElementById('ed-msg');
    if (!text.trim()) {
      msg.textContent = 'Paste some PGN first, or load a .pgn file.';
      return;
    }
    const res = importPgn(editor.rep, text);
    persist();
    msg.textContent = importSummary(res);
    if (res.added) document.getElementById('ed-pgn').value = '';
    updateEditor();
  },
  'ed-copy': () => {
    const pgn = exportPgn(editor.rep);
    const fallback = () => {
      const box = document.getElementById('ed-export');
      box.hidden = false;
      box.value = pgn;
      box.focus();
      box.select();
      document.getElementById('ed-msg').textContent = "Copying isn't available here, so the PGN is shown below. Select it and copy.";
    };
    try {
      navigator.clipboard.writeText(pgn).then(() => toast('PGN copied'), fallback);
    } catch {
      fallback();
    }
  },
  'ed-download': () => download(`${editor.rep.name.replace(/[^\w-]+/g, '-') || 'repertoire'}.pgn`, exportPgn(editor.rep), 'application/x-chess-pgn'),

  hint: () => giveHint(),
  reveal: () => revealAnswer(),
  end: () => finish(),

  'op-pick': (el) => pickOpening(el.dataset.target, Number(el.dataset.idx)),
  'preset-add': (el) => {
    el.disabled = true;
    addPreset(el.dataset.id);
  },
};

// ---------------------------------------------------------------- opening library

const picker = { list: null, results: {}, timer: null };

function pickerHtml(target, label) {
  return `
  <div class="field picker">
    <label for="${target}-op">${label}</label>
    <input id="${target}-op" class="op-search" type="search" data-target="${target}" autocomplete="off" spellcheck="false"
      placeholder="Caro-Kann Advance, B12 or 1. e4 c6 2. d4">
    <div class="op-results" id="${target}-op-results"></div>
  </div>`;
}

async function updatePicker(target) {
  const input = document.getElementById(`${target}-op`);
  const box = document.getElementById(`${target}-op-results`);
  if (!input || !box) return;
  if (!picker.list) {
    box.innerHTML = '<p class="hint">Loading openings…</p>';
    try {
      picker.list = await loadOpenings();
    } catch {
      box.innerHTML = "<p class=\"hint\">The opening library couldn't be loaded. Check your connection, then click the search box again.</p>";
      return;
    }
  }
  const { results, total, popular } = searchOpenings(picker.list, input.value);
  picker.results[target] = results;
  if (!results.length) {
    box.innerHTML = '<p class="hint">No openings match. Try fewer words, an ECO code like B12, or moves like 1. e4 c6.</p>';
    return;
  }
  box.innerHTML = `
    ${popular ? '<p class="label">Popular openings · type to search all 3,865</p>' : ''}
    <ul class="op-list">${results.map((o, i) => `
      <li><button type="button" class="op-item" data-act="op-pick" data-target="${target}" data-idx="${i}">
        <span class="op-name">${esc(o.name)}</span><span class="op-eco">${esc(o.eco)}</span>
        <span class="op-moves">${esc(numbered(o.moves))}</span>
      </button></li>`).join('')}
    </ul>
    ${total > results.length ? `<p class="hint">Showing ${results.length} of ${total}. Keep typing to narrow it down.</p>` : ''}`;
}

function pickOpening(target, idx) {
  const o = picker.results[target]?.[idx];
  if (!o) return;
  const pgn = `${numbered(o.moves)} *`;
  const box = document.getElementById(`${target}-op-results`);
  document.getElementById(`${target}-op`).value = '';
  let note;
  if (target === 'nr') {
    const name = document.getElementById('nr-name');
    if (!name.value.trim() || name.dataset.auto === '1') {
      name.value = o.name;
      name.dataset.auto = '1';
    }
    document.getElementById('nr-pgn').value = pgn;
    const side = guessColor(o.name);
    document.getElementById(side === 'b' ? 'nr-black' : 'nr-white').checked = true;
    note = `Moves added below, playing as ${colorName(side)}. Change the side if that's wrong, then press Create.`;
  } else {
    const ta = document.getElementById('ed-pgn');
    ta.value = ta.value.trim() ? `${ta.value.trim()}\n${pgn}` : pgn;
    note = 'Moves added to the PGN box. Pick more, then press Add to repertoire.';
  }
  box.innerHTML = `<p class="picked"><strong>${esc(o.name)}</strong> <span class="op-eco">${esc(o.eco)}</span><br>${esc(note)}</p>`;
}

app.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el.classList && el.classList.contains('op-search')) {
    const box = document.getElementById(`${el.dataset.target}-op-results`);
    if (box && !box.querySelector('.op-list')) updatePicker(el.dataset.target);
  }
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'nr-name') el.dataset.auto = '0';
  if (el.classList && el.classList.contains('op-search')) {
    clearTimeout(picker.timer);
    picker.timer = setTimeout(() => updatePicker(el.dataset.target), 120);
  }
});

function importSummary(res) {
  const parts = [];
  if (res.added) parts.push(`Added ${plural(res.added, 'new move')}.`);
  else if (res.games) parts.push('Those moves were already in this repertoire.');
  else parts.push("No moves found. Check the text is in PGN format, like 1. e4 e5 2. Nf3.");
  if (res.skipped) parts.push(`Skipped ${plural(res.skipped, 'game')} that start from a custom position.`);
  return [...parts, ...res.errors].join(' ');
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'new-rep-form') return;
  e.preventDefault();
  const form = new FormData(e.target);
  const name = String(form.get('name') || '').trim();
  if (!name) return;
  const rep = R.createRepertoire({ name, color: form.get('color') === 'b' ? 'b' : 'w' });
  const pgn = String(form.get('pgn') || '');
  let note = `Created ${name}`;
  if (pgn.trim()) {
    const res = importPgn(rep, pgn);
    note = res.added ? `Created ${name} with ${plural(R.stats(rep).positions, 'move')} to learn` : `Created ${name}. No moves found in the PGN.`;
  }
  data.repertoires.push(rep);
  persist();
  toast(note);
  go(`edit-${rep.id}`);
});

app.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'rep-name' && editor) {
    const name = el.value.trim();
    if (name) {
      editor.rep.name = name;
      persist();
      toast('Name saved');
    } else el.value = editor.rep.name;
    return;
  }
  if (el.type === 'file' && el.files && el.files[0]) {
    const file = el.files[0];
    const text = await file.text();
    el.value = '';
    if (el.dataset.fill) {
      document.getElementById(el.dataset.fill).value = text;
      return;
    }
    if (el.id === 'restore-file') {
      const msg = document.getElementById('backup-msg');
      try {
        ui.pendingRestore = normalize(JSON.parse(text));
        renderHome();
      } catch (err) {
        msg.textContent = err instanceof SyntaxError ? "That file isn't valid JSON, so it can't be a backup." : err.message;
      }
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (!editor || e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowLeft') editorJump(Math.max(0, editor.sans.length - 1));
  if (e.key === 'Home') editorJump(0);
});

const tactics = createTactics({ app, getData: () => data, persist, toast, esc, plural, go });

const soundBtn = document.getElementById('sound-toggle');
function showSound() {
  if (!soundBtn) return;
  const on = soundOn();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  soundBtn.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z"/>${on
    ? '<path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.3a6.5 6.5 0 0 1 0 9.4"/>'
    : '<path d="m13 8 4 4m0-4-4 4"/>'}</svg><span class="sound-label">${on ? 'Sound on' : 'Sound off'}</span>`;
}
if (soundBtn) {
  soundBtn.addEventListener('click', () => {
    setSound(!soundOn());
    showSound();
    if (soundOn()) play('move');
  });
  showSound();
}

window.addEventListener('hashchange', route);
persist();
route();
