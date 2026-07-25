# Claude Project Context — linnsanity

## What this project is

A personal portfolio website (linnsanity) — a minimal, dark-themed static site with four pages: About, Photos, Games, and Files. Built with zero dependencies: pure HTML, CSS, and vanilla JavaScript. Deployed on Vercel.

## Tech stack

- Vanilla HTML5 / CSS3 / JS (ES6+) — no frameworks, no npm, no build step
- Canvas API for the Snake game
- localStorage for Snake high score persistence
- Vercel with `cleanUrls: true` for clean URL routing

## File structure

```
linnsanity/
├── index.html          # About/landing page
├── photos.html         # Photo gallery with lightbox
├── games.html          # Games hub (currently: Snake)
├── files.html          # File downloads page
├── vercel.json         # { "cleanUrls": true }
├── css/style.css       # All styles — design tokens in :root CSS variables
├── js/nav.js           # Injects <nav> into every page on DOMContentLoaded
├── js/snake.js         # Snake game (IIFE, Canvas, 120ms game loop)
├── img/                # Photo assets (empty — auto-populate gallery when filled)
└── downloads/          # Downloadable files (empty)
```

## Design system (CSS variables in style.css :root)

- `--bg: #0a0a0a` — page background
- `--bg-light: #141414` — cards, nav
- `--text: #e0e0e0` — body text
- `--text-dim: #888` — secondary text
- `--accent: #00ff88` — neon green, links, highlights
- Font: monospace. Max content width: 800px.

## Key patterns

- **Navigation:** `nav.js` dynamically injects the nav bar into every page. Detects current page via `window.location.pathname`. Supports both `file://` (local dev) and Vercel clean URLs.
- **Snake game:** IIFE in `snake.js`. 20x20 grid, 120ms ticks, arrow/WASD controls, wall + self collision. High score in localStorage (`snake-high`).
- **Photo gallery:** `auto-fill minmax(220px, 1fr)` CSS grid. Lightbox is inline JS in `photos.html`.
- **No modules, no bundler** — scripts loaded via `<script defer>` tags.

## How to add content

- **Photos:** Drop `.jpg`/`.png` into `/img/` — gallery auto-populates
- **Downloads:** Add file to `/downloads/`, add `.file-item` div to `files.html`
- **New page:** Copy an HTML file, update `<main>` content, optionally add route to `nav.js`
- **New game:** New JS file using IIFE pattern, new `<canvas>` in `games.html`

## Coding conventions

- Keep everything vanilla — no external libraries or frameworks
- New JS files should use the IIFE pattern to avoid global scope pollution
- All colors should use CSS variables, never hardcoded hex values outside `:root`
- Mobile breakpoint is `max-width: 600px`
- No build step — code must work directly in the browser without transpilation
