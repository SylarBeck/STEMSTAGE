// Auto-charter: turns separated stems into playable note charts.
//  1. Spectral features per stem (SuperFlux-style onset strength + band energies)
//  2. Tempo estimate (autocorrelation) + dynamic-programming beat tracker (Ellis 2007)
//  3. Onset picking per stem / drum band, drum-hit classification
//  4. Pitch tracking (YIN for bass, harmonic salience + chroma for guitar/keys)
//  5. Grid quantisation, lane mapping, sustains, 4 difficulty reductions, overdrive phrases
import { FFT, hann, decimate2, percentile, yin, hzToMidi, midiToHz } from './dsp.js';
import { attributeNotes, notesFromEvents } from './transcription.js';

export const SR = 22050;
const N = 1024;
const HOP = 220;
const FPS = SR / HOP;
const B = N / 2 + 1;
const BIN_HZ = SR / N;
const bin = (hz) => Math.max(1, Math.min(B - 1, Math.round(hz / BIN_HZ)));

export const DIFFS = ['easy', 'medium', 'hard', 'expert'];
export const INSTRUMENTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];

// ---------------------------------------------------------------- features
function extractFeatures(stems, onProgress) {
  const len = Math.max(...Object.values(stems).filter(Boolean).map((s) => s.length));
  const nF = Math.floor(len / HOP) + 1;
  const silent = new Float32Array(0);
  const fft = new FFT(N);
  const win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const aR = new Float64Array(B), aI = new Float64Array(B), bR = new Float64Array(B), bI = new Float64Array(B);

  const f32 = () => new Float32Array(nF);
  const feats = {
    drums: { fluxKick: f32(), fluxSnare: f32(), fluxHat: f32(), eKick: f32(), eBody: f32(), eNoise: f32(), eHat: f32(), eLowMid: f32(), eAll: f32() },
    bass: { flux: f32(), e: f32() },
    guitar: { flux: f32(), e: f32() },
    keys: { flux: f32(), e: f32() },
    vocals: { flux: f32(), e: f32() },
    other: { flux: f32(), e: f32() },
  };
  const BANDS = {
    kick: [bin(40), bin(130)], body: [bin(150), bin(450)], noise: [bin(1500), bin(5500)],
    hat: [bin(6000), bin(10500)], lowmid: [bin(80), bin(260)],
    bass: [bin(35), bin(450)], guitar: [bin(90), bin(5000)], keys: [bin(60), bin(6000)],
    vocals: [bin(80), bin(4000)], other: [bin(60), bin(6000)],
  };

  const Y = { a: new Float64Array(B), b: new Float64Array(B) };
  const prev = { a: new Float64Array(B), b: new Float64Array(B) };
  const prevMax = new Float64Array(B);
  const mag = { a: new Float64Array(B), b: new Float64Array(B) };

  const flux = (y, pm, [b0, b1]) => {
    let s = 0;
    for (let k = b0; k <= b1; k++) { const d = y[k] - pm[k]; if (d > 0) s += d; }
    return s / (b1 - b0 + 1);
  };
  const energy = (m, [b0, b1]) => {
    let s = 0;
    for (let k = b0; k <= b1; k++) s += m[k] * m[k];
    return s;
  };
  const maxFilter = (p) => {
    prevMax[0] = Math.max(p[0], p[1]);
    for (let k = 1; k < B - 1; k++) prevMax[k] = Math.max(p[k - 1], p[k], p[k + 1]);
    prevMax[B - 1] = Math.max(p[B - 2], p[B - 1]);
    return prevMax;
  };

  const pairs = [['drums', 'bass'], ['guitar', 'keys']];
  if (stems.vocals) pairs.push(['vocals', 'other']);
  let done = 0;
  for (const [na, nb] of pairs) {
    const sa = stems[na] || silent, sb = stems[nb] || silent;
    prev.a.fill(0); prev.b.fill(0);
    for (let t = 0; t < nF; t++) {
      const s0 = t * HOP - N / 2;
      for (let n = 0; n < N; n++) {
        const p = s0 + n;
        re[n] = p >= 0 && p < sa.length ? sa[p] * win[n] : 0;
        im[n] = p >= 0 && p < sb.length ? sb[p] * win[n] : 0;
      }
      fft.forwardPair(re, im, aR, aI, bR, bI);
      for (let k = 0; k < B; k++) {
        const ma = Math.hypot(aR[k], aI[k]), mb = Math.hypot(bR[k], bI[k]);
        mag.a[k] = ma; mag.b[k] = mb;
        Y.a[k] = Math.log1p(10 * ma); Y.b[k] = Math.log1p(10 * mb);
      }
      for (const [key, name] of [['a', na], ['b', nb]]) {
        const pm = maxFilter(prev[key]);
        const y = Y[key], m = mag[key], F = feats[name];
        if (name === 'drums') {
          F.fluxKick[t] = flux(y, pm, BANDS.kick);
          F.fluxSnare[t] = 0.6 * flux(y, pm, BANDS.body) + 0.4 * flux(y, pm, BANDS.noise);
          F.fluxHat[t] = flux(y, pm, BANDS.hat);
          F.eKick[t] = energy(m, BANDS.kick);
          F.eBody[t] = energy(m, BANDS.body);
          F.eNoise[t] = energy(m, BANDS.noise);
          F.eHat[t] = energy(m, BANDS.hat);
          F.eLowMid[t] = energy(m, BANDS.lowmid);
          F.eAll[t] = energy(m, [1, B - 1]);
        } else {
          F.flux[t] = flux(y, pm, BANDS[name]);
          F.e[t] = energy(m, BANDS[name]);
        }
        prev[key].set(y);
      }
      if ((t & 1023) === 0) onProgress?.((done + t / nF) / pairs.length);
    }
    done++;
  }
  return { feats, nF };
}

