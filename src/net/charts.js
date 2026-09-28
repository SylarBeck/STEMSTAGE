// Ranked charts. Every import makes its own AI chart (a different split, a different recording), so a world
// score only means something next to runs on the same notes. Each song part (song + instrument) is ranked on one
// chart: the first one uploaded, until players vote in a better one (cloud/src/index.js). Before a song starts
// the game downloads that chart and lines it up with the player's own recording (src/audio/fingerprint.js), so
// everyone on a ranked board played the same notes; runs on any other chart go to that chart's own board.
//
// In song.json a part playing a downloaded chart keeps the player's own chart to switch back to:
//   charts[inst] = { available, notes, phrases,
//                    world: { id, offset, hash, uploader, edited, at },   the chart it came from, shifted by offset
//                    own: { notes, phrases, edited, aiNotes, aiPhrases } }  the player's chart
//   charts[inst].pin       the player picked this part's chart themselves (it isn't swapped for the ranked one)
//   charts[inst].refused   { id, reason }: that ranked chart doesn't fit this recording (not tried again)
//   song.fp                fingerprint of the recording (made once, then kept)
import { settings } from '../settings.js';
import { API, songKey, identityOf, playerOf } from './leaderboard.js';
import { profiles } from '../profile/profiles.js';
import { canonicalChart, chartId, CHART_VERSION, DIFFICULTIES } from '../../cloud/src/chart.js';
import { fingerprint, packFingerprint, unpackFingerprint, alignFingerprints } from '../audio/fingerprint.js';
import { saveSongJson } from '../storage/library.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const ms = (s) => clamp(s * 1000, 0, 3_600_000);

/** A song part in the shared format (see cloud/src/chart.js). */
export function wireChart(inst, part) {
  return {
    v: CHART_VERSION, instrument: inst,
    phrases: (part.phrases || []).map((p) => [ms(p.start), ms(p.end)]),
    notes: Object.fromEntries(DIFFICULTIES.map((d) => [d, (part.notes?.[d] || []).map((n) => [
      ms(n.t), clamp(n.lane, 0, 7), ms(n.len || 0), clamp(n.m ?? 60, 0, 127), clamp((n.s ?? 1) * 100, 0, 1000), clamp(n.p ?? -1, -1, 9999),
    ])])),
  };
}

/**
 * The world id of the chart a song part plays: the downloaded chart's id while its notes are untouched, else the
 * id of the notes as they are (an edited download is a new chart, which players can vote in).
 * → { id, downloaded, canonical }
 */
export async function partChart(inst, part) {
  const canonical = canonicalChart(wireChart(inst, part));
  const id = await chartId(canonical);
  if (part.world?.id && part.world.hash === id) return { id: part.world.id, downloaded: true, canonical };
  return { id, downloaded: false, canonical };
}

/** Beat position of a time on the song's beat grid, in 48ths (what the editor snaps to). */
function beatQ(beats, t) {
  if (!beats?.length) return 0;
  let lo = 0, hi = beats.length - 1;
  if (t <= beats[0]) return 0;
  if (t >= beats[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  return Math.round((lo + (t - beats[lo]) / (beats[hi] - beats[lo] || 1)) * 48) / 48;
}

/** A downloaded chart on this recording: every time moved by `offset` seconds, phrases re-marked. */
function fromWire(chart, offset, song) {
  const dur = song.duration || Infinity;
  const phrases = (chart.phrases || []).map(([s, e]) => ({ start: +(s / 1000 + offset).toFixed(4), end: +(e / 1000 + offset).toFixed(4) }))
    .filter((p) => p.end > 0 && p.start < dur);
  const notes = {};
  for (const d of DIFFICULTIES) {
    notes[d] = (chart.notes?.[d] || []).map(([t, lane, len, m, s]) => {
      const at = +(t / 1000 + offset).toFixed(4);
      return { t: at, lane, len: +(len / 1000).toFixed(4), s: s / 100, m, p: -1, q: beatQ(song.beats, at) };
    }).filter((n) => n.t >= 0 && n.t <= dur);
    let k = 0;
    for (const n of notes[d]) {
      while (k < phrases.length && n.t > phrases[k].end) k++;
      n.p = k < phrases.length && n.t >= phrases[k].start && n.t <= phrases[k].end ? k : -1;
    }
  }
  return { notes, phrases };
}

// ---------------------------------------------------------------- the API
async function getJson(path, params, timeout = 8000) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(timeout) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `charts ${r.status}`);
  return j;
}
async function postJson(path, body, timeout = 15000) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `charts ${r.status}`);
  return j;
}

