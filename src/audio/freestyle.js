// Freestyle solos: in a guitar or keys solo the charted notes drop away and the player improvises. The frets play
// the song's own instrument — single notes cut from its stem, pitched to a pentatonic scale in the song's key — so a
// freestyle sounds like that guitarist playing your solo. Graded on groove, flow and melody (gradeFreestyle).

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PENTA = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };
export const BEND = 100;        // whammy: cents down at full travel
const MAX_SHIFT = 7;            // a sample is pitched at most this many semitones to reach a lane's note
const PRE = 0.004;

/** The song's key from its notes' pitch classes (Krumhansl–Schmuckler): { tonic 0..11, mode }. */
export function estimateKey(notes) {
  const h = new Float64Array(12);
  for (const n of notes) if (n.m != null) h[((Math.round(n.m) % 12) + 12) % 12] += 1 + (n.len || 0) * 2;
  let best = { tonic: 0, mode: 'minor', r: -Infinity };
  for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < 12; i++) { const x = h[(i + tonic) % 12], y = prof[i]; sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
      const r = (sxy - (sx * sy) / 12) / Math.sqrt(Math.max(1e-9, (sxx - (sx * sx) / 12) * (syy - (sy * sy) / 12)));
      if (r > best.r) best = { tonic, mode, r };
    }
  }
  return { tonic: best.tonic, mode: best.mode };
}

/** Five pentatonic notes (MIDI) for the five lanes, rising from just under `center`. */
export function laneNotes(key, center) {
  const tones = [];
  for (let m = Math.round(center) - 14; m <= Math.round(center) + 16; m++) {
    if (PENTA[key.mode].includes((((m - key.tonic) % 12) + 12) % 12)) tones.push(m);
  }
  let i = tones.findIndex((m) => m >= center - 4);
  i = Math.max(0, Math.min(tones.length - 5, i));
  return tones.slice(i, i + 5);
}

/**
 * Clean single notes to play: chart groups of one note with room after them (≥ 150 ms to the next), cut from their
 * attack. → Map(midi → { from, len }) keeping the longest take of each pitch. attack(k) = group k's stem position.
 */
export function pickSamples(groups, attack, duration) {
  const out = new Map();
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k];
    if (g.notes.length !== 1 || g.notes[0].m == null) continue;
    const next = k + 1 < groups.length ? attack(k + 1) : duration;
    const from = Math.max(0, attack(k) - PRE), len = Math.min(1.2, next - from - 0.012);
    if (len < 0.15) continue;
    const m = Math.round(g.notes[0].m);
    if (!out.has(m) || out.get(m).len < len) out.set(m, { from, len });
  }
  return out;
}

/**
 * How good a freestyle was, 0..1. presses: [{ t, lane }] (song seconds); beats: the song's beat times.
 * groove: presses near the 16th-note grid; flow: a playable density (about 1–3 notes a beat); melody: several lanes,
 * few same-note repeats, a line that moves up and down.
 */
export function gradeFreestyle(presses, beats, start, end) {
  if (presses.length < 2 || end <= start) return { grade: 0, groove: 0, flow: 0, melody: 0 };
  let b = 0, groove = 0;
  for (const p of presses) {
    while (b < beats.length - 2 && beats[b + 1] <= p.t) b++;
    const len = (beats[b + 1] - beats[b]) || 0.5, step = len / 4;
    const off = Math.abs(((p.t - beats[b]) % step + step) % step);
    groove += Math.max(0, 1 - Math.min(off, step - off) / Math.min(0.06, step / 2));
  }
  groove /= presses.length;
  const nBeats = beats.filter((x) => x >= start && x < end).length || 1;
  const density = presses.length / nBeats;
  const flow = density < 0.75 ? density / 0.75 : density <= 3 ? 1 : Math.max(0, 1 - (density - 3) / 3);
  const lanes = new Set(presses.map((p) => p.lane)).size;
  let repeats = 0, turns = 0;
  for (let i = 1; i < presses.length; i++) {
    const d = presses[i].lane - presses[i - 1].lane;
    if (!d) repeats++;
    if (i > 1 && d && Math.sign(d) !== Math.sign(presses[i - 1].lane - presses[i - 2].lane || d)) turns++;
  }
  const melody = 0.4 * Math.min(1, lanes / 4) + 0.3 * (1 - repeats / (presses.length - 1)) + 0.3 * Math.min(1, turns / Math.max(1, presses.length * 0.25));
  const grade = Math.max(0, Math.min(1, 0.45 * groove + 0.25 * flow + 0.3 * melody));
  return { grade, groove, flow, melody };
}

export class Freestyle {
  /** engine: ctx; buffer: the stem; out: the stem's chain; samples: pickSamples(); lanes: laneNotes() */
  constructor(engine, buffer, out, samples, lanes) {
    this.ctx = engine.ctx;
    this.buffer = buffer;
    this.out = out;
    this.samples = [...samples.entries()].map(([m, s]) => ({ m, ...s }));
    this.lanes = lanes;
    this.voices = new Map(); // lane → { src, gain }
    this.cents = 0;
  }

  get playable() { return this.samples.length >= 2 && this.lanes.length === 5; }

  /** The take closest in pitch to a lane's note (within MAX_SHIFT semitones). */
  _take(midi) {
    let best = null;
    for (const s of this.samples) if (Math.abs(s.m - midi) <= MAX_SHIFT && (!best || Math.abs(s.m - midi) < Math.abs(best.m - midi) || (s.m === best.m && s.len > best.len))) best = s;
    return best;
  }

  noteOn(lane, now = this.ctx.currentTime) {
    const midi = this.lanes[lane], s = midi != null && this._take(midi);
    if (!s) return false;
    this.noteOff(lane, now, 0.015);
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.detune.value = (midi - s.m) * 100 + this.cents;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.out);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.003);
    gain.gain.setValueAtTime(1, now + s.len - 0.04);
    gain.gain.linearRampToValueAtTime(0, now + s.len);
    src.start(now, s.from);
    src.stop(now + s.len + 0.01);
    const v = { src, gain, midi, base: s.m };
    src.onended = () => { src.disconnect(); gain.disconnect(); if (this.voices.get(lane) === v) this.voices.delete(lane); };
    this.voices.set(lane, v);
    return true;
  }

  /** Let go of a fret: its note stops (a short release, like lifting a finger). */
  noteOff(lane, now = this.ctx.currentTime, release = 0.06) {
    const v = this.voices.get(lane);
    if (!v) return;
    this.voices.delete(lane);
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, release / 3);
    try { v.src.stop(now + release * 2); } catch { /* already stopping */ }
  }

  /** Whammy bends every ringing note down (w 0..1). */
  bend(w, now = this.ctx.currentTime) {
    const cents = -BEND * Math.max(0, Math.min(1, w || 0));
    if (Math.abs(cents - this.cents) < 2) return;
    this.cents = cents;
    for (const v of this.voices.values()) v.src.detune.setTargetAtTime((v.midi - v.base) * 100 + cents, now, 0.02);
  }

  stop() { for (const lane of [...this.voices.keys()]) this.noteOff(lane, this.ctx.currentTime, 0.03); }
}