// ---------------------------------------------------------------- onsets
function normalizeOdf(odf) {
  const scale = percentile(odf, 0.985) || 1;
  const out = new Float32Array(odf.length);
  for (let i = 0; i < odf.length; i++) out[i] = Math.min(2, odf[i] / scale);
  return out;
}

function pickOnsets(odf, env, { delta = 0.08, wait = 5, preMax = 3, postMax = 3, preAvg = 12, postAvg = 6, gate = 0.004 } = {}) {
  const n = odf.length;
  const norm = normalizeOdf(odf);
  const envRef = percentile(env, 0.95) || 1e-12;
  const csum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) csum[i + 1] = csum[i] + norm[i];
  const out = [];
  for (let i = 1; i < n - 1; i++) {
    const v = norm[i];
    if (v < delta) continue;
    let isMax = true;
    for (let k = Math.max(0, i - preMax); k <= Math.min(n - 1, i + postMax); k++) {
      if (norm[k] > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - preAvg), b = Math.min(n, i + postAvg + 1);
    const avg = (csum[b] - csum[a]) / (b - a);
    if (v < avg + delta) continue;
    let e = 0;
    for (let k = i; k < Math.min(n, i + 7); k++) if (env[k] > e) e = env[k];
    if (e < gate * envRef) continue;
    const last = out[out.length - 1];
    if (last && i - last.i < wait) {
      if (v > last.s) { last.i = i; last.t = i / FPS; last.s = v; }
      continue;
    }
    out.push({ i, t: i / FPS, s: v });
  }
  return out;
}

// ---------------------------------------------------------------- tempo + beats
function estimateTempo(odf) {
  const n = odf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += odf[i];
  mean /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = odf[i] - mean;
  const minLag = Math.floor((60 / 210) * FPS), maxLag = Math.ceil((60 / 55) * FPS);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let l = minLag; l <= Math.min(maxLag * 2 + 1, n - 1); l++) {
    let s = 0;
    for (let i = 0; i + l < n; i++) s += x[i] * x[i + l];
    ac[l] = s / (n - l);
  }
  let best = minLag, bestScore = -Infinity;
  const score = new Float64Array(maxLag + 2);
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = (60 * FPS) / l;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    score[l] = prior * (ac[l] + 0.5 * (ac[2 * l] || 0) + 0.25 * (ac[Math.round(l / 2)] || 0));
    if (score[l] > bestScore) { bestScore = score[l]; best = l; }
  }
  const a = score[best - 1] || score[best], b = score[best], c = score[best + 1] || score[best];
  const den = a - 2 * b + c;
  const period = best + (den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0);
  return period; // frames per beat
}

