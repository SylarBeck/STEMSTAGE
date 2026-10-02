// Matchmaking (v2): Online → Find match. The world API (cloud/src/index.js → POST /v1/match) looks for the best
// open room for you: same game version, the match type you want, room for one more, a lobby that hasn't started,
// players near your skill rating and, when it can, on your side of the world. While nothing fits it keeps your
// ticket (so hosts can see how many players are searching) and widens the rating window; after ~20 s you host a
// public matchmaking room yourself, and the next searchers are sent to it.
// Skill rating: an Elo number per profile (p.rating, 1000 to start) that moves after online versus / battle
// matches. It only steers matchmaking; it isn't a ranked ladder (the game can't prove a score).
import { API } from './leaderboard.js';
import { listRooms, compatible } from './rooms.js';
import { cleanApi } from './api-clean.js';

export const START_RATING = 1000;
const K = 32;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
});

/** The chance a player rated a beats one rated b. */
export const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
/** A rating after a match: score 1 win, 0.5 draw, 0 loss against opponents averaging opp. */
export const nextRating = (r, opp, score) => Math.max(100, Math.round(r + K * (score - expected(r, opp))));

async function post(path, body, signal) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal || AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `match ${r.status}`); e.status = r.status; throw e; }
  return cleanApi(j); // the room code goes into a connection address: only a real invite code passes
}

/** Without the match endpoint (an older API): the best public room by the same rules. */
async function fromList(mode, rating) {
  const rooms = (await listRooms()).filter((r) => compatible(r.version) && r.players < r.max && !r.playing && (mode === 'any' || r.mode === mode));
  rooms.sort((a, b) => Math.abs((a.rating || START_RATING) - rating) - Math.abs((b.rating || START_RATING) - rating) || b.players - a.players);
  return rooms[0] || null;
}

/**
 * Find a room. mode: any | versus | battle | band. onStatus({ searching, rooms, waited }) while it looks.
 * → { code, room } to join, or { host: true, ticket } (nothing found: host a matchmaking room).
 */
export async function findMatch({ mode = 'any', rating = START_RATING, onStatus = () => {}, signal, timeout = 20000 }) {
  const t0 = Date.now();
  let ticket = null;
  while (Date.now() - t0 < timeout) {
    if (signal?.aborted) throw new Error('cancelled');
    let res;
    try {
      res = await post('/v1/match', { mode, rating: Math.round(rating), version: __APP_VERSION__, ticket, waited: Math.round((Date.now() - t0) / 1000) }, signal);
    } catch (e) {
      if (e.status === 404 || e.status === 405) { const r = await fromList(mode, rating); return r ? { code: r.code, room: r } : { host: true, ticket: null }; }
      if (e.message === 'cancelled' || signal?.aborted) throw new Error('cancelled');
      throw e;
    }
    if (res.room?.code) return { code: res.room.code, room: res.room };
    ticket = res.ticket || ticket;
    onStatus({ searching: res.searching || 1, rooms: res.rooms || 0, waited: Math.round((Date.now() - t0) / 1000) });
    await sleep(3000, signal);
  }
  return { host: true, ticket };
}

/** Stop searching (frees the ticket so the searching count is right). */
export function cancelMatch(ticket) {
  if (!ticket) return;
  fetch(`${API}/v1/match/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }), keepalive: true }).catch(() => {});
}

/** How many people are online right now: { rooms, players, searching, byMode } (null when the API can't say). */
export async function lobbyStats() {
  try {
    const r = await fetch(`${API}/v1/lobby`, { signal: AbortSignal.timeout(6000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
