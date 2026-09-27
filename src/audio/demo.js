// Procedurally composed + synthesised demo track ("Neon Overdrive", 124 BPM, E minor).
// Each instrument renders into its own stem, so the demo skips separation and goes
// straight to the auto-charter.
import { STEM_RATE } from './engine.js';

const BPM = 124;
const BEAT = 60 / BPM;
const T0 = 0.5;

const CH = {
  Em: { bass: 40, gtr: 52, keys: [64, 67, 71] },
  C: { bass: 36, gtr: 48, keys: [60, 64, 67] },
  G: { bass: 43, gtr: 55, keys: [62, 67, 71] },
  D: { bass: 38, gtr: 50, keys: [62, 66, 69] },
  Am: { bass: 45, gtr: 57, keys: [60, 64, 69] },
};

const SECTIONS = [
  { name: 'intro', bars: 4, prog: ['Em', 'C', 'G', 'D'] },
  { name: 'verse', bars: 8, prog: ['Em', 'C', 'G', 'D'] },
  { name: 'chorus', bars: 8, prog: ['C', 'G', 'D', 'Em'] },
  { name: 'bridge', bars: 4, prog: ['Am', 'Em', 'C', 'D'] },
  { name: 'chorus2', bars: 8, prog: ['C', 'G', 'D', 'Em'] },
  { name: 'outro', bars: 4, prog: ['Em', 'C', 'D', 'Em'] },
];