function trackBeats(odf, period, tightness = 100) {
  const n = odf.length;
  let sd = 0, mean = 0;
  for (let i = 0; i < n; i++) mean += odf[i];
  mean /= n;
  for (let i = 0; i < n; i++) sd += (odf[i] - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  // local score: odf smoothed with a gaussian of width period/32
  const gw = Math.max(1, Math.round(period));
  const g = [];
  for (let k = -gw; k <= gw; k++) g.push(Math.exp(-0.5 * ((k * 32) / period) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -gw; k <= gw; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += (odf[j] / sd) * g[k + gw];
    }
    local[i] = s;
  }
  const wStart = -Math.round(2 * period), wEnd = -Math.round(period / 2);
  const txw = [];
  for (let w = wStart; w <= wEnd; w++) txw.push(-tightness * Math.log(-w / period) ** 2);
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  let maxLocal = 0;
  for (let i = 0; i < n; i++) if (local[i] > maxLocal) maxLocal = local[i];
  const thresh = 0.01 * maxLocal;
  let first = true;
  for (let i = 0; i < n; i++) {
    let bestV = -Infinity, bestJ = -1;
    for (let w = wStart, k = 0; w <= wEnd; w++, k++) {
      const j = i + w;
      if (j < 0) continue;
      const v = cum[j] + txw[k];
      if (v > bestV) { bestV = v; bestJ = j; }
    }
    if (bestJ < 0) { cum[i] = local[i]; continue; }
    cum[i] = local[i] + bestV;
    if (first && local[i] < thresh) back[i] = -1;
    else { back[i] = bestJ; first = false; }
  }
  // choose the last beat among strong local maxima of cum
  const maxima = [];
  for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(i);
  if (!maxima.length) return [];
  const med = percentile(maxima.map((i) => cum[i]), 0.5);
  let last = maxima[maxima.length - 1];
  for (let k = maxima.length - 1; k >= 0; k--) if (cum[maxima[k]] >= 0.5 * med) { last = maxima[k]; break; }
  const beats = [];
  for (let i = last; i >= 0; i = back[i]) {
    beats.push(i);
    if (back[i] < 0) break;
  }
  beats.reverse();
  return beats.map((i) => i / FPS);
}

function extendBeats(beats, duration, periodSec) {
  const out = beats.slice();
  if (out.length < 2) {
    out.length = 0;
    for (let t = 0; t < duration + periodSec; t += periodSec) out.push(t);
    return out;
  }
  const headP = Math.min(periodSec * 1.2, Math.max(periodSec * 0.8, out[1] - out[0]));
  while (out[0] > 0.01) out.unshift(out[0] - headP);
  const n = out.length;
  const tailP = Math.min(periodSec * 1.2, Math.max(periodSec * 0.8, out[n - 1] - out[n - 2]));
  while (out[out.length - 1] < duration + 2 * periodSec) out.push(out[out.length - 1] + tailP);
  return out;
}

export class Grid {
  constructor(beats) { this.beats = beats; }
  pos(t) {
    const b = this.beats;
    let lo = 0, hi = b.length - 1;
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[hi]) return hi + (t - b[hi]) / (b[hi] - b[hi - 1]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m; else hi = m; }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }
  time(p) {
    const b = this.beats;
    const i = Math.max(0, Math.min(b.length - 2, Math.floor(p)));
    return b[i] + (p - i) * (b[i + 1] - b[i]);
  }
  beatLen(t) {
    const p = Math.max(0, Math.min(this.beats.length - 2, Math.floor(this.pos(t))));
    return this.beats[p + 1] - this.beats[p];
  }
}

// ---------------------------------------------------------------- pitch
function makeSpectrum(x, center, size, fft, win) {
  const re = new Float64Array(size), im = new Float64Array(size);
  const s0 = center;
  for (let n = 0; n < size; n++) {
    const p = s0 + n;
    re[n] = p >= 0 && p < x.length ? x[p] * win[n] : 0;
  }
  fft.transform(re, im);
  const m = new Float64Array(size / 2 + 1);
  for (let k = 0; k <= size / 2; k++) m[k] = Math.hypot(re[k], im[k]);
  return m;
}

function harmonicPitch(mag, binHz, mLo, mHi) {
  let best = -1, bestS = 0;
  const pk = (f) => {
    const k = f / binHz;
    const k0 = Math.floor(k);
    if (k0 + 2 >= mag.length) return 0;
    return Math.max(mag[k0 - 1] || 0, mag[k0], mag[k0 + 1], mag[k0 + 2] * 0.5);
  };
  for (let m = mLo; m <= mHi; m += 0.5) {
    const f0 = midiToHz(m);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += pk(f0 * h) / h;
    if (s > bestS) { bestS = s; best = m; }
  }
  return best < 0 ? null : best;
}

