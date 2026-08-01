#!/usr/bin/env node
'use strict';

/**
 * build-openings.js — Phase 1 of the linnsanity chess opening trainer.
 *
 * Walks a set of openings against the Lichess Opening Explorer and writes one
 * JSON tree per opening into js/data/openings/.
 *
 * Design notes:
 *   - Zero dependencies. Node 18+ (global fetch). No npm install, no build step.
 *   - Nodes are keyed by move path, not FEN, because computing FENs would
 *     require a chess library. Transpositions duplicate slightly; harmless.
 *   - PLAYER nodes are fetched from /masters   -> defines the "correct" answer
 *     BOT    nodes are fetched from /lichess   -> defines realistic replies
 *     ...so it's one request per node, not two.
 *   - Expansion is breadth-first and budgeted by reach probability, so main
 *     lines go deep and obscure sidelines stop early.
 *   - Every response is cached on disk. Re-running after a crash or a 429
 *     costs nothing.
 *
 * Usage:
 *   node scripts/build-openings.js                 # all openings
 *   node scripts/build-openings.js italian         # just one
 *   node scripts/build-openings.js --max-nodes 120 # smaller trial run
 *   node scripts/build-openings.js --out ./js/data/openings
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// explorer.lichess.org is the current host; .ovh is the legacy one kept as a
// fallback. As of March 2026 both require authentication -- anonymous requests
// were disabled after a DDoS. See loadToken() below.
const HOSTS = ['https://explorer.lichess.org', 'https://explorer.lichess.ovh'];

const RATINGS = '1600,1800';              // club band: 1600 -> 2000
const SPEEDS = 'blitz,rapid,classical';   // bullet excluded: opening choice is noise there
// Rating params are group floors, each running up to the next group, so
// 1600,1800 covers 1600-2000.
const RATING_BAND_LABEL = '1600-2000';

const REQUEST_SPACING_MS = 1100;  // one request at a time, politely spaced
const RATE_LIMIT_WAIT_MS = 65000; // a 429 means wait a full minute
const MAX_RETRIES = 5;

const DEFAULTS = {
  maxNodes: 400,        // hard backstop per opening
  maxFailures: 8,       // give up after this many failures in a row
  maxPlies: 16,         // ply depth beyond the setup line
  reachFloor: 0.005,    // stop expanding lines reached in <0.5% of games
  playerBranches: 4,    // max book alternatives graded at your turn
  botBranches: 5,       // "around 5 theoretical ways the bot plays"
  playerMinFreq: 0.05,  // an alternative needs 5% of master games to count
  playerMinGames: 20,
  botMinFreq: 0.03,
  botMinGames: 30,
  mastersMinGames: 50,  // below this, fall back to the lichess DB for theory
  signatureMinGames: 15 // a signature move needs real games to be promoted
};

// ---------------------------------------------------------------------------
// Openings
//
// `setup` is played for free as the premise of the drill; grading starts after.
// `signature` promotes repertoire-consistent moves to rank 1 when they have
// real games behind them. Essential for systems (London), harmless elsewhere.
// ---------------------------------------------------------------------------

const OPENINGS = [
  {
    id: 'italian',
    name: 'Italian Game',
    playerColor: 'white',
    setupUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'],
    setupSan: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    signature: ['c3', 'd3', 'O-O', 'Nf3', 'Bc4', 'd4', 'Bb3', 'Re1', 'Nbd2', 'h3']
  },
  {
    id: 'london',
    name: 'London System',
    playerColor: 'white',
    // Deliberately short: the London is a system played against anything, so
    // the bot picks Black's setup and you have to find the London moves.
    setupUci: ['d2d4'],
    setupSan: ['d4'],
    isSystem: true,
    signature: ['Bf4', 'e3', 'c3', 'Bd3', 'Nbd2', 'Nf3', 'h3', 'O-O', 'Qb3', 'Ne5']
  },
  {
    id: 'scotch-gambit',
    name: 'Scotch Gambit',
    playerColor: 'white',
    setupUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f1c4'],
    setupSan: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Bc4'],
    signature: ['O-O', 'c3', 'Ng5', 'Nxd4', 'e5', 'Re1', 'Bxf7+', 'Qb3']
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defence',
    playerColor: 'black',
    setupUci: ['e2e4', 'c7c6'],
    setupSan: ['e4', 'c6'],
    signature: ['d5', 'dxe4', 'Bf5', 'Nf6', 'e6', 'Nd7', 'Qb6', 'c5', 'Bg4']
  },
  {
    id: 'french',
    name: 'French Defence',
    playerColor: 'black',
    setupUci: ['e2e4', 'e7e6'],
    setupSan: ['e4', 'e6'],
    signature: ['d5', 'c5', 'Nc6', 'Qb6', 'Nf6', 'Bb4', 'dxe4', 'Ne7', 'f6']
  },
  {
    id: 'modern',
    name: 'Modern Defence',
    playerColor: 'black',
    setupUci: ['e2e4', 'g7g6'],
    setupSan: ['e4', 'g6'],
    // Transposes constantly into Pirc/KID structures; tree will be thinner.
    signature: ['Bg7', 'd6', 'Nf6', 'c6', 'a6', 'Nd7', 'e5', 'c5', 'b5']
  }
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { ...DEFAULTS, only: null, out: null, token: null, offline: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-nodes') opts.maxNodes = parseInt(argv[++i], 10);
    else if (a === '--max-plies') opts.maxPlies = parseInt(argv[++i], 10);
    else if (a === '--reach-floor') opts.reachFloor = parseFloat(argv[++i]);
    else if (a === '--max-failures') opts.maxFailures = parseInt(argv[++i], 10);
    else if (a === '--token') opts.token = argv[++i];
    else if (a === '--offline') opts.offline = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { console.error(`unknown flag: ${a}`); process.exit(1); }
    else rest.push(a);
  }
  if (rest.length) opts.only = rest;
  return opts;
}

function usage() {
  console.log(`
build-openings.js — generate opening trees from the Lichess Opening Explorer

  node scripts/build-openings.js [opening-id ...] [flags]

Openings: ${OPENINGS.map(o => o.id).join(', ')}

Flags:
  --max-nodes N     node cap per opening        (default ${DEFAULTS.maxNodes})
  --max-plies N     depth beyond the setup      (default ${DEFAULTS.maxPlies})
  --reach-floor F   stop below this reach prob  (default ${DEFAULTS.reachFloor})
  --max-failures N  abort after N failures in a row (default ${DEFAULTS.maxFailures})
  --out DIR         output directory            (default js/data/openings)
  --token TOKEN     Lichess token (or .env, $LICHESS_TOKEN, .lichess-token)
  --offline         rebuild from cache only, no network, no token needed
`);
}

// ---------------------------------------------------------------------------
// HTTP: sequential, cached, backs off on 429
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(process.cwd(), '.cache', 'explorer');
let TOKEN = null;
let OFFLINE = false;

/**
 * Read a text file, tolerating the encodings Windows shells produce.
 * `echo x > .env` in Windows PowerShell 5.1 writes UTF-16LE, which parses as
 * mojibake if you naively toString('utf8') it.
 */
