// Live notes ("you hear what you play"): a played stem is cut at every charted note, and each hit starts that
// note's slice the moment it's played. An early or late hit sounds early or late, a missed note is silent while the
// one before it rings out, a sustain let go of too soon stops, and whammy bends the held note. A steady player's
// slices join up seamlessly; a slice that lands far from the band slides back into time at a quiet spot.
//
// Charts are quantised to the beat grid, so slices are cut where each note's attack really is in the stem (found
// from the stem's own transient envelope), not at the chart time.
//
// Times: song seconds for chart times, buffer seconds (song / rate) for stem positions, context seconds for the
// clock. The band plays buffer position (x - startCtx) at context time x (see AudioEngine.start).

export const PRE = 0.004;        // a slice starts this long before its attack
export const MAX_SKIP = 0.006;   // a hit heard late may skip this far into its attack (more would lose the pick)
export const FADE_IN = 0.003;
export const XFADE = 0.008;      // one slice into the next
export const RING = 0.05;        // a note running into an unplayed one loops its last 50 ms...
export const RING_GAP = 0.012;   // ...ending this far before the next attack...
export const RING_DECAY = 0.04;  // ...and dies away (time constant), like a string left ringing
export const DRIFT = 0.035;      // a slice further than this from the band...
export const SPLICE = 0.02;      // ...crossfades back into time over this long
export const BEND = 80;          // whammy: cents down at full travel
export const LATE = 0.03;        // a note an on-time hit would start this late behind its attack starts by itself...
export const LOOKAHEAD = 0.1;    // ...scheduled this far ahead
export const CUT = 0.01;         // a missed note that started by itself stops over this long (time constant)
const HOP = 44;                  // transient envelope frames of ~1 ms
const RISE = 0.6;                // an attack: transient energy jumps 4× (log10) or more...
const LOOKBACK = 8;              // ...within 8 frames

/** Transient envelope of a stereo stem: log10 energy of the sample-to-sample change, per ~1 ms frame. */
export function transientEnvelope(L, R = L) {
  const n = Math.floor(L.length / HOP);
  const env = new Float32Array(n);
  let pl = 0, pr = 0;
  for (let f = 0, i = 0; f < n; f++) {
    let e = 0;
    for (const end = i + HOP; i < end; i++) {
      const dl = L[i] - pl, dr = R[i] - pr;
      e += dl * dl + dr * dr;
      pl = L[i]; pr = R[i];
    }
    env[f] = Math.log10(e + 1e-10);
  }
  return env;
}

/**
 * Where each chord group's attack starts in the stem (buffer seconds): the strongest transient rise near the
 * group's onset (o, saved by the charter: within 30 ms) or, for charts without one, its chart time (within 90 ms),
 * and never past half the distance to a neighbour. A group with no clear attack (legato, a quiet note) keeps its
 * onset or chart time.
 */
export function attackTimes(env, times, rate = 1, sampleRate = 44100, onsets = []) {
  const fs = sampleRate / HOP;
  const out = new Float64Array(times.length);
  const center = (k) => (onsets[k] ?? times[k]) / rate;
  for (let k = 0; k < times.length; k++) {
    const tb = center(k);
    const prev = k ? center(k - 1) : -Infinity;
    const next = k + 1 < times.length ? center(k + 1) : Infinity;
    const w = Math.min(onsets[k] != null ? 0.03 : 0.09, (tb - prev) / 2, (next - tb) / 2);
    const f0 = Math.max(LOOKBACK, Math.floor((tb - w) * fs));
    const f1 = Math.min(env.length - 1, Math.ceil((tb + w) * fs));
    let best = RISE, top = -1, floor = 0;
    for (let f = f0; f <= f1; f++) {
      let lo = Infinity;
      for (let j = f - LOOKBACK; j < f; j++) lo = Math.min(lo, env[j]);
      if (env[f] - lo > best) { best = env[f] - lo; top = f; floor = lo; }
    }
    let at = tb;
    if (top >= 0) {
      // the attack starts in the first frame a quarter of the way up the rise
      let g = top - LOOKBACK;
      while (g < top && env[g] < floor + best / 4) g++;
      at = g / fs;
    }
    // a stem position can't sound before the group ahead of it
    out[k] = k && at <= out[k - 1] + 0.01 ? Math.max(tb, out[k - 1] + 0.01) : at;
  }
  return out;
}