const LEAD = [
  [[0, 67, 0.5], [0.5, 69, 0.5], [1, 71, 1], [2, 74, 0.5], [2.5, 71, 0.5], [3, 69, 1]],
  [[0, 67, 1.5], [1.5, 71, 0.5], [2, 74, 1], [3, 76, 1]],
  [[0, 78, 1], [1, 76, 0.5], [1.5, 74, 0.5], [2, 69, 2]],
  [[0, 71, 0.5], [0.5, 74, 0.5], [1, 76, 0.5], [1.5, 79, 0.5], [2, 76, 2]],
];

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function makeNoise(seconds = 2) {
  const n = Math.floor(STEM_RATE * seconds);
  const b = new AudioBuffer({ length: n, sampleRate: STEM_RATE, numberOfChannels: 1 });
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function distCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

/** Collect every musical event, then render per-instrument. */
function compose() {
  const ev = { drums: [], bass: [], guitar: [], keys: [], other: [] };
  let bar = 0;
  const at = (b, beat) => T0 + (b * 4 + beat) * BEAT;
  for (const sec of SECTIONS) {
    for (let i = 0; i < sec.bars; i++, bar++) {
      const chord = CH[sec.prog[i % sec.prog.length]];
      const last = i === sec.bars - 1;
      const D = (type, beat, v = 1, p) => ev.drums.push({ type, t: at(bar, beat), v, p });
      switch (sec.name) {
        case 'intro': {
          for (let e = 0; e < 8; e++) D('hat', e * 0.5, e % 2 ? 0.5 : 0.8);
          if (i >= 2) { D('kick', 0); D('kick', 2); D('snare', 3, 0.8); }
          else D('kick', 0, 0.7);
          if (last) { for (let s = 0; s < 4; s++) D('snare', 3 + s * 0.25, 0.5 + s * 0.15); }
          ev.keys.push({ type: 'pad', t: at(bar, 0), notes: chord.keys, len: 4 * BEAT });
          for (let e = 0; e < 8; e++) ev.keys.push({ type: 'ep', t: at(bar, e * 0.5), notes: [chord.keys[e % 3] + 12], len: 0.45 * BEAT, v: 0.5 });
          if (i >= 2) ev.bass.push({ t: at(bar, 0), m: chord.bass, len: 3.8 * BEAT });
          if (last) ev.guitar.push({ t: at(bar, 0), root: chord.gtr, len: 3.5 * BEAT });
          break;
        }
        case 'verse':
        case 'outro': {
          const final = sec.name === 'outro' && last;
          if (final) {
            D('crash', 0, 1); D('kick', 0);
            ev.bass.push({ t: at(bar, 0), m: chord.bass, len: 4 * BEAT });
            ev.guitar.push({ t: at(bar, 0), root: chord.gtr, len: 4 * BEAT });
            ev.keys.push({ type: 'pad', t: at(bar, 0), notes: chord.keys, len: 4 * BEAT });
            ev.keys.push({ type: 'ep', t: at(bar, 0), notes: chord.keys, len: 4 * BEAT, v: 0.8 });
            break;
          }
          D('kick', 0); D('kick', 1.5, 0.8); D('kick', 2);
          D('snare', 1); D('snare', 3);
          for (let e = 0; e < 8; e++) D('hat', e * 0.5, e % 2 ? 0.45 : 0.75);
          if (i === 0) D('crash', 0, 0.8);
          for (let e = 0; e < 8; e++) {
            const m = e === 7 ? chord.bass + 12 : chord.bass;
            ev.bass.push({ t: at(bar, e * 0.5), m, len: 0.42 * BEAT });
          }
          ev.guitar.push({ t: at(bar, 0), root: chord.gtr, len: 0.9 * BEAT });
          for (let e = 2; e < 8; e++) ev.guitar.push({ t: at(bar, e * 0.5), root: chord.gtr, len: 0.3 * BEAT, muted: true });
          for (let q = 0; q < 4; q++) ev.keys.push({ type: 'ep', t: at(bar, q + 0.5), notes: chord.keys, len: 0.35 * BEAT, v: 0.6 });
          break;
        }
        case 'chorus':
        case 'chorus2': {
          if (i % 4 === 0) D('crash', 0, 1); else D('hat', 0, 0.8, 'open');
          D('kick', 0); D('kick', 1.5, 0.85); D('kick', 2); D('kick', 3.5, 0.8);
          D('snare', 1); D('snare', 3);
          for (let e = 1; e < 8; e++) D('hat', e * 0.5, e % 2 ? 0.5 : 0.7, e % 2 ? undefined : 'open');
          if (last && sec.name === 'chorus') { D('tom', 3, 0.9, 50); D('tom', 3.25, 0.9, 45); D('tom', 3.5, 0.9, 41); D('tom', 3.75, 0.9, 38); }
          const bassPat = [[0, 0, 0.9], [1, 12, 0.4], [1.5, 0, 0.4], [2, 0, 0.9], [3, 12, 0.4], [3.5, 7, 0.4]];
          for (const [b, off, l] of bassPat) ev.bass.push({ t: at(bar, b), m: chord.bass + off, len: l * BEAT });
          ev.guitar.push({ t: at(bar, 0), root: chord.gtr, len: 1.9 * BEAT });
          ev.guitar.push({ t: at(bar, 2), root: chord.gtr, len: 1.9 * BEAT });
          const leadOn = sec.name === 'chorus2' || i >= 4;
          if (leadOn) for (const [b, m, l] of LEAD[i % 4]) ev.guitar.push({ t: at(bar, b), lead: m - 12, len: l * BEAT * 0.95 });
          for (let s = 0; s < 16; s++) {
            const n = chord.keys[[0, 1, 2, 1][s % 4]] + (s >= 8 ? 12 : 0);
            ev.keys.push({ type: 'ep', t: at(bar, s * 0.25), notes: [n], len: 0.22 * BEAT, v: 0.45 });
          }
          if (i === 0) ev.other.push({ type: 'riser-end', t: at(bar, 0) });
          break;
        }
        case 'bridge': {
          D('kick', 0); D('snare', 2);
          for (let q = 0; q < 4; q++) D('hat', q, 0.5);
          if (last) {
            [[2, 50], [2.25, 50], [2.5, 45], [2.75, 45], [3, 41], [3.25, 41], [3.5, 38], [3.75, 38]].forEach(([b, p]) => D('tom', b, 0.85, p));
            ev.other.push({ type: 'riser', t: at(bar - 1, 0), len: 8 * BEAT });
          }
          ev.bass.push({ t: at(bar, 0), m: chord.bass, len: 3.8 * BEAT });
          const riff = [0, 3, 5, 7, 5, 3, 0, -2];
          riff.forEach((o, e) => ev.guitar.push({ t: at(bar, e * 0.5), lead: chord.gtr + 12 + o, len: 0.45 * BEAT }));
          ev.keys.push({ type: 'pad', t: at(bar, 0), notes: chord.keys, len: 4 * BEAT });
          break;
        }
      }
      if (sec.name !== 'outro' || !last) ev.other.push({ type: 'pad', t: at(bar, 0), notes: chord.keys.map((n) => n - 12), len: 4 * BEAT });
    }
  }
  return { ev, duration: T0 + bar * 4 * BEAT + 3 };
}

function renderDrums(c, out, events, noise) {
  const env = (g, t, v, d) => { g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); };
  const noiseHit = (t, type, f, q, v, d, pan = 0) => {
    const s = c.createBufferSource(); s.buffer = noise;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain(); env(g, t, v, d);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(flt).connect(g).connect(p).connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + d + 0.05);
  };
  const tone = (t, type, f0, f1, v, d, sweep) => {
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    const g = c.createGain(); env(g, t, v, d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
  };
  for (const e of events) {
    const { t, v } = e;
    if (e.type === 'kick') { tone(t, 'sine', 155, 43, 1.0 * v, 0.42, 0.11); noiseHit(t, 'highpass', 3000, 0.7, 0.18 * v, 0.012); }
    else if (e.type === 'snare') { noiseHit(t, 'bandpass', 2100, 0.6, 0.75 * v, 0.2); tone(t, 'triangle', 200, 170, 0.45 * v, 0.1, 0.05); }
    else if (e.type === 'hat') noiseHit(t, 'highpass', 8000, 0.8, 0.22 * v, e.p === 'open' ? 0.28 : 0.045, 0.25);
    else if (e.type === 'crash') { noiseHit(t, 'highpass', 5200, 0.5, 0.42 * v, 1.9, -0.2); noiseHit(t, 'bandpass', 9000, 1.5, 0.2 * v, 1.2, 0.2); }
    else if (e.type === 'tom') tone(t, 'sine', hz(e.p + 12), hz(e.p + 5), 0.85 * v, 0.38, 0.22);
  }
}