function readTextFile(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le').replace(/^\uFEFF/, '');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return buf.swap16().toString('utf16le').replace(/^\uFEFF/, '');
  // UTF-16LE without a BOM: ASCII text leaves every second byte null.
  if (buf.length > 1 && buf[0] !== 0x00 && buf[1] === 0x00) return buf.toString('utf16le');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/** Minimal KEY=VALUE parser. No dependency on dotenv. */
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of readTextFile(file).split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/**
 * A Lichess personal access token, from (in order): --token, $LICHESS_TOKEN,
 * a .env file, or a .lichess-token file. No OAuth scope is required -- any
 * valid token authenticates. Generate one at:
 *   https://lichess.org/account/oauth/token
 */
function loadToken(cliToken) {
  const candidates = [
    ['--token', cliToken],
    ['$LICHESS_TOKEN', process.env.LICHESS_TOKEN],
    ['.env', readEnvFile(path.join(process.cwd(), '.env')).LICHESS_TOKEN]
  ];
  const tokenFile = path.join(process.cwd(), '.lichess-token');
  if (fs.existsSync(tokenFile)) candidates.push(['.lichess-token', readTextFile(tokenFile)]);

  for (const [source, value] of candidates) {
    if (!value) continue;
    const token = value.trim();
    if (!token) continue;

    // Catch the usual copy/paste mishaps before burning a request on them.
    if (/\s/.test(token)) {
      console.error(`\ntoken from ${source} contains whitespace -- it was probably copied with a line break or quotes.`);
      process.exit(1);
    }
    if (token.includes('=')) {
      console.error(`\ntoken from ${source} contains '=' -- looks like the whole "LICHESS_TOKEN=..." line was used as the value.`);
      process.exit(1);
    }
    if (/^(lip_)?(your|paste|xxx|token)/i.test(token)) {
      console.error(`\ntoken from ${source} still looks like a placeholder.`);
      process.exit(1);
    }
    tokenSource = source;
    return token;
  }
  return null;
}
let tokenSource = null;

const TOKEN_HELP = `
The opening explorer requires a Lichess account token. Anonymous requests were
disabled in March 2026 after the explorer was hit by a DDoS. It is still free
and unlimited -- you just have to identify yourself.

  1. Go to https://lichess.org/account/oauth/token
  2. Create a token. No scopes need to be ticked; the description is up to you.
  3. Put it in a .env file in the project root:

       LICHESS_TOKEN=lip_yourtokenhere

     ...or pass it another way: --token, $LICHESS_TOKEN, or .lichess-token.

Add .env to .gitignore -- a token can act on your account, so it must never be
committed or shipped to a browser.
`;

let liveHost = null;
let lastRequestAt = 0;
let consecutiveFailures = 0;
let maxConsecutiveFailures = 8;
const stats = { fetched: 0, cached: 0, retries: 0 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cachePathFor(db, params) {
  const key = crypto.createHash('sha1').update(`${db}?${params}`).digest('hex');
  return path.join(CACHE_DIR, `${db}-${key}.json`);
}

async function explorer(db, playUci, bypassCache) {
  // Built by hand rather than with URLSearchParams: that percent-encodes the
  // commas, and every working explorer example in the wild uses literal ones.
  const parts = [`play=${playUci.join(',')}`, 'moves=12', 'topGames=0'];
  if (db === 'lichess') {
    parts.push('variant=standard', `speeds=${SPEEDS}`, `ratings=${RATINGS}`);
  }
  const params = parts.join('&');

  const cf = cachePathFor(db, params);
  if (!bypassCache && fs.existsSync(cf)) {
    stats.cached++;
    return JSON.parse(fs.readFileSync(cf, 'utf8'));
  }

  const hosts = liveHost ? [liveHost] : HOSTS;
  let lastErr = null;
  const hostErrors = new Map();

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'linnsanity-opening-trainer/1.0'
  };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let retryable = false;

    for (const host of hosts) {
      const wait = REQUEST_SPACING_MS - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      let res;
      try {
        res = await fetch(`${host}/${db}?${params}`, { headers });
      } catch (err) {
        lastErr = err;      // network blip / DNS — worth another go
        hostErrors.set(host, err.message);
        retryable = true;
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        liveHost = host;
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cf, JSON.stringify(data));
        stats.fetched++;
        consecutiveFailures = 0;
        return data;
      }

      if (res.status === 429) {
        stats.retries++;
        process.stdout.write(`\n  rate limited — waiting ${RATE_LIMIT_WAIT_MS / 1000}s...`);
        await sleep(RATE_LIMIT_WAIT_MS);
        lastErr = new Error('429 Too Many Requests');
        retryable = true;
        break;
      }

      // Any other status is deterministic: retrying the same URL won't help.
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
      lastErr.status = res.status;
      hostErrors.set(host, `HTTP ${res.status}`);
    }

    if (!retryable) break;
  }

  consecutiveFailures++;
  if (consecutiveFailures >= maxConsecutiveFailures) {
    const fatal = new Error(
      `${consecutiveFailures} requests failed in a row (last: ${lastErr && lastErr.message}). ` +
      `Stopping so the run doesn't grind on a dead endpoint. Progress is cached — re-run to resume.`
    );
    fatal.fatal = true;
    throw fatal;
  }
  const err = lastErr || new Error('explorer request failed');
  err.hostErrors = hostErrors;
  throw err;
}

