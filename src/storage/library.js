// Song library. Primary store: a folder on disk (Documents\STEMSTAGE\songs by default) served by the
// game's local server at /api/library — one folder per song with WAV stems + song.json.
// Fallback (if the game is hosted without that API): IndexedDB in the browser.
// Songs found in the browser's IndexedDB are migrated to the folder automatically.
import { wavBytes } from '../export/exporters.js';

const API = '/api/library';
let mode = null;          // 'folder' | 'idb'
let folderRoot = null;
const cache = new Map();  // id -> { updated, song }

async function detect() {
  if (mode) return mode;
  try {
    const r = await fetch(`${API}/`, { signal: AbortSignal.timeout(2500) });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      folderRoot = (await r.json()).root;
      mode = 'folder';
    } else mode = 'idb';
  } catch { mode = 'idb'; }
  return mode;
}

export const storageMode = () => detect();

// ---------------------------------------------------------------- WAV <-> planar Int16
function decodeWav(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x52494646 || dv.getUint32(8, false) !== 0x57415645) throw new Error('not a WAV file');
  let o = 12, channels = 2, bits = 16, dataOff = -1, dataLen = 0;
  while (o + 8 <= dv.byteLength) {
    const id = dv.getUint32(o, false), size = dv.getUint32(o + 4, true);
    if (id === 0x666d7420) { channels = dv.getUint16(o + 10, true); bits = dv.getUint16(o + 22, true); }
    if (id === 0x64617461) { dataOff = o + 8; dataLen = Math.min(size, dv.byteLength - dataOff); break; }
    o += 8 + size + (size & 1);
  }
  if (dataOff < 0 || bits !== 16) throw new Error('unsupported WAV (need 16-bit PCM)');
  const frames = Math.floor(dataLen / (2 * channels));
  const src = new Int16Array(buf, dataOff, frames * channels);
  const out = new Int16Array(frames * 2);
  if (channels === 1) { out.set(src, 0); out.set(src, frames); }
  else for (let i = 0; i < frames; i++) { out[i] = src[i * channels]; out[frames + i] = src[i * channels + 1]; }
  return out;
}

const folderHint = (song) => `${song.artist || 'Unknown Artist'} - ${song.title || 'Song'}`;

