// Online multiplayer room server. Started on demand from the game (POST /api/online/host).
//   internet mode: listens on 127.0.0.1 and is reached through a Cloudflare quick tunnel (no port forwarding,
//                  no firewall prompt); friends join with the tunnel's invite code.
//   LAN mode:      listens on 0.0.0.0 for friends on the same network.
// Endpoints:
//   WebSocket          room protocol (JSON messages, see below)
//   GET /info          room summary
//   GET /songs/<id>/song.json | /songs/<id>/stems/<stem>.wav | /songs/<id>/net/<stem> (compressed) | /songs/<id>/files/<file>
//
// Client -> server: hello{name,color,profileId,hostKey} · ping{c} · set{instrument,difficulty,ready} · select{song}
//                   mode{mode} (host) · have{songId,ok,progress} · start · rematch{want} · live{...}
//                   event{kind,target} · result{result} · chat{text}
// Server -> client: welcome{id,room} · pong{c,s} · room{room} · start{startAt,lineup,song,mode} · live{id,...}
//                   event{id,kind,target} · results{results,mode,winnerId,draw} · chat{from,text} · closed{reason}
//
// Match modes: versus (highest score wins), battle (versus + overdrive attacks the leader), band (co-op: one band
// score, overdrive saves bandmates). room.history keeps the last matches (for the lobby and rematches).
import http from 'node:http';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { send, isLocal, readJsonBody } from './library.js';
import { createTunnel } from './tunnel.js';

const COLORS = ['#ff2d7a', '#29e0ff', '#ffcf3a', '#3dff8a', '#b36bff', '#ff8a1a', '#2b8cff', '#ff5a5a'];
const MODES = ['versus', 'battle', 'band'];
const ATTACKS = ['mirror', 'fog', 'shake', 'drain'];
export const MAX_PLAYERS = 8;
const HISTORY = 20;
const HAIRS = ['short', 'long', 'mohawk', 'bun', 'shaved'], PARTS = ['guitar', 'bass', 'drums', 'keys'];
/** A player's character (src/profile/looks.js) as the other players get it: colours and names from known lists only. */
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);
  const out = { part: PARTS.includes(l.part) ? l.part : 'guitar', hair: HAIRS.includes(l.hair) ? l.hair : 'short' };
  for (const k of ['skin', 'hairColor', 'top', 'pants', 'finish']) { const v = hex(l[k]); if (!v) return null; out[k] = v; }
  return out;
}

export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
    }
  }
  return out;
}

