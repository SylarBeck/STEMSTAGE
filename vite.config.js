import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLibrary } from './server/library.js';
import { createYt, createMeta, createData } from './server/extras.js';
import { createOnline } from './server/online.js';
import { createStream } from './server/stream.js';
import { createDiscord } from './server/discord.js';

// On some Windows setups (e.g. virtualised AppData folders) the project's real path differs
// from the path it was opened from; allow both so the module worker can be served in dev.
const root = fileURLToPath(new URL('.', import.meta.url));
let real = root;
try { real = realpathSync.native(root); } catch { /* keep root */ }

// Songs live on disk (WAV stems + song.json per song). Override with STEMSTAGE_SONGS=<folder>.
const songsDir = process.env.STEMSTAGE_SONGS || path.join(root, 'songs');
const dataDir = process.env.STEMSTAGE_DATA || path.join(root, 'data');

// Vite re-evaluates this file when it (or anything it imports) changes; keep one set of services per
// process so a hot restart never spawns a second room server on the same port.
function mount(server) {
  const services = globalThis.__stemstageServices ||= (() => {
    const library = createLibrary(songsDir);
    return { library, yt: createYt(), meta: createMeta(), data: createData(dataDir), online: createOnline(library), stream: createStream(), discord: createDiscord() };
  })();
  server.middlewares.use('/api/health', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*'); // polled by the desktop app's splash screen
    res.end(JSON.stringify({ ok: true, app: 'stemstage', dev: true }));
  });
  server.middlewares.use('/api/library', services.library.handler);
  server.middlewares.use('/api/yt', services.yt);
  server.middlewares.use('/api/meta', services.meta);
  server.middlewares.use('/api/data', services.data);
  server.middlewares.use('/api/online', services.online);
  server.middlewares.use('/api/stream', services.stream.handler);
  server.middlewares.use('/api/discord', services.discord);
}

if (!globalThis.__stemstageGuard) {
  globalThis.__stemstageGuard = true;
  // a bug in the game's local services (rooms, yt-dlp, metadata) must never take the game server down
  process.on('uncaughtException', (e) => console.error('[stemstage] uncaught error (server kept running):', e));
  process.on('unhandledRejection', (e) => console.error('[stemstage] unhandled rejection (server kept running):', e));
}

const stemstageServer = () => ({
  name: 'stemstage-local-services',
  configureServer: mount,
  configurePreviewServer: mount,
});

export default defineConfig({
  plugins: [stemstageServer()],
  server: { port: 5173, host: '127.0.0.1', fs: { allow: [root, real] }, watch: { ignored: ['**/songs/**', '**/data/**'] } },
  preview: { port: 4173, host: '127.0.0.1' },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
