// Singing: a player that sings into a microphone instead of pressing buttons. The vocal chart becomes
// a karaoke pitch track (segments grouped into phrases); pitch is judged octave-free, so any voice
// works, and each phrase is rated Awesome → Messy. Lyrics (from Whisper) scroll under the track.
import { settings } from '../settings.js';
import { Mic } from '../audio/pitch.js';
import { currentRules } from './replay.js';

const TOL = { easy: 3.5, medium: 2.5, hard: 1.8, expert: 1.2 }; // semitones
const RATINGS = [[0.7, 'AWESOME', '#7fffd4'], [0.5, 'STRONG', '#29e0ff'], [0.3, 'GOOD', '#ffe14d'], [0.15, 'OK', '#ffa24d'], [0, 'MESSY', '#ff3b3b']];
const GRACE = 0.15; // consonants and breaths: a short drop-out after singing on pitch still counts
const MIC_LAG = 0.09; // analysis window + input latency
let sharedMic = null;

/** Octave-free distance in semitones (-6..6). */
const pcDist = (a, b) => ((((a - b) % 12) + 18) % 12) - 6;

/** Vocal chart notes → sung segments → phrases. */
export function buildVocalTrack(notes, chartPhrases = []) {
  const byT = new Map();
  for (const n of notes) { const k = n.t.toFixed(3); const cur = byT.get(k); if (!cur || (n.s ?? 1) > (cur.s ?? 1)) byT.set(k, n); }
  const list = [...byT.values()].sort((a, b) => a.t - b.t);
  const segs = [];
  for (let i = 0; i < list.length; i++) {
    const n = list[i], next = list[i + 1];
    let end = n.t + Math.max(n.len || 0, 0.3);
    if (next && next.t - n.t < 0.6) end = next.t;
    if (next) end = Math.min(end, next.t);
    const prev = segs[segs.length - 1];
    if (prev && prev.m === n.m && n.t - prev.end < 0.05) { prev.end = end; if (n.p >= 0) prev.od = true; continue; }
    segs.push({ start: n.t, end, m: n.m, od: n.p >= 0, sung: 0 });
  }
  const phrases = [];
  for (const s of segs) {
    const cur = phrases[phrases.length - 1];
    const cut = !cur || s.start - cur.end > 0.8 || s.end - cur.start > 9
      || chartPhrases.some((p) => s.start >= p.start && cur.end < p.start);
    if (cut) phrases.push({ start: s.start, end: s.end, segs: [s], od: s.od, sung: 0, total: 0, done: false });
    else { cur.segs.push(s); cur.end = s.end; cur.od ||= s.od; }
  }
  return { segs, phrases };
}

/** Lyrics words → display lines (a checked word list marks the database's own line breaks with br). */
export function lyricLines(words = []) {
  const lines = [];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur || w.br || w.t - cur.end > 0.9 || cur.text.length > 38) lines.push({ start: w.t, end: w.e, words: [w], text: w.w });
    else { cur.words.push(w); cur.end = w.e; cur.text += ` ${w.w}`; }
  }
  return lines;
}

export class VocalPlayer {
  constructor(session, index, cfg, _highway, hud) {
    this.s = session;
    this.index = index;
    this.cfg = cfg;
    this.hud = hud;
    this.highway = null; // no 3D highway: the karaoke track is drawn on the HUD
    this.inst = 'vocals';
    this.diff = cfg.difficulty;
    this.mic = true;
    this.maxMult = 4;
    this.rules = cfg.rules || currentRules();
    this.replayer = cfg.replayer || null;
    this.activeSus = new Set();
    this.strum = false;
    this.lefty = false;
  }

