// Discord, without a bot or a client secret:
//   - "Log in with Discord": the game does an OAuth2 implicit grant (scope identify) and hands the token to
//     POST /me once, which reads the profile from Discord's API. The token isn't kept.
//   - Rich Presence ("Playing STEMSTAGE · Hotel California — Eagles · Guitar · Expert") through the Discord
//     desktop app's local IPC socket, set automatically while you play. In an online room the status carries
//     the invite code as its join secret, so friends can press Join in Discord to get into the room.
//   - Live Discord status (online / idle / do not disturb, custom status, what they're playing) from Lanyard
//     (https://github.com/Phineas/lanyard), which works for anyone who has joined its Discord server.
// OAuth and Rich Presence use STEMSTAGE's Discord application ID (public, not a secret), which the game sends
// with each request; STEMSTAGE_DISCORD_CLIENT_ID overrides it for the server.
//
//   GET  /state                    { connected, user, error, clientId }
//   POST /connect   { clientId }   connect (or reconnect with another ID) → state
//   POST /activity  { clientId, activity | null }   set / clear the Rich Presence
//   POST /me        { token }      the Discord user behind an OAuth token (scope identify)
//   GET  /events                   Server-Sent Events: { type: 'join', secret } when a friend presses Join on our
//                                  status (the secret is the room's invite code), { type: 'join-request', user }
//   GET  /presence/<user id>       Lanyard status for that Discord user
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { send, isLocal, readJsonBody } from './library.js';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const ID_RE = /^\d{15,21}$/;

