// A song being played by 1–4 local players (+ remote players online). Owns the clock, beat tracking,
// stage direction, per-instrument stem muting, band rules (shared crowd, overdrive saves),
// practice mode (time-stretched audio, start anywhere) and online relay.
import { settings } from '../settings.js';
import { gamepadRumble } from '../input/dualsense.js';
import { isDualSensePad } from '../input/input.js';
import { Highway } from './highway.js';
import { Player } from './player.js';
import { VocalPlayer } from './vocals.js';
import { RealPlayer } from './real.js';
import { saveBest, getBest } from '../storage/library.js';
import { STEM_FOR } from '../audio/engine.js';
import { runJob } from '../audio/pipeline.js';
import { Recorder, Replayer, buildReplay, ghostAt } from './replay.js';

const SHOTS = ['wide', 'left', 'player', 'right', 'low', 'drums', 'wide', 'player'];
const stretchInWorker = (L, R, rate, onProgress) => runJob('stretch', { L: L.slice(), R: R.slice(), rate }, undefined, onProgress);

export class Session {
  constructor({ engine, stage, renderer, input, ds, hud, onEnd, onPause }) {
    Object.assign(this, { engine, stage, renderer, input, ds, hud, onEnd, onPause });
    this.running = false;
    this.paused = false;
    this.highways = [];
    this.players = [];
    this.fx = { aberration: 0, shock: -1, od: 0 };
    input.onGame((ev) => this.handle(ev));
    window.addEventListener('blur', () => { if (this.running && !this.paused && !this.finished && !this.online) this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.running && !this.paused && !this.finished && !this.online) this.pause(); });
  }

  _highway(i) {
    while (this.highways.length <= i) this.highways.push(new Highway());
    return this.highways[i];
  }

  // ---------------------------------------------------------------- lifecycle
  /**
   * cfgs: [{ name, instrument, difficulty, device, strum, profileId }]
   * opts: { practice: { speed, startAt }, online: { client, lineup, startAt }, replay, ghost, onStatus }
   *   replay: a recorded run to play back (cfgs[0] is built from it); ghost: a recorded run to race
   */
  async start(song, audio, cfgs, opts = {}) {
    this.song = song; this.audio = audio; this.cfgs = cfgs; this.opts = opts;
    this.practice = opts.practice || null;
    this.online = opts.online || null;
    this.replay = opts.replay || null;
    this.ghost = !this.replay && cfgs.length === 1 ? opts.ghost || null : null;
    this.solo = cfgs.length === 1;
    this.startTime = this.practice ? Math.max(0, this.practice.startAt || 0) : 0;
    this.hud.setMulti(!this.solo);
    this.hud.clearPlayers();
    this.players = cfgs.map((cfg, i) => {
      const hud = this.solo ? this.hud : this.hud.addPlayer(i, cfgs.length, cfg);
      const pcfg = this.replay ? { ...cfg, replayer: new Replayer(this.replay), rules: this.replay.rules } : cfg;
      const p = cfg.mic && cfg.instrument === 'vocals' ? new VocalPlayer(this, i, pcfg, null, hud)
        : cfg.real && ['guitar', 'bass', 'keys'].includes(cfg.instrument) ? new RealPlayer(this, i, pcfg, this._highway(i), hud)
          : new Player(this, i, pcfg, this._highway(i), hud);
      p.setup(song, this.startTime);
      p.recorder = this.practice || this.replay ? null : new Recorder();
      return p;
    });
    this.ds.offAll();
    for (const p of this.players) this._assignFeedback(p);

    const lastEnd = Math.max(0, ...this.players.flatMap((p) => p.notes.map((n) => n.t + (n.len || 0))));
    this.endTime = Math.min(song.duration, Math.max(lastEnd + 5, this.startTime + 20));
    this.beatPtr = 0; this.lastBeat = -1;
    this.countdownShown = new Set();
    this.failedAll = false;
    this.finished = false;
    this.stemState = new Map();
    this.remote = new Map();
    this.lastLive = 0;
    this.lastBoard = 0;

    const insts = new Set(cfgs.map((c) => c.instrument));
    if (this.online) for (const r of this.online.lineup) if (r.id !== this.online.client.id) insts.add(r.instrument);
    this.engine.prepare(song, audio, [...insts]);
    if (this.practice && Math.abs(this.practice.speed - 1) > 1e-3) {
      opts.onStatus?.(`Preparing ${Math.round(this.practice.speed * 100)}% speed audio (pitch preserved)...`);
      await this.engine.stretchTo(this.practice.speed, stretchInWorker, (p) => opts.onStatus?.(`Time-stretching audio ${Math.round(p * 100)}%`));
    }
    this.renderer.setHighways(this.players.map((p) => p.highway).filter(Boolean));
    this.input.setGame(cfgs.map((c) => ({ device: c.device, mode: c.instrument === 'drums' ? 'drums' : 'five' })));
    this.stage.setShot('wide');
    const title = this.replay ? `REPLAY · ${this.replay.name} · ${cfgs[0].instrument} · ${cfgs[0].difficulty} · ${new Date(this.replay.date).toLocaleDateString()}`
      : this.practice ? `PRACTICE · ${Math.round(this.practice.speed * 100)}% · from ${fmt(this.startTime)}`
      : this.online ? `${song.artist} · online match · ${this.online.lineup.length} players`
        : this.solo ? `${song.artist} · ${cfgs[0].instrument} · ${cfgs[0].difficulty}` : `${song.artist} · ${cfgs.length}-player band`;
    this.hud.reset(song.title, title);
    this.hud.remote(this.online ? this._remoteRows() : null);
    this.hud.ghost(this.ghost ? { name: this.ghost.name, score: 0, delta: 0 } : null);
    this.hud.replayBadge(!!this.replay);
    this._setupOnline();
    this.running = true;
    this.paused = false;
    const rate = this.engine.rate || 1;
    let from = this.startTime - 3.2 * rate;
    if (this.online) from = -Math.max(0.5, (this.online.startAt - this.online.client.serverNow()) / 1000);
    this.engine.start(from);
    this.engine.setCrowd(0.3);
  }

  /** Give a player the controller that should rumble / drive triggers for them. */
  _assignFeedback(p) {
    const dev = p.cfg.device || 'any';
    p.dsOwner = false;
    p._ds = null;
    if (dev.startsWith('kb') || dev.startsWith('midi')) return;
    const pads = this.input.getPads();
    const linked = this.ds.forDevice(dev, (idx) => isDualSensePad(pads.find((x) => x.index === idx)));
    if (linked) { p._ds = linked; p.dsOwner = true; return; }
    if (dev === 'any') { p.dsOwner = true; return; } // primary DualSense, or Gamepad API rumble on any pad
    const m = /^pad:(\d+)$/.exec(dev);
    if (!m) return;
    const index = +m[1], ds = this.ds;
    // any other gamepad: rumble through the Gamepad API (no triggers / lightbar)
    p._ds = {
      scaleT: (v) => ds.scaleT(v), setTriggers() {}, setLight() {}, setPlayerLeds() {},
      rumble: (strong, weak, ms) => { const k = settings.rumbleIntensity; if (k > 0.01) gamepadRumble(strong * k / 255, weak * k / 255, ms, index); },
    };
    p.dsOwner = true;
  }

  _setupOnline() {
    this.offOnline?.forEach((f) => f());
    this.offOnline = null;
    if (!this.online) return;
    const c = this.online.client;
    this.offOnline = [
      c.on('live', (m) => { this.remote.set(m.id, m); }),
      c.on('event', (m) => {
        const who = this.online.lineup.find((r) => r.id === m.id);
        if (m.kind === 'od') {
          if (who) this.hud.callout(`${who.name}: OVERDRIVE!`, '#ffcf3a');
          for (const p of this.players) if (p.failed) p.revive(); // their overdrive saves us too
        } else if (m.kind === 'fail' && who) this.hud.callout(`${who.name} failed — overdrive to save them!`, '#ff3b3b');
        else if (m.kind === 'left' && who) { this.hud.callout(`${who.name} left`, '#9a98b8'); this.remote.set(m.id, { ...(this.remote.get(m.id) || {}), left: true }); }
      }),
    ];
  }

  _remoteRows() {
    if (!this.online) return null;
    const me = this.players[0];
    return this.online.lineup.map((r) => {
      const mine = r.id === this.online.client.id;
      const live = mine ? { score: Math.floor(me.score), streak: me.streak, mult: me.mult * (me.odActive ? 2 : 1), odActive: me.odActive, failed: me.failed } : this.remote.get(r.id) || {};
      return { ...r, mine, score: live.score || 0, streak: live.streak || 0, mult: live.mult || 1, odActive: !!live.odActive, failed: !!live.failed, left: !!live.left };
    }).sort((a, b) => b.score - a.score);
  }

  stop() {
    this.running = false;
    for (const p of this.players) p.dispose?.();
    this.paused = false;
    this.offOnline?.forEach((f) => f());
    this.offOnline = null;
    this.engine.stop();
    this.engine.rate = 1;
    this.renderer.setHighways([]);
    this.hud.clearPlayers();
    this.hud.remote(null);
    this.hud.ghost(null);
    this.hud.replayBadge(false);
    this.input.setMenu();
    this.ds.offAll();
    this.engine.setCrowd(0.15);
  }

  async pause() {
    if (!this.running || this.paused || this.online) return; // online matches can't be paused
    this.paused = true;
    await this.engine.pause();
    this.input.setMenu();
    this.ds.offAll();
    this.onPause?.();
  }

  async resume() {
    if (!this.paused) return;
    this.input.setGame(this.cfgs.map((c) => ({ device: c.device, mode: c.instrument === 'drums' ? 'drums' : 'five' })));
    for (const p of this.players) p._baseTriggers();
    this.paused = false;
    await this.engine.resume();
  }

  async restart() {
    const { song, audio, cfgs, opts } = this;
    this.stop();
    await this.start(song, audio, cfgs, opts);
  }

  // ---------------------------------------------------------------- events
  handle(ev) {
    if (!this.running) return;
    if (ev.type === 'pause') { if (!this.finished) this.pause(); return; }
    if (this.paused || this.finished) return;
    const p = this.players[ev.player];
    if (!p || p.replayer) return; // a replay plays itself
    const t = this.engine.timeAt(ev.t);
    p.recorder?.input(ev, t);
    p.handle(ev, t);
  }

  onOverdrive(player) {
    const calm = settings.calmVisuals;
    this.stage.pyro(calm ? 0.35 : 1);
    if (!calm) {
      this.stage.setShot('player');
      this.fx.shock = 0;
      this.fx.aberration = Math.max(this.fx.aberration, 0.012);
    }
    for (const p of this.players) if (p !== player && p.failed) p.revive();
    this.online?.client.event('od');
  }

  /** Stream mode: a viewer typed !hype. */
  hype(name) {
    if (!this.running || this.finished) return;
    this.stage.pyro(settings.calmVisuals ? 0.35 : 1.2);
    if (!settings.calmVisuals) { this.stage.sparks(); this.fx.shock = 0; }
    this.engine.cheer(1);
    this.hud.callout(`${name} hyped the crowd!`, '#ff8a1a');
  }

  onPlayerFailed(player) {
    this.engine.sfxFail();
    player.hud.callout(this.solo ? 'YOU FAILED' : 'FAILED!', '#ff3b3b');
    this.online?.client.event('fail');
    if (this.players.every((p) => p.failed) && !this.online) { this.failedAll = true; this._finish(); }
    else if (!this.solo) this.hud.callout(`${player.cfg.name} failed — overdrive to save them!`, '#ff3b3b');
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.running) return null;
    const t = this.engine.songTime;
    const beats = this.song.beats;
    let beatHit = false;
    const now = performance.now();

    if (!this.paused && !this.finished) {
      const rate = this.engine.rate || 1;
      for (const [c, at] of [[3, -2.4], [2, -1.6], [1, -0.8]]) {
        const when = this.startTime + at * rate;
        if (t >= when && !this.countdownShown.has(c)) {
          this.countdownShown.add(c);
          if (t > when + 0.4 * rate) continue;
          this.hud.countdown(c);
          this.engine.sfxTick(0, c === 1);
        }
      }
      while (this.beatPtr < beats.length - 2 && beats[this.beatPtr + 1] <= t) this.beatPtr++;
      if (t >= beats[this.beatPtr] && this.beatPtr !== this.lastBeat) {
        this.lastBeat = this.beatPtr;
        beatHit = t > this.startTime - 0.5;
        const measure = Math.round(this.beatPtr - this.song.downbeat);
        if (beatHit && measure % 32 === 0 && measure > 0) {
          this.stage.nextPalette();
          if (!this.players.some((p) => p.odActive) && !settings.calmVisuals) this.stage.setShot(SHOTS[(measure / 32) % SHOTS.length]);
        }
      }
      if (t > this.endTime) this._finish();
    }
    const b0 = beats[this.beatPtr], b1 = beats[this.beatPtr + 1] || b0 + 0.5;
    const bl = (b1 - b0) || 0.5;
    const beatFrac = Math.max(0, Math.min(1, (t - b0) / bl));
    const frame = { beats, downbeat: this.song.downbeat, beatHit, beatFrac, finished: this.finished || this.paused };
    const live = !this.paused && !this.finished;
    for (const p of this.players) {
      if (live && p.replayer) p.replayer.pump(p, t);
      p.update(t, dt, bl, frame);
      if (live && p.recorder) { p.recorder.whammy(p.whammy(), t); p.recorder.sample(t, p.score, p.streak); }
    }
    if (this.ghost && live) {
      const g = ghostAt(this.ghost.timeline, t);
      this.hud.ghost({ name: this.ghost.name, score: g.score, delta: Math.floor(this.players[0].score) - g.score });
    }

    // online: publish our state, show everyone's scores
    if (this.online && !this.finished && now - this.lastLive > 125) {
      this.lastLive = now;
      const me = this.players[0];
      this.online.client.live({
        score: Math.floor(me.score), streak: me.streak, mult: me.mult * (me.odActive ? 2 : 1), od: +me.od.toFixed(2),
        odActive: me.odActive, rock: +me.rock.toFixed(2), audible: me.audible, failed: me.failed, instrument: me.inst,
      });
    }
    if (this.online && now - this.lastBoard > 250) { this.lastBoard = now; this.hud.remote(this._remoteRows()); }

    // stem muting: an instrument drops out while every player on it (local or remote) is missing or failed
    const insts = new Set(this.players.map((p) => p.inst));
    if (this.online) for (const r of this.online.lineup) insts.add(r.instrument);
    for (const inst of insts) {
      let on = this.players.some((p) => p.inst === inst && p.audible && !p.failed);
      if (!on && this.online) {
        on = this.online.lineup.some((r) => {
          if (r.id === this.online.client.id || r.instrument !== inst) return false;
          const live = this.remote.get(r.id);
          return !live || live.left || (live.audible !== false && !live.failed);
        });
      }
      if (this.stemState.get(inst) !== on) { this.stemState.set(inst, on); this.engine.setStemAudible(STEM_FOR[inst], on); }
    }

    const alive = this.players.filter((p) => !p.failed);
    const rock = alive.length ? alive.reduce((s, p) => s + p.rock, 0) / alive.length : 0;
    const anyOD = this.players.some((p) => p.odActive);
    this.engine.setCrowd(0.12 + rock * 0.35 + (anyOD ? 0.25 : 0));
    this.hud.progress(Math.max(0, Math.min(1, (t - this.startTime) / Math.max(1, this.endTime - this.startTime))));
    if (!this.solo) this.hud.bandScore(this.players.reduce((s, p) => s + p.score, 0));

    this.fx.aberration = Math.max(0, this.fx.aberration - dt * 0.02);
    if (this.fx.shock >= 0) { this.fx.shock += dt * 1.4; if (this.fx.shock > 1) this.fx.shock = -1; }
    this.fx.od += ((anyOD ? 1 : 0) - this.fx.od) * Math.min(1, dt * 3);
    if (settings.calmVisuals) { this.fx.shock = -1; this.fx.aberration = 0; } // calm visuals: no shockwaves / colour fringing
    this.renderer.setFx(this.fx);

    const lv = this.engine.levels();
    const upcoming = this.players.reduce((s, p) => s + p.upcomingCount(t), 0) / this.players.length;
    const density = Math.min(1, upcoming / 12);
    const focusPlayer = this.players.find((p) => p.odActive) || this.players[0];
    return {
      mode: 'game', beat: this.beatPtr + beatFrac, beatHit, bass: lv.bass, mid: lv.mid, high: lv.high, spectrum: lv.spectrum,
      od: anyOD, intensity: Math.min(1, 0.35 * density + lv.level * 1.4 + (anyOD ? 0.3 : 0)), rock, focus: focusPlayer.inst === 'vocals' ? 'guitar' : focusPlayer.inst,
    };
  }

  async _finish() {
    if (this.finished) return;
    this.finished = true;
    for (const p of this.players) { p.activeSus.clear(); p.dispose?.(); }
    const players = this.players.map((p) => p.result());
    const replays = this.players.map((p, i) => (p.recorder ? buildReplay(this.song, p, p.recorder, players[i]) : null));
    if (!this.practice && !this.replay) {
      for (const r of players) {
        r.prevBest = getBest(this.song.id, r.instrument, r.difficulty);
        r.newBest = !r.failed && !r.assist && saveBest(this.song.id, r.instrument, r.difficulty, { score: r.score, stars: r.stars, gold: r.gold, accuracy: r.accuracy });
      }
    }
    const failed = this.failedAll;
    if (!failed) {
      this.stage.confettiBurst();
      this.stage.pyro(1.3);
      this.stage.sparks();
      this.engine.cheer(1.2);
      this.ds.rumble(200, 200, 500);
    }
    this.ds.offAll();
    this.engine.fadeOut(failed ? 0.6 : 1.6);

    let remoteResults = null;
    if (this.online) {
      const c = this.online.client;
      const mine = { ...players[0], onlineId: c.id };
      players[0].onlineId = c.id;
      c.result(mine);
      this.hud.callout('Waiting for the other players...', '#29e0ff');
      const matchId = this.online.matchId;
      remoteResults = c.lastResults && c.lastResults.matchId === matchId ? c.lastResults.results : await new Promise((resolve) => {
        const off = c.on('results', (list, msg) => { if (!matchId || msg?.matchId === matchId) { off(); resolve(list); } });
        setTimeout(() => { off(); resolve(c.lastResults?.matchId === matchId ? c.lastResults.results : null); }, 22000);
      });
    }
    await new Promise((r) => setTimeout(r, failed ? 1400 : this.online ? 600 : 1800));
    this.running = false;
    this.offOnline?.forEach((f) => f());
    this.offOnline = null;
    this.renderer.setHighways([]);
    this.hud.clearPlayers();
    this.hud.remote(null);
    this.hud.ghost(null);
    this.hud.replayBadge(false);
    this.input.setMenu();
    this.ds.offAll();
    this.engine.rate = 1;
    const result = {
      song: this.song, players, failed, bandScore: players.reduce((s, r) => s + r.score, 0), practice: this.practice, replays,
      replay: this.replay, ghost: this.ghost ? { name: this.ghost.name, score: this.ghost.score } : null,
      mode: this.replay ? 'replay' : this.practice ? 'practice' : this.online ? 'online' : this.solo ? 'solo' : 'band',
    };
    if (this.online) {
      const c = this.online.client;
      const others = (remoteResults || []).filter((r) => r.id !== c.id).map((r) => ({ ...r, remote: true }));
      result.remotePlayers = others;
      const all = [...players.map((p) => ({ ...p, id: c.id })), ...others];
      // "winning" needs an opponent whose result actually arrived
      result.onlineWinnerId = all.length > 1 ? all.sort((a, b) => (b.score || 0) - (a.score || 0))[0]?.id || null : null;
      result.bandScore = all.reduce((s, r) => s + (r.score || 0), 0);
    }
    this.onEnd?.(result);
  }
}

function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
