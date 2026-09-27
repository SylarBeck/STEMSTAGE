// Local-only server features mounted into Vite:
//   /api/yt    — YouTube search + audio download through yt-dlp
//   /api/meta  — song metadata lookup (MusicBrainz, Cover Art Archive, iTunes Search)
//   /api/data  — profiles + play history (JSON files in <project>/data)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { send, sendFile, isLocal, readJsonBody, renameRetry } from './library.js';

const UA = 'STEMSTAGE/1.0 (local rhythm game; https://github.com/)';

// ---------------------------------------------------------------- yt-dlp
function findYtDlp() {
  const candidates = [
    process.env.STEMSTAGE_YTDLP,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'stemstage', 'venv', 'Scripts', 'yt-dlp.exe'),
    process.env.HOME && path.join(process.env.HOME, '.local', 'share', 'stemstage', 'venv', 'bin', 'yt-dlp'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'yt-dlp';
}

function run(bin, args, { onLine, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    let out = '', err = '', buf = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('yt-dlp timed out')); }, timeout);
    p.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      if (onLine) { buf += s; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); }
    });
    p.stderr.on('data', (d) => { const s = d.toString(); err += s; if (onLine) s.split(/\r?\n/).forEach(onLine); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error((err.trim().split('\n').pop() || `yt-dlp exited with ${code}`).replace(/^ERROR:\s*/, ''))); });
  });
}

const bestThumb = (e) => {
  const list = (e.thumbnails || []).filter((t) => t.url);
  list.sort((a, b) => (b.width || 0) - (a.width || 0));
  return list[0]?.url || (e.id ? `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` : null);
};

