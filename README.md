# linnsanity

A personal portfolio website — a minimal, dark-themed static site showcasing photos, games, and files. Built entirely with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools, no dependencies.

**Live site:** Deployed on Vercel with clean URLs (`/photos`, `/games`, `/files`)

---

## Pages

| Page | URL | Description |
|------|-----|-------------|
| About | `/` | Landing page / bio |
| Photos | `/photos` | Auto-loading photo gallery with lightbox |
| Games | `/games` | Playable games (Snake) |
| Files | `/files` | Downloadable files |

---

## Tech Stack

- **HTML5** — semantic markup
- **CSS3** — custom properties, grid, flexbox
- **Vanilla JS (ES6+)** — no frameworks
- **Canvas API** — Snake game rendering
- **localStorage** — Snake high score persistence
- **Vercel** — hosting with `cleanUrls: true`

---

## Project Structure

```
linnsanity/
├── index.html          # About/landing page
├── photos.html         # Photo gallery
├── games.html          # Games hub
├── files.html          # File downloads
├── vercel.json         # Vercel deployment config
├── css/
│   └── style.css       # Single stylesheet (design system + all pages)
├── js/
│   ├── nav.js          # Dynamic navigation bar (injected into every page)
│   └── snake.js        # Snake game (Canvas, IIFE pattern)
├── img/                # Drop .jpg/.png files here — auto-appear in gallery
└── downloads/          # Drop files here — add file-item divs in files.html
```

---

## Adding Content

**Photos:** Drop image files into `/img/`. They appear automatically in the gallery grid — no code changes needed.

**Downloads:** Add files to `/downloads/`, then add a `.file-item` div to `files.html`:
```html
<div class="file-item">
  <div class="file-info">
    <span class="file-name">filename.ext</span>
    <span class="file-desc">Description of the file</span>
  </div>
  <a href="/downloads/filename.ext" download class="btn">Download</a>
</div>
```

**Games:** Add a new `<div class="game-container">` block in `games.html` and a corresponding JS file in `/js/`.

---

## Design System

CSS custom properties defined in `:root` (`css/style.css`):

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#0a0a0a` | Page background |
| `--bg-light` | `#141414` | Cards, nav |
| `--text` | `#e0e0e0` | Body text |
| `--text-dim` | `#888` | Secondary text |
| `--accent` | `#00ff88` | Neon green — links, highlights |
| `--accent-dim` | `#00cc6a` | Hover states |

Font: monospace stack (Courier New fallback). Max content width: 800px.

---

## Local Development

No build step required. Open any `.html` file directly in a browser, or serve with any static file server:

```bash
npx serve .
# or
python -m http.server 8000
```

---

## Deployment

Push to GitHub and connect to Vercel. The `vercel.json` config handles clean URL routing automatically.
