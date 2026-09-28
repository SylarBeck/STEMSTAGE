// Public rooms: a host can list their online room on the world API (cloud/src/index.js → /v1/rooms), so anyone
// can find it in Online → Join → Public rooms (or on the website) without being sent the invite code. The host
// re-announces the room every 30 seconds; a room that stops announcing drops off the list after 90 seconds.
import { API } from './leaderboard.js';

const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
/** The key that lets only this game update or close its listing (a new one per hosting session). */
export const newRoomKey = () => rand(16);

/** Open public rooms, fullest first: [{ code, name, host, mode, song, artist, players, max, playing, version, updated }] */
export async function listRooms() {
  const r = await fetch(`${API}/v1/rooms`, { signal: AbortSignal.timeout(6000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `rooms ${r.status}`);
  return j.rows || [];
}

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `rooms ${r.status}`);
  return j;
}

/** List (or refresh) this room. room: { code, key, name, host, mode, song, artist, players, max, playing } */
export const announceRoom = (room) => post('/v1/rooms', { ...room, version: __APP_VERSION__ });

/** Take the room off the list. keepalive lets it go out while the window is closing. */
export function closeRoom(code, key) {
  return fetch(`${API}/v1/rooms/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, key }), keepalive: true }).catch(() => {});
}

/** Rooms made by the same minor version of the game can play together (the protocol only changes between them). */
export const compatible = (version) => String(version || '').split('.').slice(0, 2).join('.') === String(__APP_VERSION__).split('.').slice(0, 2).join('.');