const lists = new Map(); // "<key>|<inst>" → { at, data }
/** The charts players uploaded for a song part (ranked first). Cached for a minute. */
export async function worldCharts(song, inst, { fresh = false } = {}) {
  const key = await songKey(song.artist, song.title);
  const id = `${key}|${inst}`;
  const hit = lists.get(id);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.data;
  const me = profiles.current?.cloud?.id;
  const data = await getJson('/v1/charts', { song: key, instrument: inst, ...(me ? { player: me } : {}) }, 5000);
  lists.set(id, { at: Date.now(), data });
  return data;
}
const forget = (key, inst) => lists.delete(`${key}|${inst}`);
/** Drop the cached chart lists (after a run: the player counts changed). */
export const forgetWorldCharts = () => lists.clear();

const downloads = new Map();
const fetchChart = (id) => {
  if (!downloads.has(id)) downloads.set(id, getJson('/v1/chart', { id }, 15000).catch((e) => { downloads.delete(id); throw e; }));
  return downloads.get(id);
};

/** The recording's fingerprint, made once (a few hundred ms) and kept in song.json. `audio` may be a loader. */
export async function ensureFingerprint(song, audio) {
  if (song.fp?.v === 1) return song.fp;
  if (typeof audio === 'function') audio = await audio();
  if (!audio?.stems) throw new Error('no audio');
  await new Promise((r) => setTimeout(r, 0)); // let "Loading…" paint first
  song.fp = packFingerprint(fingerprint(audio.stems, song.sampleRate || 44100));
  await saveSongJson(song).catch((e) => console.warn('fingerprint not saved:', e.message));
  return song.fp;
}

/** Put a downloaded chart on a song part (the player's own chart is kept in part.own). */
async function applyChart(song, inst, got, offset) {
  const part = song.charts[inst];
  // the player's chart stays in part.own; a download they edited counts as theirs now
  const untouched = part.world && (await partChart(inst, part)).downloaded;
  const own = untouched ? part.own : { notes: part.notes, phrases: part.phrases, edited: part.edited, aiNotes: part.aiNotes, aiPhrases: part.aiPhrases };
  const { notes, phrases } = fromWire(got.chart, offset, song);
  const next = { available: notes.expert.length > 0 || DIFFICULTIES.some((d) => notes[d].length), reason: '', notes, phrases, own };
  const hash = await chartId(canonicalChart(wireChart(inst, next)));
  next.world = { id: got.id, offset: +offset.toFixed(4), hash, uploader: got.uploader || null, edited: !!got.edited, at: Date.now() };
  song.charts[inst] = next;
}

/**
 * Download a chart and line it up with this recording (`audio`: the stems, or a loader, only needed for a song
 * without a fingerprint yet). → { ok, offset, reason }; the song is saved when it changes.
 */
export async function useWorldChart(song, audio, inst, id, { pin = false } = {}) {
  const got = await fetchChart(id);
  if (got.instrument !== inst) throw new Error('that chart is for another instrument');
  const mine = unpackFingerprint(await ensureFingerprint(song, audio));
  const al = alignFingerprints(unpackFingerprint(got.fp), mine);
  const part = song.charts[inst];
  if (!al.ok) {
    part.refused = { id, reason: al.reason };
    await saveSongJson(song).catch(() => {});
    return { ok: false, reason: al.reason };
  }
  await applyChart(song, inst, got, al.offset);
  if (pin) song.charts[inst].pin = true;
  await saveSongJson(song);
  return { ok: true, offset: al.offset };
}

/** Back to the player's own chart for a part (and keep it: the ranked chart isn't put back on). */
export async function useOwnChart(song, inst) {
  const part = song.charts[inst];
  if (part.world && part.own) song.charts[inst] = { ...part.own, available: true, reason: '', pin: true };
  else part.pin = true;
  await saveSongJson(song);
}

