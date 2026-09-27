// Song library on disk, served to the game over a tiny local HTTP API (mounted in Vite).
//
//   <root>/<Artist> - <Title> [<id>]/song.json      metadata + charts
//   <root>/<Artist> - <Title> [<id>]/<stem>.wav     16-bit stereo stems (drums, bass, guitar, keys, vocals, other)
//   <root>/<Artist> - <Title> [<id>]/cover.jpg      album art (optional)
//   <root>/<Artist> - <Title> [<id>]/preview.wav    short mono preview for the setlist (optional)
//   <root>/scores.json                              legacy high scores
//
// API (mounted at /api/library, local machine only):
//   GET    /                        { root, songs: [{ id, updated, folder }] }
//   GET    /info                    { root, count, bytes }
//   POST   /open                    open the folder in the OS file manager
//   GET    /<id>/song.json          PUT /<id>/song.json?name=<folder hint>
//   GET    /<id>/stems/<stem>.wav   PUT /<id>/stems/<stem>.wav?name=<folder hint>
//   GET    /<id>/files/<file>       PUT /<id>/files/<file>   (cover.jpg|cover.png|cover.webp|preview.wav)
//   (room server only) GET /songs/<id>/net/<stem>   compressed stem for online play
//   POST   /<id>/cover-from-url     { url } -> downloads album art into the song folder
//   DELETE /<id>
//   GET    /scores                  PUT /scores
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { compressedStem, precompress } from './transcode.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_STEM = /^[a-z0-9_-]{1,32}$/;
const FOLDER_ID = /\[([A-Za-z0-9_-]{1,80})\]$/;
const EXTRA_FILES = { 'cover.jpg': 'image/jpeg', 'cover.png': 'image/png', 'cover.webp': 'image/webp', 'preview.wav': 'audio/wav' };

const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Song';

export const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

export function send(res, code, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.statusCode = code;
  res.setHeader('Content-Type', type === 'application/json' ? 'application/json; charset=utf-8' : type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(data);
}

export async function sendFile(res, file, type) {
  let st;
  try { st = await fsp.stat(file); } catch { return send(res, 404, { error: 'not found' }); }
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', st.size);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/** rename() that rides out Windows' brief locks (a reader or antivirus holding the target open). */
export async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); } catch (e) {
      if (i >= 12 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 40 + i * 40));
    }
  }
}

export function receive(req, file, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const tmp = `${file}.part`;
    const ws = fs.createWriteStream(tmp);
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(); ws.destroy(); reject(new Error('too large')); } });
    req.pipe(ws);
    ws.on('finish', () => renameRetry(tmp, file).then(resolve, reject));
    ws.on('error', reject);
    req.on('error', reject);
  });
}