function chromaCount(mag, binHz) {
  const c = new Float64Array(12);
  const k0 = Math.ceil(80 / binHz), k1 = Math.min(mag.length - 1, Math.floor(2000 / binHz));
  for (let k = k0; k <= k1; k++) {
    const pc = ((Math.round(hzToMidi(k * binHz)) % 12) + 12) % 12;
    c[pc] += mag[k] * mag[k];
  }
  const mx = Math.max(...c);
  if (mx <= 0) return 0;
  let n = 0;
  for (let i = 0; i < 12; i++) if (c[i] >= 0.55 * mx) n++;
  return n;
}

function sustainLength(env, i, nextI) {
  let peak = 0;
  for (let k = i; k < Math.min(env.length, i + 5); k++) if (env[k] > peak) peak = env[k];
  const stop = Math.min(env.length - 1, nextI - 2);
  let j = i + 5;
  while (j < stop && env[j] > 0.22 * peak) j++;
  return Math.max(0, (j - i) / FPS);
}

// ---------------------------------------------------------------- note builders
function buildDrums(F) {
  const kick = pickOnsets(F.fluxKick, F.eKick, { delta: 0.09, wait: 6 });
  const snare = pickOnsets(F.fluxSnare, F.eBody, { delta: 0.09, wait: 5 });
  const hat = pickOnsets(F.fluxHat, F.eHat, { delta: 0.08, wait: 4 });
  const nk = normalizeOdf(F.fluxKick), ns = normalizeOdf(F.fluxSnare), nh = normalizeOdf(F.fluxHat);
  const localMax = (arr, i, r = 2) => {
    let m = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(arr.length - 1, i + r); k++) if (arr[k] > m) m = arr[k];
    return m;
  };
  const sum = (arr, i, n) => { let s = 0; for (let k = i; k < Math.min(arr.length, i + n); k++) s += arr[k]; return s; };

  const notes = [];
  for (const o of kick) notes.push({ t: o.t, lane: 0, s: o.s, m: 36, i: o.i });

  const snareKept = snare.filter((o) => {
    const k = localMax(nk, o.i);
    return !(k > 0.4 && ns[o.i] < 0.7 * k);
  });
  const ratios = snareKept.map((o) => Math.log((sum(F.eNoise, o.i, 4) + 1e-12) / (sum(F.eLowMid, o.i, 4) + 1e-12)));
  const rMed = ratios.length ? percentile(ratios, 0.5) : 0;
  snareKept.forEach((o, idx) => {
    const tom = ratios[idx] < rMed - 1.3;
    notes.push({ t: o.t, lane: tom ? 3 : 1, s: o.s, m: tom ? 45 : 38, i: o.i });
  });

  const snareIdx = new Set(snareKept.map((o) => o.i));
  for (const o of hat) {
    let nearSnare = false;
    for (let d = -2; d <= 2; d++) if (snareIdx.has(o.i + d)) nearSnare = true;
    if (nearSnare && nh[o.i] < 0.6 * localMax(ns, o.i)) continue;
    let peak = 0;
    for (let k = o.i; k < o.i + 4 && k < F.eHat.length; k++) peak = Math.max(peak, F.eHat[k]);
    const tail = sum(F.eHat, o.i + 15, 15) / 15;
    const crash = peak > 0 && tail / peak > 0.35 && o.s > 0.55;
    notes.push({ t: o.t, lane: crash ? 4 : 2, s: o.s, m: crash ? 49 : 42, i: o.i });
  }
  return notes.sort((a, b) => a.t - b.t);
}

