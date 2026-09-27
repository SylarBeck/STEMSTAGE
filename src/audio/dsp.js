// Core DSP primitives shared by the splitter and the charter (runs inside a worker).

export class FFT {
  constructor(n) {
    this.n = n;
    const levels = Math.round(Math.log2(n));
    if (1 << levels !== n) throw new Error('FFT size must be a power of two');
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place complex FFT. inverse=true applies 1/n scaling. */
  transform(re, im, inverse = false) {
    const n = this.n, rev = this.rev, cos = this.cos, sin = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const wr = cos[k], wi = sgn * sin[k];
          const l = j + half;
          const tr = re[l] * wr - im[l] * wi;
          const ti = re[l] * wi + im[l] * wr;
          re[l] = re[j] - tr; im[l] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
    if (inverse) {
      const s = 1 / n;
      for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; }
    }
  }

  /**
   * Forward FFT of two real signals at once (packed as re + i*im).
   * Writes half spectra (n/2+1 bins) of a into (ar, ai) and b into (br, bi).
   */
  forwardPair(re, im, ar, ai, br, bi) {
    this.transform(re, im, false);
    const n = this.n, h = n >> 1;
    for (let k = 0; k <= h; k++) {
      const nk = (n - k) & (n - 1);
      const zr = re[k], zi = im[k], cr = re[nk], ci = im[nk];
      ar[k] = 0.5 * (zr + cr); ai[k] = 0.5 * (zi - ci);
      br[k] = 0.5 * (zi + ci); bi[k] = 0.5 * (cr - zr);
    }
  }

  /** Inverse of forwardPair: builds z = A + iB and returns a in re, b in im. */
  inversePair(ar, ai, br, bi, re, im) {
    const n = this.n, h = n >> 1;
    re[0] = ar[0] - bi[0]; im[0] = ai[0] + br[0];
    re[h] = ar[h] - bi[h]; im[h] = ai[h] + br[h];
    for (let k = 1; k < h; k++) {
      re[k] = ar[k] - bi[k]; im[k] = ai[k] + br[k];
      re[n - k] = ar[k] + bi[k]; im[n - k] = br[k] - ai[k];
    }
    this.transform(re, im, true);
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Sliding-window median with edge replication. O(n*w) using an insertion-sorted window. */
export function slidingMedian(src, n, w, dst) {
  const half = w >> 1;
  const win = new Float64Array(w);
  const at = (i) => src[i < 0 ? 0 : i >= n ? n - 1 : i];
  for (let k = 0; k < w; k++) win[k] = at(k - half);
  win.sort();
  for (let i = 0; i < n; i++) {
    dst[i] = win[half];
    const outV = at(i - half), inV = at(i + half + 1);
    // remove outV
    let p = 0;
    while (p < w - 1 && win[p] !== outV) p++;
    // insert inV keeping sorted: shift toward p
    if (inV > win[p]) {
      while (p < w - 1 && win[p + 1] < inV) { win[p] = win[p + 1]; p++; }
    } else {
      while (p > 0 && win[p - 1] > inV) { win[p] = win[p - 1]; p--; }
    }
    win[p] = inV;
  }
}

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/** Crude 2:1 decimation with a 3-tap lowpass. */
export function decimate2(x) {
  const n = x.length >> 1;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 2;
    y[i] = 0.25 * (x[j - 1] || 0) + 0.5 * x[j] + 0.25 * (x[j + 1] || 0);
  }
  return y;
}

export function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

/** YIN pitch estimate on x[start .. start+W+maxTau). Returns {f0, conf} or null. */
export function yin(x, start, W, sr, fmin, fmax, thresh = 0.15) {
  const minTau = Math.max(2, Math.floor(sr / fmax));
  const maxTau = Math.min(Math.floor(sr / fmin), x.length - start - W - 1);
  if (maxTau <= minTau + 2) return null;
  const d = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[start + j] - x[start + j + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  let run = 0;
  const c = new Float64Array(maxTau + 1);
  c[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau];
    c[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let best = -1;
  for (let tau = minTau; tau < maxTau; tau++) {
    if (c[tau] < thresh) {
      while (tau + 1 < maxTau && c[tau + 1] < c[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let mv = Infinity;
    for (let tau = minTau; tau < maxTau; tau++) if (c[tau] < mv) { mv = c[tau]; best = tau; }
    if (mv > 0.45) return null;
  }
  const a = c[best - 1], b = c[best], cc = c[best + 1];
  const denom = a - 2 * b + cc;
  const shift = denom !== 0 ? (0.5 * (a - cc)) / denom : 0;
  const tau = best + Math.max(-1, Math.min(1, shift));
  return { f0: sr / tau, conf: 1 - Math.min(1, c[best]) };
}
