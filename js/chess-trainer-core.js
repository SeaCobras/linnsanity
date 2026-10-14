// chess-trainer-core.js — Phase 2 game logic, DOM-injected so it can run
// under a test DOM as well as the real browser. See chess-trainer.js for the
// browser bootstrap that wires this up to the CDN chess.js and the real page.

/**
 * Everything below is a single factory so it can be exercised under a fake
 * DOM/fetch in tests without touching the CDN import above.
 */
export function initTrainer({ fetchImpl, ChessCtor, doc }) {
  const pickerView = doc.getElementById('picker-view');
  const boardView = doc.getElementById('board-view');
  const colorBtns = doc.querySelectorAll('.chess-color-btn');
  const openingListEl = doc.getElementById('opening-list');
  const pickerErrorEl = doc.getElementById('picker-error');
  const backBtn = doc.getElementById('back-btn');
  const resetBtn = doc.getElementById('reset-btn');
  const boardEl = doc.getElementById('chess-board');
  const statusEl = doc.getElementById('chess-status');
  const feedbackEl = doc.getElementById('chess-feedback');
  const scoreEl = doc.getElementById('chess-score');
  const titleEl = doc.getElementById('opening-title');

  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const WHITE_GLYPHS = { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' };
  const BLACK_GLYPHS = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const BOT_MOVE_DELAY_MS = 450;

  // Points by rank within a player node's move list. The generator caps
  // player-turn alternatives at 4 (see build-openings.js DEFAULTS.playerBranches),
  // so there are exactly four tiers, not five -- a move outside this list has
  // no tree data at all, which is the same event as going off-book.
  const RANK_POINTS = [100, 75, 50, 25];
  const RANK_LABEL = ['the top book move', 'the 2nd most common move', 'the 3rd most common move', 'a playable but rare choice'];

  const state = {
    index: null,
    tree: null,
    opening: null,
    chess: null,
    pathUci: [],
    selectedSquare: null,
    draggedFrom: null,
    offBook: false,
    awaitingBot: false,
    score: { totalPoints: 0, gradedMoves: 0 },
  };

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  async function loadIndex() {
    const res = await fetchImpl('js/data/openings/index.json');
    if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
    const data = await res.json();
    state.index = data.openings || [];
  }

  async function loadTree(id) {
    const res = await fetchImpl(`js/data/openings/${id}.json`);
    if (!res.ok) throw new Error(`${id}.json: HTTP ${res.status}`);
    return res.json();
  }

  // ------------------------------------------------------------------
  // Picker
  // ------------------------------------------------------------------

  function renderOpeningList(color) {
    const items = state.index.filter(o => o.playerColor === color);
    openingListEl.innerHTML = '';
    items.forEach(o => {
      const item = doc.createElement('div');
      item.className = 'chess-opening-item';
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const name = doc.createElement('span');
      name.className = 'name';
      name.textContent = o.name;

      const setup = doc.createElement('span');
      setup.className = 'setup';
      setup.textContent = o.setupSan.join(' ');

      item.appendChild(name);
      item.appendChild(setup);
      item.addEventListener('click', () => selectOpening(o.id));
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOpening(o.id); }
      });
      openingListEl.appendChild(item);
    });
    openingListEl.hidden = false;
  }

  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderOpeningList(btn.dataset.color);
    });
  });

  async function selectOpening(id) {
    pickerErrorEl.hidden = true;
    try {
      state.tree = await loadTree(id);
    } catch (err) {
      pickerErrorEl.hidden = false;
      pickerErrorEl.textContent = `couldn't load that opening: ${err.message}`;
      return;
    }
    const meta = state.index.find(o => o.id === id);
    state.opening = meta
      ? meta
      : { id: state.tree.id, name: state.tree.name, playerColor: state.tree.playerColor };

    titleEl.textContent = state.opening.name;
    pickerView.hidden = true;
    boardView.hidden = false;
    startGame();
  }

  backBtn.addEventListener('click', () => {
    boardView.hidden = true;
    pickerView.hidden = false;
  });

  resetBtn.addEventListener('click', () => startGame());

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------

  function startGame() {
    state.chess = new ChessCtor();
    state.tree.setup.san.forEach(san => state.chess.move(san));
    state.pathUci = [...state.tree.setup.uci];
    state.offBook = false;
    state.selectedSquare = null;
    state.awaitingBot = false;
    state.score = { totalPoints: 0, gradedMoves: 0 };
    feedbackEl.className = 'chess-feedback';
    feedbackEl.textContent = '';
    renderScore();
    renderBoard();
    advance();
  }

  function nodeAt(path) {
    return state.tree.nodes[path.join(',')] || null;
  }

  function wantsColor() {
    return state.opening.playerColor === 'white' ? 'w' : 'b';
  }

  function isPlayerTurn() {
    return state.chess.turn() === wantsColor();
  }

  /** Once off-book there's no bot to move the other side (no tree data to
   *  draw from), so play becomes hotseat: whoever is actually to move can
   *  move, on either side. chess.js's own move generation already refuses a
   *  square that isn't the side to move, so this doesn't allow illegal play --
   *  it only lifts the "must be YOUR repertoire color" restriction. */
  function canInteract() {
    return !state.awaitingBot && (state.offBook || isPlayerTurn());
  }

  /** Weighted random pick from a bot node's move pool (weights sum to ~1). */
  function pickWeighted(moves) {
    const r = Math.random();
    let acc = 0;
    for (const m of moves) {
      acc += m.weight != null ? m.weight : 1 / moves.length;
      if (r <= acc) return m;
    }
    return moves[moves.length - 1];
  }

  /** Drives the game forward: plays the bot's move if it's the bot's turn,
   *  otherwise just updates the status line and waits for your input. */
  function advance() {
    if (state.chess.isGameOver()) { renderStatus(); return; }

    const node = state.offBook ? null : nodeAt(state.pathUci);

    if (!node) {
      state.offBook = true;
      renderStatus();
      return;
    }

    if (node.role === 'bot') {
      renderStatus('bot-thinking', 'bot is replying…');
      state.awaitingBot = true;
      renderBoard(); // pieces should stop being draggable while the bot "thinks"
      setTimeout(() => {
        const choice = pickWeighted(node.moves);
        // Flip this BEFORE applying the move: applyUci() renders the board,
        // and draggable-eligibility is computed at render time. Flipping
        // after would bake "not your turn yet" into that render and nothing
        // would become interactive until some unrelated re-render happened.
        state.awaitingBot = false;
        applyUci(choice.uci);
        const pct = Math.round((choice.weight != null ? choice.weight : choice.freq) * 100);
        feedbackEl.className = 'chess-feedback feedback-bot';
        feedbackEl.textContent = `bot played ${choice.san} — around ${pct}% of club games go this way here`;
        advance();
      }, BOT_MOVE_DELAY_MS);
      return;
    }

    renderStatus('player-turn', 'your move — find the book continuation');
  }

  /** Applies a move already known to be legal & in the tree (the bot's). */
  function applyUci(uci) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4) : undefined;
    const result = state.chess.move({ from, to, promotion });
    if (!result) return null; // tree/engine disagreement; shouldn't happen, but don't crash the board
    state.pathUci = [...state.pathUci, uci];
    renderBoard(from, to);
    return result;
  }

  /** Applies a move from user input (click or drag), after legality check. */
  function attemptMove(from, to) {
    if (!canInteract()) return false;

    const legal = state.chess.moves({ square: from, verbose: true });
    const match = legal.find(m => m.to === to);
    if (!match) return false;

    // Captured BEFORE the move: this is what we grade against. Only a
    // genuine "player" node (in-book, your turn) is gradeable -- off-book
    // hotseat moves have no tree data and aren't scored (that's Phase 5's
    // job, once Stockfish can evaluate arbitrary positions).
    const preNode = !state.offBook ? nodeAt(state.pathUci) : null;

    const promotion = match.promotion ? 'q' : undefined;
    const result = state.chess.move({ from, to, promotion });
    if (!result) return false;

    state.pathUci = [...state.pathUci, result.lan];
    state.selectedSquare = null;

    if (preNode && preNode.role === 'player') gradeMove(preNode, result.lan);

    renderBoard(from, to);
    advance();
    return true;
  }

  /** Ranks the played move against a player node's book list and scores it.
   *  Not found in the list -> 0 points; this is the same condition that will
   *  send the game off-book on the very next lookup, so nothing extra needs
   *  flagging here beyond the feedback message itself. */
  function gradeMove(node, uci) {
    const idx = node.moves.findIndex(m => m.uci === uci);
    const found = idx !== -1 && idx < RANK_POINTS.length;
    const points = found ? RANK_POINTS[idx] : 0;
    const best = node.moves[0];

    state.score.totalPoints += points;
    state.score.gradedMoves += 1;
    renderScore();

    if (found) {
      const pct = Math.round(node.moves[idx].freq * 100);
      feedbackEl.className = 'chess-feedback ' + (idx === 0 ? 'feedback-best' : 'feedback-partial');
      feedbackEl.textContent = idx === 0
        ? `✓ best move (+${points}) — played in ${pct}% of games here`
        : `✓ ${RANK_LABEL[idx]} (+${points}) — played in ${pct}% of games here`;
    } else {
      const bestPct = Math.round(best.freq * 100);
      feedbackEl.className = 'chess-feedback feedback-miss';
      feedbackEl.textContent = `not a tracked continuation (+0) — the book move here was ${best.san} (${bestPct}% of games)`;
    }
  }

  function renderScore() {
    const { totalPoints, gradedMoves } = state.score;
    if (!gradedMoves) { scoreEl.textContent = ''; return; }
    const avg = Math.round(totalPoints / gradedMoves);
    scoreEl.textContent = `${totalPoints} pts across ${gradedMoves} book move${gradedMoves === 1 ? '' : 's'} — ${avg}% average`;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function renderBoard(lastFrom, lastTo) {
    boardEl.innerHTML = '';
    const flip = state.opening.playerColor === 'black';
    const board = state.chess.board(); // row0=rank8..row7=rank1, col0=a..col7=h
    const own = wantsColor();
    const turnColor = state.chess.turn();

    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const row = flip ? 7 - displayRow : displayRow;
        const col = flip ? 7 - displayCol : displayCol;
        const piece = board[row][col];
        const sq = FILES[col] + (8 - row);

        const sqEl = doc.createElement('div');
        sqEl.className = 'chess-square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
        sqEl.dataset.square = sq;
        if (sq === lastFrom || sq === lastTo) sqEl.classList.add('last-move');

        if (piece) {
          const pieceEl = doc.createElement('span');
          const isOwn = piece.color === own;
          pieceEl.className = 'chess-piece ' + (isOwn ? 'own' : 'opponent');
          pieceEl.textContent = (piece.color === 'w' ? WHITE_GLYPHS : BLACK_GLYPHS)[piece.type];
          pieceEl.dataset.square = sq;
          // Visual "own/opponent" coloring always reflects the opening's real
          // color; drag eligibility reflects who can actually move right now.
          const draggableNow = canInteract() && piece.color === turnColor;
          pieceEl.draggable = draggableNow;
          if (draggableNow) {
            // Highlighting here only ever toggles classes on existing nodes
            // (see highlightSquares/clearHighlights) -- it must never trigger
            // a renderBoard() call, or the node dragstart fired on would be
            // torn down mid-drag, which real browsers can treat as a
            // cancelled drag. jsdom's synthetic events wouldn't have caught
            // that, so this is enforced by keeping the two concerns apart.
            pieceEl.addEventListener('dragstart', e => {
              state.draggedFrom = sq;
              if (e.dataTransfer) {
                e.dataTransfer.setData('text/plain', sq);
                e.dataTransfer.effectAllowed = 'move';
              }
              pieceEl.classList.add('dragging');
              highlightSquares(sq);
            });
            pieceEl.addEventListener('dragend', () => {
              pieceEl.classList.remove('dragging');
              // Fires whether or not a valid drop occurred. If drop() already
              // resolved the move, draggedFrom is already null here, so this
              // only cleans up a drag that ended without landing on a valid
              // square (dropped outside the board, Esc, etc).
              if (state.draggedFrom) {
                state.draggedFrom = null;
                clearHighlights();
              }
            });
          }
          sqEl.appendChild(pieceEl);
        }

        sqEl.addEventListener('click', () => onSquareClick(sq));
        sqEl.addEventListener('dragover', e => e.preventDefault());
        sqEl.addEventListener('drop', e => { e.preventDefault(); onDrop(sq); });

        boardEl.appendChild(sqEl);
      }
    }

    if (state.selectedSquare) highlightSquares(state.selectedSquare);
  }

  /** Toggles classes on the CURRENT square nodes -- never rebuilds them.
   *  Safe to call mid-drag; used by both click-select and drag hover so the
   *  two input methods share one visual language. */
  function highlightSquares(fromSquare) {
    clearHighlights();
    state.selectedSquare = fromSquare;
    const fromEl = boardEl.querySelector(`.chess-square[data-square="${fromSquare}"]`);
    if (fromEl) fromEl.classList.add('selected');
    state.chess.moves({ square: fromSquare, verbose: true }).forEach(m => {
      const targetEl = boardEl.querySelector(`.chess-square[data-square="${m.to}"]`);
      if (!targetEl) return;
      targetEl.classList.add(targetEl.querySelector('.chess-piece') ? 'legal-capture' : 'legal-target');
    });
  }

  function clearHighlights() {
    state.selectedSquare = null;
    boardEl.querySelectorAll('.selected, .legal-target, .legal-capture').forEach(el => {
      el.classList.remove('selected', 'legal-target', 'legal-capture');
    });
  }

  function onSquareClick(sq) {
    if (!canInteract()) return;

    if (state.selectedSquare === sq) {
      clearHighlights();
      return;
    }

    if (state.selectedSquare && attemptMove(state.selectedSquare, sq)) return;

    const piece = state.chess.get(sq);
    const selectable = piece && piece.color === state.chess.turn();
    if (selectable) highlightSquares(sq);
    else clearHighlights();
  }

  function onDrop(sq) {
    const from = state.draggedFrom;
    state.draggedFrom = null;
    if (!from) return;
    // A successful attemptMove() already rebuilds the board and leaves no
    // stale highlight. A failed one hasn't touched anything -- the drag's own
    // highlight is still showing from dragstart, so just clear it.
    if (!attemptMove(from, sq)) clearHighlights();
  }

  function renderStatus(cls, text) {
    if (state.chess.isCheckmate()) {
      statusEl.className = 'chess-status';
      statusEl.textContent = `checkmate — ${isPlayerTurn() ? 'the bot' : 'you'} won this line`;
      return;
    }
    if (state.chess.isStalemate() || state.chess.isDraw()) {
      statusEl.className = 'chess-status';
      statusEl.textContent = 'draw';
      return;
    }
    if (state.offBook) {
      statusEl.className = 'chess-status off-book';
      statusEl.textContent = "you're off the studied line — free play (not scored yet)";
      return;
    }
    statusEl.className = 'chess-status ' + (cls || '');
    statusEl.textContent = text || '';
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  return loadIndex()
    .then(() => {
      if (!state.index.length) throw new Error('no openings found in index.json');
    })
    .catch(err => {
      pickerErrorEl.hidden = false;
      pickerErrorEl.textContent = `couldn't load opening data: ${err.message}`;
    });
}