# Architecture Overview — linnsanity

## Philosophy

Zero-dependency static site. No npm, no bundler, no framework. Every file is directly served as-is. The goal is maximum simplicity: edit a file, refresh the browser, done.

---

## File Responsibilities

### HTML Pages
Each page is a standalone `.html` file. They share:
- The same `<link rel="stylesheet" href="/css/style.css">` reference
- A `<script src="/js/nav.js" defer></script>` tag that injects the nav bar
- No shared templating — duplication is intentional to avoid build complexity

### `css/style.css`
Single stylesheet for the entire site. Organized in sections:
1. CSS variables (design tokens)
2. Reset / base styles
3. Navigation
4. Page-specific blocks (about, photos, games, files)
5. Responsive overrides (`@media max-width: 600px`)

### `js/nav.js`
Runs on every page. On `DOMContentLoaded`:
1. Builds a `<nav>` element with the site logo and four links
2. Detects the current page by comparing `window.location.pathname` to known routes
3. Adds `.active` class to the matching link
4. Inserts the nav before the first child of `<body>`

Supports both local `file://` paths (for development) and deployed clean URLs.

### `js/snake.js`
Self-contained Snake game wrapped in an IIFE to avoid global scope pollution.

**Game loop:** `setInterval` at 120ms ticks (~8.3 moves/sec)

**State:**
- `snake` — array of `{x, y}` segment objects, head at index 0
- `dir` / `nextDir` — current and queued direction (prevents 180° reversal)
- `food` — `{x, y}` position
- `score` / `highScore` — current score and localStorage-persisted best

**Rendering pipeline (each tick):**
1. Clear canvas
2. Draw grid lines
3. Draw food with glow
4. Draw snake segments (head is brighter)

**Collision detection:**
- Wall: head x/y outside 0–19 range
- Self: head position matches any body segment

**localStorage key:** `snake-high`

---

## Data Flow

```
Browser request
    └── Vercel serves static file
            └── HTML parsed
                    └── DOMContentLoaded
                            ├── nav.js → injects <nav>, marks active link
                            └── snake.js (games page only) → initializes canvas game

User input (keyboard)
    └── snake.js keydown listener → queues direction change → applied on next tick

User clicks photo
    └── inline JS in photos.html → opens lightbox overlay → Escape/click closes it
```

---

## Patterns Used

| Pattern | Where | Why |
|---------|-------|-----|
| CSS custom properties | `style.css :root` | Single source of truth for colors/fonts |
| Dynamic DOM injection | `nav.js` | Share navigation without templating or server-side includes |
| IIFE | `snake.js` | Isolate game state without modules or bundler |
| `auto-fill minmax()` CSS grid | Photo gallery | Responsive layout without JS or breakpoints |
| localStorage | Snake high score | Lightweight client-side persistence, no backend needed |
| Inline JS | `photos.html` lightbox | Simple enough that a separate file would be overkill |

---

## Intentional Omissions

- **No framework** — site is too small to justify the overhead
- **No build step** — no transpilation, minification, or bundling
- **No package.json** — nothing to install
- **No backend** — all content is static; no API, database, or server
- **No JS modules** — IIFE pattern used instead to keep browser compatibility simple

---

## Extending the Site

**Adding a new page:**
1. Copy an existing `.html` file
2. Update the `<title>` and `<main>` content
3. Add the new route to the `pages` array in `nav.js` if you want it in the nav

**Adding a new game:**
1. Create `/js/mygame.js` using the IIFE pattern from `snake.js`
2. Add a `<canvas>` and container div in `games.html`
3. Add a `<script src="/js/mygame.js" defer></script>` tag

**Changing the color scheme:**
Edit only the CSS variables in `style.css :root` — all colors cascade from there.