  async setup(song, startTime = 0) {
    const chart = song.charts.vocals;
    const { segs, phrases } = buildVocalTrack(chart.notes[this.diff] || chart.notes.expert, chart.phrases);
    this.segs = segs.filter((s) => s.end >= startTime);
    this.phrases = phrases.filter((p) => p.end >= startTime);
    this.notes = this.segs.map((s) => ({ t: s.start, len: s.end - s.start })); // for the session's end time
    this.lines = settings.lyrics !== false ? lyricLines(song.lyrics?.words) : [];
    this.score = 0; this.streak = 0; this.maxStreak = 0; this.mult = 1;
    this.od = 0; this.odActive = false; this.odActivations = 0;
    this.rock = 0.5; this.failed = false;
    this.audible = !!settings.guideVocals; // the singer's stem stays muted unless guide vocals are on
    this.stats = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.fracSum = 0;
    this.pitch = 0; this.level = 0;
    this.trail = [];
    this.pptr = 0;
    this.lastRec = -1;
    this.track = new VocalTrack(this);
    if (!this.replayer) {
      sharedMic ||= new Mic(this.s.engine.ctx);
      try { await sharedMic.start(settings.micDevice || ''); } catch (e) { this.hud.callout(e?.name === 'NotAllowedError' ? 'Microphone blocked — see Settings → Singing → Test' : 'No microphone — check Settings → Singing', '#ff3b3b'); console.warn(e); }
    }
  }

  get ds() { return this._ds || this.s.ds; }
  get engine() { return this.s.engine; }
  whammy() { return 0; }
  isHeld() { return false; }
  _baseTriggers() {}
  rumble(a, b, ms) { if (this.dsOwner && this.cfg.rumble !== false) this.ds.rumble(a, b, ms); }
  dispose() { this.track?.destroy(); this.track = null; if (!this.replayer) sharedMic?.stop(); }

  handle(ev) {
    if (ev.type === 'od') this.activateOD();
  }

  activateOD() {
    if (this.odActive || this.od < 0.5 || this.failed) return;
    this.odActive = true;
    this.odActivations++;
    this.engine.sfxOverdrive();
    this.engine.cheer(0.8);
    this.s.onOverdrive(this);
    this.hud.callout('OVERDRIVE!', '#ffcf3a');
  }

  fail() {
    if (this.failed) return;
    this.failed = true;
    this.odActive = false;
    this.hud.setFailed(true);
    this.s.onPlayerFailed(this);
  }

  revive() {
    if (!this.failed) return;
    this.failed = false;
    this.rock = 0.35;
    this.hud.setFailed(false);
    this.hud.callout('SAVED!', '#3dff8a');
  }

  _ratePhrase(ph) {
    ph.done = true;
    if (ph.total < 0.05) return;
    const frac = Math.min(1, ph.sung / ph.total);
    const [, label, color] = RATINGS.find(([min]) => frac >= min);
    this.fracSum += Math.min(1, frac / 0.7);
    if (frac >= 0.7) this.stats.perfect++; else if (frac >= 0.5) this.stats.great++; else if (frac >= 0.15) this.stats.good++; else this.stats.miss++;
    if (frac >= 0.15) this.score += Math.round(250 + 750 * Math.min(1, frac / 0.7)) * this.mult * (this.odActive ? 2 : 1);
    if (frac >= 0.3) { this.streak++; this.maxStreak = Math.max(this.maxStreak, this.streak); } else this.streak = 0;
    this.mult = Math.min(this.maxMult, 1 + Math.floor(this.streak / 2));
    this.rock = Math.max(0, Math.min(1, this.rock + (frac >= 0.5 ? 0.06 : frac >= 0.3 ? 0.03 : frac >= 0.15 ? -0.04 : -0.08)));
    this.hud.judge(label, color);
    if (ph.od && frac >= 0.5) {
      const before = this.od;
      this.od = Math.min(1, this.od + 0.25);
      this.engine.sfxPhrase();
      if (!this.odActive && before < 0.5 && this.od >= 0.5) this.hud.callout('OVERDRIVE READY', '#7fe8ff');
    }
    if (frac < 0.15) this.engine.sfxMiss(false);
    if (this.rock <= 0 && !this.rules.noFail) this.fail();
  }

