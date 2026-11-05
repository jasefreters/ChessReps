# Book Moves

A chess opening trainer built on spaced repetition. Build a repertoire for
White or Black, then drill it line by line: the site plays your opponent's
moves and you find your replies. Moves you know come back less often; moves
you miss come back sooner.

"Book Moves" is a working name. Rename it in `index.html` and `js/pgn.js`.

## Features

- **Repertoires for either side**: add moves by playing them on the board,
  or paste/load PGN (variations, comments and multiple games are handled).
- **Opening library**: search 3,865 named openings by name ("caro kann
  advance"), ECO code ("B12") or moves ("1. e4 c6 2. d4") to start a
  repertoire or add lines to one.
- **Tactical Weaknesses**: 150 Lichess puzzles in six sets (unprotected
  pieces, pieces on the same line, exposed king, trapped pieces, overworked
  defenders, double attacks), with Hint, Solution and Retry. "Add a puzzle"
  has a setup board for entering your own puzzles; those stay in your browser.
- **Training**: new moves are shown with an arrow first, then quizzed. Due
  moves are drilled inside real lines, with the opponent steering toward the
  branches you need to practise. Wrong moves can be retried, with a hint or
  the answer if you need it.
- **Scheduling**: a simplified SM-2. Right first time pushes a move out
  (1 day, 3 days, then roughly ×2.5); a miss brings it back within minutes.
  The number of new moves per day is configurable.
- **Saved in the browser** (localStorage), with JSON backup and restore, and
  PGN export per repertoire.
- Works on phones; light and dark themes follow the device.

## Running it

It's a static site with no build step. Serve the folder with any web server,
for example:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` straight from disk won't work, because browsers block
ES modules on `file://` URLs.

### Publishing on GitHub Pages

In the repository settings, open **Pages**, choose **Deploy from a branch**,
and pick the branch and the `/ (root)` folder. The site appears at
`https://<user>.github.io/<repo>/`.

## How it's organised

| File | What it does |
| --- | --- |
| `index.html`, `css/style.css` | Page shell and styles |
| `js/app.js` | Views (repertoires, editor, training) and the training session |
| `js/board.js` | The interactive board: click or drag, promotion, arrows |
| `js/repertoire.js` | Repertoire graph (positions and moves, so transpositions merge) and target selection |
| `js/srs.js` | Spaced-repetition scheduling |
| `js/pgn.js` | PGN import (with variations) and export |
| `js/store.js` | Saving, loading and backup validation |
| `js/library.js`, `data/openings.json` | Named-opening search over the Lichess openings data |
| `js/tactics.js`, `data/puzzles.json` | Puzzle sets, puzzle player and the puzzle setup board |
| `js/samples.js` | Example repertoires loaded on first visit |
| `js/pieces.js` | Piece images |
| `js/chesslib.js` | Loads [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 from jsDelivr |

## Credits

See [NOTICE.md](NOTICE.md) for third-party licences.
