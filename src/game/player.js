// One player on one highway: timing judgement (tap or strum mode), scoring, streak multiplier,
// overdrive, crowd meter, and — for the player holding the DualSense — triggers, haptics and lights.
import { settings } from '../settings.js';
import { Trigger } from '../input/dualsense.js';
import { FIVE_COLORS, DRUM_COLORS } from './highway.js';
import { currentRules } from './replay.js';

export const WINDOWS = { perfect: 0.035, great: 0.07, good: 0.115 };
export const ACCENT = { guitar: 0xe0432f, bass: 0x3b7fd6, drums: 0xeea02a, keys: 0x9a6ad8, vocals: 0x6cbf46 };
export const PLAYER_COLORS = ['#e2432f', '#3f86e0', '#f0b429', '#6cbf46'];
const JUDGE_COLOR = { perfect: '#f6c945', great: '#ece5d3', good: '#b9ae97', miss: '#e5402f' };
const MISS_PENALTY = { easy: 0.02, medium: 0.025, hard: 0.03, expert: 0.035 };
const STREAK_CALLOUTS = new Set([50, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000]);
const hexRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const WIDE = [0, 0, 2, 4, 4]; // lane assist "wide": 5 lanes → 3 wide lanes (outer pairs merged)

export class Player {
  /**
   * cfg: { name, instrument, difficulty, device, strum }
   */
  constructor(session, index, cfg, highway, hud) {
    this.s = session;
    this.index = index;
    this.cfg = cfg;
    this.highway = highway;
    this.hud = hud;
    this.inst = cfg.instrument;
    this.diff = cfg.difficulty;
    this.drums = this.inst === 'drums';
    this.strum = !this.drums && !!cfg.strum;
    this.maxMult = this.inst === 'bass' ? 6 : 4;
    this.colors = this.drums ? DRUM_COLORS : FIVE_COLORS;
    this.dsOwner = false;
    this.lefty = cfg.lefty ?? settings.leftyFlip;
    this.rules = cfg.rules || currentRules(); // judgement rules (a replay keeps the ones it was recorded with)
    this.replayer = cfg.replayer || null;
  }

