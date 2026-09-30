// Playback engine: sample-accurate song clock, player stem vs band mix, miss muffling, crowd bed and SFX.
import { settings, onSettingsChange } from '../settings.js';
import { EQ_FREQUENCIES, equalizerGains } from './equalizer.js';

export const STEM_RATE = 44100;
export const STEM_FOR = { guitar: 'guitar', bass: 'bass', drums: 'drums', keys: 'keys', vocals: 'vocals' };

function noiseBuffer(ctx, seconds, color = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      } else d[i] = w;
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.ratio.value = 3; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.eq = EQ_FREQUENCIES.map((frequency, i) => {
      const node = ctx.createBiquadFilter();
      node.type = i === 0 ? 'lowshelf' : i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      node.frequency.value = frequency;
      if (node.type === 'peaking') node.Q.value = 0.8;
      return node;
    });
    this.master.connect(this.eq[0]);
    for (let i = 1; i < this.eq.length; i++) this.eq[i - 1].connect(this.eq[i]);
    this.eq.at(-1).connect(this.comp).connect(this.analyser).connect(ctx.destination);

    this.bandGain = ctx.createGain();
    this.playerGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.crowdGain = ctx.createGain();
    this.bandGain.connect(this.master);
    this.playerGain.connect(this.master);
    this.stemChains = new Map();
    this.sfxGain.connect(this.master);
    this.crowdGain.connect(this.master);

    this.noise = noiseBuffer(ctx, 2, 'white');
    this.pink = noiseBuffer(ctx, 4, 'pink');
    this.sources = [];
    this.controllerOutputs = [];
    this.playing = false;
    this.startCtx = 0;
    this.pausedSongTime = 0;
    this.buffers = null;
    this.duration = 0;
    this.applyVolumes();
    onSettingsChange(() => this.applyVolumes());
    this._crowd();
  }

  applyVolumes() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.masterVolume, t, 0.02);
    this.bandGain.gain.setTargetAtTime(settings.bandVolume, t, 0.02);
    this.playerGain.gain.setTargetAtTime(settings.playerVolume, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume, t, 0.02);
    equalizerGains(settings).forEach((gain, i) => this.eq[i].gain.setTargetAtTime(gain, t, 0.03));
  }

  async unlock() {
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* needs gesture */ } }
  }

  /**
   * Build playback buffers: one per played instrument stem (so each can drop out on misses)
   * plus the band (everything else).
   */
  prepare(song, audio, instruments) {
    this.stop();
    for (const ch of this.stemChains.values()) { ch.filter.disconnect(); ch.mute.disconnect(); }
    this.stemChains.clear();
    const n = song.length;
    const ctx = this.ctx;
    const played = new Set(instruments.map((i) => STEM_FOR[i]));
    const buffers = { band: ctx.createBuffer(2, n, STEM_RATE) };
    for (const stem of played) buffers[stem] = ctx.createBuffer(2, n, STEM_RATE);
    const k = 1 / 32768;
    for (const [name, pcm] of Object.entries(audio.stems)) {
      const buf = played.has(name) ? buffers[name] : buffers.band;
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let i = 0; i < n; i++) { L[i] += pcm[i] * k; R[i] += pcm[n + i] * k; }
    }
    for (const stem of played) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      const mute = ctx.createGain();
      filter.connect(mute).connect(this.playerGain);
      this.stemChains.set(stem, { filter, mute });
    }
    this.buffers = buffers;
    this.duration = n / STEM_RATE;
    this.pausedSongTime = 0;
    this.rate = 1;
  }

  /** Practice mode: replace every playback buffer with a pitch-preserving time-stretched copy. */
  async stretchTo(rate, stretchFn, onProgress = () => {}) {
    this.rate = rate;
    if (Math.abs(rate - 1) < 1e-3) return;
    const keys = Object.keys(this.buffers);
    for (let i = 0; i < keys.length; i++) {
      const buf = this.buffers[keys[i]];
      const out = await stretchFn(buf.getChannelData(0), buf.getChannelData(1), rate, (p) => onProgress((i + p) / keys.length));
      const nb = this.ctx.createBuffer(2, out.L.length, STEM_RATE);
      nb.copyToChannel(out.L, 0);
      nb.copyToChannel(out.R, 1);
      this.buffers[keys[i]] = nb;
    }
  }

  /** One four-channel USB output per local player: front-right = speaker, rear pair = voice-coil haptics. */
  async configureControllerAudio(players) {
    this.closeControllerAudio();
    if (!settings.dualsenseAudio || !('setSinkId' in AudioContext.prototype)) return;
    const used = new Set();
    const wired = players.filter((player) => player._ds && !player._ds.bt);
    let automaticSink = '';
    if (wired.length === 1 && !settings.dualsenseAudioSinks?.[wired[0]._ds.slot] && navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const matches = devices.filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'default' && /dualsense|wireless controller/i.test(device.label));
      if (matches.length === 1) automaticSink = matches[0].deviceId;
    }
    for (const player of players) {
      const device = player._ds;
      const sinkId = settings.dualsenseAudioSinks?.[device?.slot] || (wired.length === 1 ? automaticSink : '');
      const stem = STEM_FOR[player.cfg.instrument];
      if (!device || device.bt || !sinkId || !this.buffers?.[stem] || used.has(sinkId)) continue;
      let ctx;
      try {
        ctx = new AudioContext({ latencyHint: 'interactive' });
        await ctx.setSinkId(sinkId);
        if (ctx.destination.maxChannelCount < 4) throw new Error('This audio output does not expose four channels');
        ctx.destination.channelCount = 4;
        const merger = ctx.createChannelMerger(4);
        merger.connect(ctx.destination);
        const level = ctx.createGain();
        level.gain.value = 1;
        const split = ctx.createChannelSplitter(2);
        level.connect(split);
        // The DualSense's internal speaker takes front-right, so downmix both
        // stem channels there. Front-left is the headset channel.
        const monoL = ctx.createGain(); monoL.gain.value = 0.35;
        const monoR = ctx.createGain(); monoR.gain.value = 0.35;
        split.connect(monoL, 0); split.connect(monoR, 1);
        monoL.connect(merger, 0, 1); monoR.connect(merger, 0, 1);
        const haptics = [];
        for (let channel = 0; channel < 2; channel++) {
          const highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 35;
          const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 450;
          const gain = ctx.createGain(); gain.gain.value = Math.min(0.65, 0.28 * settings.rumbleIntensity);
          split.connect(highpass, channel); highpass.connect(lowpass).connect(gain).connect(merger, 0, channel + 2);
          haptics.push(gain);
        }
        const output = { ctx, sinkId, device, stem, level, merger, haptics, source: null };
        device.audioHapticPulse = (strong, weak, ms) => this.playControllerHaptic(output, strong, weak, ms);
        device.pulses = []; device.motor = [0, 0]; device.dirty = true;
        this.controllerOutputs.push(output);
        used.add(sinkId);
        ctx.resume().catch(() => {});
      } catch (error) {
        ctx?.close().catch(() => {});
        console.warn('[audio] DualSense audio output unavailable:', error);
      }
    }
  }

  playControllerHaptic(output, strong, weak, ms) {
    const { ctx, merger } = output;
    if (ctx.state === 'closed') return;
    for (const [channel, amount, frequency] of [[2, strong, 95], [3, weak, 165]]) {
      if (!amount) continue;
      const osc = ctx.createOscillator(); osc.frequency.value = frequency; osc.type = 'sine';
      const gain = ctx.createGain();
      const start = ctx.currentTime, end = start + Math.min(0.3, Math.max(0.01, ms / 1000));
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(Math.min(0.3, amount / 255 * 0.22 * settings.rumbleIntensity), start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      osc.connect(gain).connect(merger, 0, channel);
      osc.start(start); osc.stop(end + 0.01);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    }
  }

  closeControllerAudio() {
    for (const output of this.controllerOutputs || []) {
      if (output.device.audioHapticPulse) { output.device.audioHapticPulse = null; output.device.flush(true); }
      try { output.source?.stop(); } catch { /* already stopped */ }
      output.ctx.close().catch(() => {});
    }
    this.controllerOutputs = [];
  }

  /** Short speaker and audio-haptic check from Settings, before a song is loaded. */
  async testControllerAudio(device, sinkId) {
    if (!sinkId) throw new Error('Assign this controller an audio output first');
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const priorPulse = device.audioHapticPulse;
    try {
      await ctx.setSinkId(sinkId);
      if (ctx.destination.maxChannelCount < 4) throw new Error('Selected output must expose four channels');
      ctx.destination.channelCount = 4;
      const merger = ctx.createChannelMerger(4);
      merger.connect(ctx.destination);
      const tone = ctx.createOscillator(); tone.frequency.value = 660;
      const speaker = ctx.createGain(); speaker.gain.value = 0.14;
      tone.connect(speaker).connect(merger, 0, 1);
      const pulse = ctx.createOscillator(); pulse.frequency.value = 110;
      const haptic = ctx.createGain(); haptic.gain.value = 0.13;
      pulse.connect(haptic);
      haptic.connect(merger, 0, 2); haptic.connect(merger, 0, 3);
      device.audioHapticPulse = () => {};
      device.flush(true);
      await ctx.resume();
      tone.start(); pulse.start();
      tone.stop(ctx.currentTime + 0.7); pulse.stop(ctx.currentTime + 0.7);
      await new Promise((resolve) => { tone.onended = resolve; });
    } finally {
      device.audioHapticPulse = priorPulse;
      device.flush(true);
      await ctx.close();
    }
  }

  /** Start playback so that song time `fromTime` (may be negative = lead-in) is heard now. */
  start(fromTime = -2.5) {
    clearTimeout(this._fadeTimer);
    this.applyVolumes();
    this.stopSources();
    const ctx = this.ctx;
    const rate = this.rate || 1;
    const now = ctx.currentTime + 0.05;
    this.startCtx = now - fromTime / rate;
    const when = Math.max(now, this.startCtx);
    const offset = Math.max(0, fromTime) / rate;
    for (const [key, buf] of Object.entries(this.buffers)) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(key === 'band' ? this.bandGain : this.stemChains.get(key).filter);
      src.start(when, offset);
      this.sources.push(src);
    }
    for (const output of this.controllerOutputs) {
      const src = output.ctx.createBufferSource();
      src.buffer = this.buffers[output.stem];
      src.connect(output.level);
      const delay = Math.max(0, when - ctx.currentTime);
      src.start(output.ctx.currentTime + delay, offset);
      output.source = src;
    }
    for (const stem of this.stemChains.keys()) this.setStemAudible(stem, true, true);
    this.playing = true;
  }

  /** Song time (seconds) for a performance.now() timestamp, compensated for output latency and calibration. */
  timeAt(perfMs = performance.now()) {
    if (!this.playing) return this.pausedSongTime;
    const ctx = this.ctx;
    let heard;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      heard = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    } else {
      heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) + (perfMs - performance.now()) / 1000;
    }
    return (heard - this.startCtx - settings.audioOffset / 1000) * (this.rate || 1);
  }

  get songTime() { return this.timeAt(performance.now()); }

  async pause() {
    if (!this.playing) return;
    this.pausedSongTime = this.songTime;
    await this.ctx.suspend();
    await Promise.all(this.controllerOutputs.map((output) => output.ctx.suspend().catch(() => {})));
    this.paused = true;
  }

  async resume() {
    if (!this.paused) return;
    this.paused = false;
    await this.ctx.resume();
    await Promise.all(this.controllerOutputs.map((output) => output.ctx.resume().catch(() => {})));
  }

  stopSources() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
    this.sources = [];
    for (const output of this.controllerOutputs) { try { output.source?.stop(); } catch { /* already stopped */ } output.source?.disconnect(); output.source = null; }
  }

  stop() {
    this.stopSources();
    this.closeControllerAudio();
    this.playing = false;
    if (this.paused) { this.paused = false; this.ctx.resume(); }
  }

  fadeOut(seconds = 1.5) {
    const t = this.ctx.currentTime;
    this.bandGain.gain.setTargetAtTime(0, t, seconds / 4);
    this.playerGain.gain.setTargetAtTime(0, t, seconds / 4);
    for (const output of this.controllerOutputs) output.level.gain.setTargetAtTime(0, output.ctx.currentTime, seconds / 4);
    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => { this.stop(); this.applyVolumes(); }, seconds * 1000);
  }

  /** Muffle + duck a played stem while its player(s) are missing. */
  setStemAudible(stem, on, instant = false) {
    const ch = this.stemChains.get(stem);
    if (!ch) return;
    const t = this.ctx.currentTime;
    const tc = instant ? 0.001 : on ? 0.02 : 0.05;
    ch.mute.gain.setTargetAtTime(on ? 1 : 0.1, t, tc);
    ch.filter.frequency.setTargetAtTime(on ? 20000 : 650, t, tc);
    for (const output of this.controllerOutputs) if (output.stem === stem) output.level.gain.setTargetAtTime(on ? 1 : 0.1, output.ctx.currentTime, tc);
  }

  /** Band energy for visuals: returns {bass, mid, high, level} in 0..1 */
  levels() {
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq, n = f.length;
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += f[i]; return s / ((b - a) * 255); };
    const bass = avg(1, Math.floor(n * 0.02)), mid = avg(Math.floor(n * 0.02), Math.floor(n * 0.15)), high = avg(Math.floor(n * 0.15), Math.floor(n * 0.5));
    return { bass, mid, high, level: (bass + mid + high) / 3, spectrum: f };
  }

  // ---------------------------------------------------------------- crowd bed
  _crowd() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pink; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(bp.frequency);
    this.crowdLevel = ctx.createGain(); this.crowdLevel.gain.value = 0;
    src.connect(bp).connect(this.crowdLevel).connect(this.crowdGain);
    src.start(); lfo.start(); // silent until a song starts: the menus have no crowd noise
  }

  setCrowd(level) {
    this.crowdLevel.gain.setTargetAtTime(level * settings.crowdVolume, this.ctx.currentTime, 0.4);
  }

  cheer(strength = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.pink;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * strength * settings.crowdVolume, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    src.connect(bp).connect(g).connect(this.crowdGain);
    src.start(t, Math.random()); src.stop(t + 3.5);
  }

  // ---------------------------------------------------------------- SFX
  _env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  sfxMiss(drums = false) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = drums ? 400 : 1400;
    if (drums) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
      o.connect(lp);
      this._env(g, t, 0.5, 0.004, 0.18);
      o.start(t); o.stop(t + 0.25);
    } else {
      for (const f of [98, 104, 147]) {
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.18);
        o.connect(lp); o.start(t); o.stop(t + 0.25);
      }
      this._env(g, t, 0.16, 0.003, 0.2);
    }
    lp.connect(g).connect(this.sfxGain);
  }

  sfxOverdrive() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(6000, t + 0.6);
    const g = ctx.createGain(); this._env(g, t, 0.5, 0.25, 0.7);
    src.connect(bp).connect(g).connect(this.sfxGain);
    src.start(t); src.stop(t + 1.1);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const og = ctx.createGain(); this._env(og, t + 0.05 * i, 0.12, 0.02, 1.2);
      o.connect(og).connect(this.sfxGain); o.start(t + 0.05 * i); o.stop(t + 1.5);
    });
  }

  sfxPhrase() {
    const ctx = this.ctx, t = ctx.currentTime;
    [1318.5, 1760].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + i * 0.07, 0.15, 0.005, 0.35);
      o.connect(g).connect(this.sfxGain); o.start(t + i * 0.07); o.stop(t + 0.6);
    });
  }

  sfxTick(when = 0, accent = false) {
    const ctx = this.ctx, t = when || ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = accent ? 1800 : 1200;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = accent ? 1800 : 1200; bp.Q.value = 8;
    const g = ctx.createGain(); this._env(g, t, accent ? 0.5 : 0.35, 0.001, 0.05);
    o.connect(bp).connect(g).connect(this.sfxGain); o.start(t); o.stop(t + 0.08);
  }

  sfxUi(kind = 'move') {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = kind === 'confirm' ? 880 : kind === 'back' ? 330 : 620;
    o.frequency.setValueAtTime(f, t);
    if (kind === 'confirm') o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    const g = ctx.createGain(); this._env(g, t, 0.07, 0.003, kind === 'move' ? 0.05 : 0.12);
    o.connect(g).connect(this.sfxGain); o.start(t); o.stop(t + 0.2);
  }

  sfxFail() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(40, t + 1.2);
    const lp = ctx.createBiquadFilter(); lp.frequency.value = 1200;
    const g = ctx.createGain(); this._env(g, t, 0.3, 0.01, 1.2);
    o.connect(lp).connect(g).connect(this.sfxGain); o.start(t); o.stop(t + 1.4);
  }

  /** Decode an audio file and resample to 44.1 kHz stereo. Returns {L, R, sampleRate}. */
  async decodeFile(arrayBuffer) {
    const decoded = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    const len = Math.ceil(decoded.duration * STEM_RATE);
    const off = new OfflineAudioContext(2, len, STEM_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    const L = out.getChannelData(0);
    const R = decoded.numberOfChannels > 1 ? out.getChannelData(1) : L;
    return { L, R, sampleRate: STEM_RATE, duration: decoded.duration };
  }
}
