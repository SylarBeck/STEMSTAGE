// STEMSTAGE production server: serves the built game (dist/) plus the local services — song library,
// yt-dlp, metadata + lyrics lookups, profiles/scores, Discord and the LAN room server — without Vite.
// Used by the desktop app (src-tauri) and `npm start`.
//
//   PORT / HOST            where to listen (127.0.0.1:5173)
//   STEMSTAGE_DIST         built game folder (default: ../dist)
//   STEMSTAGE_SONGS        songs folder      (default: ../songs)
//   STEMSTAGE_DATA         profiles + scores (default: ../data)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary } from './library.js';
import { createYt, createMeta, createData } from './extras.js';
import { createOnline } from './online.js';
import { createStream } from './stream.js';
import { createDiscord } from './discord.js';
import { guarded, refusal } from './guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const DIST = path.resolve(process.env.STEMSTAGE_DIST || path.join(root, 'dist'));
const SONGS = process.env.STEMSTAGE_SONGS || path.join(root, 'songs');
const DATA = process.env.STEMSTAGE_DATA || path.join(root, 'data');
const PORT = +(process.env.PORT || 5173);
// reported by /api/health so the desktop launcher can tell its own server from a leftover one
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return null; } })();
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

// The game page may only run the game's own scripts: no inline <script> or on…= handlers, no plugins. Anything a
// room, the world API or a song's metadata managed to slip into the page as HTML still couldn't run. Images,
// audio and connections stay open (covers and avatars from anywhere, rooms at any LAN address or tunnel, and the
// desktop app's ipc: bridge).
const GAME_CSP = [
  // 'unsafe-eval': the desktop app may answer its native calls by evaluating script in the page; injected <script>
  // tags and on…= attributes stay blocked either way
  "default-src 'self'", "script-src 'self' 'unsafe-eval'", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:", "media-src 'self' data: blob: http: https:", "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss: ipc:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

process.on('uncaughtException', (e) => console.error('[stemstage] uncaught error (server kept running):', e));
process.on('unhandledRejection', (e) => console.error('[stemstage] unhandled rejection (server kept running):', e));

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No built game at ${DIST}. Run "npm run build" first.`);
  process.exit(1);
}

const library = createLibrary(SONGS);
const services = [
  ['/api/library', library.handler],
  ['/api/yt', createYt()],
  ['/api/meta', createMeta()],
  ['/api/data', createData(DATA)],
  ['/api/online', createOnline(library)],
  ['/api/stream', createStream().handler],
  ['/api/discord', createDiscord()],
].map(([prefix, handler]) => [prefix, guarded(handler)]); // only the game page and local programs (server/guard.js)

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.statusCode = 400; return res.end(); }
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if (stat?.isDirectory()) { file = path.join(file, 'index.html'); stat = fs.statSync(file, { throwIfNoEntry: false }); }
  if (!stat) {
    // single-page app: unknown routes get the game, missing assets get a 404
    if (path.extname(rel)) { res.statusCode = 404; return res.end('Not found'); }
    file = path.join(DIST, 'index.html');
    stat = fs.statSync(file);
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file === path.join(DIST, 'index.html')) res.setHeader('Content-Security-Policy', GAME_CSP);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (url === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*'); // the desktop splash screen polls this
    // the folders only for the launcher and the game (they name the user's home folder)
    const detail = refusal(req) ? {} : { pid: process.pid, dist: DIST, songs: SONGS };
    return res.end(JSON.stringify({ ok: true, app: 'stemstage', version: VERSION, ...detail }));
  }
  for (const [prefix, handler] of services) {
    if (url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)) {
      req.originalUrl = url;
      req.url = url.slice(prefix.length) || '/'; // mounted like connect/Vite middleware
      try {
        await handler(req, res, () => { res.statusCode = 404; res.end(); });
      } catch (e) {
        console.error(`[stemstage] ${prefix} failed:`, e);
        if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e?.message || e) })); }
      }
      return;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
  serveStatic(req, res);
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (is STEMSTAGE already running?)` : e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`STEMSTAGE running at http://${HOST}:${PORT}`);
  console.log(`Songs: ${SONGS}`);
});