  setup(song, startTime = 0) {
    const chart = song.charts[this.inst];
    this.notes = chart.notes[this.diff]
      .filter((n) => n.t >= startTime - 0.05)
      .map((n, i) => ({ ...n, i, hit: false, missed: false, judged: false, sus: n.len > 0 ? { held: false, dead: false, done: false } : null }));
    if (this.rules.laneAssist === 'wide' && !this.drums) {
      const seen = new Set();
      this.notes = this.notes.filter((n) => {
        n.lane = WIDE[n.lane];
        const k = `${n.t.toFixed(4)}:${n.lane}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      this.notes.forEach((n, i) => { n.i = i; });
    }
    // chord groups + hammer-on/pull-off flags for strum mode
    this.groups = [];
    for (const n of this.notes) {
      const g = this.groups[this.groups.length - 1];
      if (g && Math.abs(g.t - n.t) < 1e-4) g.notes.push(n);
      else this.groups.push({ t: n.t, notes: [n], judged: false });
      n.group = this.groups[this.groups.length - 1];
    }
    if (this.strum) {
      const beats = song.beats;
      let bi = 0;
      for (let k = 1; k < this.groups.length; k++) {
        const g = this.groups[k], p = this.groups[k - 1];
        while (bi < beats.length - 2 && beats[bi + 1] <= g.t) bi++;
        const bl = (beats[bi + 1] - beats[bi]) || 0.5;
        g.hopo = g.notes.length === 1 && p.notes.length === 1 && g.notes[0].lane !== p.notes[0].lane && g.t - p.t <= bl * 0.36;
        if (g.hopo) g.notes[0].hopo = true;
      }
    }
    this.laneNotes = [[], [], [], [], []];
    for (const n of this.notes) this.laneNotes[n.lane].push(n);
    this.ptr = [0, 0, 0, 0, 0];
    this.gptr = 0;
    this.phraseCount = new Map();
    for (const n of this.notes) if (n.p >= 0) this.phraseCount.set(n.p, (this.phraseCount.get(n.p) || 0) + 1);
    this.phraseHits = new Map();
    this.phraseFailed = new Set();
    this.activeSus = new Set();
    this.baseScore = this.notes.reduce((sum, n) => sum + 50 + (n.len > 0 ? (n.len / 0.5) * 25 : 0), 0);
    this.score = 0; this.streak = 0; this.maxStreak = 0; this.mult = 1;
    this.od = 0; this.odActive = false; this.odActivations = 0;
    this.rock = 0.5;
    this.failed = false;
    this.audible = true;
    this.stats = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.lastMissSfx = 0;
    this.lastSusRumble = 0;
    this.lightFlash = { col: [0, 0, 0], until: 0 };
    this.trigTemp = [null, null];
    this.trigSus = [null, null];
    this.onFire = false;
    this.highway.configure({ instrument: this.inst, lefty: this.lefty, speed: 8 + settings.noteSpeed * 2.4, accent: ACCENT[this.inst] });
    this.highway.resetScroll();
    this._baseTriggers();
  }

  get ds() { return this._ds || this.s.ds; }
  get engine() { return this.s.engine; }
  rumble(strong, weak, ms) { if (this.dsOwner && this.cfg.rumble !== false) this.ds.rumble(strong, weak, ms); }
  rawHeld(lane) { return this.replayer ? this.replayer.held[lane] : this.s.input.isHeld(this.index, lane); }
  /** Lane held — through the lane assist (wide: either button of a merged pair; any: any button). */
  isHeld(lane) {
    const a = this.rules.laneAssist;
    if (!a || a === 'off' || (a === 'wide' && this.drums)) return this.rawHeld(lane);
    if (a === 'any') return [0, 1, 2, 3, 4].some((l) => this.rawHeld(l));
    return [0, 1, 2, 3, 4].some((l) => WIDE[l] === lane && this.rawHeld(l));
  }
  get assisted() { return (this.rules.laneAssist && this.rules.laneAssist !== 'off') || !!this.rules.autoSustain; }
  whammy() { return this.replayer ? this.replayer.whammy : this.s.input.whammy(this.index); }

  // ---------------------------------------------------------------- input
  handle(ev, t) {
    if (this.failed && ev.type !== 'od') return;
    if (ev.type === 'press') this.press(ev.lane, t);
    else if (ev.type === 'release') this.release(ev.lane, t);
    else if (ev.type === 'strum') this.strumAt(t);
    else if (ev.type === 'od') this.activateOD();
  }

  press(lane, t) {
    if (this.strum) { this._tryHopo(t); return; }
    if (this.rules.laneAssist === 'any') { // any button hits the next note (and its whole chord)
      const g = this._nextGroup(t);
      if (g) { this._hitGroup(g, t); return; }
      this.ghost(lane, t);
      return;
    }
    if (this.rules.laneAssist === 'wide' && !this.drums) lane = WIDE[lane];
    const list = this.laneNotes[lane];
    let p = this.ptr[lane];
    while (p < list.length && list[p].judged) p++;
    this.ptr[lane] = p;
    for (let k = p; k < list.length; k++) {
      const n = list[k];
      if (n.judged) continue;
      if (n.t - t > WINDOWS.good) break;
      if (t - n.t <= WINDOWS.good) { this.hit(n, t - n.t); return; }
    }
    this.ghost(lane, t);
  }

  release(lane, t = this.s.engine.songTime) {
    for (const n of this.activeSus) if (n.lane === lane) { this._susScore(n, Math.min(t, n.t + n.len)); this._endSustain(n, false); }
    if (this.strum) this._tryHopo(t); // pull-offs
  }

  _nextGroup(t) {
    while (this.gptr < this.groups.length && this.groups[this.gptr].judged) this.gptr++;
    for (let k = this.gptr; k < this.groups.length; k++) {
      const g = this.groups[k];
      if (g.judged) continue;
      if (g.t - t > WINDOWS.good) return null;
      if (t - g.t <= WINDOWS.good) return g;
    }
    return null;
  }

  _fretsMatch(g) {
    if (this.rules.laneAssist === 'any') return true;
    const held = [0, 1, 2, 3, 4].filter((l) => this.isHeld(l));
    const req = g.notes.map((n) => n.lane).sort();
    if (req.length === 1) return held.includes(req[0]) && !held.some((l) => l > req[0]); // anchoring: lower frets allowed
    return held.length === req.length && req.every((l, i) => held[i] === l);
  }

  strumAt(t) {
    const g = this._nextGroup(t);
    if (g && this._fretsMatch(g)) { this._hitGroup(g, t); return; }
    // overstrum: breaks the streak
    if (this.rules.ghostPenalty || g) this._breakStreak(g ? g.notes[0].lane : 2);
  }

  _tryHopo(t) {
    const g = this._nextGroup(t);
    if (!g || !g.hopo || this.streak === 0) return;
    if (this._fretsMatch(g)) this._hitGroup(g, t);
  }

  _hitGroup(g, t) {
    g.judged = true;
    for (const n of g.notes) if (!n.judged) this.hit(n, t - n.t);
  }

  ghost(lane, t) {
    if (this.drums || !this.rules.ghostPenalty) return;
    let near = false;
    for (let l = 0; l < 5 && !near; l++) {
      const list = this.laneNotes[l];
      for (let k = this.ptr[l]; k < list.length; k++) {
        const n = list[k];
        if (n.t - t > 0.25) break;
        if (!n.judged && Math.abs(n.t - t) < 0.25) { near = true; break; }
      }
    }
    if (near) this._breakStreak(lane);
  }

  _breakStreak(lane) {
    this.streak = 0;
    this._updateMult();
    this.rock = Math.max(0, this.rock - 0.01);
    this.highway.missFx(lane);
    const now = performance.now();
    if (now - this.lastMissSfx > 150) { this.engine.sfxMiss(false); this.lastMissSfx = now; }
  }

  // ---------------------------------------------------------------- judgement
  hit(n, delta) {
    const ad = Math.abs(delta);
    const j = ad <= WINDOWS.perfect ? 'perfect' : ad <= WINDOWS.great ? 'great' : 'good';
    n.hit = n.judged = true;
    if (n.group && n.group.notes.every((x) => x.judged)) n.group.judged = true;
    this.stats[j]++;
    this.streak++;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this._updateMult();
    this.score += 50 * this.mult * (this.odActive ? 2 : 1);
    this.rock = Math.min(1, this.rock + (this.odActive ? 0.02 : 0.012));
    this.audible = true;
    this.highway.hitFx(n.lane, j);
    this.hud.judge(j.toUpperCase(), JUDGE_COLOR[j]);
    if (STREAK_CALLOUTS.has(this.streak)) {
      this.hud.callout(`${this.streak} NOTE STREAK!`, '#ece5d3');
      this.rumble(60, 160, 220);
      if (this.streak >= 100) this.s.stage.sparks();
    }
    if (n.sus) { n.sus.held = true; n.sus.last = n.t + delta; this.activeSus.add(n); this._setSusTrigger(n, true); }
    if (n.p >= 0 && !this.phraseFailed.has(n.p)) {
      const h = (this.phraseHits.get(n.p) || 0) + 1;
      this.phraseHits.set(n.p, h);
      if (h === this.phraseCount.get(n.p)) this._phraseComplete();
    }
    if (this.dsOwner) {
      if (this.drums) {
        if (n.lane === 0) this.rumble(170, 10, 70);
        else if (n.lane === 4 || n.lane === 2) this.rumble(30, 130, 60);
        else this.rumble(20, 110, 45);
      } else {
        const w = j === 'perfect' ? 100 : j === 'great' ? 75 : 55;
        this.rumble(n.lane <= 1 ? 30 : 0, w, 45);
      }
      this.lightFlash = { col: hexRgb(this.colors[n.lane]), until: performance.now() + 150 };
    }
  }

  miss(n) {
    n.missed = n.judged = true;
    if (n.group && n.group.notes.every((x) => x.judged)) n.group.judged = true;
    if (n.sus) n.sus.dead = true;
    this.stats.miss++;
    this.streak = 0;
    this._updateMult();
    this.rock = Math.max(0, this.rock - MISS_PENALTY[this.diff]);
    if (n.p >= 0) this.phraseFailed.add(n.p);
    this.audible = false;
    const now = performance.now();
    if (now - this.lastMissSfx > 120) { this.engine.sfxMiss(this.drums); this.lastMissSfx = now; }
    this.highway.missFx(n.lane);
    this.hud.judge('MISS', JUDGE_COLOR.miss);
    this.s.fx.aberration = Math.max(this.s.fx.aberration, 0.004);
    if (this.dsOwner) {
      this.rumble(150, 25, 110);
      const until = now + 160;
      this.trigTemp = [{ fx: Trigger.off(), until }, { fx: Trigger.off(), until }];
    }
    if (this.rock <= 0 && !this.rules.noFail) this.fail();
  }

  _updateMult() {
    this.mult = Math.min(this.maxMult, 1 + Math.floor(this.streak / 10));
  }

  _phraseComplete() {
    const before = this.od;
    this.od = Math.min(1, this.od + 0.25);
    this.engine.sfxPhrase();
    this.rumble(0, 200, 90); setTimeout(() => this.rumble(0, 200, 90), 130);
    if (!this.odActive && before < 0.5 && this.od >= 0.5) this.hud.callout('OVERDRIVE READY', '#ffe39a');
  }

  activateOD() {
    if (this.odActive || this.od < 0.5 || this.failed) return;
    this.odActive = true;
    this.odActivations++;
    this.engine.sfxOverdrive();
    this.engine.cheer(0.8);
    this.highway.odBurst();
    this.s.onOverdrive(this);
    this.hud.callout('OVERDRIVE!', '#f6c945');
    this.rumble(255, 220, 700);
  }

  fail() {
    if (this.failed) return;
    this.failed = true;
    this.odActive = false;
    this.audible = false;
    for (const n of this.activeSus) this._endSustain(n, false);
    this.hud.setFailed(true);
    this.s.onPlayerFailed(this);
  }

  revive() {
    if (!this.failed) return;
    this.failed = false;
    this.rock = 0.35;
    this.hud.setFailed(false);
    this.hud.callout('SAVED!', '#8dc044');
  }

  // ---------------------------------------------------------------- DualSense
  _physSide(lane) {
    if (this.drums) return -1;
    const phys = this.lefty ? 4 - lane : lane;
    return phys === 0 ? 0 : phys === 4 ? 1 : -1;
  }

  _baseTriggers() {
    const ds = this.ds;
    this.trigBase = this.drums
      ? [Trigger.weapon(3, 6, ds.scaleT(7)), Trigger.weapon(3, 6, ds.scaleT(7))]
      : [Trigger.weapon(2, 5, ds.scaleT(5)), Trigger.weapon(2, 5, ds.scaleT(5))];
    this.trigSus = [null, null];
    this.trigTemp = [null, null];
  }

  _setSusTrigger(n, on) {
    const side = this._physSide(n.lane);
    if (side < 0) return;
    this.trigSus[side] = on ? Trigger.vibration(2, this.ds.scaleT(4), 32 + (n.m % 12) * 3) : null;
  }

  /** Sustain points up to song time `until` (song-time based, so a replay scores exactly the same). */
  _susScore(n, until) {
    const d = until - n.sus.last;
    if (d <= 0) return;
    this.score += (25 * this.mult * (this.odActive ? 2 : 1) * d) / (this._bl || 0.5);
    n.sus.last = until;
  }

  _endSustain(n, completed) {
    n.sus.held = false;
    if (completed) n.sus.done = true; else n.sus.dead = true;
    this.activeSus.delete(n);
    this._setSusTrigger(n, false);
  }

  applyDs(now, beatHit, beatFrac) {
    const ds = this.ds;
    if (this.odActive && beatHit) {
      const until = now + 110;
      const fx = Trigger.vibration(1, ds.scaleT(7), 45);
      this.trigTemp = [{ fx, until }, { fx, until }];
      this.rumble(90, 40, 80);
    }
    const pick = (side) => {
      const tmp = this.trigTemp[side];
      if (tmp && tmp.until > now) return tmp.fx;
      return this.trigSus[side] || this.trigBase[side];
    };
    if (this.failed || this.cfg.triggers === false) ds.setTriggers(Trigger.off(), Trigger.off());
    else ds.setTriggers(pick(0), pick(1));
    let rgb;
    const accent = hexRgb(ACCENT[this.inst]);
    if (this.odActive) { const k = 0.55 + 0.45 * Math.cos(beatFrac * Math.PI * 2); rgb = [255 * k, 190 * k, 40 * k]; }
    else if (this.rock < 0.25) { const k = 0.4 + 0.6 * Math.abs(Math.sin(now / 180)); rgb = [255 * k, 0, 10 * k]; }
    else if (this.lightFlash.until > now) { const k = (this.lightFlash.until - now) / 150; rgb = accent.map((a, i) => a + (this.lightFlash.col[i] - a) * k); }
    else rgb = accent;
    ds.setLight(...rgb);
    ds.setPlayerLeds(this.odActive ? 5 : Math.min(5, this.mult));
  }

  // ---------------------------------------------------------------- per frame
  update(t, dt, bl, frame) {
    const now = performance.now();
    this._bl = bl;
    if (!frame.finished && !this.failed) {
      for (let lane = 0; lane < 5; lane++) {
        const list = this.laneNotes[lane];
        let p = this.ptr[lane];
        while (p < list.length && (list[p].judged || list[p].t < t - WINDOWS.good)) {
          if (!list[p].judged) this.miss(list[p]);
          p++;
        }
        this.ptr[lane] = p;
      }
      const whammy = this.whammy();
      for (const n of [...this.activeSus]) {
        if (!this.rules.autoSustain && !this.isHeld(n.lane)) { this._endSustain(n, false); continue; }
        this._susScore(n, Math.min(t, n.t + n.len));
        if (t >= n.t + n.len) { this._endSustain(n, true); continue; }
        this.highway.sustainSparks(n.lane);
        if (n.p >= 0 && !this.phraseFailed.has(n.p) && whammy > 0.25) this.od = Math.min(1, this.od + dt * 0.035);
        if (this.dsOwner && now - this.lastSusRumble > 45) { this.rumble(0, 40 + whammy * 60, 60); this.lastSusRumble = now; }
      }
      if (this.odActive) {
        this.od -= dt / bl / 32;
        if (this.od <= 0) { this.od = 0; this.odActive = false; }
      }
    }
    this.onFire = !this.failed && this.mult >= this.maxMult;
    if (this.dsOwner && !frame.finished) this.applyDs(now, frame.beatHit, frame.beatFrac);

    const held = [0, 1, 2, 3, 4].map((l) => this.isHeld(l));
    this.highway.update(t, dt, {
      notes: this.notes, beats: frame.beats, downbeat: frame.downbeat, held, od: this.odActive,
      odReady: !this.odActive && this.od >= 0.5, onFire: this.onFire, failed: this.failed,
      danger: this.rock < 0.25 ? 1 : 0, whammy: this.whammy(), beatHit: frame.beatHit,
      mult: this.mult, maxMult: this.maxMult, streak: this.streak,
      odPhraseAlive: (p) => !this.phraseFailed.has(p), cameraShake: settings.cameraShake && !settings.calmVisuals,
    });
    this.hud.frame(dt, {
      score: Math.floor(this.score), mult: this.mult * (this.odActive ? 2 : 1), maxMult: this.maxMult,
      multProgress: this.mult >= this.maxMult ? 1 : (this.streak % 10) / 10, streak: this.streak,
      od: this.od, odActive: this.odActive, rock: this.rock, anchor: this.highway.anchor(),
    });
  }

  upcomingCount(t) {
    let c = 0;
    for (let k = Math.min(...this.ptr); k < this.notes.length && this.notes[k].t < t + 2; k++) if (this.notes[k].t > t) c++;
    return c;
  }

  result() {
    const total = this.notes.length;
    const hits = this.stats.perfect + this.stats.great + this.stats.good;
    const accuracy = total ? (this.stats.perfect + this.stats.great * 0.8 + this.stats.good * 0.5) / total : 0;
    const ratio = this.baseScore ? this.score / this.baseScore : 0;
    const k = this.inst === 'bass' ? 1.3 : 1;
    const th = [0.2, 0.5, 1.0, 1.7, 2.5].map((x) => x * k);
    const stars = this.failed ? 0 : th.filter((x) => ratio >= x).length;
    const gold = !this.failed && ratio >= 3.4 * k;
    return {
      index: this.index, name: this.cfg.name, color: this.cfg.color || PLAYER_COLORS[this.index], device: this.cfg.device, profileId: this.cfg.profileId || null,
      instrument: this.inst, difficulty: this.diff, score: Math.floor(this.score), stars, gold, accuracy, hits, total,
      maxStreak: this.maxStreak, ...this.stats, odActivations: this.odActivations, failed: this.failed, strum: this.strum, assist: this.assisted,
    };
  }
}
