// Online multiplayer client: room connection (invite code over the internet, or a LAN address), clock sync
// with the host, lobby state, song download from the host, and live score relay during a match.
import { getSong, copySongFrom } from '../storage/library.js';

/**
 * What the player typed → the room's base URL.
 *   "mean-assist-lately-dim" (invite code)  → https://mean-assist-lately-dim.trycloudflare.com
 *   "https://…" / "…trycloudflare.com"       → as given (https)
 *   "192.168.1.20" / "192.168.1.20:5180"    → http://192.168.1.20:5180 (LAN)
 */
export function roomUrl(input) {
  // the words may be typed with spaces or dashes between them
  let s = String(input || '').trim().replace(/\/+$/, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s.toLowerCase().startsWith('http://') ? s : `https://${s.slice(8).toLowerCase()}`;
  if (/trycloudflare\.com$/i.test(s)) return `https://${s.toLowerCase()}`;
  if (/^[a-z]+(-[a-z]+){1,}$/i.test(s)) return `https://${s.toLowerCase()}.trycloudflare.com`;
  if (!/:\d+$/.test(s)) s += ':5180';
  return `http://${s}`;
}
/** Invite code shown to the host (the tunnel's words). */
export const inviteCode = (url) => (/^https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i.exec(url || '')?.[1] || '').toUpperCase();

export class OnlineClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.host = false;
    this.room = null;
    this.address = null;
    this.offset = 0;       // serverTime ≈ performance.now() + offset
    this.bestRtt = Infinity;
    this.listeners = new Map();
    this.remoteLive = new Map();
    this.syncing = null;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }
  emit(type, ...args) { this.listeners.get(type)?.forEach((fn) => fn(...args)); }

  get connected() { return this.ws?.readyState === 1; }
  get me() { return this.room?.players.find((p) => p.id === this.id) || null; }
  get baseUrl() { return this.base; }
  serverNow() { return performance.now() + this.offset; }

  /**
   * address: an invite code, a room URL, or a LAN address ("127.0.0.1:5180" for the host itself).
   * A brand-new internet room can take a few seconds to become reachable, so keep retrying for a while.
   */
  async connect(address, { name, color, profileId, hostKey = null }) {
    const base = roomUrl(address);
    if (!base) throw new Error('Enter an invite code');
    const remote = base.startsWith('https://');
    const deadline = performance.now() + (remote ? 30000 : 4000);
    let lastErr;
    for (let attempt = 0; performance.now() < deadline; attempt++) {
      try { return await this._open(base, { name, color, profileId, hostKey }); } catch (e) { lastErr = e; }
      if (this.cancelled) break;
      this.emit('connecting', attempt + 1);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(remote ? `No room found for "${inviteCode(base) || address}" — check the code, or ask the host if their room is still open` : (lastErr?.message || `Could not connect to ${address}`));
  }

  _open(base, { name, color, profileId, hostKey }) {
    this.close();
    this.cancelled = false;
    this.base = base;
    this.address = base.replace(/^https?:\/\//, '');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace(/^http/, 'ws'));
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); reject(new Error(`No STEMSTAGE room answered at ${this.address}`)); }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, color, profileId, hostKey }));
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`Could not connect to ${this.address}`)); };
      ws.onclose = () => {
        clearTimeout(timer);
        clearInterval(this.pingTimer);
        // only a room we were actually in counts as a disconnect (not a failed join attempt)
        if (this.ws === ws) { const was = !!this.id; this.ws = null; this.room = null; this.id = null; if (was) this.emit('disconnected'); }
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          this.id = msg.id; this.host = msg.host; this.room = msg.room;
          this.bestRtt = Infinity;
          this._ping(); setTimeout(() => this._ping(), 300); setTimeout(() => this._ping(), 700);
          this.pingTimer = setInterval(() => this._ping(), 3000);
          resolve(this);
          this.emit('room', this.room);
          if (this.room.song) this._syncSong(this.room.song); // joined after the host already picked a song
          return;
        }
        this._handle(msg);
      };
    });
  }

  _ping() { this.send({ t: 'ping', c: performance.now() }); }

  _handle(msg) {
    switch (msg.t) {
      case 'pong': {
        const now = performance.now();
        const rtt = now - msg.c;
        if (rtt <= this.bestRtt * 1.5) { // keep the estimate from the fastest round trips
          this.bestRtt = Math.min(this.bestRtt, rtt);
          const est = msg.s - (msg.c + rtt / 2);
          this.offset = this.offsetInit ? this.offset * 0.7 + est * 0.3 : est;
          this.offsetInit = true;
        }
        this.rtt = rtt;
        break;
      }
      case 'room': {
        const prevSong = this.room?.song?.id;
        this.room = msg.room;
        this.emit('room', this.room);
        if (this.room.song && this.room.song.id !== prevSong) this._syncSong(this.room.song);
        break;
      }
      case 'start': this.remoteLive.clear(); this.matchId = msg.matchId; this.lastResults = null; this.emit('start', msg); break;
      case 'live': this.remoteLive.set(msg.id, msg); this.emit('live', msg); break;
      case 'event': this.emit('event', msg); break;
      case 'results': this.lastResults = { matchId: msg.matchId, results: msg.results }; this.emit('results', msg.results, msg); break;
      case 'chat': this.emit('chat', msg); break;
      case 'closed': this.emit('closed', msg.reason); break;
      default: break;
    }
  }

  /** Make sure the selected song exists locally; download it from the host if not. */
  async _syncSong(song) {
    const token = (this.syncing = {});
    const local = await getSong(song.id);
    if (local) { this.send({ t: 'have', songId: song.id, ok: true }); this.emit('song-ready', local); return; }
    if (this.host) return;
    try {
      this.send({ t: 'have', songId: song.id, ok: false, progress: 0 });
      let last = 0;
      const copied = await copySongFrom(this.baseUrl, song.id, (p) => {
        if (token !== this.syncing) return;
        if (p - last > 0.05 || p === 1) { last = p; this.send({ t: 'have', songId: song.id, ok: false, progress: p }); this.emit('song-progress', p); }
      });
      if (token !== this.syncing) return;
      this.send({ t: 'have', songId: song.id, ok: true });
      this.emit('song-ready', copied);
    } catch (e) {
      this.emit('error', `Couldn't download "${song.title}" from the host: ${e.message}`);
    }
  }

  send(msg) { if (this.connected) this.ws.send(JSON.stringify(msg)); }
  set(fields) { this.send({ t: 'set', ...fields }); }
  select(song) { this.send({ t: 'select', song }); }
  start() { this.send({ t: 'start' }); }
  live(state) { this.send({ t: 'live', ...state }); }
  event(kind, target) { this.send({ t: 'event', kind, target }); }
  result(result) { this.send({ t: 'result', result }); }
  chat(text) { this.send({ t: 'chat', text }); }

  close() {
    this.cancelled = true;
    clearInterval(this.pingTimer);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* closed */ } }
    this.room = null; this.id = null; this.host = false;
  }
}

export const online = new OnlineClient();

// ---------------------------------------------------------------- host controls (local server)
export async function hostInfo() {
  try { return await (await fetch('/api/online/info')).json(); } catch { return { hosting: false, addresses: [] }; }
}

/** internet: true = invite code through a Cloudflare tunnel (no port forwarding), false = LAN only */
export async function startHosting(name, internet = true) {
  const r = await fetch('/api/online/host', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: 5180, name, internet }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Could not start hosting');
  return j;
}

export async function stopHosting() {
  await fetch('/api/online/stop', { method: 'POST' }).catch(() => {});
}
