// v3: freestyle solos — key finding, lane notes, sample picking, grading.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateKey, laneNotes, pickSamples, gradeFreestyle } from '../src/audio/freestyle.js';

test('the key comes from the notes: A minor and C major', () => {
  const aMinor = [57, 60, 62, 64, 67, 69, 69, 72, 64, 57, 60, 57].map((m) => ({ m, len: 0.2 }));
  assert.deepEqual(estimateKey(aMinor), { tonic: 9, mode: 'minor' });
  const cMajor = [60, 64, 67, 72, 65, 69, 60, 62, 64, 67, 60, 71].map((m) => ({ m, len: 0.2 }));
  assert.deepEqual(estimateKey(cMajor), { tonic: 0, mode: 'major' });
});

test('five rising pentatonic notes around the solo', () => {
  const lanes = laneNotes({ tonic: 9, mode: 'minor' }, 69);
  assert.equal(lanes.length, 5);
  for (let i = 1; i < 5; i++) assert.ok(lanes[i] > lanes[i - 1]);
  for (const m of lanes) assert.ok([0, 3, 5, 7, 10].includes((m - 9 + 120) % 12));
  assert.ok(lanes[0] <= 69 && lanes[4] >= 69);
});

test('samples are clean single notes with room after them, the longest take of each pitch', () => {
  const g = (t, ...ms) => ({ t, notes: ms.map((m) => ({ m })) });
  const groups = [g(1, 60), g(1.1, 62), g(1.6, 64, 67), g(2.2, 60)];
  const s = pickSamples(groups, (k) => groups[k].t, 4);
  assert.ok(!s.has(62) || s.get(62).len >= 0.15);     // 62 has 0.5 s after it
  assert.ok(!s.has(64) && !s.has(67), 'chords are skipped');
  assert.equal(s.get(60).from, 2.2 - 0.004);          // the second 60 rings longer than the first (cut at 1.1)
});

test('grading rewards a groovy, moving line over mashing one fret', () => {
  const beats = Array.from({ length: 64 }, (_, i) => i * 0.5);
  const line = Array.from({ length: 24 }, (_, i) => ({ t: 4 + i * 0.25, lane: [0, 1, 2, 3, 4, 3, 2, 1][i % 8] }));
  const mash = Array.from({ length: 80 }, (_, i) => ({ t: 4 + i * 0.077, lane: 2 }));
  const good = gradeFreestyle(line, beats, 4, 10), bad = gradeFreestyle(mash, beats, 4, 10);
  assert.ok(good.grade > 0.85, `line ${good.grade}`);
  assert.ok(bad.grade < 0.5, `mash ${bad.grade}`);
  assert.equal(gradeFreestyle([], beats, 4, 10).grade, 0);
});