function renderBass(c, out, events) {
  for (const e of events) {
    const f = hz(e.m);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f / 2;
    const sub = c.createGain(); sub.gain.value = 0.4;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(1600, e.t); lp.frequency.exponentialRampToValueAtTime(320, e.t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, e.t);
    g.gain.exponentialRampToValueAtTime(0.55, e.t + 0.006);
    g.gain.setValueAtTime(0.45, e.t + Math.max(0.02, e.len - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, e.t + e.len + 0.05);
    o1.connect(lp); o2.connect(sub).connect(lp); lp.connect(g).connect(out);
    o1.start(e.t); o2.start(e.t); o1.stop(e.t + e.len + 0.1); o2.stop(e.t + e.len + 0.1);
  }
}

function renderGuitar(c, out, events) {
  const curve = distCurve(6);
  const chain = (pan, delay) => {
    const ws = c.createWaveShaper(); ws.curve = curve; ws.oversample = '2x';
    const cab = c.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3800; cab.Q.value = 0.8;
    const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = 4;
    const p = c.createStereoPanner(); p.pan.value = pan;
    ws.connect(cab).connect(mid).connect(p).connect(out);
    return { input: ws, delay };
  };
  const sides = [chain(-0.65, 0), chain(0.65, 0.011)];
  const leadChain = chain(0, 0);
  for (const e of events) {
    const isLead = e.lead != null;
    const notes = isLead ? [e.lead] : [e.root, e.root + 7, e.root + 12];
    const targets = isLead ? [leadChain] : sides;
    for (const tgt of targets) {
      const t = e.t + tgt.delay;
      const g = c.createGain();
      const peak = isLead ? 0.42 : e.muted ? 0.3 : 0.26;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      if (e.muted) g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      else { g.gain.setValueAtTime(peak * 0.8, t + Math.max(0.01, e.len - 0.03)); g.gain.exponentialRampToValueAtTime(0.0001, t + e.len + 0.06); }
      let dst = g;
      if (e.muted) {
        const pm = c.createBiquadFilter(); pm.type = 'lowpass'; pm.frequency.value = 700;
        g.connect(pm); dst = pm;
      }
      dst.connect(tgt.input);
      const end = t + (e.muted ? 0.2 : e.len + 0.1);
      for (const m of notes) {
        for (const det of [-7, 7]) {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
          if (isLead) {
            const vib = c.createOscillator(); vib.frequency.value = 5.5;
            const vg = c.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(12, t + Math.min(0.4, e.len));
            vib.connect(vg).connect(o.detune); vib.start(t); vib.stop(end);
          }
          o.connect(g); o.start(t); o.stop(end);
        }
      }
    }
  }
}

function renderKeys(c, out, events, pan = 0.35) {
  const p = c.createStereoPanner(); p.pan.value = pan; p.connect(out);
  for (const e of events) {
    for (const m of e.notes) {
      const f = hz(m);
      const g = c.createGain();
      if (e.type === 'pad') {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
        g.gain.setValueAtTime(0.0001, e.t);
        g.gain.exponentialRampToValueAtTime(0.09, e.t + 0.35);
        g.gain.setValueAtTime(0.09, e.t + e.len - 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, e.t + e.len + 0.4);
        for (const det of [-10, 10]) {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
          o.connect(lp); o.start(e.t); o.stop(e.t + e.len + 0.5);
        }
        lp.connect(g).connect(p);
      } else {
        const car = c.createOscillator(); car.type = 'sine'; car.frequency.value = f;
        const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = f;
        const mi = c.createGain();
        mi.gain.setValueAtTime(f * 2.2, e.t); mi.gain.exponentialRampToValueAtTime(f * 0.15, e.t + 0.5);
        mod.connect(mi).connect(car.frequency);
        const v = (e.v ?? 0.6) * 0.35;
        const dec = Math.max(e.len, 0.25);
        g.gain.setValueAtTime(0.0001, e.t);
        g.gain.exponentialRampToValueAtTime(v, e.t + 0.004);
        g.gain.exponentialRampToValueAtTime(v * 0.4, e.t + dec * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, e.t + dec + 0.25);
        car.connect(g).connect(p);
        car.start(e.t); mod.start(e.t); car.stop(e.t + dec + 0.3); mod.stop(e.t + dec + 0.3);
      }
    }
  }
}

function renderOther(c, out, events, noise) {
  const pads = events.filter((e) => e.type === 'pad').map((e) => ({ ...e, type: 'pad' }));
  renderKeys(c, out, pads, -0.3);
  for (const e of events) {
    if (e.type === 'riser') {
      const s = c.createBufferSource(); s.buffer = noise; s.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, e.t); bp.frequency.exponentialRampToValueAtTime(7000, e.t + e.len);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, e.t); g.gain.exponentialRampToValueAtTime(0.25, e.t + e.len);
      g.gain.linearRampToValueAtTime(0, e.t + e.len + 0.05);
      s.connect(bp).connect(g).connect(out); s.start(e.t); s.stop(e.t + e.len + 0.1);
    }
  }
}