export async function readJsonBody(req, max = 2e6) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error('body too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createLibrary(root) {
  fs.mkdirSync(root, { recursive: true });
  const folderCache = new Map(); // folder -> { id, mtime }

  async function scan() {
    const out = [];
    const ents = await fsp.readdir(root, { withFileTypes: true });
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const file = path.join(root, ent.name, 'song.json');
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      let c = folderCache.get(ent.name);
      if (!c || c.mtime !== st.mtimeMs) {
        let id = FOLDER_ID.exec(ent.name)?.[1];
        if (!id) { try { id = JSON.parse(await fsp.readFile(file, 'utf8')).id; } catch { continue; } }
        if (!id || !SAFE_ID.test(id)) continue;
        c = { id, mtime: st.mtimeMs };
        folderCache.set(ent.name, c);
      }
      out.push({ id: c.id, updated: Math.round(c.mtime), folder: ent.name });
    }
    return out;
  }

  async function folderFor(id, hint, create) {
    const hit = (await scan()).find((s) => s.id === id);
    if (hit) return path.join(root, hit.folder);
    for (const ent of await fsp.readdir(root, { withFileTypes: true })) {
      if (ent.isDirectory() && FOLDER_ID.exec(ent.name)?.[1] === id) return path.join(root, ent.name);
    }
    if (!create) return null;
    const dir = path.join(root, `${cleanName(hint)} [${id}]`);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  async function dirSize(dir) {
    let total = 0;
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) total += await dirSize(p);
      else { try { total += (await fsp.stat(p)).size; } catch { /* vanished */ } }
    }
    return total;
  }

  /** GET-only routes, shared with LAN guests (online play): song.json, stems, extra files. */
  async function serveRead(res, id, kind, name) {
    if (!SAFE_ID.test(id)) return send(res, 400, { error: 'bad id' });
    const dir = await folderFor(id, '', false);
    if (!dir) return send(res, 404, { error: 'not found' });
    if (kind === 'song.json') return sendFile(res, path.join(dir, 'song.json'), 'application/json');
    if (kind === 'stems') {
      const stem = String(name || '').replace(/\.wav$/, '');
      if (!SAFE_STEM.test(stem)) return send(res, 400, { error: 'bad stem' });
      return sendFile(res, path.join(dir, `${stem}.wav`), 'audio/wav');
    }
    if (kind === 'net') {
      // compressed stem for online play (Opus/Vorbis in Ogg); 404 means "use the WAV"
      const stem = String(name || '').replace(/.(ogg|wav)$/, '');
      if (!SAFE_STEM.test(stem)) return send(res, 400, { error: 'bad stem' });
      const wav = path.join(dir, `${stem}.wav`);
      if (!fs.existsSync(wav)) return send(res, 404, { error: 'not found' });
      const ogg = await compressedStem(wav);
      return ogg ? sendFile(res, ogg, 'audio/ogg') : send(res, 404, { error: 'no encoder' });
    }
    if (kind === 'files' && EXTRA_FILES[name]) return sendFile(res, path.join(dir, name), EXTRA_FILES[name]);
    return send(res, 404, { error: 'not found' });
  }

  async function handler(req, res) {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, 'http://local');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const m = req.method;
      const hint = url.searchParams.get('name') || 'Song';

      if (parts.length === 0 && m === 'GET') return send(res, 200, { root, songs: await scan() });
      if (parts[0] === 'info' && m === 'GET') {
        const songs = await scan();
        return send(res, 200, { root, count: songs.length, bytes: await dirSize(root) });
      }
      if (parts[0] === 'open' && m === 'POST') {
        const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(cmd, [root], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { ok: true });
      }
      if (parts[0] === 'scores') {
        const file = path.join(root, 'scores.json');
        if (m === 'GET') { try { return send(res, 200, await fsp.readFile(file, 'utf8')); } catch { return send(res, 200, {}); } }
        if (m === 'PUT') { await receive(req, file); return send(res, 200, { ok: true }); }
      }

      const id = parts[0];
      if (!id || !SAFE_ID.test(id)) return send(res, 400, { error: 'bad id' });

      if (parts.length === 1 && m === 'DELETE') {
        const dir = await folderFor(id, hint, false);
        if (dir) await fsp.rm(dir, { recursive: true, force: true });
        for (const [k, v] of folderCache) if (v.id === id) folderCache.delete(k);
        return send(res, 200, { ok: true });
      }
      if (m === 'GET') return serveRead(res, id, parts[1], parts[2]);
      if (m === 'PUT' && parts[1] === 'song.json') {
        const dir = await folderFor(id, hint, true);
        await receive(req, path.join(dir, 'song.json'));
        return send(res, 200, { ok: true });
      }
      if (m === 'PUT' && parts[1] === 'stems' && parts[2]) {
        const stem = parts[2].replace(/\.wav$/, '');
        if (!SAFE_STEM.test(stem)) return send(res, 400, { error: 'bad stem' });
        const dir = await folderFor(id, hint, true);
        await receive(req, path.join(dir, `${stem}.wav`));
        return send(res, 200, { ok: true });
      }
      if (m === 'PUT' && parts[1] === 'files' && EXTRA_FILES[parts[2]]) {
        const dir = await folderFor(id, hint, true);
        await receive(req, path.join(dir, parts[2]), 64e6);
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && parts[1] === 'cover-from-url') {
        const { url: imgUrl } = await readJsonBody(req);
        if (!/^https:\/\//i.test(imgUrl || '')) return send(res, 400, { error: 'https url required' });
        const r = await fetch(imgUrl, { headers: { 'User-Agent': 'STEMSTAGE/1.0 (local rhythm game)' }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) return send(res, 502, { error: `image fetch failed (${r.status})` });
        const type = r.headers.get('content-type') || '';
        const name = type.includes('png') ? 'cover.png' : type.includes('webp') ? 'cover.webp' : 'cover.jpg';
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 16e6) return send(res, 413, { error: 'image too large' });
        const dir = await folderFor(id, hint, true);
        for (const f of ['cover.jpg', 'cover.png', 'cover.webp']) if (f !== name) await fsp.rm(path.join(dir, f), { force: true });
        await fsp.writeFile(path.join(dir, name), buf);
        return send(res, 200, { ok: true, file: name });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[library]', e);
      return send(res, 500, { error: String(e?.message || e) });
    }
  }

  /** Compress a song's stems ahead of time (the host picked it for an online match). */
  async function prepareForNet(id) {
    if (!SAFE_ID.test(id)) return;
    const dir = await folderFor(id, '', false);
    if (dir) await precompress(dir);
  }

  return { handler, serveRead, scan, root, prepareForNet };
}

export function libraryMiddleware(root) { return createLibrary(root).handler; }