  update(t, dt, bl, frame) {
    const live = !frame.finished && !this.failed;
    if (this.replayer) { this.pitch = this.replayer.pitch || 0; this.level = this.pitch ? 0.5 : 0; }
    else if (sharedMic?.active) { const r = sharedMic.read(); this.pitch = r.midi; this.level = r.level; }
    // record the pitch for replays (20 Hz, only when it changes)
    if (this.recorder && live && t - this.lastRec >= 0.05) {
      this.lastRec = t;
      const v = this.pitch ? Math.round(this.pitch * 10) / 10 : 0;
      if (v !== this.lastRecV) { this.recorder.events.push([Math.round(t * 1e4) / 1e4, 'v', v]); this.lastRecV = v; }
    }
    const te = t - (this.replayer ? 0 : MIC_LAG);
    if (live) {
      while (this.pptr < this.phrases.length && this.phrases[this.pptr].end < te) this._ratePhrase(this.phrases[this.pptr++]);
      const ph = this.phrases[this.pptr];
      if (ph && te >= ph.start) {
        const seg = ph.segs.find((s) => te >= s.start && te < s.end);
        if (seg) {
          ph.total += dt;
          const onPitch = this.pitch && Math.abs(pcDist(this.pitch, seg.m)) <= TOL[this.diff];
          if (onPitch) this.lastOn = te;
          if (onPitch || te - (this.lastOn ?? -9) < GRACE) { seg.sung += dt; ph.sung += dt; }
        }
      }
      if (this.odActive) { this.od -= dt / bl / 32; if (this.od <= 0) { this.od = 0; this.odActive = false; } }
    }
    this.trail.push([t, this.pitch]);
    while (this.trail.length && this.trail[0][0] < t - 1.2) this.trail.shift();
    this.track?.draw(t, te);
    this.hud.frame(dt, {
      score: Math.floor(this.score), mult: this.mult * (this.odActive ? 2 : 1), maxMult: this.maxMult,
      multProgress: this.mult >= this.maxMult ? 1 : (this.streak % 2) / 2, streak: this.streak,
      od: this.od, odActive: this.odActive, rock: this.rock,
      anchor: { l: innerWidth * 0.3, r: innerWidth * 0.7, y: innerHeight * 0.86 },
    });
  }

  upcomingCount(t) { let c = 0; for (const s of this.segs) { if (s.start > t + 2) break; if (s.start > t) c++; } return c * 2; }

  result() {
    const total = this.phrases.filter((p) => p.total >= 0.05 || !p.done).length || this.phrases.length;
    const hits = this.stats.perfect + this.stats.great + this.stats.good;
    const accuracy = total ? this.fracSum / total : 0;
    // singing stars follow how well you sang (phrase accuracy), not the multiplier
    const th = [0.3, 0.5, 0.7, 0.85, 0.95];
    return {
      index: this.index, name: this.cfg.name, color: this.cfg.color, device: this.cfg.device, profileId: this.cfg.profileId || null,
      instrument: 'vocals', difficulty: this.diff, score: Math.floor(this.score), stars: this.failed ? 0 : th.filter((x) => accuracy >= x).length,
      gold: !this.failed && accuracy >= 0.98 && this.stats.miss === 0, accuracy, hits, total, maxStreak: this.maxStreak, ...this.stats,
      odActivations: this.odActivations, failed: this.failed, strum: false, mic: true,
    };
  }
}

/** The karaoke track: pitch bars scrolling left, your pitch as an arrow, lyrics underneath. */
class VocalTrack {
  constructor(player) {
    this.p = player;
    this.el = document.createElement('div');
    this.el.className = 'vox';
    this.el.innerHTML = '<canvas></canvas><div class="vox-lyrics"><div class="vl-now"></div><div class="vl-next"></div></div>';
    document.getElementById('hud').appendChild(this.el);
    this.cv = this.el.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    this.center = null;
    this.lineKey = '';
  }

  destroy() { this.el.remove(); }