function buildMelodic(name, F, signal, grid) {
  const opts = name === 'bass' ? { delta: 0.08, wait: 7 } : { delta: 0.08, wait: 6 };
  const onsets = pickOnsets(F.flux, F.e, opts);
  const notes = [];
  if (name === 'bass') {
    const x = decimate2(signal); // 11025 Hz
    const sr = SR / 2;
    let last = 40;
    for (const o of onsets) {
      const start = Math.floor((o.t + 0.03) * sr);
      const r = yin(x, start, 768, sr, 32, 420);
      const m = r ? hzToMidi(r.f0) : last;
      last = m;
      notes.push({ t: o.t, s: o.s, m, i: o.i });
    }
  } else {
    const size = 4096;
    const fft = new FFT(size);
    const win = hann(size);
    const binHz = SR / size;
    let last = 60;
    for (const o of onsets) {
      const mag = makeSpectrum(signal, Math.floor((o.t + 0.02) * SR), size, fft, win);
      const p = harmonicPitch(mag, binHz, name === 'keys' ? 36 : 40, name === 'keys' ? 96 : 88);
      const m = p ?? last;
      last = m;
      notes.push({ t: o.t, s: o.s, m, i: o.i, chroma: chromaCount(mag, binHz) });
    }
  }
  // sustains
  for (let k = 0; k < notes.length; k++) {
    const nextI = k + 1 < notes.length ? notes[k + 1].i : F.e.length;
    const len = sustainLength(F.e, notes[k].i, nextI);
    const beat = grid.beatLen(notes[k].t);
    notes[k].len = len >= Math.max(0.3, 0.8 * beat) ? len : 0;
  }
  assignLanes(notes);
  return notes;
}

function assignLanes(notes) {
  const n = notes.length, W = 6;
  const ms = notes.map((x) => x.m);
  for (let i = 0; i < n; i++) {
    const w = ms.slice(Math.max(0, i - W), Math.min(n, i + W + 1)).sort((a, b) => a - b);
    const lo = w[Math.floor(w.length * 0.15)], hi = w[Math.floor((w.length - 1) * 0.85)];
    const range = Math.max(hi - lo, 7);
    const center = (hi + lo) / 2;
    notes[i].lane = Math.max(0, Math.min(4, Math.round(2 + ((ms[i] - center) / range) * 4)));
  }
  for (let i = 1; i < n; i++) {
    const dm = ms[i] - ms[i - 1];
    const pl = notes[i - 1].lane;
    if (Math.abs(dm) < 0.6) notes[i].lane = pl;
    else if (dm > 0 && notes[i].lane <= pl) notes[i].lane = Math.min(4, pl + (dm > 4 ? 2 : 1));
    else if (dm < 0 && notes[i].lane >= pl) notes[i].lane = Math.max(0, pl - (dm < -4 ? 2 : 1));
  }
}

// ---------------------------------------------------------------- quantise + reduce
function quantize(notes, grid, sub) {
  const byKey = new Map();
  for (const nt of notes) {
    const q = Math.round(grid.pos(nt.t) * sub) / sub;
    const key = `${q}:${nt.lane}`;
    const prev = byKey.get(key);
    if (prev && prev.s >= nt.s) continue;
    const out = { ...nt, q, t: grid.time(q) };
    if (nt.len) {
      const qe = Math.round(grid.pos(nt.t + nt.len) * sub) / sub;
      out.len = Math.max(0, grid.time(qe) - out.t);
    }
    byKey.set(key, out);
  }
  return [...byKey.values()].sort((a, b) => a.q - b.q || a.lane - b.lane);
}

function chooseSubdivision(allOnsets, grid) {
  const err = (sub) => {
    let e = 0;
    for (const t of allOnsets) { const p = grid.pos(t) * sub; e += Math.abs(p - Math.round(p)) / sub; }
    return e / Math.max(1, allOnsets.length);
  };
  return err(3) < 0.8 * err(4) ? 3 : 4;
}

function groupByTime(notes) {
  const groups = [];
  for (const nt of notes) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.q - nt.q) < 1e-6) g.notes.push(nt);
    else groups.push({ q: nt.q, t: nt.t, notes: [nt] });
  }
  for (const g of groups) g.s = Math.max(...g.notes.map((n) => n.s));
  return groups;
}

function greedySelect(groups, gapBeats, grid, minSec) {
  const scored = groups.map((g) => {
    const frac = g.q - Math.floor(g.q);
    const bonus = frac < 1e-6 ? 0.35 : Math.abs(frac - 0.5) < 1e-6 ? 0.15 : 0;
    return { g, score: g.s + bonus };
  }).sort((a, b) => b.score - a.score);
  const taken = [];
  const takenQ = [];
  for (const { g } of scored) {
    const gap = Math.max(gapBeats, minSec / grid.beatLen(g.t)) - 1e-6;
    let ok = true;
    // binary search neighbours in takenQ (kept sorted)
    let lo = 0, hi = takenQ.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (takenQ[m] < g.q) lo = m + 1; else hi = m; }
    if (lo < takenQ.length && takenQ[lo] - g.q < gap) ok = false;
    if (lo > 0 && g.q - takenQ[lo - 1] < gap) ok = false;
    if (!ok) continue;
    takenQ.splice(lo, 0, g.q);
    taken.push(g);
  }
  return taken.sort((a, b) => a.q - b.q);
}

