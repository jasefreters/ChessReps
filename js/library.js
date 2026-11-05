// Named-opening library: the Lichess chess-openings data set (CC0), stored in
// data/openings.json as [eco, name, moves] rows. Loaded the first time it's needed.

let loading = null;

const POPULAR = [
  'Italian Game', 'Ruy Lopez', 'Scotch Game', 'Vienna Game', "King's Gambit",
  'Sicilian Defense', 'French Defense', 'Caro-Kann Defense', 'Scandinavian Defense', 'Pirc Defense',
  "Queen's Gambit Declined", "Queen's Gambit Accepted", 'Slav Defense', "Queen's Pawn Game: London System",
  'Catalan Opening', "King's Indian Defense", 'Nimzo-Indian Defense', 'Grünfeld Defense', 'Dutch Defense',
  'English Opening', 'Réti Opening',
];

const SAN = /^(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?|O-O(?:-O)?)[+#]?$/;

/** Lowercase, drop accents and apostrophes, and treat "defence" as "defense". */
export function normalize(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/defence/g, 'defense')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function loadOpenings() {
  if (!loading) {
    loading = fetch(new URL('../data/openings.json', import.meta.url))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows) => rows.map(([eco, name, moves]) => ({
        eco, name, moves, plies: moves.split(' ').length, key: normalize(`${name} ${eco}`),
      })))
      .catch((err) => {
        loading = null; // allow a retry
        throw err;
      });
  }
  return loading;
}

/** Moves with numbers: "1. e4 c6 2. d4 d5". */
export function numbered(moves) {
  return moves.split(' ').map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join(' ');
}

/** Guess which side a repertoire for this opening is for. */
export function guessColor(name) {
  return /defen[cs]e|declined|accepted|countergambit|counter-gambit/i.test(name) ? 'b' : 'w';
}

/**
 * Search by name ("caro kann advance"), ECO code ("B12") or moves ("1. e4 c6 2. d4").
 * Returns { results, total }.
 */
export function searchOpenings(list, query, limit = 30) {
  const raw = query.trim();
  if (!raw) {
    const seen = new Set();
    const results = [];
    for (const name of POPULAR) {
      const o = list.find((x) => x.name === name);
      if (o && !seen.has(name)) {
        seen.add(name);
        results.push(o);
      }
    }
    return { results, total: results.length, popular: true };
  }

  let matches;
  const moveTokens = raw.replace(/\d+\.+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (/^[a-e]\d{1,2}$/i.test(raw)) {
    const code = raw.toUpperCase();
    matches = list.filter((o) => o.eco.startsWith(code.length === 2 ? code : code.slice(0, 3)));
  } else if (moveTokens.length && moveTokens.every((t) => SAN.test(t))) {
    const prefix = moveTokens.join(' ');
    matches = list.filter((o) => o.moves === prefix || o.moves.startsWith(`${prefix} `));
  } else {
    const q = normalize(raw);
    const words = q.split(' ');
    matches = list.filter((o) => words.every((w) => o.key.includes(w)));
    const starts = (o) => (normalize(o.name).startsWith(q) ? 0 : 1);
    matches.sort((a, b) => starts(a) - starts(b) || a.plies - b.plies || a.name.localeCompare(b.name));
    return { results: matches.slice(0, limit), total: matches.length };
  }
  matches.sort((a, b) => a.plies - b.plies || a.name.localeCompare(b.name));
  return { results: matches.slice(0, limit), total: matches.length };
}
