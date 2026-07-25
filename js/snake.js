(() => {
  const canvas = document.getElementById('snake-canvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('high-score');
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');

  const GRID = 20;
  const COLS = canvas.width / GRID;
  const ROWS = canvas.height / GRID;
  const TICK_MS = 120;

  const COLORS = {
    bg: '#0a0a0a',
    grid: '#111',
    snake: '#00ff88',
    snakeHead: '#00ffaa',
    food: '#ff5555',
    foodGlow: 'rgba(255, 85, 85, 0.3)',
  };

  let snake, direction, nextDirection, food, score, highScore, running, gameLoop;

  highScore = parseInt(localStorage.getItem('snake-high') || '0', 10);
  highScoreEl.textContent = highScore;

  function init() {
    const midX = Math.floor(COLS / 2);
    const midY = Math.floor(ROWS / 2);
    snake = [
      { x: midX, y: midY },
      { x: midX - 1, y: midY },
      { x: midX - 2, y: midY },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    scoreEl.textContent = '0';
    placeFood();
    running = true;
    overlay.style.display = 'none';
    draw();
    clearInterval(gameLoop);
    gameLoop = setInterval(tick, TICK_MS);
  }

  function placeFood() {
    let pos;
    do {
      pos = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
      };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    food = pos;
  }

  function tick() {
    if (!running) return;

    direction = { ...nextDirection };

    const head = {
      x: snake[0].x + direction.x,
      y: snake[0].y + direction.y,
    };

    // Wall collision
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      return gameOver();
    }

    // Self collision
    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      return gameOver();
    }

    snake.unshift(head);

    // Eat food
    if (head.x === food.x && head.y === food.y) {
      score++;
      scoreEl.textContent = score;
      if (score > highScore) {
        highScore = score;
        highScoreEl.textContent = highScore;
        localStorage.setItem('snake-high', String(highScore));
      }
      placeFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function gameOver() {
    running = false;
    clearInterval(gameLoop);
    overlayTitle.textContent = 'game over';
    overlayText.textContent = `score: ${score} — press any key to restart`;
    overlay.style.display = 'block';
  }

  function draw() {
    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= canvas.width; x += GRID) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += GRID) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Food glow
    ctx.fillStyle = COLORS.foodGlow;
    ctx.beginPath();
    ctx.arc(
      food.x * GRID + GRID / 2,
      food.y * GRID + GRID / 2,
      GRID,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Food
    ctx.fillStyle = COLORS.food;
    ctx.fillRect(food.x * GRID + 2, food.y * GRID + 2, GRID - 4, GRID - 4);

    // Snake body
    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? COLORS.snakeHead : COLORS.snake;
      ctx.fillRect(seg.x * GRID + 1, seg.y * GRID + 1, GRID - 2, GRID - 2);
    });
  }

  // Input
  const KEY_MAP = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    W: { x: 0, y: -1 },
    S: { x: 0, y: 1 },
    A: { x: -1, y: 0 },
    D: { x: 1, y: 0 },
  };

  document.addEventListener('keydown', (e) => {
    const dir = KEY_MAP[e.key];
    if (!dir) return;

    e.preventDefault();

    // If not running, restart
    if (!running) {
      init();
      return;
    }

    // Prevent 180-degree turns
    if (dir.x !== -direction.x || dir.y !== -direction.y) {
      nextDirection = dir;
    }
  });

  // Initial draw
  snake = [
    { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) },
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  food = { x: Math.floor(COLS / 2) + 5, y: Math.floor(ROWS / 2) };
  score = 0;
  running = false;
  draw();
})();
