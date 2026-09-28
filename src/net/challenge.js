// Weekly challenges and seasons (cloud/src/index.js → /v1/challenge, /v1/season). Every week one ranked song part
// is the challenge; everyone's best run on its ranked chart that week makes the board, and the board places add up
// to season points over six weeks.
import { API, songKey } from './leaderboard.js';
import { profiles } from '../profile/profiles.js';
import { cleanApi } from './api-clean.js';

const cache = new Map(); // path → { at, data }
async function get(path, fresh) {
  const me = profiles.current?.cloud?.id;
  const url = `${API}${path}${me ? `?player=${encodeURIComponent(me)}` : ''}`;
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.data;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `challenge ${r.status}`);
  const data = cleanApi(j);
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** This week's challenge: { week, season, starts, ends, song, instrument, difficulty, chart, rows, me } or { none: true } */
export const weeklyChallenge = (fresh = false) => get('/v1/challenge', fresh);
/** This season's standings: { season, starts, ends, weeks: [...], rows, me } */
export const seasonStandings = (fresh = false) => get('/v1/season', fresh);

const keys = new Map();
/** The song in the library that is the challenge's song (matched by artist + title, like the leaderboards). */
export async function findLocalSong(songs, key) {
  for (const s of songs) {
    const k = `${s.artist}|${s.title}`;
    if (!keys.has(k)) keys.set(k, await songKey(s.artist, s.title));
    if (keys.get(k) === key) return s;
  }
  return null;
}

/** "3 days" / "5 hours" left until a Unix time. */
export function timeLeft(t) {
  const s = t - Date.now() / 1000;
  if (s <= 0) return 'ending now';
  if (s > 86400 * 1.5) return `${Math.round(s / 86400)} days left`;
  if (s > 5400) return `${Math.round(s / 3600)} hours left`;
  return `${Math.max(1, Math.round(s / 60))} min left`;
}
