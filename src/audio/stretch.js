// Pitch-preserving time stretch (phase vocoder with identity phase locking, Laroche & Dolson 1999).
// Used by practice mode to slow songs down without turning them into chipmunk/tape-drag audio.
import { FFT, hann } from './dsp.js';

const TWO_PI = Math.PI * 2;
const wrap = (x) => x - TWO_PI * Math.round(x / TWO_PI);

/**
 * @param {Float32Array} L
 * @param {Float32Array} R
 * @param {number} rate  playback speed (0.5 = half speed). Output length ≈ input length / rate.
 */
export function stretchStereo(L, R, rate, onProgress = () => {}) {
  if (Math.abs(rate - 1) < 1e-3) return { L: L.slice(), R: R.slice() };
  const N = 2048, Hs = 512, B = N / 2 + 1;
  const Ha = Hs * rate;
  const len = L.length;
  const outLen = Math.ceil(len / rate) + N;
  const oL = new Float32Array(outLen), oR = new Float32Array(outLen);
  const win = hann(N);
  const fft = new FFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const X = [new Float64Array(B), new Float64Array(B), new Float64Array(B), new Float64Array(B)]; // Lr Li Rr Ri
  const S = [new Float64Array(B), new Float64Array(B), new Float64Array(B), new Float64Array(B)];
  const mag = [new Float64Array(B), new Float64Array(B)];
  const phase = [new Float64Array(B), new Float64Array(B)];
  const prevPhase = [new Float64Array(B), new Float64Array(B)];
  const synPhase = [new Float64Array(B), new Float64Array(B)];
  const peakOf = new Int32Array(B);
  const peakPhase = new Float64Array(B);
  const norm = 1 / 1.5;
  const frames = Math.floor((len - N) / Ha) + 1;
  let prevPos = 0;

  for (let f = 0; f < frames; f++) {
    const pos = Math.round(f * Ha);
    const hop = f === 0 ? Ha : pos - prevPos;
    prevPos = pos;
    for (let n = 0; n < N; n++) { const p = pos + n; re[n] = p < len ? L[p] * win[n] : 0; im[n] = p < len ? R[p] * win[n] : 0; }
    fft.forwardPair(re, im, X[0], X[1], X[2], X[3]);
    for (let c = 0; c < 2; c++) {
      const xr = X[c * 2], xi = X[c * 2 + 1], m = mag[c], ph = phase[c], pp = prevPhase[c], sp = synPhase[c];
      for (let k = 0; k < B; k++) { m[k] = Math.hypot(xr[k], xi[k]); ph[k] = Math.atan2(xi[k], xr[k]); }
      if (f === 0) {
        for (let k = 0; k < B; k++) sp[k] = ph[k];
      } else {
        // peaks: local maxima over +-2 bins; every bin is locked to its nearest peak
        const peaks = [];
        for (let k = 2; k < B - 2; k++) if (m[k] > m[k - 1] && m[k] >= m[k + 1] && m[k] > m[k - 2] && m[k] >= m[k + 2]) peaks.push(k);
        if (!peaks.length) peaks.push(1);
        let pi = 0;
        for (let k = 0; k < B; k++) {
          while (pi + 1 < peaks.length && Math.abs(peaks[pi + 1] - k) < Math.abs(peaks[pi] - k)) pi++;
          peakOf[k] = peaks[pi];
        }
        for (const k of peaks) {
          const omega = (TWO_PI * k) / N;
          const dphi = wrap(ph[k] - pp[k] - omega * hop);
          peakPhase[k] = sp[k] + (omega + dphi / hop) * Hs;
        }
        for (let k = 0; k < B; k++) { const p = peakOf[k]; sp[k] = peakPhase[p] + (ph[k] - ph[p]); }
      }
      pp.set(ph);
      const sr = S[c * 2], si = S[c * 2 + 1];
      for (let k = 0; k < B; k++) { sr[k] = m[k] * Math.cos(sp[k]); si[k] = m[k] * Math.sin(sp[k]); }
    }
    fft.inversePair(S[0], S[1], S[2], S[3], re, im);
    const o = f * Hs;
    for (let n = 0; n < N && o + n < outLen; n++) {
      const w = win[n] * norm;
      oL[o + n] += re[n] * w;
      oR[o + n] += im[n] * w;
    }
    if ((f & 255) === 0) onProgress(f / frames);
  }
  const trimmed = Math.ceil(len / rate);
  return { L: oL.subarray(0, trimmed).slice(), R: oR.subarray(0, trimmed).slice() };
}
