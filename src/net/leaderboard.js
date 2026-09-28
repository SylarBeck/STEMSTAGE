// The world leaderboard (cloud/src/index.js, a Cloudflare Worker at api.stemstage.varconstint.com).
// Signed-in profiles send each finished run; the Leaderboards screen and the website read the boards.
// Each profile gets a random id + secret on its first run (kept in profiles.json), so nobody else can post
// under its name.
import { settings } from '../settings.js';
import { profiles } from '../profile/profiles.js';

export const API = 'https://api.stemstage.varconstint.com';

// same normalisation as the server's songKey(): one board per song, whoever imported it
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, '').replace(/\b(feat|ft)\b.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const songKey = async (artist, title) => (await sha256(`${norm(artist)}|${norm(title)}`)).slice(0, 16);

const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

async function get(path, params = {}) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `leaderboard ${r.status}`);
  return j;
}

export const worldBoard = async (song, instrument, difficulty, limit = 25) => get('/v1/leaderboard', { song: await songKey(song.artist, song.title), instrument, difficulty, limit });
export const worldPlayers = (limit = 25) => get('/v1/players', { limit });

/**
 * Send a finished run for every signed-in player in it. Returns [{ name, rank, newTop, personalBest }] for the
 * runs that were accepted (errors are logged, never shown mid-results).
 */
export async function submitRuns(r) {
  if (settings.worldLeaderboard === false || r.practice || r.mode === 'replay') return [];
  const out = [];
  for (const res of r.players || []) {
    if (!res.profileId || res.assist || res.failed) continue;
    const p = profiles.byId(res.profileId);
    if (!p) continue;
    const cloud = await profiles.cloudIdentity(p.id, () => ({ id: `p_${rand(12)}`, secret: rand(24) }));
    const body = {
      player: { id: cloud.id, secret: cloud.secret, name: p.name, ...(p.discord ? { discord: { id: p.discord.id, avatar: p.discord.avatar } } : {}) },
      song: { title: r.song.title, artist: r.song.artist, duration: Math.round(r.song.duration || 0) },
      instrument: res.instrument, difficulty: res.difficulty, score: res.score, stars: res.stars, accuracy: res.accuracy,
      fc: res.total > 0 && res.hits === res.total, maxStreak: res.maxStreak, notes: res.total, version: __APP_VERSION__,
    };
    try {
      const resp = await fetch(`${API}/v1/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) out.push({ name: p.name, ...j });
      else console.warn('world leaderboard:', j.error || resp.status);
    } catch (e) { console.warn('world leaderboard:', e.message); }
  }
  return out;
}