// ---------------------------------------------------------------- public API
export async function listSongs() {
  if ((await detect()) === 'idb') return idb.listSongs();
  const r = await fetch(`${API}/`);
  const { songs } = await r.json();
  const out = [];
  await Promise.all(songs.map(async (s) => {
    let c = cache.get(s.id);
    if (!c || c.updated !== s.updated) {
      try {
        const song = await (await fetch(`${API}/${encodeURIComponent(s.id)}/song.json`)).json();
        c = { updated: s.updated, song };
        cache.set(s.id, c);
      } catch { return; }
    }
    out.push(c.song);
  }));
  const live = new Set(songs.map((s) => s.id));
  for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getSong(id) {
  if ((await detect()) === 'idb') return idb.getSong(id);
  const c = cache.get(id);
  if (c) return c.song;
  const r = await fetch(`${API}/${encodeURIComponent(id)}/song.json`);
  if (!r.ok) return null;
  return r.json();
}

/** Returns { stems: {name: Int16Array planar [L..., R...]} } */
export async function getAudio(id) {
  if ((await detect()) === 'idb') return idb.getAudio(id);
  const song = await getSong(id);
  if (!song) return null;
  const stems = {};
  await Promise.all((song.stemNames || []).map(async (name) => {
    const r = await fetch(`${API}/${encodeURIComponent(id)}/stems/${name}.wav`);
    if (r.ok) stems[name] = decodeWav(await r.arrayBuffer());
  }));
  return Object.keys(stems).length ? { stems } : null;
}

export async function saveSong(song, stems, onProgress) {
  if ((await detect()) === 'idb') return idb.saveSong(song, stems);
  const q = `?name=${encodeURIComponent(folderHint(song))}`;
  const names = Object.keys(stems);
  let k = 0;
  // stems first (one at a time to keep memory flat), song.json last so the song only appears when complete
  for (const name of names) {
    const body = wavBytes(stems[name], song.length, song.sampleRate || 44100);
    const r = await fetch(`${API}/${encodeURIComponent(song.id)}/stems/${name}.wav${q}`, { method: 'PUT', body });
    if (!r.ok) throw new Error(`Saving ${name}.wav failed (${r.status})`);
    onProgress?.(++k / (names.length + 1));
  }
  const full = { ...song, stemNames: names };
  const r = await fetch(`${API}/${encodeURIComponent(song.id)}/song.json${q}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(full),
  });
  if (!r.ok) throw new Error(`Saving song.json failed (${r.status})`);
  cache.delete(song.id);
  onProgress?.(1);
}

export async function deleteSong(id) {
  if ((await detect()) === 'idb') return idb.deleteSong(id);
  await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  cache.delete(id);
}

export async function storageEstimate() {
  if ((await detect()) === 'folder') {
    try {
      const info = await (await fetch(`${API}/info`)).json();
      return { mode: 'folder', root: info.root, count: info.count, usage: info.bytes };
    } catch { /* fall through */ }
  }
  try {
    const e = await navigator.storage.estimate();
    return { mode: 'idb', usage: e.usage, quota: e.quota };
  } catch { return null; }
}

export async function openSongsFolder() {
  if ((await detect()) !== 'folder') return false;
  const r = await fetch(`${API}/open`, { method: 'POST' });
  return r.ok;
}

export const songsFolder = () => folderRoot;

// ---------------------------------------------------------------- extra song files (cover art, preview) + metadata edits
const songPath = (id) => `${API}/${encodeURIComponent(id)}`;
export const coverUrl = (song) => (song?.cover && mode === 'folder' ? `${songPath(song.id)}/files/${song.cover}?v=${song.coverRev || 0}` : null);
export const previewUrl = (song) => (song?.preview && mode === 'folder' ? `${songPath(song.id)}/files/preview.wav` : null);

/** Rewrite song.json (e.g. after editing metadata). */
export async function saveSongJson(song) {
  if ((await detect()) === 'idb') return idb.putSong(song);
  const q = `?name=${encodeURIComponent(folderHint(song))}`;
  const r = await fetch(`${songPath(song.id)}/song.json${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(song) });
  if (!r.ok) throw new Error(`Saving song.json failed (${r.status})`);
  cache.delete(song.id);
}

export async function saveSongFile(song, name, body) {
  if ((await detect()) !== 'folder') return false;
  const r = await fetch(`${songPath(song.id)}/files/${name}?name=${encodeURIComponent(folderHint(song))}`, { method: 'PUT', body });
  return r.ok;
}

/** Download album art from a URL into the song folder. Returns the stored file name or null. */
export async function coverFromUrl(song, url) {
  if ((await detect()) !== 'folder' || !url) return null;
  const r = await fetch(`${songPath(song.id)}/cover-from-url?name=${encodeURIComponent(folderHint(song))}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  if (!r.ok) return null;
  return (await r.json()).file;
}

/** Copy a song from another STEMSTAGE (online host) into this library, streaming the WAVs as-is. */
/** Decode an Ogg (Opus/Vorbis) stem back to planar 16-bit PCM of exactly `length` frames. */
async function decodeCompressed(buf, length, rate) {
  const ctx = new OfflineAudioContext(2, Math.max(1, length), rate);
  const audio = await ctx.decodeAudioData(buf);
  const L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
  const out = new Int16Array(length * 2);
  const n = Math.min(length, audio.length);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    out[length + i] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  return out;
}

export async function copySongFrom(baseUrl, id, onProgress) {
  if ((await detect()) !== 'folder') throw new Error('Online play needs the songs folder (start the game with play.bat)');
  const src = `${baseUrl.replace(/\/$/, '')}/songs/${encodeURIComponent(id)}`;
  const song = await (await fetch(`${src}/song.json`)).json();
  const q = `?name=${encodeURIComponent(folderHint(song))}`;
  const names = song.stemNames || [];
  const extras = [song.cover, song.preview ? 'preview.wav' : null].filter(Boolean);
  const total = names.length + extras.length + 1;
  const rate = song.sampleRate || 44100;
  let k = 0;
  for (const name of names) {
    // compressed (Opus/Vorbis, ~10x smaller) when the host can make it, the WAV otherwise
    let body = null;
    try {
      const r = await fetch(`${src}/net/${name}`);
      if (r.ok) body = wavBytes(await decodeCompressed(await r.arrayBuffer(), song.length, rate), song.length, rate);
    } catch (e) { console.warn(`compressed ${name} failed, using WAV`, e); }
    if (!body) body = await (await fetch(`${src}/stems/${name}.wav`)).arrayBuffer();
    const r = await fetch(`${songPath(id)}/stems/${name}.wav${q}`, { method: 'PUT', body });
    if (!r.ok) throw new Error(`Copying ${name}.wav failed`);
    onProgress?.(++k / total);
  }
  for (const f of extras) {
    try {
      const r = await fetch(`${src}/files/${f}`);
      if (r.ok) await fetch(`${songPath(id)}/files/${f}${q}`, { method: 'PUT', body: await r.arrayBuffer() });
    } catch { /* optional */ }
    onProgress?.(++k / total);
  }
  await saveSongJson(song);
  onProgress?.(1);
  return song;
}

// ---------------------------------------------------------------- profiles + play history (data folder)
const DATA = '/api/data';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; } };

export async function loadProfiles() {
  if ((await detect()) !== 'folder') return lsGet('stemstage.profiles', []);
  try { return await (await fetch(`${DATA}/profiles`)).json(); } catch { return []; }
}

export async function saveProfiles(list) {
  if ((await detect()) !== 'folder') { localStorage.setItem('stemstage.profiles', JSON.stringify(list)); return; }
  await fetch(`${DATA}/profiles`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list) });
}

/** Named JSON documents in the data folder (localStorage without it): 'setlists'. */
export async function loadDoc(name, fallback = []) {
  if ((await detect()) !== 'folder') return lsGet(`stemstage.${name}`, fallback);
  try { return await (await fetch(`${DATA}/${name}`)).json(); } catch { return fallback; }
}

export async function saveDoc(name, value) {
  if ((await detect()) !== 'folder') { localStorage.setItem(`stemstage.${name}`, JSON.stringify(value)); return; }
  await fetch(`${DATA}/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

export async function loadPlays() {
  if ((await detect()) !== 'folder') return lsGet('stemstage.plays', []);
  try { return await (await fetch(`${DATA}/plays`)).json(); } catch { return []; }
}

export async function addPlays(entries) {
  if (!entries.length) return;
  if ((await detect()) !== 'folder') { localStorage.setItem('stemstage.plays', JSON.stringify([...lsGet('stemstage.plays', []), ...entries])); return; }
  await fetch(`${DATA}/plays`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entries) });
}

/**
 * Move songs saved in this browser's IndexedDB (earlier versions) into the songs folder.
 * Returns the number of songs moved. The browser copy is deleted once everything is safely on disk.
 */
export async function migrateFromBrowser(onProgress) {
  if ((await detect()) !== 'folder') return 0;
  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === idb.DB_NAME)) return 0;
  }
  const old = await idb.listSongs();
  if (!old.length) { await idb.dropDatabase(); return 0; }
  const { songs: onDisk } = await (await fetch(`${API}/`)).json();
  const have = new Set(onDisk.map((s) => s.id));
  let moved = 0;
  for (const s of old) {
    if (have.has(s.id)) continue;
    const audio = await idb.getAudio(s.id);
    if (!audio) continue;
    onProgress?.(s, moved, old.length);
    await saveSong(s, audio.stems);
    moved++;
  }
  // scores from localStorage are merged by initScores(); drop the browser copy of the songs
  await idb.dropDatabase();
  return moved;
}

