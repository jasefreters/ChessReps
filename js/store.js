// Everything is saved in this browser's localStorage.

const KEY = 'book-moves:v1';

export function defaultData() {
  return {
    version: 1,
    settings: { newPerDay: 10 },
    repertoires: [],
    daily: { date: '', newSeen: 0 },
    myPuzzles: [],
    puzzleProgress: {},
  };
}

/** Validate and fill in defaults. Throws if `d` isn't usable. */
export function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.repertoires)) {
    throw new Error("This file isn't a Book Moves backup.");
  }
  const base = defaultData();
  const repertoires = d.repertoires.filter(
    (r) => r && typeof r.id === 'string' && typeof r.name === 'string' && (r.color === 'w' || r.color === 'b') &&
      typeof r.root === 'string' && r.nodes && typeof r.nodes === 'object',
  ).map((r) => ({ ...r, cards: r.cards && typeof r.cards === 'object' ? r.cards : {} }));
  return {
    ...base,
    settings: { ...base.settings, ...(d.settings || {}) },
    daily: { ...base.daily, ...(d.daily || {}) },
    myPuzzles: Array.isArray(d.myPuzzles)
      ? d.myPuzzles.filter((p) => p && typeof p.id === 'string' && typeof p.fen === 'string' && Array.isArray(p.line))
      : [],
    puzzleProgress: d.puzzleProgress && typeof d.puzzleProgress === 'object' ? d.puzzleProgress : {},
    repertoires,
  };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