/** Let the ranked chart go on this part again (it's swapped in the next time the song starts). */
export async function allowRanked(song, inst) {
  const part = song.charts[inst];
  delete part.pin;
  delete part.refused;
  await saveSongJson(song);
}

let offlineUntil = 0;
/**
 * Before a song starts: the ranked chart on every part that's played, lined up with this recording.
 * → [{ inst, status: 'ranked' | 'swapped' | 'first' | 'own' | 'refused' | 'offline', reason?, offset? }]
 */
export async function prepareRankedCharts(song, audio, insts, onStatus = () => {}) {
  if (settings.worldLeaderboard === false) return [];
  const out = [];
  for (const inst of new Set(insts)) {
    const part = song.charts?.[inst];
    if (!part?.available) continue;
    if (part.pin || settings.rankedCharts === false) { out.push({ inst, status: 'own' }); continue; }
    if (Date.now() < offlineUntil) { out.push({ inst, status: 'offline' }); continue; }
    let list;
    try { list = await worldCharts(song, inst); } catch (e) {
      offlineUntil = Date.now() + 60_000; // don't hold up every song start while the API is unreachable
      out.push({ inst, status: 'offline', reason: e.message });
      continue;
    }
    const ranked = list.rankedChart;
    if (!ranked) { out.push({ inst, status: 'first' }); continue; } // nobody has uploaded one: this run's chart will be it
    const cur = await partChart(inst, part);
    if (cur.id === ranked) { out.push({ inst, status: 'ranked' }); continue; }
    if (part.refused?.id === ranked) { out.push({ inst, status: 'refused', reason: part.refused.reason }); continue; }
    onStatus(`Lining up the ranked ${inst} chart with your recording…`);
    try {
      const r = await useWorldChart(song, audio, inst, ranked);
      out.push(r.ok ? { inst, status: 'swapped', offset: r.offset } : { inst, status: 'refused', reason: r.reason, fresh: true });
    } catch (e) { out.push({ inst, status: 'offline', reason: e.message }); }
  }
  return out;
}

const uploaded = new Set();
/**
 * The chart a finished run was played on, uploaded if the world doesn't have it yet (the first chart of a song
 * part becomes its ranked chart). → { id, first } or null
 */
export async function chartForRun(song, inst, profile) {
  const part = song.charts?.[inst];
  if (!part?.available) return null;
  const c = await partChart(inst, part);
  if (c.downloaded || uploaded.has(c.id) || !song.fp) return { id: c.id, first: false };
  const j = await postChart(song, inst, part, c, profile);
  return { id: j.chartId, first: !j.known && j.ranked };
}

async function postChart(song, inst, part, c, profile) {
  const cloud = await identityOf(profile);
  const j = await postJson('/v1/charts', {
    player: playerOf(profile, cloud),
    song: { title: song.title, artist: song.artist, duration: Math.round(song.duration || 0) },
    instrument: inst, chart: c.canonical, fp: song.fp,
    meta: { edited: !!(part.edited && Object.keys(part.edited).length) || !!part.world, method: String(song.model || song.method || '').slice(0, 40), version: __APP_VERSION__ },
  });
  uploaded.add(c.id);
  forget(j.songKey, inst);
  return j;
}

/**
 * Song options → World charts → Share my chart: put a part's chart in the chart library now, without a run
 * (a chart fixed in the editor, for others to play and vote for). `audio`: the stems or a loader (for the
 * fingerprint of a song that hasn't got one yet). → { id, known, ranked, downloaded }
 */
export async function shareChart(song, inst, profile, audio) {
  const part = song.charts?.[inst];
  if (!part?.available) throw new Error(`this song has no ${inst} chart`);
  const c = await partChart(inst, part);
  if (c.downloaded) return { id: c.id, known: true, downloaded: true };
  await ensureFingerprint(song, audio);
  const j = await postChart(song, inst, part, c, profile);
  return { id: j.chartId, known: j.known, ranked: j.ranked };
}

/** Vote for the chart a song part should be ranked on (the player must have finished a run on it). */
export async function voteChart(profile, id) {
  const cloud = await identityOf(profile);
  const j = await postJson('/v1/charts/vote', { player: playerOf(profile, cloud), chartId: id });
  lists.clear();
  return j;
}