const MELODIC_CFG = {
  expert: { gap: 0.24, minSec: 0.07, lanes: 5, chord: 3, susMin: 0.5 },
  hard: { gap: 0.5, minSec: 0.17, lanes: 5, chord: 2, susMin: 0.75 },
  medium: { gap: 1, minSec: 0.32, lanes: 4, chord: 1, susMin: 1 },
  easy: { gap: 2, minSec: 0.6, lanes: 3, chord: 1, susMin: 1 },
};
const DRUM_CFG = {
  expert: { kick: 0.24, kickSec: 0.08, pad: 0.24, padSec: 0.07, pads: 2 },
  hard: { kick: 0.5, kickSec: 0.18, pad: 0.5, padSec: 0.15, pads: 2 },
  medium: { kick: 1, kickSec: 0.33, pad: 0.5, padSec: 0.25, pads: 1 },
  easy: { kick: 2, kickSec: 0.6, pad: 1, padSec: 0.45, pads: 1 },
};

function finalizeSustains(list, grid, susMinBeats) {
  for (let k = 0; k < list.length; k++) {
    const nt = list[k];
    if (!nt.len) continue;
    let next = null;
    for (let j = k + 1; j < list.length; j++) if (list[j].q > nt.q + 1e-6) { next = list[j]; break; }
    const beat = grid.beatLen(nt.t);
    let len = nt.len;
    if (next) len = Math.min(len, next.t - nt.t - beat / 4);
    nt.len = len >= susMinBeats * beat ? len : 0;
  }
}

function reduceMelodic(expertGroups, diff, grid) {
  const cfg = MELODIC_CFG[diff];
  const groups = diff === 'expert' ? expertGroups : greedySelect(expertGroups, cfg.gap, grid, cfg.minSec);
  const out = [];
  for (const g of groups) {
    const sorted = g.notes.slice().sort((a, b) => b.s - a.s);
    const primary = sorted[0];
    let lanes = [primary.lane, ...sorted.slice(1).map((n) => n.lane)];
    if (cfg.lanes < 5) lanes = lanes.map((l) => Math.round((l * (cfg.lanes - 1)) / 4));
    lanes = [...new Set(lanes)].slice(0, cfg.chord);
    for (const lane of lanes) out.push({ t: g.t, q: g.q, lane, len: primary.len || 0, s: primary.s, m: primary.m });
  }
  finalizeSustains(out, grid, cfg.susMin);
  return out;
}

function reduceDrums(expert, diff, grid) {
  const cfg = DRUM_CFG[diff];
  const kicks = groupByTime(expert.filter((n) => n.lane === 0));
  const pads = groupByTime(expert.filter((n) => n.lane !== 0));
  const kSel = greedySelect(kicks, cfg.kick, grid, cfg.kickSec);
  const pSel = greedySelect(pads, cfg.pad, grid, cfg.padSec);
  const pri = { 1: 3, 4: 2, 3: 1, 2: 0 }; // snare > cymbal > tom > hat
  const out = [];
  for (const g of kSel) out.push({ ...g.notes[0], len: 0 });
  for (const g of pSel) {
    const chosen = g.notes.slice().sort((a, b) => (pri[b.lane] - pri[a.lane]) || (b.s - a.s)).slice(0, cfg.pads);
    for (const n of chosen) out.push({ ...n, len: 0 });
  }
  return out.sort((a, b) => a.q - b.q || a.lane - b.lane);
}

