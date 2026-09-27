// Import pipeline: (download) -> decode -> metadata -> split (AI server or in-browser DSP)
// -> neural transcription -> auto-chart -> cover art + preview -> library.
import { settings } from '../settings.js';
import { STEM_RATE } from './engine.js';
import { renderDemo } from './demo.js';
import { saveSong, saveSongJson, saveSongFile, coverFromUrl, getAudio } from '../storage/library.js';
import { gatherMetadata } from './metadata.js';

// ---------------------------------------------------------------- worker bridge
let worker = null;
let jobSeq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, type } = e.data;
      const job = pending.get(id);
      if (!job) return;
      if (type === 'progress') job.onProgress?.(e.data.p, e.data.msg);
      else if (type === 'result') { pending.delete(id); job.resolve(e.data.result); }
      else if (type === 'error') { pending.delete(id); job.reject(new Error(e.data.error)); }
    };
    worker.onerror = (e) => {
      for (const job of pending.values()) job.reject(new Error(e.message || 'worker crashed'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

export function runJob(type, payload, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, type, payload }, transfer);
  });
}

// ---------------------------------------------------------------- AI server client
export class AIClient {
  constructor(url) { this.url = url.replace(/\/$/, ''); }

  async health() {
    try {
      const r = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async separate(L, R, sampleRate, onProgress) {
    const n = L.length;
    const body = new Float32Array(n * 2);
    body.set(L, 0); body.set(R, n);
    onProgress(0, 'Uploading audio to AI splitter');
    const res = await fetch(`${this.url}/separate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': String(sampleRate), 'X-Channels': '2' },
      body,
    });
    if (!res.ok) throw new Error(`AI splitter rejected the upload (${res.status})`);
    const { job } = await res.json();
    let info;
    for (;;) {
      await new Promise((r) => setTimeout(r, 350));
      const r = await fetch(`${this.url}/jobs/${job}`);
      info = await r.json();
      if (info.status === 'error') throw new Error(`AI splitter: ${info.message}`);
      onProgress(info.progress || 0, info.message || info.status);
      if (info.status === 'done') break;
    }
    const stems = {};
    for (const src of info.sources) {
      const r = await fetch(`${this.url}/jobs/${job}/stems/${src}`);
      if (!r.ok) throw new Error(`Failed to download stem ${src}`);
      stems[src] = new Int16Array(await r.arrayBuffer());
    }
    let notes = {};
    try { notes = (await (await fetch(`${this.url}/jobs/${job}/notes`)).json()).notes || {}; } catch { /* older server */ }
    fetch(`${this.url}/jobs/${job}`, { method: 'DELETE' }).catch(() => {});
    return { sources: info.sources, stems, notes, length: info.length };
  }

  /** Neural transcription of one mono 22.05 kHz stem. Returns note events or null. */
  async transcribe(stem, mono) {
    const r = await fetch(`${this.url}/transcribe?stem=${encodeURIComponent(stem)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': '22050' }, body: mono,
    });
    if (!r.ok) return null;
    return (await r.json()).notes || [];
  }
}

export const aiClient = () => new AIClient(settings.aiServer);

const pcmRms = (pcm) => {
  let s = 0;
  for (let i = 0; i < pcm.length; i += 8) { const v = pcm[i] / 32768; s += v * v; }
  return Math.sqrt(s / Math.max(1, pcm.length / 8));
};

const mixPcm = (a, b) => {
  const out = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(-32768, Math.min(32767, a[i] + b[i]));
  return out;
};

/**
 * Map model sources (and their note events) onto game stems. When the guitar or piano stem is nearly
 * empty but "other" carries the melodic content (synths, unusual timbres), "other" becomes that part.
 */
function mapAIStems(sources, raw, rawNotes = {}) {
  const out = {};
  const notes = {};
  const remarks = [];
  const has = (s) => sources.includes(s);
  out.drums = raw.drums;
  out.bass = raw.bass; notes.bass = rawNotes.bass;
  if (has('guitar')) { out.guitar = raw.guitar; notes.guitar = rawNotes.guitar; }
  if (has('piano')) { out.keys = raw.piano; notes.keys = rawNotes.piano; }
  if (has('vocals')) { out.vocals = raw.vocals; notes.vocals = rawNotes.vocals; }
  if (has('other')) { out.other = raw.other; notes.other = rawNotes.other; }
  if (out.other) {
    const o = pcmRms(out.other);
    const g = out.guitar ? pcmRms(out.guitar) : 0;
    const k = out.keys ? pcmRms(out.keys) : 0;
    const fold = (target, label) => {
      out[target] = out[target] ? mixPcm(out[target], out.other) : out.other;
      notes[target] = [...(notes[target] || []), ...(notes.other || [])].sort((a, b) => a[0] - b[0]);
      delete out.other; delete notes.other;
      remarks.push(`${label} part charted from the "other" stem (synths / unclassified melodic parts)`);
    };
    if (g < 0.2 * o && o > 0.004) fold('guitar', 'Guitar');
    else if (k < 0.2 * o && o > 0.004) fold('keys', 'Keys');
  }
  return { stems: out, notes, remarks };
}

// ---------------------------------------------------------------- helpers
export function toMono22k(pcm, n) {
  const m = new Float32Array(n >> 1);
  const k = 1 / (4 * 32768);
  for (let i = 0; i < m.length; i++) {
    const j = i * 2;
    m[i] = (pcm[j] + pcm[j + 1] + pcm[n + j] + pcm[n + j + 1]) * k;
  }
  return m;
}

// short ids: they end up in the song's folder name
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function chart(stems, n, duration, onProgress, aiNotes) {
  const mono = {};
  const silent = new Float32Array(n >> 1);
  for (const inst of ['drums', 'bass', 'guitar', 'keys']) mono[inst] = stems[inst] ? toMono22k(stems[inst], n) : silent.slice();
  for (const extra of ['vocals', 'other']) if (stems[extra]) mono[extra] = toMono22k(stems[extra], n);
  const transfer = Object.values(mono).map((a) => a.buffer);
  return runJob('chart', { stems: mono, duration, aiNotes }, transfer, onProgress);
}

/** 30 s mono 22.05 kHz preview (from ~30% into the song) as a WAV file. */
function makePreview(stems, n, sr = STEM_RATE) {
  const start = Math.floor(n * 0.3), len = Math.min(n - start, sr * 30);
  const out = new Int16Array(Math.floor(len / 2));
  const mix = new Float32Array(out.length);
  for (const pcm of Object.values(stems)) {
    for (let i = 0; i < out.length; i++) { const j = start + i * 2; mix[i] += (pcm[j] + pcm[n + j]) * 0.5; }
  }
  let peak = 1;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const fadeLen = 22050;
  for (let i = 0; i < out.length; i++) {
    const fade = Math.min(1, i / fadeLen, (out.length - i) / fadeLen);
    out[i] = Math.round((mix[i] / peak) * 29000 * fade);
  }
  const bytes = new DataView(new ArrayBuffer(44 + out.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); bytes.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, 22050, true); bytes.setUint32(28, 44100, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
  w(36, 'data'); bytes.setUint32(40, out.length * 2, true);
  new Int16Array(bytes.buffer, 44).set(out);
  return new Uint8Array(bytes.buffer);
}

/** Cover art: embedded picture > online album art > video thumbnail. Returns the stored file name or null. */
async function storeCover(song, meta) {
  try {
    if (meta.picture?.data?.length) {
      const name = /png/i.test(meta.picture.format) ? 'cover.png' : /webp/i.test(meta.picture.format) ? 'cover.webp' : 'cover.jpg';
      if (await saveSongFile(song, name, meta.picture.data)) return name;
    }
    if (meta.coverUrl) return await coverFromUrl(song, meta.coverUrl);
  } catch { /* optional */ }
  return null;
}

// ---------------------------------------------------------------- public pipeline
/**
 * @param {File} file
 * @param {'auto'|'ai'|'dsp'} mode
 * @param {(stage: string, p: number, msg?: string) => void} report
 * @param {{ video?: object, source?: object }} extra  YouTube info when imported through yt-dlp
 */
export async function importFile(file, mode, engine, report, extra = {}) {
  report('decode', 0, `Decoding ${file.name}`);
  const buf = await file.arrayBuffer();
  const { L, R, duration } = await engine.decodeFile(buf);
  const n = L.length;
  report('decode', 0.6, 'Reading tags + looking up metadata');
  const metaPromise = gatherMetadata({ file, fileName: file.name, video: extra.video, duration });
  report('decode', 1, `${duration.toFixed(1)}s of audio at ${STEM_RATE / 1000} kHz`);

  let method = 'dsp', model = 'Spectral HPSS (in-browser)', stems, remarks = [], aiNotes = null;
  let useAI = mode === 'ai';
  const client = aiClient();
  if (mode === 'auto') useAI = !!(await client.health());
  if (useAI) {
    const h = await client.health();
    if (!h) throw new Error(`AI splitter not reachable at ${settings.aiServer}. Start it with: npm run ai`);
    const res = await client.separate(L, R, STEM_RATE, (p, msg) => report('split', p, msg));
    ({ stems, notes: aiNotes, remarks } = mapAIStems(res.sources, res.stems, res.notes));
    if (!Object.values(aiNotes).some((v) => v?.length)) aiNotes = null;
    method = 'ai';
    model = `Demucs ${h.model}${h.gpu ? ` · ${h.gpu}` : ' · CPU'}${aiNotes ? ' + basic-pitch' : ''}`;
  } else {
    report('split', 0, 'Splitting stems in the browser (spectral HPSS)');
    const res = await runJob('split', { L: L.slice(), R: R.slice(), sampleRate: STEM_RATE }, undefined,
      (p) => report('split', p, `Spectral separation ${Math.round(p * 100)}%`));
    stems = {};
    for (const [k, [a, b]] of Object.entries(res)) {
      const pcm = new Int16Array(n * 2);
      pcm.set(a, 0); pcm.set(b, n);
      stems[k] = pcm;
    }
  }
  report('split', 1, `Stems: ${Object.keys(stems).join(', ')}`);

  const analysis = await chart(stems, n, duration, (p, msg) => report('chart', p, msg), aiNotes);
  report('chart', 1, `Tempo ${analysis.bpm} BPM${aiNotes ? ' · neural transcription' : ''}`);

  report('save', 0, 'Writing WAV stems to the songs folder');
  const meta = await metaPromise;
  const song = {
    id: newId(), title: meta.title, artist: meta.artist, album: meta.album, year: meta.year, genre: meta.genre,
    mbid: meta.mbid, metaSources: meta.sources, source: extra.source || { type: 'file', name: file.name },
    duration, length: n, sampleRate: STEM_RATE, createdAt: Date.now(), method, model,
    stemNames: Object.keys(stems), remarks, hue: Math.floor(Math.random() * 360), ...analysis,
  };
  await saveSong(song, stems, (p) => report('save', Math.min(0.9, p * 0.9), 'Writing WAV stems to the songs folder'));
  report('save', 0.92, 'Saving cover art + preview');
  song.cover = await storeCover(song, meta);
  song.preview = await saveSongFile(song, 'preview.wav', makePreview(stems, n));
  if (song.cover || song.preview) await saveSongJson({ ...song, stemNames: Object.keys(stems) });
  report('save', 1, 'Ready to play');
  return song;
}

// ---------------------------------------------------------------- YouTube (yt-dlp)
export async function ytStatus() {
  try { return await (await fetch('/api/yt/status', { signal: AbortSignal.timeout(20000) })).json(); } catch { return { available: false }; }
}

export async function ytSearch(q) {
  const r = await fetch(`/api/yt/search?n=15&q=${encodeURIComponent(q)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'search failed');
  j.results.playlist = j.playlist || null; // a pasted playlist link: its name
  return j.results;
}

export async function importFromYouTube(item, mode, engine, report) {
  report('download', 0, `Downloading "${item.title}"`);
  const r = await fetch('/api/yt/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.url }) });
  const { job, error } = await r.json();
  if (!job) throw new Error(error || 'download failed to start');
  let info;
  for (;;) {
    await new Promise((res) => setTimeout(res, 400));
    info = await (await fetch(`/api/yt/jobs/${job}`)).json();
    if (info.status === 'error') throw new Error(`yt-dlp: ${info.message}`);
    report('download', info.progress || 0, info.message);
    if (info.status === 'done') break;
  }
  const blob = await (await fetch(`/api/yt/jobs/${job}/file`)).blob();
  fetch(`/api/yt/jobs/${job}`, { method: 'DELETE' }).catch(() => {});
  report('download', 1, 'Downloaded');
  const video = info.info || { title: item.title, uploader: item.channel, thumbnail: item.thumbnail, url: item.url };
  const file = new File([blob], `${(video.title || 'youtube').replace(/[\\/:*?"<>|]/g, '_')}.${info.ext || 'm4a'}`, { type: blob.type });
  return importFile(file, mode, engine, report, { video, source: { type: 'youtube', url: video.url || item.url, id: video.id || item.id, channel: video.uploader || item.channel } });
}

// ---------------------------------------------------------------- re-chart an existing song
/** Re-run transcription (neural if the AI server is up) + charting on a song already in the library. */
export async function rechartSong(song, report) {
  report('chart', 0, 'Loading stems');
  const audio = await getAudio(song.id);
  if (!audio) throw new Error('Stems not found for this song');
  const n = song.length;
  let aiNotes = null;
  const client = aiClient();
  const h = await client.health();
  if (h?.transcriber) {
    aiNotes = {};
    const names = ['bass', 'guitar', 'keys', 'vocals', 'other'].filter((k) => audio.stems[k]);
    for (let i = 0; i < names.length; i++) {
      report('chart', 0.05 + (i / names.length) * 0.45, `Neural transcription: ${names[i]}`);
      aiNotes[names[i]] = await client.transcribe(names[i] === 'keys' ? 'piano' : names[i], toMono22k(audio.stems[names[i]], n));
    }
  }
  const analysis = await chart(audio.stems, n, song.duration, (p, msg) => report('chart', 0.5 + p * 0.45, msg), aiNotes);
  const updated = {
    ...song, ...analysis, rechartedAt: Date.now(),
    model: song.method === 'demo' ? song.model : `${String(song.model || '').replace(/ \+ basic-pitch$/, '')}${aiNotes ? ' + basic-pitch' : ''}`,
  };
  if (!updated.preview) updated.preview = await saveSongFile(updated, 'preview.wav', makePreview(audio.stems, n));
  await saveSongJson(updated);
  report('chart', 1, aiNotes ? 'Re-charted with neural transcription' : 'Re-charted (AI server offline: heuristic transcription)');
  return updated;
}

/** Generate the setlist preview clip for a song that doesn't have one yet. */
export async function ensurePreview(song) {
  if (song.preview) return song;
  const audio = await getAudio(song.id);
  if (!audio) return song;
  const ok = await saveSongFile(song, 'preview.wav', makePreview(audio.stems, song.length));
  if (!ok) return song;
  const updated = { ...song, preview: true };
  await saveSongJson(updated);
  return updated;
}

export async function createDemo(report) {
  report('decode', 0, 'Composing demo track');
  const { stems, length, duration } = await renderDemo((p, msg) => report('decode', p, msg));
  report('decode', 1, 'Demo rendered');
  report('split', 1, 'Demo is multitrack — no separation needed');
  const analysis = await chart(stems, length, duration, (p, msg) => report('chart', p, msg));
  report('chart', 1, `Tempo ${analysis.bpm} BPM`);
  const song = {
    id: 'demo-neon-overdrive', title: 'Neon Overdrive', artist: 'STEMSTAGE Synth Band', album: 'Demo', year: '2026', genre: 'Synth Rock',
    duration, length, sampleRate: STEM_RATE, createdAt: 1, method: 'demo', model: 'Procedural multitrack', stemNames: Object.keys(stems),
    hue: 320, source: { type: 'demo' }, ...analysis,
  };
  await saveSong(song, stems);
  song.preview = await saveSongFile(song, 'preview.wav', makePreview(stems, length));
  if (song.preview) await saveSongJson(song);
  report('save', 1, 'Ready to play');
  return song;
}

// ---------------------------------------------------------------- lyrics (singing mode)
/**
 * AI lyrics: the vocal stem goes to the AI server's Whisper (faster-whisper) and comes back as timed
 * words, stored in song.json as song.lyrics = { language, words: [{ t, e, w }], source }.
 */
export async function fetchLyrics(song, onStatus = () => {}) {
  const audio = await getAudio(song.id);
  const v = audio?.stems?.vocals;
  if (!v) throw new Error('This song has no vocal stem');
  onStatus('Preparing the vocal stem');
  const len = song.length, rate = song.sampleRate || 44100;
  const src = new Float32Array(len);
  for (let i = 0; i < len; i++) src[i] = (v[i] + v[len + i]) / 65536;
  const off = new OfflineAudioContext(1, Math.ceil((len * 16000) / rate), 16000);
  const buf = off.createBuffer(1, len, rate);
  buf.copyToChannel(src, 0);
  const node = off.createBufferSource();
  node.buffer = buf;
  node.connect(off.destination);
  node.start();
  const mono = (await off.startRendering()).getChannelData(0);
  onStatus('Listening for lyrics (Whisper)…');
  const r = await fetch(`${settings.aiServer.replace(/\/$/, '')}/lyrics`, { method: 'POST', body: mono.buffer });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `lyrics failed (${r.status})`);
  song.lyrics = { language: j.language, words: j.words, source: 'whisper', date: Date.now() };
  await saveSongJson(song);
  return song.lyrics;
}
