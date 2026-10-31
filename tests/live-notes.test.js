// v3: live notes — attack finding, slice placement, and what a LiveStem schedules for hits, misses and sustains.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transientEnvelope, attackTimes, placeSlice, quietSplice, LiveStem, PRE, MAX_SKIP, DRIFT, BEND } from '../src/audio/live-notes.js';

const SR = 44100;
// a stem of plucked notes: a decaying 220 Hz tone starting at each attack
function stem(attacks, seconds = 6) {
  const L = new Float32Array(SR * seconds);
  for (const a of attacks) {
    const i0 = Math.round(a * SR);
    for (let i = i0; i < Math.min(L.length, i0 + SR * 0.6); i++) {
      const t = (i - i0) / SR;
      L[i] += Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t / 0.15) * Math.min(1, t / 0.001) * 0.5;
    }
  }
  return L;
}

// the slice timing a LiveStem schedules, without Web Audio
class Param {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); return this; }
  setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); return this; }
}
class FakeNode { connect(n) { return n; } disconnect() {} }
class FakeGain extends FakeNode { constructor() { super(); this.gain = new Param(1); } }
class FakeSource extends FakeNode {
  constructor() { super(); this.detune = new Param(0); this.loop = false; this.started = null; this.stopped = null; }
  start(at, from) { this.started = { at, from }; }
  stop(t) { this.stopped = t ?? 0; }
}
function rig(attacks, chart, { startCtx = 0, rate = 1, sustained = [] } = {}) {
  const L = stem(attacks);
  const ctx = { currentTime: 0, sources: [], createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }, createGain: () => new FakeGain() };
  const buffer = { sampleRate: SR, duration: L.length / SR, numberOfChannels: 1, getChannelData: () => L };
  const live = new LiveStem({ ctx, startCtx, rate }, buffer, new FakeNode(), chart, sustained);
  return { live, ctx };
}
const near = (a, b, eps = 0.002) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('attacks are found in the stem, not at the quantised chart time', () => {
  const attacks = [0.5, 1.0, 1.52, 2.0];
  const chart = [0.52, 0.98, 1.5, 2.0]; // the grid put them up to 20 ms off
  const env = transientEnvelope(stem(attacks));
  const found = attackTimes(env, chart, 1, SR);
  attacks.forEach((a, k) => near(found[k], a));
});

test('the charter onset finds attacks the grid moved too far for a search around the chart time', () => {
  const attacks = [0.5, 1.0];
  const chart = [0.625, 1.0]; // an eighth-note grid at 120 bpm can put a note 125 ms off
  const env = transientEnvelope(stem(attacks));
  near(attackTimes(env, chart, 1, SR)[0], 0.5 + 0.125, 0.09); // searched near the chart time: not found there
  const found = attackTimes(env, chart, 1, SR, [0.51, null]); // the charter's onset (10 ms late, SuperFlux peak)
  near(found[0], 0.5);
  near(found[1], 1.0);
});

test('a note with no attack nearby keeps its chart time; attacks stay in order', () => {
  const env = transientEnvelope(stem([0.5]));
  const found = attackTimes(env, [0.5, 1.7, 1.705], 1, SR);
  near(found[0], 0.5);
  assert.equal(found[1], 1.7);
  assert.ok(found[2] > found[1]);
});

test('placeSlice shifts the stem by the hit error, keeps the attack, waits for early notes', () => {
  // on time, but the hit reached the engine 20 ms after it was heard: start a little into the attack, run behind
  const late = placeSlice({ first: 1 - PRE, err: 0, now: 1.02, startCtx: 0 });
  near(late.from, 1 + MAX_SKIP, 1e-9);
  near(late.shift, 0.02 - MAX_SKIP, 1e-9);
  // 50 ms early and heard at once: the slice starts right away, ahead of the band
  const early = placeSlice({ first: 1 - PRE, err: -0.05, now: 0.95, startCtx: 0 });
  assert.equal(early.at, 0.95);
  near(early.from, 1, 1e-9);
  near(early.shift, -0.05, 1e-9);
  // a negative audio offset can make a hit arrive before its slice is due: wait instead of playing early stem
  const wait = placeSlice({ first: 1 - PRE, err: 0, now: 0.97, startCtx: 0 });
  near(wait.at, 0.97 + (1 - PRE - 0.97), 1e-9);
  assert.equal(wait.from, 1 - PRE);
});

test('quietSplice picks a spot away from attacks at both positions', () => {
  const env = transientEnvelope(stem([1, 1.4, 1.8, 3]));
  const p = quietSplice(env, 1.05, 2.8, 0.1, SR);
  for (const a of [1.4, 1.8]) {
    assert.ok(Math.abs(p - a) > 0.02 && Math.abs(p + 0.1 - a) > 0.02, `splice at ${p} lands on the attack at ${a}`);
  }
});

test('the intro plays by itself up to the first note', () => {
  const { live, ctx } = rig([1, 2], [1, 2]);
  live.start(0, 0);
  const intro = ctx.sources[0];
  assert.deepEqual(intro.started, { at: 0, from: 0 });
  near(intro.stopped, 1 - PRE + 0.002);
});