// ---------------------------------------------------------------- high scores (songs folder, cached in memory)
const SKEY = 'stemstage.scores.v1';
let scores = {};

export async function initScores() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { /* none */ }
  if ((await detect()) !== 'folder') { scores = local; return; }
  try { scores = await (await fetch(`${API}/scores`)).json(); } catch { scores = {}; }
  // merge scores that only exist in this browser
  let merged = false;
  for (const [song, insts] of Object.entries(local)) {
    for (const [inst, diffs] of Object.entries(insts)) {
      for (const [diff, entry] of Object.entries(diffs)) {
        const cur = scores?.[song]?.[inst]?.[diff];
        if (!cur || cur.score < entry.score) {
          scores[song] = scores[song] || {};
          scores[song][inst] = scores[song][inst] || {};
          scores[song][inst][diff] = entry;
          merged = true;
        }
      }
    }
  }
  if (merged) persistScores();
  try { localStorage.removeItem(SKEY); } catch { /* ignore */ }
}

function persistScores() {
  if (mode === 'folder') {
    fetch(`${API}/scores`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scores) }).catch(() => {});
  } else {
    try { localStorage.setItem(SKEY, JSON.stringify(scores)); } catch { /* ignore */ }
  }
}

export function getBest(songId, inst, diff) {
  return scores?.[songId]?.[inst]?.[diff] || null;
}