export function createOnline(library) {
  let server = null, wss = null, port = 5180, room = null, resultsTimer = null, internet = false, hostKey = null;
  const tunnel = createTunnel();

  const summary = () => room && {
    code: room.code, phase: room.phase, song: room.song, startAt: room.startAt, mode: room.mode, max: MAX_PLAYERS,
    history: room.history, rematch: [...room.rematch],
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, profileId: p.profileId, host: p.host, instrument: p.instrument,
      difficulty: p.difficulty, ready: p.ready, hasSong: p.hasSong, loading: p.loading, connected: p.connected,
    })),
  };
  const sendTo = (p, msg) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
  const broadcast = (msg, except) => { for (const p of room.players.values()) if (p !== except) sendTo(p, msg); };
  const pushRoom = () => broadcast({ t: 'room', room: summary() });

  /** The winner of a versus / battle match: the highest score (a tie is a draw). */
  function verdict(mode, results) {
    if (mode === 'band' || results.length < 2) return { winnerId: null, draw: false };
    const sorted = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
    const draw = (sorted[0].score || 0) === (sorted[1].score || 0);
    return { winnerId: draw ? null : sorted[0].id, draw };
  }

  /** The match as the lobby's history shows it. */
  function remember(matchId, mode, song, results) {
    const v = verdict(mode, results);
    const entry = {
      matchId, mode, date: Date.now(), song: song ? { id: song.id, title: song.title, artist: song.artist } : null, ...v,
      bandScore: results.reduce((s, r) => s + (r.score || 0), 0),
      results: results.map((r) => ({ id: r.id, name: r.name, color: r.color, profileId: r.profileId || null, score: r.score || 0, stars: r.stars || 0,
        accuracy: r.accuracy || 0, instrument: r.instrument, difficulty: r.difficulty, fc: !!r.fc, failed: !!r.failed })),
    };
    const i = room.history.findIndex((h) => h.matchId === matchId);
    if (i >= 0) room.history[i] = entry; else room.history.unshift(entry);
    room.history.length = Math.min(room.history.length, HISTORY);
    return v;
  }

  function finishResults() {
    clearTimeout(resultsTimer);
    const results = [...room.players.values()].filter((p) => p.result).map((p) => ({ id: p.id, name: p.name, color: p.color, profileId: p.profileId, ...p.result }));
    room.lastResults = { matchId: room.matchId, mode: room.matchMode, song: room.song, results };
    const v = remember(room.matchId, room.matchMode, room.song, results);
    broadcast({ t: 'results', matchId: room.matchId, mode: room.matchMode, results, ...v });
    room.phase = 'lobby';
    room.rematch.clear();
    for (const p of room.players.values()) { p.ready = false; p.result = null; }
    pushRoom();
  }

  /** Start a match with everyone who has the song. */
  function startMatch() {
    const lineup = [...room.players.values()].filter((q) => q.connected && q.hasSong);
    room.phase = 'playing';
    room.startAt = Date.now() + 5000;
    room.matchId = `m${Date.now().toString(36)}`;
    room.matchMode = room.mode;
    room.lastResults = null;
    room.rematch.clear();
    for (const q of room.players.values()) { q.result = null; q.playing = lineup.includes(q); }
    broadcast({ t: 'start', matchId: room.matchId, startAt: room.startAt, song: room.song, mode: room.mode, lineup: lineup.map((q) => ({ id: q.id, name: q.name, color: q.color, profileId: q.profileId, instrument: q.instrument, difficulty: q.difficulty, look: q.look })) });
    pushRoom();
  }

  function onMessage(p, msg) {
    switch (msg.t) {
      case 'ping': sendTo(p, { t: 'pong', c: msg.c, s: Date.now() }); break;
      case 'set':
        if (room.phase !== 'lobby') break;
        if (typeof msg.instrument === 'string') p.instrument = msg.instrument.slice(0, 12);
        if (typeof msg.difficulty === 'string') p.difficulty = msg.difficulty.slice(0, 12);
        if (typeof msg.ready === 'boolean') p.ready = msg.ready;
        pushRoom();
        break;
      case 'mode':
        if (!p.host || room.phase !== 'lobby' || !MODES.includes(msg.mode)) break;
        room.mode = msg.mode;
        room.rematch.clear();
        pushRoom();
        break;
      case 'select':
        if (!p.host || room.phase !== 'lobby' || !msg.song?.id) break;
        room.rematch.clear();
        library.prepareForNet?.(String(msg.song.id)).catch(() => {}); // compress stems for friends in the background
        room.song = { id: String(msg.song.id).slice(0, 80), title: String(msg.song.title || '').slice(0, 120), artist: String(msg.song.artist || '').slice(0, 120), duration: +msg.song.duration || 0, instruments: msg.song.instruments || [], rev: String(msg.song.rev || '').slice(0, 32) };
        for (const q of room.players.values()) { q.ready = false; q.hasSong = q.host; q.loading = 0; }
        pushRoom();
        break;
      case 'have':
        if (room.song && msg.songId === room.song.id) { p.hasSong = !!msg.ok; p.loading = msg.ok ? 1 : +msg.progress || 0; pushRoom(); }
        break;
      case 'start':
        if (!p.host || room.phase !== 'lobby' || !room.song) break;
        startMatch();
        break;
      case 'rematch': {
        // the same song again: it starts by itself once everyone who has the song wants it
        if (room.phase !== 'lobby' || !room.song || !room.history.length || !p.hasSong) break;
        if (msg.want === false) room.rematch.delete(p.id); else room.rematch.add(p.id);
        const everyone = [...room.players.values()].filter((q) => q.connected && q.hasSong);
        if (everyone.length && everyone.every((q) => room.rematch.has(q.id))) startMatch();
        else pushRoom();
        break;
      }
      case 'live': if (room.phase === 'playing') broadcast({ ...msg, t: 'live', id: p.id }, p); break;
      case 'event': {
        const kind = String(msg.kind).slice(0, 20);
        // a battle attack names its target and what it does; anything else carries no payload
        const target = kind === 'attack' && room.matchMode === 'battle' && room.players.has(msg.target?.to) && ATTACKS.includes(msg.target?.a)
          ? { to: msg.target.to, a: msg.target.a } : undefined;
        if (kind === 'attack' && !target) break;
        broadcast({ t: 'event', id: p.id, kind, target }, p);
        break;
      }
      case 'result':
        if (room.phase !== 'playing') {
          // a late finisher: merge into the published results and re-broadcast
          const last = room.lastResults;
          if (last && p.playing && !last.results.some((r) => r.id === p.id)) {
            last.results.push({ id: p.id, name: p.name, color: p.color, profileId: p.profileId, ...(msg.result || {}) });
            const v = remember(last.matchId, last.mode, last.song, last.results);
            broadcast({ t: 'results', matchId: last.matchId, mode: last.mode, results: last.results, ...v, update: true });
            pushRoom();
          }
          break;
        }
        p.result = msg.result || {};
        if ([...room.players.values()].filter((q) => q.playing && q.connected).every((q) => q.result)) finishResults();
        else { clearTimeout(resultsTimer); resultsTimer = setTimeout(finishResults, 20000); }
        break;
      case 'chat': broadcast({ t: 'chat', from: p.name, color: p.color, text: String(msg.text || '').slice(0, 200) }); break;
      default: break;
    }
  }

  function start(wantPort = 5180, hostName = 'Host', wantInternet = true) {
    if (server && internet === wantInternet) {
      if (internet && tunnel.info.status === 'error') tunnel.start(port); // 'Try again' after a failed tunnel
      return Promise.resolve(info(true));
    }
    if (server) stop();
    port = wantPort;
    internet = wantInternet;
    if (!internet) tunnel.stop();
    hostKey = crypto.randomBytes(16).toString('hex');
    room = { code: Math.random().toString(36).slice(2, 6).toUpperCase(), phase: 'lobby', song: null, players: new Map(), startAt: 0, hostName, mode: 'versus', history: [], rematch: new Set() };
    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Access-Control-Allow-Headers', '*'); return res.end(); }
      if (req.method !== 'GET') return send(res, 405, { error: 'read only' });
      const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'info') return send(res, 200, { name: 'STEMSTAGE', room: summary() });
      if (parts[0] === 'songs' && parts[1]) return library.serveRead(res, parts[1], parts[2], parts[3]);
      return send(res, 404, { error: 'not found' });
    });
    wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
    wss.on('error', (e) => console.warn('[online] websocket server error:', e.message)); // never let an error event crash Vite
    let seq = 0;
    wss.on('connection', (ws, req) => {
      let p = null;
      ws.on('error', () => { /* client vanished */ });
      ws.on('message', (raw) => {
        if (!room) return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!p) {
          if (msg.t !== 'hello') return;
          // the host proves itself with the key it got from the local control API (tunnel visitors also look "local")
          const host = !!msg.hostKey && msg.hostKey === hostKey && ![...room.players.values()].some((q) => q.host && q.connected);
          if (!host && room.players.size >= MAX_PLAYERS) { try { ws.send(JSON.stringify({ t: 'closed', reason: `This room is full (${MAX_PLAYERS} players)` })); ws.close(); } catch { /* gone */ } return; }
          p = {
            id: `p${++seq}`, ws, host, connected: true, name: String(msg.name || 'Player').slice(0, 24), profileId: msg.profileId || null, look: cleanLook(msg.look),
            color: /^#[0-9a-f]{6}$/i.test(msg.color || '') ? msg.color : COLORS[(seq - 1) % COLORS.length],
            instrument: 'guitar', difficulty: 'medium', ready: false, hasSong: false, loading: 0, result: null,
          };
          room.players.set(p.id, p);
          sendTo(p, { t: 'welcome', id: p.id, host, room: summary(), serverTime: Date.now() });
          pushRoom();
          return;
        }
        onMessage(p, msg);
      });
      ws.on('close', () => {
        if (!p || !room) return;
        p.connected = false;
        room.players.delete(p.id);
        room.rematch.delete(p.id);
        broadcast({ t: 'event', id: p.id, kind: 'left' });
        if (room.phase === 'playing' && [...room.players.values()].filter((q) => q.playing).every((q) => q.result)) finishResults();
        const rest = [...room.players.values()].filter((q) => q.connected && q.hasSong);
        if (room.phase === 'lobby' && room.rematch.size && rest.length && rest.every((q) => room.rematch.has(q.id))) { startMatch(); return; }
        pushRoom();
      });
    });
    return new Promise((resolve, reject) => {
      server.once('error', (e) => {
        try { wss.close(); } catch { /* ignore */ }
        server = null; wss = null; room = null;
        reject(e);
      });
      server.listen(port, internet ? '127.0.0.1' : '0.0.0.0', () => {
        if (internet) tunnel.start(port);
        resolve(info(true));
      });
    });
  }

  function stop() {
    if (!server) { tunnel.stop(); return; }
    for (const p of room.players.values()) { try { sendTo(p, { t: 'closed', reason: 'Host closed the room' }); p.ws.close(); } catch { /* gone */ } }
    wss.close();
    server.close();
    server = null; wss = null; room = null;
    // give the goodbye messages a moment to get through the tunnel before closing it
    if (internet) { const t = tunnel; setTimeout(() => { if (!server) t.stop(); }, 600); } else tunnel.stop();
  }

  const info = (withKey = false) => ({
    hosting: !!server, port, internet, tunnel: internet ? tunnel.info : null,
    addresses: internet ? [] : lanAddresses(), room: summary(), ...(withKey ? { hostKey } : {}),
  });

  return async function handler(req, res) {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const name = new URL(req.url, 'http://local').pathname.split('/').filter(Boolean)[0];
      if (name === 'info') return send(res, 200, info(true));
      if (name === 'host' && req.method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        return send(res, 200, await start(+body.port || 5180, body.name, body.internet !== false));
      }
      if (name === 'stop' && req.method === 'POST') { stop(); return send(res, 200, info()); }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.code === 'EADDRINUSE' ? `Port ${port} is already in use` : String(e?.message || e) });
    }
  };
}
