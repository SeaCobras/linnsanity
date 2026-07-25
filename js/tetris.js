(() => {
  const canvas = document.getElementById('tetris-canvas');
  const ctx = canvas.getContext('2d');
  const holdCanvas = document.getElementById('hold-canvas');
  const holdCtx = holdCanvas.getContext('2d');
  const nextCanvas = document.getElementById('next-canvas');
  const nextCtx = nextCanvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('high-score');
  const levelEl = document.getElementById('level');
  const linesEl = document.getElementById('lines');
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');

  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;

  // Tetromino definitions [rotations][rows][cols]
  const PIECES = {
    I: { color: '#00cfff', cells: [[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],[[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],[[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],[[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]] },
    O: { color: '#ffe000', cells: [[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]]] },
    T: { color: '#a000f0', cells: [[[0,1,0],[1,1,1],[0,0,0]],[[0,1,0],[0,1,1],[0,1,0]],[[0,0,0],[1,1,1],[0,1,0]],[[0,1,0],[1,1,0],[0,1,0]]] },
    S: { color: '#00d000', cells: [[[0,1,1],[1,1,0],[0,0,0]],[[0,1,0],[0,1,1],[0,0,1]],[[0,0,0],[0,1,1],[1,1,0]],[[1,0,0],[1,1,0],[0,1,0]]] },
    Z: { color: '#ff2020', cells: [[[1,1,0],[0,1,1],[0,0,0]],[[0,0,1],[0,1,1],[0,1,0]],[[0,0,0],[1,1,0],[0,1,1]],[[0,1,0],[1,1,0],[1,0,0]]] },
    J: { color: '#0040ff', cells: [[[1,0,0],[1,1,1],[0,0,0]],[[0,1,1],[0,1,0],[0,1,0]],[[0,0,0],[1,1,1],[0,0,1]],[[0,1,0],[0,1,0],[1,1,0]]] },
    L: { color: '#ff8000', cells: [[[0,0,1],[1,1,1],[0,0,0]],[[0,1,0],[0,1,0],[0,1,1]],[[0,0,0],[1,1,1],[1,0,0]],[[1,1,0],[0,1,0],[0,1,0]]] },
  };

  const PIECE_KEYS = Object.keys(PIECES);

  // SRS wall kick data for J/L/S/T/Z
  const KICKS = {
    '0>1': [[-1,0],[-1,1],[0,-2],[-1,-2]],
    '1>0': [[1,0],[1,-1],[0,2],[1,2]],
    '1>2': [[1,0],[1,-1],[0,2],[1,2]],
    '2>1': [[-1,0],[-1,1],[0,-2],[-1,-2]],
    '2>3': [[1,0],[1,1],[0,-2],[1,-2]],
    '3>2': [[-1,0],[-1,-1],[0,2],[-1,2]],
    '3>0': [[-1,0],[-1,-1],[0,2],[-1,2]],
    '0>3': [[1,0],[1,1],[0,-2],[1,-2]],
  };

  // SRS wall kick data for I
  const KICKS_I = {
    '0>1': [[-2,0],[1,0],[-2,-1],[1,2]],
    '1>0': [[2,0],[-1,0],[2,1],[-1,-2]],
    '1>2': [[-1,0],[2,0],[-1,2],[2,-1]],
    '2>1': [[1,0],[-2,0],[1,-2],[-2,1]],
    '2>3': [[2,0],[-1,0],[2,1],[-1,-2]],
    '3>2': [[-2,0],[1,0],[-2,-1],[1,2]],
    '3>0': [[1,0],[-2,0],[1,-2],[-2,1]],
    '0>3': [[-1,0],[2,0],[-1,2],[2,-1]],
  };

  const SCORE_TABLE = [0, 100, 300, 500, 800];
  const COLORS = { bg: '#0a0a0a', grid: '#111', ghost: 'rgba(255,255,255,0.08)' };

  let board, bag, current, currentRot, currentX, currentY;
  let held, holdUsed, next;
  let score, highScore, level, lines;
  let running, started, dropTimer, dropInterval;

  highScore = parseInt(localStorage.getItem('tetris-high') || '0', 10);
  highScoreEl.textContent = highScore;

  // 7-bag randomizer
  function refillBag() {
    const shuffled = [...PIECE_KEYS];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    bag.push(...shuffled);
  }

  function nextPiece() {
    if (bag.length < 2) refillBag();
    return bag.shift();
  }

  function spawn(key) {
    current = key;
    currentRot = 0;
    const shape = PIECES[key].cells[0];
    currentX = Math.floor((COLS - shape[0].length) / 2);
    currentY = 0;
  }

  function cells(key, rot) {
    return PIECES[key].cells[rot % PIECES[key].cells.length];
  }

  function fits(key, rot, x, y) {
    const shape = cells(key, rot);
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nx = x + c, ny = y + r;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
        if (ny >= 0 && board[ny][nx]) return false;
      }
    }
    return true;
  }

  function lock() {
    const shape = cells(current, currentRot);
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const ny = currentY + r;
        if (ny < 0) { endGame(); return; }
        board[ny][currentX + c] = PIECES[current].color;
      }
    }
    clearLines();
    holdUsed = false;
    spawn(next);
    next = nextPiece();
    if (!fits(current, currentRot, currentX, currentY)) {
      endGame();
    }
    drawNext();
  }

  function clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(c => c)) {
        board.splice(r, 1);
        board.unshift(new Array(COLS).fill(null));
        cleared++;
        r++;
      }
    }
    if (!cleared) return;
    lines += cleared;
    score += SCORE_TABLE[cleared] * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(50, 1000 - (level - 1) * 90);
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
    if (score > highScore) {
      highScore = score;
      highScoreEl.textContent = highScore;
      localStorage.setItem('tetris-high', String(highScore));
    }
  }

  function ghostY() {
    let gy = currentY;
    while (fits(current, currentRot, currentX, gy + 1)) gy++;
    return gy;
  }

  function rotate(dir) {
    const nextRot = (currentRot + (dir > 0 ? 1 : 3)) % 4;
    const key = `${currentRot}>${nextRot}`;
    const kicks = current === 'I' ? (KICKS_I[key] || []) : (KICKS[key] || []);
    const tries = [[0, 0], ...kicks];
    for (const [dx, dy] of tries) {
      if (fits(current, nextRot, currentX + dx, currentY + dy)) {
        currentRot = nextRot;
        currentX += dx;
        currentY += dy;
        return;
      }
    }
  }

  function hardDrop() {
    const gy = ghostY();
    score += (gy - currentY) * 2;
    scoreEl.textContent = score;
    currentY = gy;
    lock();
    resetDrop();
    draw();
  }

  function softDrop() {
    if (fits(current, currentRot, currentX, currentY + 1)) {
      currentY++;
      score += 1;
      scoreEl.textContent = score;
    } else {
      lock();
    }
    resetDrop();
    draw();
  }

  function hold() {
    if (holdUsed) return;
    holdUsed = true;
    if (held) {
      const tmp = held;
      held = current;
      spawn(tmp);
    } else {
      held = current;
      spawn(next);
      next = nextPiece();
      drawNext();
    }
    currentRot = 0;
    drawHold();
    draw();
  }

  function resetDrop() {
    clearInterval(dropTimer);
    dropTimer = setInterval(() => {
      if (!running) return;
      if (fits(current, currentRot, currentX, currentY + 1)) {
        currentY++;
      } else {
        lock();
      }
      draw();
    }, dropInterval);
  }

  function init() {
    board = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    bag = [];
    refillBag();
    held = null;
    holdUsed = false;
    score = 0; level = 1; lines = 0;
    dropInterval = 1000;
    scoreEl.textContent = '0';
    levelEl.textContent = '1';
    linesEl.textContent = '0';
    next = nextPiece();
    spawn(nextPiece());
    running = true;
    started = true;
    overlay.style.display = 'none';
    drawHold();
    drawNext();
    resetDrop();
    draw();
  }

  function endGame() {
    running = false;
    clearInterval(dropTimer);
    overlayTitle.textContent = 'game over';
    overlayText.textContent = `score: ${score} — press any key to restart`;
    overlay.style.display = 'block';
  }

  // ===== Drawing =====

  function drawCell(c, x, y, size, alpha) {
    if (!c) return;
    ctx.globalAlpha = alpha ?? 1;
    ctx.fillStyle = c;
    ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    ctx.globalAlpha = 1;
  }

  function drawMiniCell(miniCtx, c, x, y, size) {
    if (!c) return;
    miniCtx.fillStyle = c;
    miniCtx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  }

  function draw() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(canvas.width, y * CELL); ctx.stroke();
    }

    // Board
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        drawCell(board[r][c], c, r, CELL);
      }
    }

    // Ghost
    const gy = ghostY();
    const shape = cells(current, currentRot);
    ctx.fillStyle = COLORS.ghost;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        ctx.fillRect((currentX + c) * CELL + 1, (gy + r) * CELL + 1, CELL - 2, CELL - 2);
      }
    }

    // Active piece
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        drawCell(PIECES[current].color, currentX + c, currentY + r, CELL);
      }
    }
  }

  function drawMini(miniCtx, miniCanvas, key) {
    miniCtx.fillStyle = COLORS.bg;
    miniCtx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);
    if (!key) return;
    const shape = PIECES[key].cells[0];
    const size = 18;
    const offsetX = Math.floor((miniCanvas.width - shape[0].length * size) / 2);
    const offsetY = Math.floor((miniCanvas.height - shape.length * size) / 2);
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        miniCtx.fillStyle = PIECES[key].color;
        miniCtx.fillRect(offsetX + c * size + 1, offsetY + r * size + 1, size - 2, size - 2);
      }
    }
  }

  function drawHold() { drawMini(holdCtx, holdCanvas, held); }
  function drawNext() { drawMini(nextCtx, nextCanvas, next); }

  // Initial blank draw
  board = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  bag = []; refillBag();
  next = nextPiece();
  spawn(nextPiece());
  running = false; started = false;
  draw();
  drawHold();
  drawNext();

  // Input
  document.addEventListener('keydown', (e) => {
    if (!started || !running) {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','c','C'].includes(e.key) || e.key.length === 1) {
        init();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (fits(current, currentRot, currentX - 1, currentY)) { currentX--; draw(); }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (fits(current, currentRot, currentX + 1, currentY)) { currentX++; draw(); }
        break;
      case 'ArrowUp':
        e.preventDefault();
        rotate(1);
        draw();
        break;
      case 'ArrowDown':
        e.preventDefault();
        softDrop();
        break;
      case ' ':
        e.preventDefault();
        hardDrop();
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        hold();
        break;
    }
  });
})();