  draw(t, te) {
    const cv = this.cv, g = this.g;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const p = this.p;
    const AHEAD = 4, BEHIND = 1.2, nowX = w * (BEHIND / (AHEAD + BEHIND));
    const xOf = (x) => nowX + ((x - te) / (AHEAD + BEHIND)) * w;
    // follow the melody: centre on the pitches in view
    const inView = p.segs.filter((s) => s.end > te - BEHIND && s.start < te + AHEAD);
    if (inView.length) {
      const target = inView.reduce((a, s) => a + s.m, 0) / inView.length;
      this.center = this.center == null ? target : this.center + (target - this.center) * 0.05;
    }
    const c = this.center ?? 60, SPAN = 20;
    const yOf = (m) => h * 0.5 - ((m - c) / SPAN) * h * 0.9;
    g.clearRect(0, 0, w, h);
    for (let m = Math.floor(c - SPAN / 2); m <= c + SPAN / 2; m++) {
      if (m % 12 !== 0 && m % 12 !== 7) continue;
      g.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
      g.fillRect(0, yOf(m), w, 1);
    }
    const bh = Math.max(8, h * 0.07);
    for (const s of inView) {
      const x0 = xOf(s.start), x1 = xOf(s.end), y = yOf(s.m);
      g.fillStyle = s.od ? 'rgba(255,207,58,0.35)' : 'rgba(80,190,255,0.3)';
      pill(g, x0, y - bh / 2, Math.max(4, x1 - x0), bh);
      g.fill();
      const f = Math.min(1, s.sung / Math.max(0.01, s.end - s.start));
      if (f > 0) { g.fillStyle = s.od ? '#ffd24a' : '#3dff8a'; pill(g, x0, y - bh / 2, Math.max(4, (x1 - x0) * f), bh); g.fill(); }
      g.strokeStyle = s.od ? 'rgba(255,220,120,0.9)' : 'rgba(150,215,255,0.8)';
      g.lineWidth = 1.5 * dpr;
      pill(g, x0, y - bh / 2, Math.max(4, x1 - x0), bh);
      g.stroke();
    }
    // now line
    g.fillStyle = 'rgba(255,45,122,0.85)';
    g.fillRect(nowX - 1.5 * dpr, 0, 3 * dpr, h);
    // your pitch (folded to the octave of the nearest target) + trail
    const near = inView.reduce((b, s) => (Math.abs(s.start - te) < Math.abs((b?.start ?? 1e9) - te) ? s : b), null);
    const fold = (m) => (near ? near.m + pcDist(m, near.m) : m);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2.5 * dpr;
    g.beginPath();
    let started = false;
    for (const [tt, m] of p.trail) {
      if (!m) { started = false; continue; }
      const x = nowX - ((t - tt) / (AHEAD + BEHIND)) * w, y = yOf(fold(m));
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.stroke();
    if (p.pitch) {
      const y = yOf(fold(p.pitch));
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(nowX + 14 * dpr, y); g.lineTo(nowX - 4 * dpr, y - 9 * dpr); g.lineTo(nowX - 4 * dpr, y + 9 * dpr); g.closePath(); g.fill();
    }
    this._lyrics(t);
  }

  _lyrics(t) {
    const lines = this.p.lines;
    if (!lines.length) return;
    let i = lines.findIndex((l) => l.end + 0.4 >= t);
    if (i < 0) i = lines.length;
    const now = lines[i], next = lines[i + 1];
    const key = `${i}`;
    const nowEl = this.el.querySelector('.vl-now'), nextEl = this.el.querySelector('.vl-next');
    if (this.lineKey !== key) {
      this.lineKey = key;
      nowEl.innerHTML = now ? now.words.map((w) => `<span>${escapeHtml(w.w)}</span>`).join(' ') : '';
      nextEl.textContent = next ? next.text : '';
    }
    if (now) now.words.forEach((w, k) => nowEl.children[k]?.classList.toggle('sung', t >= w.t));
  }
}

function pill(g, x, y, w, h) {
  const r = Math.min(h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