/**
 * Where a hit's slice plays: the stem shifted by how early or late the hit was. first: the slice's start (buffer s);
 * err: hit time minus chart time (buffer s). Returns { at, from, shift }: start at context time `at` from buffer
 * position `from`; shift = how far the slice runs behind the band (negative: ahead of it).
 */
export function placeSlice({ first, err, now, startCtx }) {
  let at = now, from = now - startCtx - err;
  if (from < first) { at += first - from; from = first; } // the note isn't due yet in the slice: wait for it
  else from = Math.min(from, first + PRE + MAX_SKIP);      // the hit reached us late: keep the attack
  return { at, from, shift: at - startCtx - from };
}

/**
 * The quietest spot to splice a drifting slice back into time: a position p in [lo, hi] where both p (where the
 * slice is) and p + shift (where the band is) have the least transient energy. Null when there's no room.
 */
export function quietSplice(env, lo, hi, shift, sampleRate = 44100) {
  const fs = sampleRate / HOP, span = Math.ceil(SPLICE * fs) + 2;
  const level = (f) => {
    let m = -Infinity;
    for (let j = Math.max(0, f - 2); j < Math.min(env.length, f + span); j++) m = Math.max(m, env[j]);
    return m;
  };
  let best = Infinity, at = null;
  for (let f = Math.ceil(lo * fs); f <= Math.floor(hi * fs); f += 2) {
    const v = Math.max(level(f), level(Math.round(f + shift * fs)));
    if (v < best) { best = v; at = f / fs; }
  }
  return at;
}

/**
 * A ring loop [start, end] (seconds) ending RING_GAP before `cut`: it starts where both channels and their slopes
 * best match the sample after its end, like a sampler's loop point, so the wrap doesn't click.
 */
export function ringLoop(L, R, cut, sr) {
  const b = Math.min(L.length - 1, Math.round((cut - RING_GAP) * sr));
  const lo = Math.max(1, b - Math.round((RING + 0.025) * sr)), hi = b - Math.round(0.02 * sr);
  if (hi <= lo) return null;
  const dl = L[b] - L[b - 1], dr = R[b] - R[b - 1];
  let best = Infinity, a = -1;
  for (let i = lo; i < hi; i++) {
    const c = Math.abs(L[i] - L[b]) + Math.abs(R[i] - R[b]) + Math.abs(L[i] - L[i - 1] - dl) + Math.abs(R[i] - R[i - 1] - dr);
    if (c < best) { best = c; a = i; }
  }
  return [a / sr, b / sr];
}

