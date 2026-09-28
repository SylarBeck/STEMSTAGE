// Replays and ghosts. Every run records its inputs at song time (press / release / strum / overdrive /
// whammy) plus a score timeline. A replay feeds the inputs back into a normal Player, so it's judged
// exactly like the original run; a ghost is the score timeline of an earlier run shown next to yours.
// Stored in the data folder (data/replays/<id>.json) through /api/data/replays.
import { settings } from '../settings.js';

const API = '/api/data/replays';
const CODE = { press: 'p', release: 'r', strum: 's', od: 'o' };
const TYPE = { p: 'press', r: 'release', s: 'strum', o: 'od' };
const KEEP_RECENT = 40;
const round = (t) => Math.round(t * 10000) / 10000;

export class Recorder {
  constructor() {
    this.events = [];   // [t, code, lane?]  (code 'w' = whammy value)
    this.timeline = []; // [t, score, streak]
    this.lastW = 0;
    this.nextSample = 0;
  }

  input(ev, t) {
    const c = CODE[ev.type];
    if (!c) return;
    this.events.push(ev.lane !== undefined ? [round(t), c, ev.lane] : [round(t), c]);
  }

  whammy(v, t) {
    if (Math.abs(v - this.lastW) < 0.04 && !(v === 0 && this.lastW !== 0)) return;
    this.lastW = v;
    this.events.push([round(t), 'w', Math.round(v * 100) / 100]);
  }

  sample(t, score, streak) {
    if (t < this.nextSample) return;
    this.nextSample = t + 0.25;
    this.timeline.push([round(t), Math.floor(score), streak]);
  }
}

/** Plays a recorded run back into a Player: held frets, whammy and the input events at their song times. */
export class Replayer {
  constructor(data) {
    this.events = data.events;
    this.ptr = 0;
    this.held = [false, false, false, false, false];
    this.whammy = 0;
  }

  /** Feed every event up to song time t into the player. */
  pump(player, t) {
    while (this.ptr < this.events.length && this.events[this.ptr][0] <= t) {
      const [at, c, v] = this.events[this.ptr++];
      if (c === 'w') { this.whammy = v; continue; }
      if (c === 'v') { this.pitch = v; continue; } // singing / real instruments: the recorded pitch
      if (c === 'n') { player.handle({ type: 'realnote', note: v }, at); continue; } // a note played on a real instrument
      if (c === 'p') this.held[v] = true;
      if (c === 'r') this.held[v] = false;
      player.handle({ type: TYPE[c], lane: v }, at);
    }
  }
}

/** Ghost score at song time t (from a replay's timeline). */
export function ghostAt(timeline, t) {
  if (!timeline?.length || t < timeline[0][0]) return { score: 0, streak: 0 };
  let lo = 0, hi = timeline.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (timeline[mid][0] <= t) lo = mid; else hi = mid - 1; }
  return { score: timeline[lo][1], streak: timeline[lo][2] };
}

/** The rules that change judgement; a replay is played back under the rules it was recorded with. */
export const currentRules = () => (settings.proMode
  // Pro: tight timing windows, overstrums break the streak, and no assists or no-fail
  ? { pro: true, ghostPenalty: true, noFail: false, laneAssist: 'off', autoSustain: false }
  : {
    ghostPenalty: !!settings.ghostPenalty, noFail: !!settings.noFail,
    laneAssist: settings.laneAssist || 'off', autoSustain: !!settings.autoSustain, // accessibility assists
  });

export function buildReplay(song, player, recorder, result) {
  const notes = song.charts?.[result.instrument]?.notes?.[result.difficulty] || [];
  return {
    v: 1,
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    songId: song.id, songTitle: song.title, songArtist: song.artist,
    instrument: result.instrument, difficulty: result.difficulty, strum: !!player.strum, lefty: !!player.lefty, mic: !!player.mic,
    profileId: result.profileId || null, name: result.name, color: result.color,
    score: result.score, stars: result.stars, accuracy: +result.accuracy.toFixed(4), fc: !result.failed && result.miss === 0 && result.total > 0,
    failed: !!result.failed, maxStreak: result.maxStreak, date: Date.now(), rules: player.rules,
    chart: { n: notes.length, t0: notes[0]?.t ?? 0 }, // to tell when the chart changed since (an edit, or a ranked chart swapped in)
    events: recorder.events, timeline: recorder.timeline,
  };
}

// ---------------------------------------------------------------- storage
let index = null; // metadata of every stored replay (no events)
const meta = (r) => { const { events, timeline, ...m } = r; return m; };

export async function listReplays() {
  if (index) return index;
  try {
    const r = await fetch(API);
    index = r.ok ? await r.json() : [];
  } catch { index = []; }
  return index;
}

export async function loadReplay(id) {
  try {
    const r = await fetch(`${API}/${encodeURIComponent(id)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const chartKey = (r) => `${r.profileId || 'guest'}|${r.songId}|${r.instrument}|${r.difficulty}`;

/** Save a replay, then prune: keep the newest runs plus the best run per profile and chart. */
export async function saveReplay(replay) {
  const r = await fetch(`${API}/${replay.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(replay) });
  if (!r.ok) return false;
  const list = await listReplays();
  list.push(meta(replay));
  const best = new Map();
  for (const x of list) {
    if (x.failed) continue;
    const cur = best.get(chartKey(x));
    if (!cur || x.score > cur.score) best.set(chartKey(x), x);
  }
  const keep = new Set([...best.values()].map((x) => x.id));
  [...list].sort((a, b) => b.date - a.date).slice(0, KEEP_RECENT).forEach((x) => keep.add(x.id));
  const drop = list.filter((x) => !keep.has(x.id));
  index = list.filter((x) => keep.has(x.id));
  await Promise.all(drop.map((x) => fetch(`${API}/${x.id}`, { method: 'DELETE' }).catch(() => {})));
  return true;
}

/** Replays of one chart, best first. */
export async function replaysFor(songId, instrument, difficulty) {
  return (await listReplays()).filter((x) => x.songId === songId && (!instrument || x.instrument === instrument) && (!difficulty || x.difficulty === difficulty))
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the ghost for a solo run. which: 'best' (this profile's best), 'top' (best of anyone on this PC).
 * Returns the full replay or null.
 */
export async function pickGhost(which, songId, instrument, difficulty, profileId) {
  if (which === 'off') return null;
  const list = (await replaysFor(songId, instrument, difficulty)).filter((x) => !x.failed);
  const mine = list.filter((x) => (x.profileId || null) === (profileId || null));
  const pick = which === 'top' ? list[0] : mine[0];
  return pick ? loadReplay(pick.id) : null;
}
