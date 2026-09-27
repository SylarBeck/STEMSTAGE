// Discord for the game: link a profile to the Discord account signed in on this PC, show that account's live
// status (Lanyard) and put what you're playing in your Discord status (Rich Presence). The work happens in the
// local server (server/discord.js); this is the game-side API.
import { settings } from '../settings.js';

const api = async (path, body) => {
  const r = await fetch(`/api/discord/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Discord ${r.status}`);
  return j;
};

/** Avatar image URL for a linked account ({ id, avatar }); Discord's default avatar when they have none. */
export function discordAvatar(d, size = 128) {
  if (!d?.id) return null;
  if (d.avatar) return `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.${d.avatar.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
  let idx = 0;
  try { idx = Number((BigInt(d.id) >> 22n) % 6n); } catch { /* keep 0 */ }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

export const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };

class Discord {
  constructor() {
    this.presenceCache = new Map();
    this.last = null;
    this.timer = null;
  }

  /** Connect to the Discord app → { connected, user, error }. */
  connect() { return api('connect', { clientId: settings.discordClientId || '' }); }

  /** The Discord account signed in on this PC, for linking a profile. Throws a readable error. */
  async currentUser() {
    const s = await this.connect();
    if (s.user) return s.user;
    const e = s.error || '';
    if (/application ID/i.test(e)) throw new Error('Set your Discord application ID first (Settings → Discord)');
    if (/Invalid Client ID/i.test(e)) throw new Error('Discord says the application ID is wrong — copy it again from discord.com/developers');
    throw new Error(e || 'Discord is not running on this PC');
  }

  /** Live status of a Discord user (cached 20 s): { ok, status, user, custom, playing, listening } or { ok: false, error }. */
  async presence(id, { fresh = false } = {}) {
    const hit = this.presenceCache.get(id);
    if (!fresh && hit && Date.now() - hit.at < 20000) return hit.value;
    const value = await api(`presence/${id}`).catch((e) => ({ ok: false, error: e.message }));
    this.presenceCache.set(id, { at: Date.now(), value });
    return value;
  }

  /** Rich Presence. a: { details, state, start?, end?, image?, party? } or null to clear. Coalesced, ≤ 1 per 2 s. */
  activity(a) {
    if (!settings.discordPresence) a = null;
    const key = JSON.stringify(a);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.pending = a;
    if (this.timer) return;
    const flush = () => {
      this.timer = null;
      const next = this.pending;
      api('activity', { clientId: settings.discordClientId || '', activity: next }).catch(() => { /* Discord closed: fine */ });
      this.timer = setTimeout(() => { this.timer = null; if (this.pending !== next) flush(); }, 2000);
    };
    flush();
  }

  // game events → Rich Presence
  menus(what = 'Picking a song') { this.activity({ details: what, state: 'In the menus' }); }

  playing(song, players, { resumeAt = 0, rate = 1 } = {}) {
    const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
    const solo = players.length === 1 ? players[0] : null;
    const left = Math.max(0, ((song.duration || 0) - resumeAt) / rate);
    this.activity({
      details: `${song.title}${song.artist ? ` — ${song.artist}` : ''}`,
      state: solo ? `${cap(solo.instrument)} · ${cap(solo.difficulty)}${solo.real ? ' · real instrument' : ''}` : `${players.length}-piece band`,
      start: Date.now(), end: left ? Date.now() + left * 1000 : undefined,
      image: /^https:\/\//.test(song.cover || '') ? song.cover : undefined, imageText: song.album || song.title,
      party: players.length > 1 ? { id: `band-${song.id}`, size: players.length, max: 4 } : undefined,
    });
  }

  paused(song) { this.activity({ details: `${song.title}${song.artist ? ` — ${song.artist}` : ''}`, state: 'Paused' }); }

  results(song, r) {
    const p = r?.players?.[0];
    this.activity({ details: `Just played ${song.title}`, state: p ? `${Number(p.score || 0).toLocaleString('en-US')} points · ${p.stars || 0}★${p.fc ? ' · full combo' : ''}` : 'Results' });
  }
}

export const discord = new Discord();