export class LiveStem {
  /**
   * engine: the AudioEngine (ctx and its clock: startCtx, rate); buffer: the stem; out: where slices go (the stem's
   * chain); times: song times of the player's chord groups, ascending; sustained[k]: group k holds a sustain;
   * onsets[k]: where group k really starts in the stem (song seconds, from the charter), or null; cuts: song times
   * where the stem stops whatever plays (a freestyle solo starts).
   */
  constructor(engine, buffer, out, times, sustained = [], onsets = [], cuts = []) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.buffer = buffer;
    this.out = out;
    this.times = times;
    this.sustained = sustained;
    this.rate = engine.rate || 1;
    this.env = transientEnvelope(buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : undefined);
    this.attack = attackTimes(this.env, times, this.rate, buffer.sampleRate, onsets);
    this.cuts = cuts.map((t) => t / this.rate).sort((a, b) => a - b);
    this.segs = new Set();
    this.voice = null; // the newest slice: { k, segs } (k = -1: the intro before the first note)
    this.last = -1;    // the newest group hit
    this.specs = new Map(); // slices that started by themselves (update), waiting for their hit or miss
    this.next = 0;     // the next group update() looks at
    this.lat = 0.03;   // how long after a press its hit reaches us (running average, buffer seconds)
  }

  _first(k) { return Math.max(0, this.attack[k] - PRE); }
  _end(k) { return this._cut(this.attack[k], k + 1 < this.attack.length ? this.attack[k + 1] - PRE : this.buffer.duration); }
  /** end, or the first cut between from and end */
  _cut(from, end) {
    for (const c of this.cuts) if (c > from && c < end) return c;
    return end;
  }

  /** engine.start: everything before the first note plays by itself, in time with the band. */
  start(when, offset) {
    this.stop();
    const end = this._cut(offset, this.attack.length ? this._first(0) : this.buffer.duration);
    if (end - offset > 0.02) this.voice = { k: -1, segs: [this._seg(when, offset, end)].filter(Boolean) };
  }

  /**
   * Per frame. Where the grid put a note after its sound, an on-time hit would reach us too late to start it in
   * time: that note's slice starts on time by itself, its hit keeps it and its miss cuts it. A hit that comes before
   * the slice starts still places it (early sounds early).
   */
  update(now = this.ctx.currentTime) {
    const startCtx = this.engine.startCtx;
    while (this.next < this.attack.length) {
      const k = this.next;
      const at = startCtx + this._first(k);
      if (k > this.last && at > now + LOOKAHEAD) break;
      this.next++;
      if (k <= this.last || at < now) continue; // hit already, or too late to start in time
      if (this.times[k] / this.rate + this.lat - (this.attack[k] + MAX_SKIP) <= LATE) continue;
      const prev = this.voice?.k < k ? this.voice : null;
      this._fade(prev, at);
      const v = { k, segs: [this._seg(at, this._first(k), this._end(k))].filter(Boolean), cents: 0, at, prev };
      this.specs.set(k, v);
      this.voice = v;
    }
  }

  /** Group k was missed: a slice that started by itself stops. */
  miss(k, now = this.ctx.currentTime) {
    const v = this.specs.get(k);
    if (!v) return;
    this.specs.delete(k);
    this._fade(v, now, CUT);
    if (this.voice === v) this.voice = null;
  }

  /** The player failed: everything sounding stops. */
  quiet(now = this.ctx.currentTime) {
    this._fade(this.voice, now, 0.02);
    for (const v of this.specs.values()) this._fade(v, now, 0.02);
    this.specs.clear();
    this.voice = null;
  }

  /** The player hit group k at song time `press`. `now` is the context time (tests pass their own). */
  hit(k, press, now = this.ctx.currentTime) {
    if (k <= this.last || k >= this.attack.length) return; // a chord sounds once, and never behind a later one
    this.last = k;
    const startCtx = this.engine.startCtx;
    const lat = now - startCtx - press / this.rate;
    if (lat > 0 && lat < 0.25) this.lat += (lat - this.lat) * 0.2;
    for (const j of this.specs.keys()) if (j < k) this.specs.delete(j);
    const first = this._first(k);
    let end = this._end(k);
    const { at, from, shift } = placeSlice({ first, err: (press - this.times[k]) / this.rate, now, startCtx });
    const spec = this.specs.get(k);
    if (spec) {
      this.specs.delete(k);
      if (at >= spec.at - 0.002) return; // it started (or is about to) on time: the hit keeps it
      this._fade(spec, at, 0.001);       // an early hit: play it early instead
      this._fade(spec.prev, at);
      this.voice = spec.prev;
    }
    // a late hit can land after the next note's slice already started by itself: it stops where that one starts
    const later = this.voice?.k > k ? this.voice : null;
    if (later) {
      if (later.at <= at + 0.01) return; // the next note is already sounding
      end = Math.min(end, from + later.at - at + XFADE);
    } else this._fade(this.voice, at);
    let splice = null;
    if (Math.abs(shift) > DRIFT && !this.sustained[k]) {
      // clear of this attack and the next, at both the slice's position and the band's
      const lo = from + 0.05 + Math.max(0, -shift), hi = end - 0.03 - SPLICE - Math.max(0, shift);
      if (hi > lo) splice = quietSplice(this.env, lo, hi, shift, this.buffer.sampleRate);
    }
    const segs = splice === null ? [this._seg(at, from, end, { ring: !later })] : [
      this._seg(at, from, splice + SPLICE, { ring: false, fadeOut: SPLICE }),
      this._seg(at + splice - from, splice + shift, end, { fadeIn: SPLICE, ring: !later }),
    ];
    const v = { k, segs: segs.filter(Boolean), cents: 0, at };
    if (!later) this.voice = v;
  }

  /** A sustain was let go of too soon: the note stops. */
  release(k, now = this.ctx.currentTime) {
    if (this.voice?.k !== k) return;
    this._fade(this.voice, now, 0.012);
    this.voice = null;
  }

  /** Whammy on a held sustain (w 0..1) bends it down. */
  bend(k, w, now = this.ctx.currentTime) {
    const v = this.voice;
    if (v?.k !== k) return;
    const cents = -BEND * Math.max(0, Math.min(1, w || 0));
    if (Math.abs(cents - v.cents) < 2) return;
    v.cents = cents;
    for (const s of v.segs) for (const src of [s.src, s.ring?.src]) src?.detune?.setTargetAtTime(cents, now, 0.025);
  }

  stop() {
    for (const s of this.segs) for (const src of [s.src, s.ring?.src]) { try { src?.stop(); } catch { /* not started */ } }
    this.segs.clear();
    this.specs.clear();
    this.voice = null;
    this.last = -1;
    this.next = 0;
  }

  _fade(voice, at, tc = XFADE / 3) {
    if (voice) for (const s of voice.segs) s.kill.gain.setTargetAtTime(0, at, tc);
  }

  // One stretch of the stem: source → env (fade in, cut at `end`) → kill (forced fades) → out, plus its ring.
  _seg(at, from, end, { ring = true, fadeIn = FADE_IN, fadeOut = XFADE } = {}) {
    const len = end - from;
    if (len < 0.004) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const env = ctx.createGain(), kill = ctx.createGain();
    src.connect(env).connect(kill).connect(this.out);
    const fi = Math.min(fadeIn, len / 3), fo = Math.min(fadeOut, len / 3), cut = at + len;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + fi);
    env.gain.setValueAtTime(1, cut - fo);
    env.gain.linearRampToValueAtTime(0, cut);
    src.start(at, from);
    src.stop(cut + 0.002);
    const seg = { src, env, kill, ring: null };
    if (ring && end < this.buffer.duration - 0.01) seg.ring = this._ring(end, cut, kill);
    let playing = seg.ring ? 2 : 1;
    const ended = () => {
      if (--playing) return;
      src.disconnect(); env.disconnect(); kill.disconnect(); seg.ring?.src.disconnect(); seg.ring?.gain.disconnect();
      this.segs.delete(seg);
    };
    src.onended = ended;
    if (seg.ring) seg.ring.src.onended = ended;
    this.segs.add(seg);
    return seg;
  }

  // The note keeps ringing into one that wasn't played: loop the sound just before the cut and let it die away.
  _ring(end, cut, kill) {
    const L = this.buffer.getChannelData(0), R = this.buffer.numberOfChannels > 1 ? this.buffer.getChannelData(1) : L;
    const loop = ringLoop(L, R, end, this.buffer.sampleRate);
    if (!loop) return null;
    const [a, b] = loop;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.loopStart = a;
    src.loopEnd = b;
    const gain = ctx.createGain();
    src.connect(gain).connect(kill);
    gain.gain.setValueAtTime(0, cut - XFADE);
    gain.gain.linearRampToValueAtTime(0.9, cut);
    gain.gain.setTargetAtTime(0, cut, RING_DECAY);
    src.start(cut - XFADE, a);
    src.stop(cut + RING_DECAY * 8);
    return { src, gain };
  }
}