function makePhrases(expert, grid, downbeat) {
  const beats = grid.beats;
  const bars = [];
  for (let b = downbeat; b + 4 < beats.length; b += 4) bars.push([beats[b], beats[b + 4]]);
  const counts = bars.map(([s, e]) => {
    let c = 0;
    for (const n of expert) if (n.t >= s && n.t < e) c++;
    return c;
  });
  const phrases = [];
  let cool = 2;
  for (let k = 0; k < bars.length; k++) {
    if (cool > 0) { cool--; continue; }
    if (counts[k] >= 4) {
      const two = counts[k] < 8 && k + 1 < bars.length && counts[k + 1] >= 2;
      phrases.push({ start: bars[k][0] - 0.01, end: bars[two ? k + 1 : k][1] - 0.02 });
      cool = 3 + ((k * 7) % 3);
      if (two) k++;
    }
  }
  return phrases;
}

function markPhrases(notes, phrases) {
  let p = 0;
  for (const n of notes) {
    while (p < phrases.length && n.t > phrases[p].end) p++;
    n.p = p < phrases.length && n.t >= phrases[p].start && n.t <= phrases[p].end ? p : -1;
  }
}

function findDownbeat(beats, kicks, snares) {
  const near = (list, t) => {
    let best = 0;
    for (const o of list) if (Math.abs(o.t - t) < 0.06) best = Math.max(best, o.s);
    return best;
  };
  const scores = [0, 0, 0, 0];
  const limit = Math.min(beats.length, 400);
  for (let b = 0; b < limit; b++) {
    const k = near(kicks, beats[b]), s = near(snares, beats[b]);
    for (let ph = 0; ph < 4; ph++) {
      const pos = (((b - ph) % 4) + 4) % 4;
      if (pos === 0) scores[ph] += k * 1.0 - s * 0.5;
      if (pos === 1 || pos === 3) scores[ph] += s * 0.8;
      if (pos === 2) scores[ph] += k * 0.4;
    }
  }
  return scores.indexOf(Math.max(...scores));
}

const rms = (x) => {
  let s = 0;
  const step = 4;
  for (let i = 0; i < x.length; i += step) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length / step));
};

// ---------------------------------------------------------------- chart editor helpers
/**
 * Rebuild easy / medium / hard from an (edited) expert chart, the same way the AI charts are reduced.
 * notes: [{ t, lane, len, q?, s?, m? }]; returns { easy, medium, hard } with phrases marked.
 */
export function reduceFromExpert(inst, expertNotes, beats, phrases = [], sub = 4) {
  const grid = new Grid(beats);
  const expert = expertNotes.map((n) => ({ ...n, q: Math.round(grid.pos(n.t) * sub * 2) / (sub * 2), s: n.s ?? 1, len: n.len || 0 }))
    .sort((a, b) => a.q - b.q || a.lane - b.lane);
  const groups = groupByTime(expert);
  const out = {};
  for (const d of ['easy', 'medium', 'hard']) {
    out[d] = inst === 'drums' ? reduceDrums(expert, d, grid) : reduceMelodic(groups, d, grid);
    markPhrases(out[d], phrases);
  }
  return out;
}

/** Overdrive phrase index (n.p) for every note from a phrase list. */
export function applyPhrases(notes, phrases) { markPhrases(notes, [...phrases].sort((a, b) => a.start - b.start)); }