/** Renders the demo. Returns { stems: {name: Int16Array planar}, length, duration } */
export async function renderDemo(onProgress = () => {}) {
  const { ev, duration } = compose();
  const len = Math.ceil(duration * STEM_RATE);
  const noise = makeNoise(2);
  const jobs = [
    ['drums', (c, o) => renderDrums(c, o, ev.drums, noise), 0.95],
    ['bass', (c, o) => renderBass(c, o, ev.bass), 0.8],
    ['guitar', (c, o) => renderGuitar(c, o, ev.guitar), 0.5],
    ['keys', (c, o) => renderKeys(c, o, ev.keys), 0.6],
    ['other', (c, o) => renderOther(c, o, ev.other, noise), 0.35],
  ];
  const float = {};
  let k = 0;
  onProgress(0, 'Synthesising stems');
  // Each OfflineAudioContext renders on its own thread, so the stems render in parallel.
  await Promise.all(jobs.map(async ([name, fn, gain]) => {
    const c = new OfflineAudioContext(2, len, STEM_RATE);
    const g = c.createGain(); g.gain.value = gain; g.connect(c.destination);
    fn(c, g);
    const buf = await c.startRendering();
    float[name] = [buf.getChannelData(0), buf.getChannelData(1)];
    onProgress(++k / jobs.length, `Synthesised ${name}`);
  }));
  let peak = 0;
  for (let i = 0; i < len; i++) {
    let l = 0, r = 0;
    for (const n in float) { l += float[n][0][i]; r += float[n][1][i]; }
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const scale = (0.89 / Math.max(peak, 1e-6)) * 32767;
  const stems = {};
  for (const n in float) {
    const pcm = new Int16Array(len * 2);
    const [L, R] = float[n];
    for (let i = 0; i < len; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * scale)));
      pcm[len + i] = Math.max(-32768, Math.min(32767, Math.round(R[i] * scale)));
    }
    stems[n] = pcm;
  }
  onProgress(1, 'Demo rendered');
  return { stems, length: len, duration: len / STEM_RATE };
}
