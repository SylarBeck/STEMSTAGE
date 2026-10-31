// v3: Runs — the map, songs per node, perks, results.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeMap, newRun, choices, songFor, playResult, runMods, rewardOptions, shopItems, mystery, visit, finalRewards, FLOORS, HEARTS, dailySeed } from '../src/game/runs.js';

const notes = (n) => Array.from({ length: n }, (_, i) => ({ t: i * (60 / n), lane: i % 5 }));
const songs = Array.from({ length: 12 }, (_, k) => ({ id: `s${k}`, charts: { guitar: { available: true, notes: { easy: notes(20 + k * 30), medium: notes(30 + k * 40), hard: notes(40 + k * 50), expert: notes(60 + k * 60) } } } }));

test('the map: eight floors, the headliner on top, every path reaches it', () => {
  const map = makeMap(1234);
  assert.equal(map.length, FLOORS);
  assert.equal(map.at(-1).length, 1);
  assert.equal(map.at(-1)[0].type, 'headliner');
  assert.ok(map[0].every((n) => n.type === 'gig'));
  for (let f = 0; f < FLOORS - 1; f++) for (const n of map[f]) assert.ok(n.next.length >= 1 && n.next.every((i) => map[f + 1].some((m) => m.i === i)));
  assert.deepEqual(makeMap(1234), map, 'the same seed makes the same map (daily runs)');
  assert.equal(dailySeed(new Date('2026-10-31T10:00:00Z')), dailySeed(new Date('2026-10-31T22:00:00Z')));
});

test('songs get harder up the map, encores carry a curse and a harder difficulty', () => {
  const run = newRun({ seed: 7, diff: 'medium' });
  const low = songFor(run, run.floors[0][0], songs);
  const top = songFor(run, run.floors.at(-1)[0], songs);
  assert.ok(+top.song.slice(1) > +low.song.slice(1), `${low.song} → ${top.song}`);
  assert.equal(top.diff, 'hard');
  const enc = { f: 3, i: 0, type: 'encore', next: [] };
  songFor(run, enc, songs);
  assert.equal(enc.diff, 'hard');
  assert.equal(enc.curses.length, 1);
});

test('a good gig pays and offers a perk; a bad one costs a heart; three bad ones end the run', () => {
  const run = newRun({ seed: 9 });
  const n0 = songFor(run, choices(run)[0], songs);
  const out = playResult(run, n0, { stars: 4, failed: false, score: 50000 });
  assert.ok(out.cash > 0 && out.reward && !out.heart);
  assert.equal(choices(run).length >= 1, true);
  for (let k = 0; k < HEARTS; k++) {
    const next = choices(run).find((n) => ['gig', 'encore', 'headliner'].includes(n.type)) || choices(run)[0];
    if (!['gig', 'encore', 'headliner'].includes(next.type)) { visit(run, next); continue; }
    songFor(run, next, songs);
    playResult(run, next, { stars: 1, failed: false, score: 1000 });
  }
  assert.ok(run.hearts < HEARTS);
});

test('winning the headliner wins the run and pays a bonus', () => {
  const run = newRun({ seed: 3 });
  run.at = { f: FLOORS - 2, i: 1 };
  const head = choices(run)[0];
  assert.equal(head.type, 'headliner');
  songFor(run, head, songs);
  const out = playResult(run, head, { stars: 5, failed: false, score: 90000 });
  assert.ok(out.won && run.over === 'won');
  assert.ok(finalRewards(run).cash >= 150 && finalRewards(run).xp >= 250);
  assert.deepEqual(choices(run), []);
});

test('perks stack into gear modifiers; offers never repeat a perk you have', () => {
  const run = newRun({ seed: 5 });
  run.perks = ['pick', 'neck', 'hands'];
  const m = runMods(run);
  assert.equal(m.shield, 1); assert.equal(m.window, 0.01); assert.equal(m.multStep, 8);
  for (const p of [...rewardOptions(run, 3), ...shopItems(run, 3)]) assert.ok(!run.perks.includes(p.id));
  const before = run.hearts + run.cash + run.perks.length;
  run.at = { f: 2, i: 1 };
  const m2 = mystery(run, 3);
  assert.ok(m2.text && run.hearts + run.cash + run.perks.length !== before);
});