export function saveBest(songId, inst, diff, entry) {
  const prev = scores?.[songId]?.[inst]?.[diff];
  if (prev && prev.score >= entry.score) return false;
  scores[songId] = scores[songId] || {};
  scores[songId][inst] = scores[songId][inst] || {};
  scores[songId][inst][diff] = entry;
  persistScores();
  return true;
}

// ---------------------------------------------------------------- IndexedDB (fallback + migration source)
const idb = (() => {
  const DB_NAME = 'stemstage';
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' }); // v1: one record per song
          if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks'); // v2: "<id>|<stem>|<part>" -> ArrayBuffer
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  };
  const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const tx = (store, txMode, fn) => open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, txMode);
    let result;
    const stores = Array.isArray(store) ? store.map((s) => t.objectStore(s)) : [t.objectStore(store)];
    Promise.resolve(fn(...stores)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  }));
  return {
    DB_NAME,
    async listSongs() {
      const all = await tx('songs', 'readonly', (s) => reqP(s.getAll()));
      return (all || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    getSong: (id) => tx('songs', 'readonly', (s) => reqP(s.get(id))),
    putSong: (song) => tx('songs', 'readwrite', (s) => { s.put(song); }),
    async getAudio(id) {
      const rec = await tx('audio', 'readonly', (s) => reqP(s.get(id)));
      if (rec) { // v1 layout
        const stems = {};
        for (const [k, buf] of Object.entries(rec.stems)) stems[k] = new Int16Array(buf);
        return { stems };
      }
      // v2 layout: stems split into chunks (a single IndexedDB value is capped at ~133 MB)
      const range = IDBKeyRange.bound(`${id}|`, `${id}|￿`);
      const [keys, vals] = await tx('chunks', 'readonly', (c) => Promise.all([reqP(c.getAllKeys(range)), reqP(c.getAll(range))]));
      if (!keys.length) return null;
      const parts = {};
      keys.forEach((k, i) => {
        const [, stem, part] = k.split('|');
        (parts[stem] = parts[stem] || [])[+part] = vals[i];
      });
      const stems = {};
      for (const [stem, list] of Object.entries(parts)) {
        const total = list.reduce((s, b) => s + b.byteLength, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const b of list) { out.set(new Uint8Array(b), o); o += b.byteLength; }
        stems[stem] = new Int16Array(out.buffer);
      }
      return { stems };
    },
    async saveSong(song, stems) {
      const CHUNK = 32 * 1024 * 1024;
      await tx(['songs', 'chunks'], 'readwrite', (s, c) => {
        s.put(song);
        for (const [stem, arr] of Object.entries(stems)) {
          const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          for (let o = 0, part = 0; o < bytes.length; o += CHUNK, part++) c.put(bytes.slice(o, o + CHUNK).buffer, `${song.id}|${stem}|${part}`);
        }
      });
    },
    deleteSong: (id) => tx(['songs', 'audio', 'chunks'], 'readwrite', (s, a, c) => {
      s.delete(id); a.delete(id); c.delete(IDBKeyRange.bound(`${id}|`, `${id}|￿`));
    }),
    async dropDatabase() {
      try { (await dbPromise)?.close(); } catch { /* ignore */ }
      dbPromise = null;
      await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    },
  };
})();
