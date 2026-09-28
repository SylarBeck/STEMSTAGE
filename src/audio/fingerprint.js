// Audio fingerprints for lining up one player's chart with another player's copy of the song.
// Two recordings of the same song rarely start at the same moment (a YouTube rip has a longer intro, a CD rip
// has leading silence), so a chart made from one is off by a fixed amount on the other. A fingerprint is two
// curves sampled 50 times a second: where the hits are (spectral-flux onset strength) and how loud the song is
// (so a chorus and the verse before it look different). Sliding the chart uploader's curves over ours finds that
// offset to within a few milliseconds; a different version of the song (live, radio edit, another speed)
// never lines up, and is refused instead of being played out of sync.
import { FFT, hann } from './dsp.js';

export const FP_FPS = 50;
const N = 512;

/**
 * Fingerprint of a song from its stems (planar 16-bit stereo, as getAudio() returns them): the stems are mixed
 * back together, so any split of the same recording gives the same fingerprint.
 * → { v: 1, fps, onset: Uint8Array, loud: Uint8Array }
 */
export function fingerprint(stems, sampleRate = 44100) {
  const list = Object.values(stems || {}).filter((s) => s && s.length);
  if (!list.length) throw new Error('no audio');
  const frames = Math.max(...list.map((s) => s.length >> 1));
  // mono mix, box-decimated to ~11 kHz (plenty for where the hits are)
  const d = Math.max(1, Math.floor(sampleRate / 11025));
  const sr = sampleRate / d;
  const n = Math.floor(frames / d);
  const x = new Float32Array(n);
  for (const s of list) {
    const f = s.length >> 1;
    for (let i = 0, b = 0; i < n; i++, b += d) {
      let acc = 0;
      for (let k = 0; k < d && b + k < f; k++) acc += s[b + k] + s[f + b + k];
      x[i] += acc;
    }
  }
  const g = 1 / (32768 * 2 * d);
  const hop = sr / FP_FPS;
  const count = Math.max(1, Math.floor((n - N) / hop) + 1);
  const fft = new FFT(N), win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const top = Math.min(N / 2, Math.round((5000 / sr) * N));
  let prev = new Float64Array(top + 1), cur = new Float64Array(top + 1);
  const onset = new Float32Array(count), loud = new Float32Array(count);
  for (let t = 0; t < count; t++) {
    const s0 = Math.round(t * hop);
    let e = 0;
    for (let i = 0; i < N; i++) { const v = (x[s0 + i] || 0) * g; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    fft.transform(re, im);
    let flux = 0;
    for (let k = 1; k <= top; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const dv = cur[k] - prev[k];
      if (dv > 0) flux += dv;
    }
    onset[t] = t ? flux : 0;
    loud[t] = 10 * Math.log10(e / N + 1e-10);
    [prev, cur] = [cur, prev];
  }
  return { v: 1, fps: FP_FPS, onset: quantize(onset, 0.99), loud: quantizeDb(loud) };
}

/** 0..255, scaled to the p-th percentile (the loudest hits clip instead of squashing everything else). */
function quantize(a, p) {
  const sorted = Float32Array.from(a).sort();
  const hi = sorted[Math.floor((sorted.length - 1) * p)] || 1;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((a[i] / hi) * 255)));
  return out;
}
/** Loudness in dB → 0..255 over the 60 dB below the loudest frame. */
function quantizeDb(a) {
  let hi = -Infinity;
  for (const v of a) if (v > hi) hi = v;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(((a[i] - hi + 60) / 60) * 255)));
  return out;
}

// ---------------------------------------------------------------- storage: base64 so it fits in JSON
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const packFingerprint = (fp) => ({ v: fp.v, fps: fp.fps, onset: b64(fp.onset), loud: b64(fp.loud) });
export const unpackFingerprint = (p) => ({ v: p.v, fps: p.fps, onset: unb64(p.onset), loud: unb64(p.loud) });

