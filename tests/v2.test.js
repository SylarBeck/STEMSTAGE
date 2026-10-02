// v2.0.0: bosses, gear modifiers, looks, matchmaking ranking.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planBoss, BossFight, seededRandom } from '../src/game/boss.js';
import { gearMods, changesPlay, cleanMods, setRigPart, PEDALS } from '../src/profile/rig.js';
import { cleanLook, fromPreset, lockedPieces } from '../src/profile/looks.js';
import { pickRoom, scoreRoom } from '../cloud/src/match.js';

const beats = Array.from({ length: 400 }, (_, i) => i * 0.5);
const notes = Array.from({ length: 300 }, (_, i) => ({ t: 4 + i * 0.6, lane: i % 5 }));
const song = { id: 'song-x', beats, downbeat: 0 };

test('boss plans are deterministic per seed and stay inside the song', () => {
  const a = planBoss({ bossId: 'leviathan', song, notes: [notes], seed: 42, mode: 'always' });
  const b = planBoss({ bossId: 'leviathan', song, notes: [notes], seed: 42, mode: 'always' });
  assert.deepEqual(a, b);
  assert.ok(a.start > notes[0].t && a.end < notes.at(-1).t && a.end - a.start >= 18);
  assert.ok(a.attacks.length > 0 && a.attacks.every((x) => x.t > a.start && x.t < a.end));
  assert.equal(planBoss({ bossId: 'leviathan', song, notes: [notes], seed: 42, mode: 'off' }), null);
  assert.equal(planBoss({ bossId: 'leviathan', song, notes: [notes.slice(0, 10)], seed: 1, mode: 'always' }), null);
  const rnd = seededRandom(7);
  assert.ok([1, 2, 3].map(() => rnd()).every((x) => x >= 0 && x < 1));
});

test('a boss fight: hits damage it, misses heal it, it dies or escapes', () => {
  const plan = planBoss({ bossId: 'titan', song, notes: [notes], seed: 3, mode: 'always' });
  const hud = { boss() {}, bossWarn() {}, bossEnd: (won) => { hud.won = won; }, callout() {} };
  const session = { players: [{ notes }], hud, stage: { world: null, setShot() {}, pyro() {}, sparks() {}, confettiBurst() {} }, engine: { songTime: plan.start + 10 }, bossAttack() {}, clearHazards() {} };
  const f = new BossFight(session, plan);
  f.update(plan.start - 3); f.update(plan.start);
  assert.equal(f.state, 'fight');
  const p = { streak: 0, odActive: false, gear: { boss: 0 } };
  f.hit(p, 'perfect');
  const after = f.hp;
  f.miss(p);
  assert.ok(f.hp > after, 'a miss heals');
  while (f.hp > 0) f.hit({ ...p, odActive: true }, 'perfect');
  assert.equal(f.state, 'defeated');
  assert.equal(hud.won, true);
  assert.equal(f.result().outcome, 'defeated');
  const g = new BossFight(session, plan);
  g.update(plan.start); g.update(plan.end + 1);
  assert.equal(g.result().outcome, 'escaped');
});

test('gear: components and pedals add up, with caps; cash alone is not play-changing', () => {
  const p = { xp: 0, owned: { 'pedal.fuzz': 1, 'pedal.merch': 1 }, rig: {} };
  setRigPart(p, 'guitar', { comps: { pickups: 5, amp: 2 } });
  p.rig.pedals = ['fuzz', 'merch'];
  const m = gearMods(p, 'guitar', 20);
  assert.ok(Math.abs(m.odGain - (5 * 0.05 + 0.15)) < 1e-9);
  assert.ok(m.cash > 0 && changesPlay(m));
  assert.equal(changesPlay(gearMods({ rig: { pedals: ['merch'] }, owned: { 'pedal.merch': 1 } }, 'bass', 1)), false);
  // one pedal slot at level 1: only the first pedal counts
  assert.equal(gearMods(p, 'guitar', 1).cash, 0);
  assert.equal(cleanMods({ window: 9, shield: 99, multStep: 2 }).window, 0.012);
  assert.ok(PEDALS.every((x) => x.req && x.mod));
});

test('looks: v1 looks still load, presets report locked pieces', () => {
  const old = cleanLook({ part: 'bass', skin: '#e0ac85', hair: 'mohawk', hairColor: '#c8322a', top: '#15120e', pants: '#2447d8', finish: '#f0b429' });
  assert.equal(old.part, 'bass');
  assert.equal(old.topStyle, 'tee');
  assert.equal(cleanLook({ hair: '<script>' }).hair, 'short');
  const cyber = fromPreset('cyber');
  assert.ok(lockedPieces(cyber, () => false).includes('eyes'));
  assert.equal(lockedPieces(cyber, () => true).length, 0);
});

test('matchmaking prefers close ratings, same continent, fuller rooms; refuses full/started/other versions', () => {
  const rooms = [
    { code: 'A', mode: 'versus', players: 1, max: 8, rating: 1400, version: '2.0.0', continent: 'EU' },
    { code: 'B', mode: 'versus', players: 3, max: 8, rating: 1050, version: '2.0.0', continent: 'NA' },
    { code: 'C', mode: 'versus', players: 2, max: 8, rating: 1020, version: '2.0.0', continent: 'EU' },
    { code: 'D', mode: 'versus', players: 8, max: 8, rating: 1000, version: '2.0.0', continent: 'EU' },
    { code: 'E', mode: 'versus', players: 2, max: 8, rating: 1000, version: '1.8.9', continent: 'EU' },
    { code: 'F', mode: 'band', players: 2, max: 8, rating: 1000, version: '2.0.0', continent: 'EU' },
  ];
  const want = { mode: 'versus', rating: 1000, version: '2.0.3', continent: 'EU', waited: 0 };
  assert.equal(pickRoom(rooms, want).code, 'C');
  assert.equal(scoreRoom(rooms[3], want), null);
  assert.equal(scoreRoom(rooms[4], want), null);
  assert.equal(scoreRoom(rooms[0], want), null, 'too far in rating at first');
  assert.ok(scoreRoom(rooms[0], { ...want, waited: 10 }) !== null, 'the window widens while you wait');
  assert.equal(pickRoom(rooms, { ...want, mode: 'band' }).code, 'F');
});