async function smokeTest() {
  if (OFFLINE) {
    console.log('offline mode: skipping the reachability check, using cache only');
    return;
  }
  process.stdout.write('authenticating against the explorer... ');
  try {
    // Deliberately bypasses the cache: a cached hit would prove nothing about
    // whether the token is present and accepted.
    const data = await explorer('masters', ['e2e4'], true);
    if (!data || !Array.isArray(data.moves)) throw new Error('unexpected response shape');
    console.log(`ok (${liveHost})`);
  } catch (err) {
    console.log('FAILED');

    if (err.hostErrors && err.hostErrors.size) {
      console.error('');
      for (const [host, msg] of err.hostErrors) console.error(`  ${host} -> ${msg}`);
    }

    if (err.status === 401 || err.status === 403) {
      console.error(TOKEN ? `
The token was rejected. Check it was copied whole and hasn't been revoked:
  https://lichess.org/account/oauth/token
` : TOKEN_HELP);
    } else if (err.status === 429) {
      console.error(`
Rate limited before the run even started. The explorer has had extended
outages. Wait a while and try again.
`);
    } else {
      console.error(`
The explorer did not respond: ${err.message}
Nothing has been written. Check https://lichess.org/api#tag/Opening-Explorer
`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Move shaping
// ---------------------------------------------------------------------------

function totalGames(m) {
  return (m.white || 0) + (m.draws || 0) + (m.black || 0);
}

/** Score from the perspective of whoever is to move: wins + half the draws. */
function scoreFor(m, turn) {
  const t = totalGames(m);
  if (!t) return null;
  const wins = turn === 'w' ? (m.white || 0) : (m.black || 0);
  return round3((wins + (m.draws || 0) / 2) / t);
}

const round3 = n => Math.round(n * 1000) / 1000;

function shapeMoves(raw, turn, parentTotal) {
  return (raw || []).map(m => {
    const games = totalGames(m);
    return {
      uci: m.uci,
      san: m.san,
      games,
      freq: parentTotal ? round3(games / parentTotal) : 0,
      score: scoreFor(m, turn),
      white: games ? round3((m.white || 0) / games) : null,
      draw: games ? round3((m.draws || 0) / games) : null,
      black: games ? round3((m.black || 0) / games) : null,
      avgRating: m.averageRating || m.averageOpponentRating || null,
      eco: m.opening ? m.opening.eco : null,
      openingName: m.opening ? m.opening.name : null
    };
  });
}

/**
 * Promote repertoire-consistent moves. Without this the London ranks 2.c4
 * above 2.Bf4 and marks the actual system move wrong.
 *
 * The signature array doubles as a priority list. For a system opening the
 * order is authoritative — Bf4 outranks e3 outranks c3 — because "most common
 * in master games" is precisely the wrong metric when the whole point is to
 * play a specific setup. For non-system openings, signature membership only
 * acts as a tiebreaker and master frequency still decides the order within it.
 *
 * Every move also gets `inRepertoire`, so the scoring layer can distinguish
 * "good move, wrong repertoire" from "good move, partial credit".
 */
function applySignature(moves, opening, opts) {
  if (!opening.signature || !opening.signature.length) {
    moves.forEach(m => { m.inRepertoire = true; });
    return moves;
  }

  const rank = new Map(opening.signature.map((san, i) => [san, i]));
  const isSig = m => rank.has(m.san) && m.games >= opts.signatureMinGames;

  moves.forEach(m => { m.inRepertoire = isSig(m); });

  const hit = moves.filter(m => m.inRepertoire);
  if (!hit.length) {
    // Nothing from the repertoire is playable here — fall back to raw theory
    // and let the app flag that the line has left the system.
    moves.forEach(m => { m.inRepertoire = true; });
    return moves;
  }

  if (opening.isSystem) hit.sort((a, b) => rank.get(a.san) - rank.get(b.san));
  return [...hit, ...moves.filter(m => !m.inRepertoire)];
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

const keyOf = pathUci => pathUci.join(',');

function sideToMove(pathUci) {
  return pathUci.length % 2 === 0 ? 'w' : 'b';
}

async function buildOpening(opening, opts) {
  const playerTurn = opening.playerColor === 'white' ? 'w' : 'b';
  const setup = opening.setupUci;
  const nodes = {};
  const warnings = [];

  // Breadth-first, so the budget is spent on the likeliest positions first.
  const queue = [{ pathUci: [...setup], pathSan: [...opening.setupSan], reach: 1 }];
  let expanded = 0;

  while (queue.length && expanded < opts.maxNodes) {
    const cur = queue.shift();
    const key = keyOf(cur.pathUci);
    if (nodes[key]) continue;

    const depth = cur.pathUci.length - setup.length;
    if (depth >= opts.maxPlies) continue;

    const turn = sideToMove(cur.pathUci);
    const isPlayerTurn = turn === playerTurn;

    // Player's turn -> masters defines theory. Bot's turn -> club-level replies.
    let db = isPlayerTurn ? 'masters' : 'lichess';
    let data;
    try {
      data = await explorer(db, cur.pathUci);
    } catch (err) {
      if (err.fatal) throw err;
      warnings.push(`fetch failed at ${cur.pathSan.join(' ')}: ${err.message}`);
      continue;
    }

    let total = totalGames(data);

    // Thin master coverage (very common in the Modern) -> fall back to the
    // lichess DB so there's still a defensible "correct" move, and flag it.
    if (isPlayerTurn && total < opts.mastersMinGames) {
      try {
        const alt = await explorer('lichess', cur.pathUci);
        if (totalGames(alt) > total) {
          data = alt;
          total = totalGames(alt);
          db = 'lichess';
        }
      } catch { /* keep the sparse masters data */ }
    }

    let moves = shapeMoves(data.moves, turn, total);
    if (!moves.length) continue;

    if (isPlayerTurn) {
      moves = applySignature(moves, opening, opts);
      moves = moves
        .filter((m, i) => i === 0 || (m.freq >= opts.playerMinFreq && m.games >= opts.playerMinGames))
        .slice(0, opts.playerBranches);
    } else {
      moves = moves
        .filter((m, i) => i === 0 || (m.freq >= opts.botMinFreq && m.games >= opts.botMinGames))
        .slice(0, opts.botBranches);
      // Renormalise so the bot's weighted-random pick sums to 1.
      const sum = moves.reduce((s, m) => s + m.games, 0) || 1;
      moves.forEach(m => { m.weight = round3(m.games / sum); });
    }

    nodes[key] = {
      pathUci: cur.pathUci,
      pathSan: cur.pathSan,
      turn,
      role: isPlayerTurn ? 'player' : 'bot',
      source: db,
      totalGames: total,
      reach: round3(cur.reach),
      eco: data.opening ? data.opening.eco : null,
      openingName: data.opening ? data.opening.name : null,
      moves
    };
    expanded++;

    process.stdout.write(`\r  ${opening.id}: ${expanded} nodes (${stats.fetched} fetched, ${stats.cached} cached)   `);

    // Queue children. The key asymmetry: at YOUR turn the top move keeps full
    // reach (the main line never gets pruned) while alternatives decay by their
    // real frequency. At the BOT's turn everything decays by frequency.
    moves.forEach((m, i) => {
      // In a system opening, a move outside the repertoire is still stored so
      // it can be graded and explained — but there's no point building out a
      // Queen's Gambit tree inside the London file, so it isn't expanded.
      if (isPlayerTurn && opening.isSystem && !m.inRepertoire) return;

      const childReach = isPlayerTurn
        ? (i === 0 ? cur.reach : cur.reach * m.freq)
        : cur.reach * (m.weight || m.freq);
      if (childReach < opts.reachFloor) return;
      queue.push({
        pathUci: [...cur.pathUci, m.uci],
        pathSan: [...cur.pathSan, m.san],
        reach: childReach
      });
    });

    // Keep the likeliest positions at the front of the budget.
    queue.sort((a, b) => b.reach - a.reach);
  }

  process.stdout.write('\n');

  return {
    id: opening.id,
    name: opening.name,
    playerColor: opening.playerColor,
    ratingBand: RATING_BAND_LABEL,
    speeds: SPEEDS.split(','),
    generated: new Date().toISOString(),
    setup: { uci: opening.setupUci, san: opening.setupSan },
    rootKey: keyOf(opening.setupUci),
    nodeCount: Object.keys(nodes).length,
    warnings,
    nodes
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  maxConsecutiveFailures = opts.maxFailures;
  TOKEN = loadToken(opts.token);
  OFFLINE = opts.offline;

  const outDir = opts.out
    ? path.resolve(opts.out)
    : path.join(process.cwd(), 'js', 'data', 'openings');

  let list = OPENINGS;
  if (opts.only) {
    list = OPENINGS.filter(o => opts.only.includes(o.id));
    const missing = opts.only.filter(id => !OPENINGS.some(o => o.id === id));
    if (missing.length) {
      console.error(`unknown opening(s): ${missing.join(', ')}`);
      console.error(`available: ${OPENINGS.map(o => o.id).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`\nbuilding ${list.length} opening tree(s) -> ${outDir}`);
  console.log(`club band ${RATING_BAND_LABEL}, cap ${opts.maxNodes} nodes each`);
  console.log(TOKEN ? `token: found (${tokenSource})\n` : 'token: MISSING -- this will almost certainly fail\n');

  await smokeTest();
  fs.mkdirSync(outDir, { recursive: true });

  const index = [];
  const failed = [];
  const started = Date.now();

  for (const opening of list) {
    console.log(`\n${opening.name}`);
    const tree = await buildOpening(opening, opts);

    if (tree.nodeCount === 0) {
      console.log(`  !! built 0 nodes -- nothing written for ${opening.id}`);
      tree.warnings.slice(0, 3).forEach(w => console.log(`     ${w}`));
      failed.push(opening.id);
      continue;
    }

    const file = path.join(outDir, `${opening.id}.json`);
    fs.writeFileSync(file, JSON.stringify(tree));

    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`  wrote ${tree.nodeCount} nodes, ${kb}KB`);
    tree.warnings.forEach(w => console.log(`  ! ${w}`));

    index.push({
      id: opening.id,
      name: opening.name,
      playerColor: opening.playerColor,
      setupSan: opening.setupSan,
      nodeCount: tree.nodeCount,
      file: `${opening.id}.json`
    });
  }

  // Merge into any existing index so single-opening runs don't clobber others.
  const indexFile = path.join(outDir, 'index.json');
  let merged = index;
  if (fs.existsSync(indexFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(indexFile, 'utf8')).openings || [];
      const ids = new Set(index.map(o => o.id));
      merged = [...index, ...prev.filter(o => !ids.has(o.id))];
    } catch { /* rewrite from scratch */ }
  }
  merged.sort((a, b) => OPENINGS.findIndex(o => o.id === a.id) - OPENINGS.findIndex(o => o.id === b.id));
  fs.writeFileSync(indexFile, JSON.stringify({ generated: new Date().toISOString(), openings: merged }, null, 2));

  if (failed.length) {
    console.log(`\nFAILED: ${failed.join(', ')} -- no tree could be built.`);
    console.log('If the errors above are 401/403, the token is missing or rejected.');
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\ndone in ${mins} min — ${stats.fetched} requests, ${stats.cached} from cache, ${stats.retries} rate-limit waits`);
  console.log(`cache lives in .cache/explorer (safe to delete; re-runs are free while it exists)\n`);
}

main().catch(err => {
  console.error('\n' + (err && err.stack ? err.stack : err));
  process.exit(1);
});