// ---------------------------------------------------------------- alignment
/** Zero-mean, unit-variance copy (so loud and quiet recordings compare). */
function standardize(u8, smooth = 0) {
  let a = Float32Array.from(u8);
  if (smooth > 1) { // moving average: loudness only needs the shape of the song, not every frame
    const out = new Float32Array(a.length);
    let acc = 0;
    for (let i = 0; i < a.length; i++) { acc += a[i]; if (i >= smooth) acc -= a[i - smooth]; out[i] = acc / Math.min(i + 1, smooth); }
    a = out;
  }
  let m = 0;
  for (const v of a) m += v;
  m /= a.length || 1;
  let s = 0;
  for (let i = 0; i < a.length; i++) { a[i] -= m; s += a[i] * a[i]; }
  s = Math.sqrt(s / (a.length || 1)) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= s;
  return a;
}

/** Pearson-style correlation of a against b shifted by `lag` frames (b[i + lag] ~ a[i]), over their overlap. */
function corrAt(a, b, lag, from = 0, to = a.length) {
  const i0 = Math.max(from, -lag), i1 = Math.min(to, b.length - lag);
  if (i1 - i0 < 50) return { r: -1, n: 0 };
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * b[i + lag];
  return { r: s / (i1 - i0), n: i1 - i0 };
}

/**
 * Line up a reference fingerprint (the chart uploader's recording) with ours.
 * → { ok, offset, confidence, reason }: add `offset` seconds to the chart's times to play it on our audio.
 */
export function alignFingerprints(ref, mine, { maxShift = 45 } = {}) {
  if (!ref || !mine || ref.fps !== mine.fps) return { ok: false, reason: 'no fingerprint' };
  const fps = ref.fps;
  const aO = standardize(ref.onset), bO = standardize(mine.onset);
  const aL = standardize(ref.loud, fps), bL = standardize(mine.loud, fps);
  const maxLag = Math.round(maxShift * fps);
  const minOverlap = Math.min(aO.length, bO.length) * 0.5;
  // coarse: every lag, onsets for precision + loudness so a one-bar slip in a loop scores lower than the truth
  const scores = new Float32Array(2 * maxLag + 1).fill(-2);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const o = corrAt(aO, bO, lag), l = corrAt(aL, bL, lag);
    if (o.n < minOverlap) continue;
    scores[lag + maxLag] = 0.65 * o.r + 0.35 * l.r;
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const lag = best - maxLag;
  const top = scores[best];
  // the runner-up away from the peak: a clear winner or a coin toss?
  let second = -2;
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - best) > fps / 4 && scores[i] > second) second = scores[i];
  // sub-frame peak (parabola through the peak and its neighbours)
  const y0 = scores[best - 1] ?? top, y2 = scores[best + 1] ?? top;
  const den = y0 - 2 * top + y2;
  const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  const offset = (lag + frac) / fps;
  // the two recordings must stay together all the way through: a different edit or speed drifts apart
  const third = Math.floor(aO.length / 3);
  const local = (from, to) => {
    let bl = lag, br = -2;
    for (let l = lag - 10; l <= lag + 10; l++) { const { r, n } = corrAt(aO, bO, l, from, to); if (n > 100 && r > br) { br = r; bl = l; } }
    return { lag: bl, r: br };
  };
  const head = local(0, third), tail = local(2 * third, aO.length);
  const drift = Math.abs(head.lag - tail.lag) / fps;
  const confidence = Math.max(0, Math.min(1, (top - 0.15) / 0.5)) * Math.max(0, Math.min(1, (top - second) / 0.12));
  const base = { offset, confidence, score: top, runnerUp: second, drift };
  if (top < 0.3) return { ok: false, reason: 'the recordings don\'t match (a different song or version?)', ...base };
  if (top - second < 0.04) return { ok: false, reason: 'couldn\'t tell where the charts line up (too repetitive to be sure)', ...base };
  if (drift > 0.06) return { ok: false, reason: 'the recordings drift apart (a different edit or speed)', ...base };
  return { ok: true, ...base };
}
