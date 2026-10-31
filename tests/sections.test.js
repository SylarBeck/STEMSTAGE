// v3: song sections from charts, and the charter's finer snapping.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSections, sectionAt } from '../src/game/sections.js';
import { Grid, snapToGrid, SNAP_TOLERANCE } from '../src/audio/charter.js';

const BEAT = 0.5;
const beats = Array.from({ length: 4 * 120 }, (_, i) => i * BEAT);
const bar = (b) => b * 4 * BEAT;
// a song by bars: [from, to, { part: notes per bar, sing, pitch }]
function song(plan) {
  const parts = { guitar: [], bass: [], drums: [], keys: [], vocals: [] };
  for (const [from, to, spec] of plan) {
    for (let b = from; b < to; b++) {
      for (const [inst, n] of Object.entries(spec)) {
        if (!(inst in parts)) continue;
        for (let k = 0; k < n; k++) parts[inst].push({ t: bar(b) + (k * 4 * BEAT) / n, lane: k % 5, len: 0, m: (spec.pitch ?? 60) + (inst === 'vocals' ? 12 : 0) + (k % 3) * 4 });
      }
    }
  }
  const charts = Object.fromEntries(Object.entries(parts).map(([inst, notes]) => [inst, { available: notes.length > 0, notes: { expert: notes } }]));
  return { beats, downbeat: 0, duration: beats.at(-1), charts };
}

test('verses, choruses and a guitar solo come out of the charts', () => {
  const verse = { guitar: 4, bass: 4, drums: 8, vocals: 6, pitch: 57 };
  const chorus = { guitar: 8, bass: 8, drums: 16, vocals: 8, pitch: 64 };
  const s = song([
    [0, 4, { guitar: 4, drums: 4, pitch: 57 }],
    [4, 12, verse], [12, 20, chorus], [20, 28, verse], [28, 36, chorus],
    [36, 44, { guitar: 16, bass: 4, drums: 8, pitch: 69 }],
    [44, 52, chorus], [52, 56, { guitar: 2, drums: 2, pitch: 57 }],
  ]);
  const secs = detectSections(s);
  const at = (b) => sectionAt(secs, bar(b) + 0.1)?.kind;
  assert.equal(at(1), 'intro');
  assert.equal(at(6), 'verse');
  assert.equal(at(14), 'chorus');
  assert.equal(at(22), 'verse');
  assert.equal(at(30), 'chorus');
  assert.equal(at(40), 'solo');
  assert.equal(sectionAt(secs, bar(40) + 0.1).name, 'Guitar solo');
  assert.equal(at(54), 'outro');
  assert.deepEqual(secs.filter((x) => x.kind === 'chorus').map((x) => x.name), ['Chorus 1', 'Chorus 2', 'Chorus 3']);
});

test('an instrumental opening is an intro, not a solo; tiny songs have no sections', () => {
  const s = song([[0, 8, { guitar: 16, drums: 8, pitch: 69 }], [8, 24, { guitar: 4, bass: 4, drums: 8, vocals: 6, pitch: 57 }]]);
  assert.notEqual(sectionAt(detectSections(s), bar(2))?.kind, 'solo');
  assert.deepEqual(detectSections(song([[0, 3, { guitar: 4 }]])), []);
});

test('sections are cached on the song and sorted, without gaps between neighbours', () => {
  const s = song([[0, 8, { guitar: 4, drums: 8, vocals: 4 }], [8, 16, { guitar: 8, drums: 16, vocals: 8, pitch: 64 }], [16, 24, { guitar: 4, drums: 8, vocals: 4 }]]);
  const a = detectSections(s);
  assert.equal(detectSections(s), a);
  assert.ok(!Object.keys(s).includes('_sections'), 'the cache is not saved into song.json');
  for (let i = 1; i < a.length; i++) assert.ok(Math.abs(a[i].start - a[i - 1].end) < 1e-6);
});

test('the charter snaps to the coarsest grid that keeps a note within 20 ms of its sound', () => {
  const grid = new Grid(beats);
  assert.equal(snapToGrid(grid, 1.0 + 0.01, 4), 2);           // on the beat, 10 ms late: the beat
  assert.equal(snapToGrid(grid, 1.0 + 0.0625, 4), 2.125);     // a 32nd after the beat: finer than 16ths
  const loose = 1.0 + 0.047;                                   // a loose groove, between grid lines
  assert.ok(Math.abs(grid.time(snapToGrid(grid, loose, 4)) - loose) <= SNAP_TOLERANCE);
});
