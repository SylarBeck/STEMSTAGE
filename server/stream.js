// Stream mode: a small relay between the game, OBS overlays and Twitch chat.
//   Twitch chat is read anonymously (wss://irc-ws.chat.twitch.tv as "justinfan…": read-only, no login).
//   Chat commands (!vote, !sr, !hype) go to the game; the game publishes its state for the overlays.
// Endpoints (mounted at /api/stream):
//   GET  /events?role=game|overlay   Server-Sent Events (game: chat; overlay: state)
//   POST /publish                    { state } from the game → overlays
//   POST /connect                    { channel } join a Twitch channel ('' = disconnect)
//   GET  /status                     { channel, status, error, overlays }
import WebSocket from 'ws';
import { send, isLocal, readJsonBody } from './library.js';

export function createStream() {
  const clients = { game: new Set(), overlay: new Set() };
  let last = { mode: 'idle' };
  let irc = null, channel = '', status = 'off', error = null, retry = null, retries = 0;

  function emit(role, event, data) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients[role]) { try { res.write(line); } catch { /* closed */ } }
  }
  const statusInfo = () => ({ channel, status, error, overlays: clients.overlay.size });
  const pushStatus = () => emit('game', 'status', statusInfo());

  // ---------------------------------------------------------------- Twitch chat (anonymous IRC over WebSocket)
  function connect(ch) {
    disconnect();
    channel = String(ch || '').trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
    if (!channel) { pushStatus(); return; }
    status = 'connecting'; error = null;
    pushStatus();
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    irc = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    });
    ws.on('message', (buf) => {
      for (const line of String(buf).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
        if (/ 366 /.test(line) || / JOIN #/.test(line)) { if (status !== 'connected') { status = 'connected'; retries = 0; pushStatus(); } continue; }
        const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/.exec(line);
        if (!m) continue;
        const tags = Object.fromEntries((m[1] || '').split(';').map((kv) => kv.split('=')));
        const text = m[3].trim();
        if (!text.startsWith('!')) continue; // only commands reach the game
        emit('game', 'chat', { user: tags['display-name'] || m[2], color: tags.color || null, text: text.slice(0, 200), mod: tags.mod === '1' || (tags.badges || '').includes('broadcaster') });
      }
    });
    ws.on('close', () => {
      if (irc !== ws) return;
      irc = null;
      status = 'off';
      pushStatus();
      if (channel && retries < 6) { retries++; retry = setTimeout(() => connect(channel), 2000 * retries); }
    });
    ws.on('error', (e) => { error = e.message; });
  }

  function disconnect() {
    clearTimeout(retry);
    const ws = irc;
    irc = null;
    try { ws?.close(); } catch { /* closed */ }
    status = 'off';
  }

  // ---------------------------------------------------------------- HTTP
  const handler = async (req, res) => {
    try {
      if (!isLocal(req)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, 'http://local');
      const name = url.pathname.split('/').filter(Boolean)[0];
      if (name === 'events' && req.method === 'GET') {
        const role = url.searchParams.get('role') === 'game' ? 'game' : 'overlay';
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); // the overlay is served from here too
        res.write(`event: hello\ndata: ${JSON.stringify(role === 'game' ? statusInfo() : last)}\n\n`);
        clients[role].add(res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
        req.on('close', () => { clearInterval(ping); clients[role].delete(res); if (role === 'overlay') pushStatus(); });
        if (role === 'overlay') pushStatus();
        return;
      }
      if (name === 'publish' && req.method === 'POST') {
        last = await readJsonBody(req, 1e6);
        emit('overlay', 'state', last);
        return send(res, 200, { ok: true });
      }
      if (name === 'connect' && req.method === 'POST') {
        const body = await readJsonBody(req);
        connect(body.channel);
        return send(res, 200, statusInfo());
      }
      if (name === 'status') return send(res, 200, statusInfo());
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e?.message || e) });
    }
  };
  return { handler, connect, disconnect };
}
