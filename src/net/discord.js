// Discord for the game: log in with Discord (OAuth) to link a profile, show that account's live status (Lanyard)
// and put what you're playing in your Discord status automatically (Rich Presence through the Discord app on
// this PC). The local server (server/discord.js) does the Discord calls; this is the game-side API.
//
// Both use STEMSTAGE's own Discord application. Its ID is public (not a secret) and baked in at build time, so
// players set nothing up. Forks: build with VITE_DISCORD_CLIENT_ID=<your application id>.
import { settings } from '../settings.js';

export const DISCORD_APP_ID = import.meta.env?.VITE_DISCORD_CLIENT_ID || '1553872601603117127';
const appId = () => settings.discordClientId || DISCORD_APP_ID;
const OAUTH_KEY = 'stemstage.discord.oauth';
export const CALLBACK_PATH = '/discord/callback';
/** The web invite for a room: works for everyone, and opens STEMSTAGE straight into the room when it's installed. */
export const inviteLink = (code) => `https://stemstage.varconstint.com/join/?code=${encodeURIComponent(code)}`;

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

  get available() { return !!appId(); }

  /** Connect to the Discord app on this PC (Rich Presence) → { connected, user, error }. */
  connect() { return api('connect', { clientId: appId() }); }

  /** The Discord account signed in to the Discord app on this PC. Throws a readable error. */
  async currentUser() {
    const s = await this.connect();
    if (s.user) return s.user;
    const e = s.error || '';
    if (/application ID|Invalid Client ID/i.test(e)) throw new Error('Discord isn’t set up in this build of STEMSTAGE');
    throw new Error(e || 'Discord is not running on this PC');
  }

  /**
   * "Log in with Discord": OAuth2 implicit grant, scope identify (who you are, nothing else). The page goes to
   * discord.com and comes back to /discord/callback with a token, which finishLogin() uses once to read the
   * profile. The token is never stored.
   */
  login(profileId) {
    if (!this.available) throw new Error('Discord login isn’t set up in this build of STEMSTAGE');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ state, profileId, at: Date.now() }));
    const q = new URLSearchParams({ client_id: appId(), response_type: 'token', scope: 'identify', state, redirect_uri: location.origin + CALLBACK_PATH });
    location.assign(`https://discord.com/oauth2/authorize?${q}`);
  }

  /**
   * Back from discord.com (call once at start-up). Returns null when this wasn't a login, else
   * { profileId, user } or { profileId, error }. Puts the address back to / either way.
   */
  async finishLogin() {
    const back = this.callback;
    this.callback = null;
    if (!back) return null;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(OAUTH_KEY) || 'null'); } catch { /* none */ }
    sessionStorage.removeItem(OAUTH_KEY);
    const q = new URLSearchParams(back.replace(/^[#?]/, ''));
    if (!pending || q.get('state') !== pending.state || Date.now() - pending.at > 15 * 60000) return { error: 'That Discord login expired — try again' };
    if (q.get('error')) return { profileId: pending.profileId, error: q.get('error') === 'access_denied' ? 'Discord login cancelled' : q.get('error_description') || q.get('error') };
    const token = q.get('access_token');
    if (!token) return { profileId: pending.profileId, error: 'Discord didn’t send a login' };
    try { return { profileId: pending.profileId, user: await api('me', { token }) }; } catch (e) { return { profileId: pending.profileId, error: e.message }; }
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
      api('activity', { clientId: appId(), activity: next }).catch(() => { /* Discord closed: fine */ });
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

  /**
   * In an online room. Discord allows either link buttons or a join secret, not both:
   *   'link' (default)  a "Join room" button with the web invite: anyone can use it, game installed or not
   *   'discord'         Discord's own Join / Ask to Join (only lights up for people who have STEMSTAGE installed)
   */
  room({ code, players, host, song }) {
    const discordJoin = settings.discordInvites === 'discord';
    this.activity({
      details: song ? `Online · ${song.title}${song.artist ? ` — ${song.artist}` : ''}` : 'In an online room',
      state: host ? 'Hosting · join in!' : 'In the lobby',
      party: { id: `room-${code}`, size: Math.max(1, players), max: 8 },
      ...(discordJoin ? { secret: code } : { buttons: [{ label: 'Join room', url: inviteLink(code) }, { label: 'Get STEMSTAGE', url: 'https://stemstage.varconstint.com/' }] }),
    });
  }

  /** Events from Discord: { type: 'join', secret } (a friend pressed Join) or { type: 'join-request', user }. */
  onEvent(fn) {
    (this.handlers ||= new Set()).add(fn);
    if (this.es || typeof EventSource === 'undefined') return;
    this.es = new EventSource(`/api/discord/events?clientId=${encodeURIComponent(appId())}`);
    this.es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      this.handlers.forEach((h) => h(ev));
    };
  }

  paused(song) { this.activity({ details: `${song.title}${song.artist ? ` — ${song.artist}` : ''}`, state: 'Paused' }); }

  results(song, r) {
    const p = r?.players?.[0];
    this.activity({ details: `Just played ${song.title}`, state: p ? `${Number(p.score || 0).toLocaleString('en-US')} points · ${p.stars || 0}★${p.fc ? ' · full combo' : ''}` : 'Results' });
  }
}

export const discord = new Discord();

// the OAuth redirect lands on /discord/callback#access_token=…: keep the answer and show the game at / right away
if (typeof location !== 'undefined' && location.pathname === CALLBACK_PATH) {
  discord.callback = location.hash || location.search;
  history.replaceState(null, '', '/');
}