export function createYt() {
  const bin = findYtDlp();
  const tmpRoot = path.join(os.tmpdir(), 'stemstage-yt');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const jobs = new Map();
  let version = null;

  async function status() {
    if (version) return { available: true, version, bin };
    try { version = (await run(bin, ['--version'], { timeout: 15000 })).trim(); return { available: true, version, bin }; }
    catch (e) { return { available: false, error: String(e.message || e) }; }
  }

  async function search(q, n) {
    const isUrl = /^https?:\/\//i.test(q);
    const target = isUrl ? q : `ytsearch${Math.min(25, Math.max(1, n))}:${q}`;
    const json = JSON.parse(await run(bin, [target, '--flat-playlist', '-J', '--no-warnings'], { timeout: 45000 }));
    const entries = json.entries || [json];
    const results = entries.filter((e) => e && e.id).map((e) => ({
      id: e.id,
      title: e.title,
      channel: e.channel || e.uploader || '',
      duration: e.duration || 0,
      url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
      thumbnail: bestThumb(e),
      views: e.view_count || null,
    }));
    // a playlist URL: every entry plus the playlist's name (batch import)
    results.playlist = json._type === 'playlist' ? (json.title || 'Playlist') : null;
    return results;
  }

  function download(url) {
    const id = Math.random().toString(36).slice(2, 10);
    const dir = path.join(tmpRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    const job = { id, status: 'running', progress: 0, message: 'Starting yt-dlp', dir, file: null, info: null, created: Date.now() };
    jobs.set(id, job);
    const args = [
      '-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--newline', '--no-warnings',
      '--js-runtimes', 'node', '--write-info-json', '--restrict-filenames',
      '-o', path.join(dir, 'audio.%(ext)s'),
      '--print', 'after_move:FILE %(filepath)s',
      url,
    ];
    run(bin, args, {
      timeout: 15 * 60000,
      onLine: (line) => {
        const m = /\[download\]\s+([\d.]+)%/.exec(line);
        if (m) { job.progress = Math.min(0.99, parseFloat(m[1]) / 100); job.message = `Downloading ${m[1]}%`; }
        const f = /^FILE (.+)$/.exec(line.trim());
        if (f) job.file = f[1].trim();
      },
    }).then(async () => {
      if (!job.file || !fs.existsSync(job.file)) {
        const audio = (await fsp.readdir(dir)).find((n) => n.startsWith('audio.') && !n.endsWith('.json'));
        if (audio) job.file = path.join(dir, audio);
      }
      const infoFile = (await fsp.readdir(dir)).find((n) => n.endsWith('.info.json'));
      if (infoFile) {
        const i = JSON.parse(await fsp.readFile(path.join(dir, infoFile), 'utf8'));
        job.info = {
          id: i.id, title: i.title, track: i.track || null, artist: i.artist || i.creator || null, album: i.album || null,
          releaseYear: i.release_year || null, uploader: i.uploader || i.channel || null, duration: i.duration || null,
          thumbnail: bestThumb(i), url: i.webpage_url, tags: (i.tags || []).slice(0, 12), genre: i.genre || null,
        };
      }
      if (!job.file) throw new Error('download finished but no audio file was produced');
      job.status = 'done'; job.progress = 1; job.message = 'Downloaded';
    }).catch((e) => { job.status = 'error'; job.message = String(e.message || e); });
    return job;
  }

  setInterval(() => {
    const now = Date.now();
    for (const [id, j] of jobs) if (now - j.created > 60 * 60000) { fs.rm(j.dir, { recursive: true, force: true }, () => {}); jobs.delete(id); }
  }, 5 * 60000).unref();

  return async function handler(req, res) {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, 'http://local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'status') return send(res, 200, await status());
      if (parts[0] === 'search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return send(res, 400, { error: 'empty query' });
        { const results = await search(q, +(url.searchParams.get('n') || 12)); return send(res, 200, { results, playlist: results.playlist }); }
      }
      if (parts[0] === 'download' && req.method === 'POST') {
        const { url: target } = await readJsonBody(req);
        if (!/^https?:\/\//i.test(target || '')) return send(res, 400, { error: 'url required' });
        const job = download(target);
        return send(res, 200, { job: job.id });
      }
      if (parts[0] === 'jobs' && parts[1]) {
        const job = jobs.get(parts[1]);
        if (!job) return send(res, 404, { error: 'unknown job' });
        if (req.method === 'DELETE') { fs.rm(job.dir, { recursive: true, force: true }, () => {}); jobs.delete(job.id); return send(res, 200, { ok: true }); }
        if (parts[2] === 'file') {
          if (job.status !== 'done') return send(res, 409, { error: 'not ready' });
          const ext = path.extname(job.file).slice(1).toLowerCase();
          return sendFile(res, job.file, { m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', mp3: 'audio/mpeg' }[ext] || 'application/octet-stream');
        }
        return send(res, 200, { status: job.status, progress: job.progress, message: job.message, info: job.info, ext: job.file ? path.extname(job.file).slice(1) : null });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e?.message || e) });
    }
  };
}

// ---------------------------------------------------------------- metadata lookup
export function createMeta() {
  const cache = new Map();
  let mbChain = Promise.resolve();
  let lastMb = 0;
  // MusicBrainz asks for at most one request per second and a descriptive User-Agent
  const mbFetch = (url) => {
    const p = mbChain.then(async () => {
      const wait = Math.max(0, lastMb + 1100 - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      lastMb = Date.now();
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`MusicBrainz ${r.status}`);
      return r.json();
    });
    mbChain = p.catch(() => {});
    return p;
  };

  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = (s) => `"${String(s).replace(/["\\]/g, ' ').trim()}"`;

  async function musicbrainz(artist, title, duration) {
    const base = artist ? `recording:${q(title)} AND artist:${q(artist)}` : `recording:${q(title)}`;
    const search = (query) => mbFetch(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=15&query=${encodeURIComponent(query)}`);
    // official album releases first (popular songs have hundreds of bootleg/live recordings), then anything
    let data = await search(`${base} AND status:official AND primarytype:album`);
    if (!(data.recordings || []).length) data = await search(base);
    const out = [];
    const wantsVariant = /\b(live|demo|remix|acoustic|instrumental)\b/i.test(title);
    const isStudio = (rel) => rel.status === 'Official' && !(rel['release-group']?.['secondary-types'] || []).length;
    for (const r of data.recordings || []) {
      const credit = (r['artist-credit'] || []).map((c) => c.name + (c.joinphrase || '')).join('');
      const releases = (r.releases || []).slice().sort((a, b) => {
        const oa = isStudio(a) ? 0 : 1, ob = isStudio(b) ? 0 : 1;
        const pa = a['release-group']?.['primary-type'] === 'Album' ? 0 : 1, pb = b['release-group']?.['primary-type'] === 'Album' ? 0 : 1;
        return oa - ob || pa - pb || String(a.date || '9999').localeCompare(String(b.date || '9999'));
      });
      const rel = releases[0];
      let score = (r.score || 0) / 100;
      if (norm(r.title) === norm(title)) score += 0.3;
      if (artist && norm(credit).includes(norm(artist))) score += 0.3;
      if (duration && r.length) score -= Math.min(0.6, Math.abs(r.length / 1000 - duration) / 30);
      if (!r.length) score -= 0.15;
      // prefer the studio recording over bootlegs, live takes and demos
      if (!releases.some((x) => x.status === 'Official')) score -= 0.5;
      else if (!releases.some(isStudio)) score -= 0.3;
      if (!wantsVariant && /\b(live|demo|remix|rehearsal|session|instrumental)\b/i.test(`${r.disambiguation || ''} ${r.title}`)) score -= 0.35;
      score += Math.min(0.3, releases.length * 0.02);
      out.push({
        source: 'MusicBrainz', score, mbid: r.id, title: r.title, artist: credit, album: rel?.title || null,
        year: (rel?.date || r['first-release-date'] || '').slice(0, 4) || null, releaseId: rel?.id || null,
        releaseGroupId: rel?.['release-group']?.id || null, duration: r.length ? r.length / 1000 : null,
        tags: (r.tags || []).sort((a, b) => b.count - a.count).map((t) => t.name).slice(0, 5),
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  async function coverArt(m) {
    for (const url of [m.releaseId && `https://coverartarchive.org/release/${m.releaseId}/front-500`, m.releaseGroupId && `https://coverartarchive.org/release-group/${m.releaseGroupId}/front-500`]) {
      if (!url) continue;
      try {
        const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
        if (r.ok) return r.url || url;
      } catch { /* try next */ }
    }
    return null;
  }

  async function itunes(artist, title) {
    const term = [artist, title].filter(Boolean).join(' ');
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(term)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).map((x) => {
      let score = 0.5;
      if (norm(x.trackName) === norm(title)) score += 0.4;
      if (artist && norm(x.artistName).includes(norm(artist))) score += 0.4;
      return {
        source: 'iTunes', score, title: x.trackName, artist: x.artistName, album: x.collectionName || null,
        year: (x.releaseDate || '').slice(0, 4) || null, genre: x.primaryGenreName || null,
        cover: x.artworkUrl100 ? x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null,
        duration: x.trackTimeMillis ? x.trackTimeMillis / 1000 : null,
      };
    }).sort((a, b) => b.score - a.score);
  }

  async function lookup(artist, title, duration) {
    const key = `${norm(artist)}|${norm(title)}|${Math.round(duration || 0)}`;
    if (cache.has(key)) return cache.get(key);
    const errors = {};
    const [mb, it] = await Promise.all([
      musicbrainz(artist, title, duration).catch((e) => { errors.musicbrainz = String(e.message || e); return []; }),
      itunes(artist, title).catch((e) => { errors.itunes = String(e.message || e); return []; }),
    ]);
    const bestMb = mb[0] && mb[0].score >= 1.2 ? mb[0] : null;
    const bestIt = it[0] && it[0].score >= 0.9 ? it[0] : null;
    let best = null;
    if (bestMb || bestIt) {
      // MusicBrainz for identity (title/artist/ids), iTunes for the commercial album, year, genre and artwork
      best = { ...(bestMb || {}), ...(bestIt ? { album: bestIt.album, year: bestIt.year } : {}) };
      if (!best.title) Object.assign(best, bestIt);
      best.genre = bestIt?.genre || bestMb?.tags?.[0] || null;
      best.cover = bestIt?.cover || (bestMb && await coverArt(bestMb)) || null;
      best.sources = [bestMb && 'MusicBrainz', bestIt && 'iTunes'].filter(Boolean);
    }
    const result = { best, candidates: [...mb.slice(0, 5), ...it.slice(0, 5)], errors };
    if (!Object.keys(errors).length) cache.set(key, result);
    return result;
  }

  // ---------------------------------------------------------------- lyrics (LRCLIB: free, no key, time-synced)
  const lyricsCache = new Map();
  const lrclib = async (pathAndQuery) => {
    const r = await fetch(`https://lrclib.net/api/${pathAndQuery}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`LRCLIB ${r.status}`);
    return r.json();
  };
  const pickLyrics = (x) => x && ({
    source: 'LRCLIB', id: x.id, title: x.trackName, artist: x.artistName, album: x.albumName || null, duration: x.duration || null,
    instrumental: !!x.instrumental, synced: x.syncedLyrics || null, plain: x.plainLyrics || null,
  });

  /** The best lyrics for a song: exact match (artist + title + duration) first, then a search ranked like lookup(). */
  async function lyrics(artist, title, album, duration) {
    const key = `${norm(artist)}|${norm(title)}|${Math.round(duration || 0)}`;
    if (lyricsCache.has(key)) return lyricsCache.get(key);
    let best = null;
    if (artist && duration) {
      const qs = new URLSearchParams({ artist_name: artist, track_name: title, duration: String(Math.round(duration)) });
      if (album) qs.set('album_name', album);
      best = pickLyrics(await lrclib(`get?${qs}`).catch(() => null));
    }
    if (!best || (!best.synced && !best.plain && !best.instrumental)) {
      const qs = new URLSearchParams({ track_name: title });
      if (artist) qs.set('artist_name', artist);
      let list = (await lrclib(`search?${qs}`)) || [];
      if (!list.length && artist) list = (await lrclib(`search?${new URLSearchParams({ q: `${artist} ${title}` })}`)) || [];
      const scored = list.filter((x) => x.syncedLyrics || x.plainLyrics).map((x) => {
        let score = 0;
        if (norm(x.trackName) === norm(title)) score += 1; else if (norm(x.trackName).includes(norm(title))) score += 0.5;
        if (artist && norm(x.artistName) === norm(artist)) score += 1; else if (artist && norm(x.artistName).includes(norm(artist))) score += 0.6;
        if (duration && x.duration) score -= Math.min(1.5, Math.abs(x.duration - duration) / 8);
        if (x.syncedLyrics) score += 0.4; // timing makes the cross-check much more reliable
        return { x, score };
      }).sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score >= 0.8) best = pickLyrics(scored[0].x);
    }
    const result = { best: best && (best.synced || best.plain || best.instrumental) ? best : null };
    lyricsCache.set(key, result);
    return result;
  }

  return async function handler(req, res) {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, 'http://local');
      if (url.pathname.replace(/\/$/, '') === '/lyrics') {
        const title = (url.searchParams.get('title') || '').trim();
        if (!title) return send(res, 400, { error: 'title required' });
        const p = (k) => (url.searchParams.get(k) || '').trim();
        return send(res, 200, await lyrics(p('artist'), title, p('album'), +p('duration') || 0));
      }
      if (url.pathname.replace(/\/$/, '') === '/lookup') {
        const title = (url.searchParams.get('title') || '').trim();
        if (!title) return send(res, 400, { error: 'title required' });
        return send(res, 200, await lookup((url.searchParams.get('artist') || '').trim(), title, +url.searchParams.get('duration') || 0));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e?.message || e) });
    }
  };
}

// ---------------------------------------------------------------- data store (profiles + plays)
export function createData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (n) => path.join(dir, `${n}.json`);
  const read = async (n, fallback) => { try { return JSON.parse(await fsp.readFile(file(n), 'utf8')); } catch { return fallback; } };
  const write = async (n, value) => { const f = file(n); await fsp.writeFile(`${f}.part`, JSON.stringify(value)); await renameRetry(`${f}.part`, f); };
  let playsLock = Promise.resolve();

  return async function handler(req, res) {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, 'http://local');
      const name = url.pathname.split('/').filter(Boolean)[0];
      if (name === 'profiles' || name === 'setlists') {
        if (req.method === 'GET') return send(res, 200, await read(name, []));
        if (req.method === 'PUT') { await write(name, await readJsonBody(req, 5e6)); return send(res, 200, { ok: true }); }
      }
      if (name === 'replays') {
        // data/replays/<id>.json + index.json (metadata without the event streams)
        const rdir = path.join(dir, 'replays');
        const id = url.pathname.split('/').filter(Boolean)[1];
        const readIndex = async () => { try { return JSON.parse(await fsp.readFile(path.join(rdir, 'index.json'), 'utf8')); } catch { return []; } };
        const writeIndex = async (list) => { const f = path.join(rdir, 'index.json'); await fsp.writeFile(`${f}.part`, JSON.stringify(list)); await renameRetry(`${f}.part`, f); };
        if (!id) return req.method === 'GET' ? send(res, 200, await readIndex()) : send(res, 405, { error: 'method' });
        if (!/^[a-z0-9]{4,40}$/i.test(id)) return send(res, 400, { error: 'bad id' });
        const f = path.join(rdir, `${id}.json`);
        if (req.method === 'GET') return sendFile(res, f, 'application/json');
        if (req.method === 'PUT') {
          const body = await readJsonBody(req, 8e6);
          await fsp.mkdir(rdir, { recursive: true });
          await fsp.writeFile(`${f}.part`, JSON.stringify(body));
          await renameRetry(`${f}.part`, f);
          const { events, timeline, ...m } = body;
          playsLock = playsLock.then(async () => { const list = (await readIndex()).filter((x) => x.id !== id); list.push({ ...m, id }); await writeIndex(list); });
          await playsLock;
          return send(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          await fsp.rm(f, { force: true });
          playsLock = playsLock.then(async () => writeIndex((await readIndex()).filter((x) => x.id !== id)));
          await playsLock;
          return send(res, 200, { ok: true });
        }
      }
      if (name === 'plays') {
        if (req.method === 'GET') return send(res, 200, await read('plays', []));
        if (req.method === 'POST') {
          const entries = await readJsonBody(req, 2e6);
          const list = Array.isArray(entries) ? entries : [entries];
          playsLock = playsLock.then(async () => { const all = await read('plays', []); all.push(...list); await write('plays', all); });
          await playsLock;
          return send(res, 200, { ok: true });
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e?.message || e) });
    }
  };
}
