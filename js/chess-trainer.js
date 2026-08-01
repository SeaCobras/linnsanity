// chess-trainer.js — browser bootstrap.
//
// chess.js is loaded from jsDelivr as a plain ES module -- pinned to an exact
// version and the literal dist file (confirmed dependency-free) so this stays
// a static import with no bundler, matching the rest of the site.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js';
import { initTrainer } from './chess-trainer-core.js';

initTrainer({
  fetchImpl: (...args) => fetch(...args),
  ChessCtor: Chess,
  doc: document,
});