// ---------------------------------------------------------------- main
export function buildCharts({ stems, duration, aiNotes = null }, onProgress = () => {}) {
  const { feats } = extractFeatures(stems, (p) => onProgress(p * 0.45, 'Spectral analysis'));

  onProgress(0.47, 'Tracking tempo');
  const parts = [
    [feats.drums.fluxKick, 1.0], [feats.drums.fluxSnare, 0.8], [feats.drums.fluxHat, 0.25],
    [feats.bass.flux, 0.5], [feats.guitar.flux, 0.4], [feats.keys.flux, 0.3],
  ];
  const nF = feats.bass.flux.length;
  const beatOdf = new Float32Array(nF);
  for (const [odf, w] of parts) {
    const sc = percentile(odf, 0.95);
    if (sc <= 1e-9) continue;
    for (let i = 0; i < nF; i++) beatOdf[i] += (w * Math.min(3, odf[i] / sc));
  }
  const period = estimateTempo(beatOdf);
  const periodSec = period / FPS;
  const rawBeats = trackBeats(beatOdf, period);
  const beats = extendBeats(rawBeats, duration, periodSec);
  const grid = new Grid(beats);
  const bpm = 60 / periodSec;

  onProgress(0.55, 'Detecting drum hits');
  const stemRms = Object.fromEntries(INSTRUMENTS.map((n) => [n, stems[n] ? rms(stems[n]) : 0]));
  const maxRms = Math.max(...Object.values(stemRms));

  const raw = {};
  const transcriber = {};
  const dropped = {};
  raw.drums = buildDrums(feats.drums);
  const melodic = ['bass', 'guitar', 'keys', 'vocals'];
  melodic.forEach((inst, k) => {
    onProgress(0.62 + k * 0.07, `Transcribing ${inst}`);
    const events = aiNotes?.[inst] || (inst === 'keys' ? aiNotes?.piano : null);
    if (events?.length && stems[inst]) {
      // neural note events, minus notes that really belong to another stem
      const res = attributeNotes(inst, events, stems, SR);
      raw[inst] = notesFromEvents(inst, res.notes, grid, assignLanes, FPS);
      transcriber[inst] = 'basic-pitch';
      dropped[inst] = res.dropped;
    } else if (stems[inst]) {
      raw[inst] = buildMelodic(inst, feats[inst], stems[inst], grid);
      transcriber[inst] = 'heuristic';
    } else raw[inst] = [];
  });

  const allOnsetTimes = [...raw.drums, ...raw.bass, ...raw.guitar].filter((n) => n.s > 0.5).map((n) => n.t);
  const sub = chooseSubdivision(allOnsetTimes, grid);
  const downbeat = findDownbeat(beats, raw.drums.filter((n) => n.lane === 0), raw.drums.filter((n) => n.lane === 1));

  onProgress(0.92, 'Building charts');
  const charts = {};
  for (const inst of INSTRUMENTS) {
    const q = quantize(raw[inst], grid, sub);
    const tooQuiet = stemRms[inst] < 0.003 || stemRms[inst] < 0.08 * maxRms;
    let expert;
    if (inst === 'drums') {
      expert = [];
      for (const g of groupByTime(q)) {
        const kick = g.notes.filter((n) => n.lane === 0);
        const pads = g.notes.filter((n) => n.lane !== 0).sort((a, b) => b.s - a.s).slice(0, 2);
        expert.push(...kick.slice(0, 1), ...pads);
      }
    } else if (transcriber[inst] === 'basic-pitch') {
      expert = q; // chords come from the real simultaneous notes
    } else {
      // chords for guitar/keys (heuristic path: chroma spread)
      const withChords = [];
      const chordCands = q.filter((n) => inst !== 'bass' && n.chroma >= 3 && n.s > 0.45).sort((a, b) => b.chroma - a.chroma || b.s - a.s);
      const chordSet = new Set(chordCands.slice(0, Math.floor(q.length * 0.35)));
      for (const n of q) {
        withChords.push(n);
        if (chordSet.has(n)) {
          const l2 = n.lane + 2 <= 4 ? n.lane + 2 : n.lane - 2;
          withChords.push({ ...n, lane: l2, s: n.s * 0.9 });
          if (inst === 'keys' && n.chroma >= 4) {
            const l3 = Math.min(4, Math.max(0, (n.lane + l2) >> 1));
            if (l3 !== n.lane && l3 !== l2) withChords.push({ ...n, lane: l3, s: n.s * 0.85 });
          }
        }
      }
      expert = withChords;
    }
    const expertGroups = groupByTime(expert);
    const notes = {};
    for (const d of DIFFS) {
      notes[d] = inst === 'drums' ? reduceDrums(expert, d, grid) : reduceMelodic(expertGroups, d, grid);
    }
    const phrases = makePhrases(notes.expert, grid, downbeat);
    const available = !tooQuiet && notes.expert.length >= 24;
    for (const d of DIFFS) {
      markPhrases(notes[d], phrases);
      notes[d] = notes[d].map((n) => ({
        t: +n.t.toFixed(4), lane: n.lane, len: +(n.len || 0).toFixed(4), s: +n.s.toFixed(3),
        m: Math.round(n.m ?? 60), p: n.p, q: +n.q.toFixed(4),
      }));
    }
    charts[inst] = {
      available,
      reason: available ? '' : tooQuiet ? 'Instrument not present in this song' : 'Not enough notes detected',
      notes,
      phrases,
    };
  }
  onProgress(1, 'Done');
  return { bpm: +bpm.toFixed(2), beats: beats.map((b) => +b.toFixed(4)), downbeat, sub, charts, analysis: { transcriber, dropped } };
}
