// Chart notes from neural note events (basic-pitch on the AI server), with cross-stem attribution:
// every candidate note is checked against ALL separated stems (drums, bass, guitar, keys, vocals, other)
// and dropped when most of its harmonic energy actually lives in a different stem (separation bleed).
import { FFT, hann, midiToHz } from './dsp.js';

const SIZE = 2048;
const HOP = 256;

class SpectrumCache {
  constructor(stems, sr) {
    this.stems = stems;
    this.sr = sr;
    this.fft = new FFT(SIZE);
    this.win = hann(SIZE);
    this.re = new Float64Array(SIZE);
    this.im = new Float64Array(SIZE);
    this.cache = new Map();
  }

  /** Magnitude spectrum (SIZE/2+1) of `name` for a window starting near time t. */
  get(name, t) {
    const x = this.stems[name];
    if (!x) return null;
    const start = Math.max(0, Math.round((t * this.sr) / HOP) * HOP);
    const key = `${name}:${start}`;
    let mag = this.cache.get(key);
    if (mag) return mag;
    const { re, im, win } = this;
    for (let n = 0; n < SIZE; n++) { const p = start + n; re[n] = p < x.length ? x[p] * win[n] : 0; im[n] = 0; }
    this.fft.transform(re, im);
    mag = new Float32Array(SIZE / 2 + 1);
    for (let k = 0; k <= SIZE / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, mag);
    return mag;
  }

  /** Harmonic salience of MIDI pitch p in a spectrum. */
  salience(mag, p) {
    const binHz = this.sr / SIZE;
    const f0 = midiToHz(p);
    let s = 0;
    for (let h = 1; h <= 5; h++) {
      const k = Math.round((f0 * h) / binHz);
      if (k + 1 >= mag.length) break;
      s += Math.max(mag[k - 1] || 0, mag[k], mag[k + 1]) / h;
    }
    return s;
  }
}

const MIN_SHARE = { bass: 0.3, guitar: 0.32, keys: 0.32, vocals: 0.38 };

/**
 * Keep only the notes of `inst` that its own stem really produced.
 * notes: [[start, end, pitch, amp]], stems: { name: Float32Array mono } (all available stems)
 */
export function attributeNotes(inst, notes, stems, sr) {
  const cache = new SpectrumCache(stems, sr);
  const others = Object.keys(stems).filter((n) => n !== inst && stems[n]);
  const kept = [];
  let dropped = 0;
  for (const n of notes) {
    const [s, e, p, a] = n;
    if (a < 0.16 && e - s < 0.12) { dropped++; continue; } // faint blips
    const t = s + 0.02;
    const own = cache.get(inst, t);
    if (!own) { kept.push(n); continue; }
    const mine = cache.salience(own, p);
    let total = mine;
    for (const o of others) {
      const m = cache.get(o, t);
      if (m) total += cache.salience(m, p) * (o === 'drums' ? 0.6 : 1);
    }
    const share = total > 1e-9 ? mine / total : 0;
    if (share >= (MIN_SHARE[inst] ?? 0.3)) kept.push(n);
    else dropped++;
  }
  return { notes: kept, dropped };
}

/**
 * Turn attributed note events into the charter's raw note format (lanes assigned, chords expanded).
 * Returns [{ t, s, m, len, lane, i }]
 */
export function notesFromEvents(inst, events, grid, assignLanes, fps) {
  const sorted = events.slice().sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const groups = [];
  for (const ev of sorted) {
    const g = groups[groups.length - 1];
    if (g && ev[0] - g.t < 0.035) g.ev.push(ev);
    else groups.push({ t: ev[0], ev: [ev] });
  }
  const line = groups.map((g) => {
    const byAmp = g.ev.slice().sort((a, b) => b[3] - a[3]);
    const byPitch = g.ev.slice().sort((a, b) => a[2] - b[2]);
    // bass follows the lowest note, vocals the loudest (one melody), guitar/keys the top voice
    const prim = inst === 'bass' ? byPitch[0] : inst === 'vocals' ? byAmp[0] : byPitch[byPitch.length - 1];
    const pcs = new Set(g.ev.map((e) => e[2] % 12));
    const beat = grid.beatLen(g.t);
    const dur = prim[1] - prim[0];
    return {
      t: g.t, m: prim[2], s: 0.35 + 1.25 * Math.max(...g.ev.map((e) => e[3])),
      len: dur >= Math.max(0.3, 0.8 * beat) ? dur : 0, i: Math.round(g.t * fps),
      chord: inst === 'bass' || inst === 'vocals' ? 1 : Math.min(3, pcs.size),
    };
  });
  assignLanes(line);
  const out = [];
  for (const n of line) {
    out.push({ ...n, fromAi: true });
    if (n.chord >= 2) {
      // chord tones sit below the top voice: spread them onto lower lanes
      const lanes = n.chord === 2 ? [n.lane - 2] : [n.lane - 1, n.lane - 2];
      const shift = Math.max(0, -Math.min(...lanes));
      if (shift) out[out.length - 1].lane = Math.min(4, n.lane + shift);
      for (const l of lanes) out.push({ ...n, lane: Math.min(4, l + shift), s: n.s * 0.9, fromAi: true, chordTone: true });
    }
  }
  return out;
}
