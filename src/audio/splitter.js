// In-browser fallback stem splitter (no neural network).
// Harmonic/percussive separation via median filtering on the STFT, then the harmonic
// layer is split by frequency (bass) and spectral stability (sustained "keys" vs
// articulated "guitar"). Masks sum to one, so the stems add back up to the mix.
// It is a heuristic: use the AI splitter for real instrument separation.
import { FFT, hann, slidingMedian } from './dsp.js';

export const DSP_STEMS = ['drums', 'bass', 'guitar', 'keys', 'other'];

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function splitDSP(L, R, sr, onProgress = () => {}) {
  const N = 2048, H = 512, B = N / 2 + 1;
  const len = L.length;
  const pad = N;
  const F = Math.ceil((len + pad) / H) + 1;
  const C = 160, K = 16;
  const MAXF = C + 2 * K;
  const S = DSP_STEMS.length;

  const win = hann(N);
  const fft = new FFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const tmpR = new Float64Array(B), tmpI = new Float64Array(B);
  const tmpR2 = new Float64Array(B), tmpI2 = new Float64Array(B);

  const XLr = new Float32Array(MAXF * B), XLi = new Float32Array(MAXF * B);
  const XRr = new Float32Array(MAXF * B), XRi = new Float32Array(MAXF * B);
  const MAG = new Float32Array(MAXF * B);
  const Hs = new Float32Array(C * B), Hl = new Float32Array(C * B);
  const col = new Float32Array(MAXF), colS = new Float32Array(MAXF), colL = new Float32Array(MAXF);
  const prow = new Float32Array(B);

  // Frequency weights
  const binHz = sr / N;
  const lowW = new Float32Array(B), gBand = new Float32Array(B), kBand = new Float32Array(B);
  for (let b = 0; b < B; b++) {
    const f = b * binHz;
    lowW[b] = 1 - smooth(160, 300, f);
    gBand[b] = smooth(70, 110, f) * (1 - smooth(5000, 9000, f));
    kBand[b] = smooth(50, 80, f) * (1 - smooth(7000, 11000, f));
  }

  // Outputs + overlap-add ring buffers
  const out = DSP_STEMS.map(() => [new Int16Array(len), new Int16Array(len)]);
  const ACC = (C + 4) * H + N;
  const acc = DSP_STEMS.map(() => [new Float32Array(ACC), new Float32Array(ACC)]);
  let accStart = -pad;
  const norm = 1 / 1.5; // sum of hann^2 at hop N/4
  const masks = DSP_STEMS.map(() => new Float32Array(B));
  const sR = new Float64Array(B), sI = new Float64Array(B), tR = new Float64Array(B), tI = new Float64Array(B);

  const frameAt = (f, local) => {
    const s0 = f * H - pad;
    for (let n = 0; n < N; n++) {
      const p = s0 + n;
      const w = win[n];
      re[n] = p >= 0 && p < len ? L[p] * w : 0;
      im[n] = p >= 0 && p < len ? R[p] * w : 0;
    }
    fft.forwardPair(re, im, tmpR, tmpI, tmpR2, tmpI2);
    const o = local * B;
    for (let b = 0; b < B; b++) {
      XLr[o + b] = tmpR[b]; XLi[o + b] = tmpI[b];
      XRr[o + b] = tmpR2[b]; XRi[o + b] = tmpI2[b];
      const mr = 0.5 * (tmpR[b] + tmpR2[b]), mi = 0.5 * (tmpI[b] + tmpI2[b]);
      MAG[o + b] = Math.sqrt(mr * mr + mi * mi);
    }
  };

  for (let cs = 0; cs < F; cs += C) {
    const ce = Math.min(F, cs + C);
    const fa = Math.max(0, cs - K), fb = Math.min(F, ce + K);
    const nf = fb - fa;
    for (let f = fa; f < fb; f++) frameAt(f, f - fa);

    // Time medians (harmonic), short and long
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < nf; i++) col[i] = MAG[i * B + b];
      slidingMedian(col, nf, 17, colS);
      slidingMedian(col, nf, 31, colL);
      for (let f = cs; f < ce; f++) {
        const j = f - cs, i = f - fa;
        Hs[j * B + b] = colS[i];
        Hl[j * B + b] = colL[i];
      }
    }

    for (let f = cs; f < ce; f++) {
      const j = f - cs, i = f - fa, o = i * B;
      slidingMedian(MAG.subarray(o, o + B), B, 17, prow);
      for (let b = 0; b < B; b++) {
        const hs = Hs[j * B + b], hl = Hl[j * B + b], p = prow[b];
        const h2 = hs * hs, p2 = p * p;
        const mh = h2 / (h2 + p2 + 1e-12);
        const mp = 1 - mh;
        const bass = mh * lowW[b];
        const high = mh - bass;
        const stab = smooth(0.55, 0.95, hl / (hs + 1e-9));
        const keys = high * stab * kBand[b];
        const guitar = high * (1 - stab) * gBand[b];
        masks[0][b] = mp;
        masks[1][b] = bass;
        masks[2][b] = guitar;
        masks[3][b] = keys;
        masks[4][b] = Math.max(0, 1 - mp - bass - guitar - keys);
      }
      const offset = f * H - pad - accStart;
      for (let s = 0; s < S; s++) {
        const m = masks[s];
        for (let b = 0; b < B; b++) {
          sR[b] = XLr[o + b] * m[b]; sI[b] = XLi[o + b] * m[b];
          tR[b] = XRr[o + b] * m[b]; tI[b] = XRi[o + b] * m[b];
        }
        fft.inversePair(sR, sI, tR, tI, re, im);
        const aL = acc[s][0], aR = acc[s][1];
        for (let n = 0; n < N; n++) {
          const w = win[n] * norm;
          aL[offset + n] += re[n] * w;
          aR[offset + n] += im[n] * w;
        }
      }
    }

    // Flush completed samples
    const doneUpTo = ce * H - pad;
    const count = doneUpTo - accStart;
    for (let s = 0; s < S; s++) {
      for (let c = 0; c < 2; c++) {
        const a = acc[s][c], dst = out[s][c];
        for (let k = 0; k < count; k++) {
          const pos = accStart + k;
          if (pos >= 0 && pos < len) {
            const v = a[k] * 32767;
            dst[pos] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v);
          }
        }
        a.copyWithin(0, count);
        a.fill(0, ACC - count);
      }
    }
    accStart = doneUpTo;
    onProgress(ce / F);
  }

  const stems = {};
  DSP_STEMS.forEach((name, i) => { stems[name] = out[i]; });
  return stems;
}
