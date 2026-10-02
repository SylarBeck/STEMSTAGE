// v2.0.0 room server: version check, kick + ban, lock, host options + seed in the start, spectators.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { after, test } from 'node:test';
import { WebSocket } from 'ws';
import { createOnline } from '../server/online.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const control = http.createServer(createOnline({}));
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
const controlUrl = `http://127.0.0.1:${control.address().port}`;
const roomPort = 52000 + Math.floor(Math.random() * 9000);
after(async () => {
  await fetch(`${controlUrl}/stop`, { method: 'POST' }).catch(() => {});
  await new Promise((resolve) => control.close(resolve));
});

let n = 0;
async function join(extra = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${roomPort}`);
  const messages = [];
  const listeners = [];
  ws.on('message', (raw) => { messages.push(JSON.parse(raw.toString())); for (const fn of [...listeners]) fn(); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const sessionId = `${String(++n).padStart(8, '0')}-1111-4111-8111-111111111111`;
  ws.send(JSON.stringify({ t: 'hello', name: `P${n}`, sessionId, version: VERSION, ...extra }));
  const next = (type) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2000);
    function check() {
      const i = messages.findIndex((m) => m.t === type);
      if (i < 0) return;
      clearTimeout(timer); listeners.splice(listeners.indexOf(check), 1);
      resolve(messages.splice(i, 1)[0]);
    }
    listeners.push(check); check();
  });
  return { ws, next, sessionId, send: (m) => ws.send(JSON.stringify(m)) };
}
const settle = () => new Promise((r) => setTimeout(r, 80));

test('v2 rooms: version, options, kick, lock, spectators, seed', async () => {
  const hosted = await (await fetch(`${controlUrl}/host`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: roomPort, internet: false }) })).json();
  const host = await join({ hostKey: hosted.hostKey });
  const hw = await host.next('welcome');
  assert.equal(hw.room.opts.stage, 'arena');

  // an older game is told to update
  const old = await join({ version: '1.8.9' });
  assert.match((await old.next('closed')).reason, /update/);

  // host options are validated
  host.send({ t: 'opts', opts: { stage: 'aquarium', gear: true, bosses: 'always', max: 3, autoStart: false } });
  host.send({ t: 'opts', opts: { stage: 'nowhere', max: 99 } });
  await settle();
  const info = (await (await fetch(`${controlUrl}/info`)).json()).room;
  assert.deepEqual([info.opts.stage, info.opts.gear, info.opts.bosses, info.opts.max], ['aquarium', true, 'always', 8]);

  // kick: the player is told, and can't come back
  const g1 = await join();
  const g1w = await g1.next('welcome');
  host.send({ t: 'kick', id: g1w.id });
  assert.match((await g1.next('closed')).reason, /removed/);
  const again = await join();
  again.ws.close();

  // lock
  host.send({ t: 'opts', opts: { locked: true } });
  await settle();
  const late = await join();
  assert.match((await late.next('closed')).reason, /locked/);
  host.send({ t: 'opts', opts: { locked: false } });

  // a spectator doesn't hold up the start and isn't in the lineup; the start carries a seed and the options
  const player = await join();
  const pw = await player.next('welcome');
  const watcher = await join();
  const ww = await watcher.next('welcome');
  watcher.send({ t: 'set', spectate: true });
  host.send({ t: 'select', song: { id: 'song1', title: 'T', instruments: ['guitar'] } });
  player.send({ t: 'have', songId: 'song1', ok: true });
  player.send({ t: 'set', ready: true });
  host.send({ t: 'set', ready: true });
  await settle();
  host.send({ t: 'start' });
  const start = await player.next('start');
  assert.ok(Number.isInteger(start.seed));
  assert.equal(start.opts.stage, 'aquarium');
  assert.ok(start.lineup.some((q) => q.id === pw.id));
  assert.ok(!start.lineup.some((q) => q.id === ww.id));
  for (const c of [host, player, watcher]) c.ws.close();
});