test('a hit plays its note up to the next one, which rings out if it is missed', () => {
  const { live, ctx } = rig([1, 2, 3], [1, 2, 3]);
  live.start(0, 0);
  live.hit(0, 1.0, 1.01);
  const [slice, ring] = ctx.sources.slice(-2);
  near(slice.started.from, 1 + 0.006); // 10 ms after it was heard: 6 ms into the attack (MAX_SKIP)
  near(slice.stopped, 1.01 + (2 - PRE) - slice.started.from + 0.002);
  assert.ok(ring.loop && ring.loopEnd < 2 - PRE && ring.loopStart < ring.loopEnd, 'ring loops the tail before the next attack');
  // the intro fades out as the note comes in
  assert.ok(live.segs.size >= 2);
});

test('a late hit sounds late; the previous slice fades as it starts', () => {
  const { live, ctx } = rig([1, 2, 3], [1, 2, 3]);
  live.start(0, 0);
  live.hit(0, 1.0, 1.01);
  const first = live.voice;
  const n = ctx.sources.length;
  live.hit(1, 2.06, 2.07); // 60 ms late
  const slice = ctx.sources[n];
  assert.equal(slice.started.at, 2.07);
  near(slice.started.from, 2 + 0.006);
  assert.ok(first.segs.every((s) => s.kill.gain.events.some(([kind, v, t]) => kind === 'target' && v === 0 && t === 2.07)));
});

test('a chord sounds once, and an older group never plays after a newer one', () => {
  const { live, ctx } = rig([1, 2, 3], [1, 2, 3]);
  live.hit(1, 2, 2.01);
  const n = ctx.sources.length;
  live.hit(1, 2.01, 2.02);
  live.hit(0, 1.1, 2.03);
  assert.equal(ctx.sources.length, n);
});

test('a slice far from the band slides back into time at a quiet spot', () => {
  const { live, ctx } = rig([1, 1.5, 2.4, 4], [1, 4]); // the chart skips the middle notes (easy)
  live.hit(0, 1.1, 1.11); // 100 ms late
  const [a, b, ring] = ctx.sources; // the late slice (no ring), the band-aligned rest, its ring
  assert.equal(live.voice.segs.length, 2, 'two slices: the late one, then the band-aligned rest');
  assert.ok(!a.loop && !b.loop && ring.loop);
  assert.ok(1.11 - a.started.from > DRIFT);
  // the second slice plays the band's position at its start time (startCtx = 0)
  near(b.started.at, b.started.from, 1e-9);
  // and it starts after the first one's own quiet spot, clear of the 1.5 s and 2.4 s attacks
  for (const t of [1.5, 2.4]) assert.ok(Math.abs(b.started.from - t) > 0.02);
});

test('a note the grid put after its sound starts on time by itself; its hit keeps it, a miss cuts it', () => {
  const { live, ctx } = rig([1, 2, 3], [1.06, 2.06, 3]); // chart 60 ms after the first two attacks
  live.start(0, 0);
  live.update(0.95); // 0.996 is within the lookahead
  const spec = ctx.sources.at(-2);
  near(spec.started.at, 1 - PRE);
  near(spec.started.from, 1 - PRE);
  const n = ctx.sources.length;
  live.hit(0, 1.06, 1.09); // on time by the chart: arrives after the slice started — keep it
  assert.equal(ctx.sources.length, n);
  live.update(1.95);
  const second = live.voice;
  live.miss(1, 2.18);
  assert.ok(second.segs[0].kill.gain.events.some(([kind, v, t]) => kind === 'target' && v === 0 && t === 2.18));
  assert.equal(live.voice, null);
});

test('an early hit still plays early when its note would start by itself', () => {
  const { live, ctx } = rig([1, 2], [1.06, 2]);
  live.start(0, 0);
  live.update(0.9);
  const spec = live.voice;
  live.hit(0, 0.94, 0.95); // 120 ms early by the chart, before the slice was due
  assert.ok(spec.segs[0].kill.gain.events.some(([, v, t]) => v === 0 && t === 0.95), 'the slice that would start by itself is dropped');
  const early = ctx.sources.find((s) => s.started?.at === 0.95);
  assert.ok(early && early.started.from <= 1 + MAX_SKIP, 'the hit starts the note right away, ahead of the band (attack at 1.0)');
});

test('a sustain let go of too soon stops; whammy bends it', () => {
  const { live } = rig([1, 3], [1, 3], { sustained: [true, false] });
  live.hit(0, 1, 1.01);
  live.bend(0, 1, 1.5);
  assert.ok(live.voice.segs[0].src.detune.events.some(([kind, v]) => kind === 'target' && v === -BEND));
  const voice = live.voice;
  live.release(0, 1.8);
  assert.equal(live.voice, null);
  assert.ok(voice.segs[0].kill.gain.events.some(([kind, v, t]) => kind === 'target' && v === 0 && t === 1.8));
});
