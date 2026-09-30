import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { WebSocket } from 'ws';
import { createOnline } from '../server/online.js';

const control = http.createServer(createOnline({}));
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
const controlUrl = `http://127.0.0.1:${control.address().port}`;
const roomPort = 51000 + Math.floor(Math.random() * 10000);
after(async () => {
  await fetch(`${controlUrl}/stop`, { method: 'POST' }).catch(() => {});
  await new Promise((resolve) => control.close(resolve));
});

async function roomInfo() {
  return (await (await fetch(`${controlUrl}/info`)).json()).room;
}

async function join(sessionId, hostKey = null) {
  const ws = new WebSocket(`ws://127.0.0.1:${roomPort}`);
  const messages = [];
  const listeners = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const fn of listeners) fn();
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ t: 'hello', name: sessionId, sessionId, hostKey }));
  const next = (type) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.splice(listeners.indexOf(check), 1); reject(new Error(`Timed out waiting for ${type}`)); }, 2000);
    function check() {
      const i = messages.findIndex((message) => message.t === type);
      if (i < 0) return;
      clearTimeout(timer); listeners.splice(listeners.indexOf(check), 1);
      resolve(messages.splice(i, 1)[0]);
    }
    listeners.push(check); check();
  });
  return { ws, next, send: (message) => ws.send(JSON.stringify(message)) };
}

test('ready gate, reaction relay, and reconnecting as a spectator', async () => {
  const hosted = await (await fetch(`${controlUrl}/host`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: roomPort, name: 'Host', internet: false }),
  })).json();
  const host = await join('11111111-1111-4111-8111-111111111111', hosted.hostKey);
  const hw = await host.next('welcome');
  const guest = await join('22222222-2222-4222-8222-222222222222');
  const gw = await guest.next('welcome');
  host.send({ t: 'select', song: { id: 'song1', title: 'Test', instruments: ['guitar'] } });
  guest.send({ t: 'have', songId: 'song1', ok: true });
  host.send({ t: 'set', ready: true });
  host.send({ t: 'start' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await roomInfo()).phase, 'lobby');
  guest.send({ t: 'set', ready: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  host.send({ t: 'start' });
  assert.equal((await host.next('start')).lineup.length, 2);
  guest.ws.close();
  await new Promise((resolve) => guest.ws.once('close', resolve));
  const returned = await join('22222222-2222-4222-8222-222222222222');
  const welcome = await returned.next('welcome');
  assert.equal(welcome.id, gw.id);
  assert.equal(welcome.room.players.find((p) => p.id === gw.id).spectator, true);
  returned.send({ t: 'react', emoji: '👏' });
  assert.equal((await host.next('react')).emoji, '👏');
  host.send({ t: 'result', result: { score: 1200, stars: 3 } });
  await host.next('results');
  assert.equal((await roomInfo()).phase, 'lobby');
  host.send({ t: 'rematch', want: true });
  returned.send({ t: 'rematch', want: true });
  assert.equal((await host.next('start')).lineup.length, 2);
  assert.equal(hw.host, true);
  returned.ws.close(); host.ws.close();
});