/** Where the Discord app listens: a named pipe on Windows, a Unix socket elsewhere (incl. Flatpak / Snap). */
function socketPaths(i) {
  if (process.platform === 'win32') return [`\\\\?\\pipe\\discord-ipc-${i}`];
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return [path.join(base, `discord-ipc-${i}`), path.join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`), path.join(base, 'snap.discord', `discord-ipc-${i}`), `/tmp/discord-ipc-${i}`];
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

class DiscordIpc {
  constructor() {
    this.sock = null;
    this.clientId = null;
    this.user = null;
    this.error = null;
    this.connecting = null;
    this.lastTry = 0;
    this.activity = null; // re-sent after a reconnect
    this.events = []; // join events waiting for the game (Discord may start the game to deliver one)
    this.listeners = new Set();
  }

  /** A Discord event for the game: straight to connected games, or kept until one connects. */
  emit(ev) {
    if (this.listeners.size) this.listeners.forEach((fn) => fn(ev));
    else this.events.push({ ...ev, at: Date.now() });
  }

  /** Subscribe the game (GET /events): pending events first, then live ones. */
  listen(fn) {
    const fresh = this.events.filter((e) => Date.now() - e.at < 120000);
    this.events = [];
    fresh.forEach(fn);
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get connected() { return !!(this.sock && this.user); }
  state() { return { connected: this.connected, user: this.user, error: this.error, clientId: this.clientId }; }

  close() {
    try { this.sock?.destroy(); } catch { /* gone */ }
    this.sock = null;
    this.user = null;
  }

  async connect(clientId, { force = false } = {}) {
    if (!ID_RE.test(clientId || '')) { this.close(); this.clientId = null; this.error = 'no Discord application ID set'; return this.state(); }
    if (clientId !== this.clientId) { this.close(); this.clientId = clientId; force = true; }
    if (this.connected) return this.state();
    if (this.connecting) return this.connecting;
    if (!force && Date.now() - this.lastTry < 10000) return this.state(); // don't hammer a closed Discord
    this.lastTry = Date.now();
    this.connecting = this._open(clientId).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async _open(clientId) {
    for (let i = 0; i < 10; i++) {
      for (const p of socketPaths(i)) {
        const sock = await new Promise((resolve) => {
          const s = net.createConnection(p);
          const fail = () => { s.destroy(); resolve(null); };
          const timer = setTimeout(fail, 800);
          s.once('connect', () => { clearTimeout(timer); s.off('error', fail); resolve(s); });
          s.once('error', () => { clearTimeout(timer); fail(); });
        });
        if (!sock) continue;
        const ready = await this._handshake(sock, clientId);
        if (ready) { this.error = null; return this.state(); }
      }
    }
    if (!this.error) this.error = 'Discord is not running on this PC';
    return this.state();
  }

  _handshake(sock, clientId) {
    return new Promise((resolve) => {
      let buf = Buffer.alloc(0);
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 8) {
          const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
          if (buf.length < 8 + len) break;
          let msg = null;
          try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch { /* ignore */ }
          buf = buf.subarray(8 + len);
          if (op === OP.PING) { sock.write(encode(OP.PONG, msg)); continue; }
          if (op === OP.CLOSE) { this.error = msg?.message || 'Discord closed the connection'; sock.destroy(); finish(false); continue; }
          if (msg?.evt === 'READY') {
            const u = msg.data?.user || {};
            this.sock = sock;
            this.user = { id: u.id, username: u.username, globalName: u.global_name || null, avatar: u.avatar || null };
            // friends pressing Join / Ask to Join on our status
            for (const evt of ['ACTIVITY_JOIN', 'ACTIVITY_JOIN_REQUEST']) sock.write(encode(OP.FRAME, { cmd: 'SUBSCRIBE', evt, args: {}, nonce: randomUUID() }));
            if (this.activity) this._send(this.activity);
            finish(true);
          } else if (msg?.cmd === 'DISPATCH' && msg.evt === 'ACTIVITY_JOIN' && msg.data?.secret) {
            this.emit({ type: 'join', secret: msg.data.secret });
          } else if (msg?.cmd === 'DISPATCH' && msg.evt === 'ACTIVITY_JOIN_REQUEST' && msg.data?.user?.id) {
            // "Ask to Join": the room is open to anyone with the invite code, so let them in
            const u = msg.data.user;
            sock.write(encode(OP.FRAME, { cmd: 'SEND_ACTIVITY_JOIN_INVITE', args: { user_id: u.id }, nonce: randomUUID() }));
            this.emit({ type: 'join-request', user: { id: u.id, username: u.username, globalName: u.global_name || null } });
          } else if (msg?.evt === 'ERROR') {
            this.error = msg.data?.message || 'Discord error';
          }
        }
      });
      sock.on('close', () => { if (this.sock === sock) { this.sock = null; this.user = null; } finish(false); });
      sock.on('error', () => {});
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: clientId }));
      setTimeout(() => { if (!done) { this.error = 'Discord did not answer'; sock.destroy(); finish(false); } }, 4000);
    });
  }

  _send(activity) {
    if (!this.sock) return false;
    this.sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, ...(activity ? { activity } : {}) }, nonce: randomUUID() }));
    return true;
  }

  async setActivity(clientId, a) {
    this.activity = a ? toActivity(a) : null;
    await this.connect(clientId);
    return this._send(this.activity);
  }
}

/** Game-side activity → Discord's shape (field limits: 2-128 characters, 2 buttons). */
function toActivity(a) {
  const clip = (s) => (s == null ? undefined : String(s).slice(0, 128).padEnd(2, ' '));
  const act = { details: clip(a.details), state: clip(a.state), instance: false };
  if (a.start || a.end) act.timestamps = { ...(a.start ? { start: Math.round(a.start) } : {}), ...(a.end ? { end: Math.round(a.end) } : {}) };
  const large = /^https:\/\//.test(a.image || '') ? a.image : 'stemstage';
  act.assets = { large_image: large, large_text: clip(a.imageText || 'STEMSTAGE'), ...(a.small ? { small_image: a.small, small_text: clip(a.smallText) } : {}) };
  if (a.party) act.party = { id: String(a.party.id || 'band'), size: [a.party.size, a.party.max] };
  // a join secret gives the status Discord's Join / Ask to Join buttons (Discord doesn't allow link buttons with it)
  if (a.secret && act.party) act.secrets = { join: String(a.secret).slice(0, 128) };
  else {
    const given = (Array.isArray(a.buttons) ? a.buttons : []).filter((b) => b && /^https:\/\//.test(b.url || '') && b.label).slice(0, 2);
    act.buttons = given.length ? given.map((b) => ({ label: String(b.label).slice(0, 32), url: String(b.url).slice(0, 512) })) : [{ label: 'Get STEMSTAGE', url: 'https://stemstage.varconstint.com/' }];
  }
  for (const k of Object.keys(act)) if (act[k] === undefined) delete act[k];
  return act;
}

// ---------------------------------------------------------------- Lanyard (live status)
const presenceCache = new Map();
async function presence(id) {
  const hit = presenceCache.get(id);
  if (hit && Date.now() - hit.at < 15000) return hit.value;
  const r = await fetch(`https://api.lanyard.rest/v1/users/${id}`, { headers: { Accept: 'application/json', 'User-Agent': 'STEMSTAGE' }, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  let value;
  if (!j.success) value = { ok: false, error: j.error?.code === 'user_not_monitored' ? 'not_monitored' : (j.error?.message || `Lanyard ${r.status}`) };
  else {
    const d = j.data;
    const custom = d.activities?.find((x) => x.type === 4);
    const game = d.activities?.find((x) => x.type === 0);
    value = {
      ok: true, status: d.discord_status, // online | idle | dnd | offline
      user: { id: d.discord_user.id, username: d.discord_user.username, globalName: d.discord_user.global_name || null, avatar: d.discord_user.avatar || null },
      custom: custom ? { text: custom.state || '', emoji: custom.emoji?.name || '' } : null,
      playing: game ? { name: game.name, details: game.details || '', state: game.state || '' } : null,
      listening: d.listening_to_spotify && d.spotify ? { song: d.spotify.song, artist: d.spotify.artist } : null,
    };
  }
  presenceCache.set(id, { at: Date.now(), value });
  return value;
}

export function createDiscord() {
  const ipc = new DiscordIpc();
  const envId = process.env.STEMSTAGE_DISCORD_CLIENT_ID || '';
  const idFor = (x) => (ID_RE.test(x || '') ? x : envId);

  return async function handler(req, res) {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, 'http://local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'state' && req.method === 'GET') return send(res, 200, { ...ipc.state(), envClientId: !!envId });
      if (parts[0] === 'events' && req.method === 'GET') {
        // Server-Sent Events: friends joining through Discord
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': discord events\n\n');
        const off = ipc.listen((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { off(); clearInterval(ping); });
        // a game that just started (maybe by Discord, to deliver a join) connects to Discord right away
        const id = url.searchParams.get('clientId');
        if (ID_RE.test(id || '') || envId) ipc.connect(idFor(id));
        return;
      }
      if (parts[0] === 'connect' && req.method === 'POST') {
        const body = await readJsonBody(req, 1e4);
        return send(res, 200, await ipc.connect(idFor(body.clientId), { force: true }));
      }
      if (parts[0] === 'activity' && req.method === 'POST') {
        const body = await readJsonBody(req, 2e4);
        const ok = await ipc.setActivity(idFor(body.clientId), body.activity || null);
        return send(res, 200, { ok, ...ipc.state() });
      }
      if (parts[0] === 'me' && req.method === 'POST') {
        const { token } = await readJsonBody(req, 1e4);
        if (!/^[A-Za-z0-9._-]{10,200}$/.test(token || '')) return send(res, 400, { error: 'bad token' });
        const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'STEMSTAGE' }, signal: AbortSignal.timeout(10000) });
        const u = await r.json().catch(() => ({}));
        if (!r.ok) return send(res, r.status === 401 ? 401 : 502, { error: r.status === 401 ? 'Discord login expired — try again' : `Discord ${r.status}` });
        return send(res, 200, { id: u.id, username: u.username, globalName: u.global_name || null, avatar: u.avatar || null });
      }
      if (parts[0] === 'presence' && req.method === 'GET') {
        if (!ID_RE.test(parts[1] || '')) return send(res, 400, { error: 'bad Discord user id' });
        return send(res, 200, await presence(parts[1]));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e?.message || e) });
    }
  };
}
