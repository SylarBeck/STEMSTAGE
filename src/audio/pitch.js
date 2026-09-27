// Microphone + pitch detection for singing. YIN on 2048-sample frames from an AnalyserNode (~60 Hz),
// voiced/unvoiced by YIN confidence and level. Returns MIDI pitch (fractional) or 0 when silent.

/** YIN fundamental estimate. Returns { hz, conf } (conf 0..1, higher is cleaner). */
export function yin(buf, sampleRate, minHz = 70, maxHz = 1100) {
  const n = buf.length;
  const maxTau = Math.min(Math.floor(sampleRate / minHz), (n >> 1) - 1);
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const d = new Float32Array(maxTau + 1);
  const W = n - maxTau;
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < 0.15) { while (t + 1 <= maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) { // no dip under the threshold: take the global minimum if it's decent
    let best = minTau;
    for (let t = minTau; t <= maxTau; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.35) return { hz: 0, conf: 0 };
    tau = best;
  }
  // parabolic interpolation
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const t = tau + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0);
  return { hz: sampleRate / t, conf: 1 - Math.min(1, b) };
}

export const hzToMidi = (hz) => (hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0);

export class Mic {
  constructor(ctx) {
    this.ctx = ctx;
    this.stream = null;
    this.analyser = null;
    this.buf = new Float32Array(2048);
    this.midi = 0;
    this.level = 0;
    this.smooth = 0;
  }

  get active() { return !!this.stream; }

  /** raw: an instrument (no echo cancellation), lowHz: lowest note to track (bass goes down to ~40 Hz) */
  async start(deviceId = '', { raw = false, lowHz = 70 } = {}) {
    if (this.stream) return;
    this.lowHz = lowHz;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: !raw, noiseSuppression: false, autoGainControl: false },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = lowHz < 60 ? 4096 : 2048; // YIN needs two periods: 4096 reaches a bass's low E (41 Hz)
    this.buf = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser); // analysis only — the mic is never sent to the speakers
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.source?.disconnect(); } catch { /* gone */ }
    this.stream = null; this.source = null; this.analyser = null;
    this.midi = 0; this.level = 0;
  }

  /** Read the current pitch. Call once per frame. */
  read() {
    if (!this.analyser) return { midi: 0, level: 0, rms: 0 };
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    this.level = Math.min(1, rms * 8);
    let midi = 0;
    if (rms > 0.012) {
      const { hz, conf } = yin(this.buf, this.ctx.sampleRate, this.lowHz || 70);
      if (hz && conf > 0.55) midi = hzToMidi(hz);
    }
    // light smoothing that still follows jumps between notes
    if (midi && this.smooth && Math.abs(midi - this.smooth) < 1.2) this.smooth = this.smooth * 0.55 + midi * 0.45;
    else this.smooth = midi;
    this.midi = this.smooth;
    return { midi: this.midi, level: this.level, rms };
  }

  static async devices() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { return []; }
  }
}
