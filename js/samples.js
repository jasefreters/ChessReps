// Example repertoires loaded the first time the site opens. Delete them any time.

export const SAMPLES = [
  {
    name: 'Italian Game (example)',
    color: 'w',
    pgn: `1. e4 e5 (1... c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3)
2. Nf3 Nc6 (2... Nf6 3. Nxe5 d6 4. Nf3 Nxe4 5. d4) (2... d6 3. d4 exd4 4. Nxd4)
3. Bc4 Bc5 (3... Nf6 4. d3 Be7 5. O-O O-O 6. Re1)
4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 *`,
  },
  {
    name: 'Caro-Kann (example)',
    color: 'b',
    pgn: `1. e4 c6 2. d4 (2. Nc3 d5 3. Nf3 Bg4) 2... d5
3. Nc3 (3. e5 Bf5 4. Nf3 e6 5. Be2 c5) (3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6)
3... dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 *`,
  },
];
