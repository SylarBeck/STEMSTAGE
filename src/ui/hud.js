// In-game HUD (DOM overlay). `Hud` owns the global elements and doubles as the solo player's
// panel; `PlayerHud` is the compact per-player panel used in band mode. Writes only on change.
const $ = (id) => document.getElementById(id);
import { instIcon, fa } from './icons.js';
import { PLAYER_COLORS } from '../game/player.js';
const ICON = { guitar: instIcon('guitar'), bass: instIcon('bass'), drums: instIcon('drums'), keys: instIcon('keys'), vocals: instIcon('vocals') };

function popClass(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

class HudBase {
  _set(key, v, fn) { if (this.cache[key] !== v) { this.cache[key] = v; fn(v); } }

  judge(text, color) {
    const j = this.el.judge;
    j.textContent = text;
    j.style.color = color;
    j.style.textShadow = '0 3px 0 #0b0a09, 2px 0 0 #0b0a09, -2px 0 0 #0b0a09';
    popClass(j, 'show');
  }

  callout(text, color = '#fff') {
    const c = this.el.callout;
    c.textContent = text;
    c.style.color = color;
    popClass(c, 'show');
  }
}

export class Hud extends HudBase {
  constructor() {
    super();
    this.root = $('hud');
    this.el = {
      score: $('hud-score'), mult: $('hud-mult'), ring: $('mult-ring'), streak: $('hud-streak'),
      od: $('od-fill'), odMeter: document.querySelector('#hud .od-meter'), needle: $('rock-needle'),
      judge: $('hud-judge'), callout: $('hud-callout'), countdown: $('hud-countdown'),
      progress: $('hud-progress-fill'), title: $('hud-title'), sub: $('hud-sub'), band: $('hud-band'), fail: $('hud-fail'),
    };
    this.cache = {};
    this.shownScore = 0;
    this.players = [];
  }

  setMulti(on) { this.root.classList.toggle('multi', on); }

  clearPlayers() { this.players.forEach((p) => p.destroy()); this.players = []; }

  addPlayer(index, count, cfg) {
    const p = new PlayerHud(this.root, index, count, cfg);
    this.players.push(p);
    return p;
  }

  reset(title, sub) {
    this.cache = {};
    this.shownScore = 0;
    this.el.title.textContent = title;
    this.el.sub.textContent = sub;
    this.el.judge.className = 'judge';
    this.el.callout.className = 'callout';
    this.el.band.textContent = '';
    this.setFailed(false);
  }

  progress(p) { this._set('prog', Math.round(p * 400), (v) => { this.el.progress.style.width = `${v / 4}%`; }); }
  bandScore(v) { this._set('band', Math.floor(v), (x) => { this.el.band.textContent = `BAND ${x.toLocaleString()}`; }); }

  setFailed(on) { this.el.fail.classList.toggle('show', !!on); }

  /** Keep the score/multiplier and meters next to the highway's strikeline. */
  _anchor(a) {
    const last = this.cache.anchor;
    if (last && Math.abs(last.l - a.l) < 1.5 && Math.abs(last.r - a.r) < 1.5 && Math.abs(last.y - a.y) < 1.5) return;
    this.cache.anchor = { ...a };
    const st = this.root.style;
    const k = 1 / (window.__uiScale || 1); // the UI is zoomed to fit the window; the projection is in window px
    st.setProperty('--trk-l', `${(a.l * k).toFixed(1)}px`);
    st.setProperty('--trk-r', `${(a.r * k).toFixed(1)}px`);
    st.setProperty('--trk-y', `${(a.y * k).toFixed(1)}px`);
  }

  frame(dt, s) {
    if (s.anchor) this._anchor(s.anchor);
    this.shownScore += (s.score - this.shownScore) * Math.min(1, dt * 12);
    if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
    this._set('score', Math.round(this.shownScore), (v) => { this.el.score.textContent = v.toLocaleString(); });
    this._set('mult', s.mult, (v) => { this.el.mult.innerHTML = `${v}&times;`; popClass(this.el.mult, 'bump'); });
    this._set('ring', Math.round(s.multProgress * 100), (v) => { this.el.ring.style.strokeDashoffset = String(264 * (1 - v / 100)); });
    this._set('ringCol', s.odActive ? 'od' : s.mult >= s.maxMult ? 'max' : 'n', (v) => {
      this.el.ring.style.stroke = v === 'od' ? 'var(--gold)' : v === 'max' ? 'var(--accent)' : 'var(--ink)';
    });
    this._set('streak', s.streak, (v) => { this.el.streak.textContent = v; });
    this._set('od', Math.round(s.od * 200) / 2, (v) => { this.el.od.style.width = `${v * 100}%`; });
    this._set('odState', s.odActive ? 'active' : s.od >= 0.5 ? 'ready' : '', (v) => {
      this.el.odMeter.classList.toggle('active', v === 'active');
      this.el.odMeter.classList.toggle('ready', v === 'ready');
    });
    this._set('rock', Math.round(s.rock * 100), (v) => { this.el.needle.style.left = `calc(${v}% - 2px)`; });
  }

  countdown(n) {
    const c = this.el.countdown;
    c.textContent = n;
    popClass(c, 'show');
  }

  /** Ghost race panel under the score (null hides it). g: { name, score, delta } */
  ghost(g) {
    let el = document.getElementById('hud-ghost');
    if (!g) { if (el) el.hidden = true; this.cache.ghost = null; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-ghost';
      el.className = 'hud-ghost';
      el.innerHTML = '<span class="hg-name"></span><b class="hg-score"></b><em class="hg-delta"></em>';
      this.root.querySelector('.hud-left').appendChild(el);
    }
    el.hidden = false;
    const key = `${g.name}|${g.score}|${Math.round(g.delta / 10)}`;
    if (this.cache.ghost === key) return;
    this.cache.ghost = key;
    el.querySelector('.hg-name').innerHTML = `${fa('ghost')} ${escapeHtml(g.name)}`;
    el.querySelector('.hg-score').textContent = g.score.toLocaleString();
    const d = el.querySelector('.hg-delta');
    d.innerHTML = `${fa(g.delta >= 0 ? 'caret-up' : 'caret-down')} ${Math.abs(g.delta).toLocaleString()}`;
    d.className = `hg-delta ${g.delta >= 0 ? 'ahead' : 'behind'}`;
  }

  replayBadge(on) {
    let el = document.getElementById('hud-replay');
    if (!el && on) {
      el = document.createElement('div');
      el.id = 'hud-replay';
      el.className = 'hud-replay';
      el.innerHTML = `${fa('circle', 'rec')} REPLAY`;
      this.root.appendChild(el);
    }
    if (el) el.hidden = !on;
  }

  /** Online scoreboard (null hides it). rows: [{ name, color, instrument, score, streak, mult, odActive, failed, left, mine }] */
  /** Online scoreboard. mode: versus / battle (a ranking) or band (the line-up and one band score). */
  remote(rows, { mode = 'versus' } = {}) {
    let el = document.getElementById('hud-remote');
    if (!rows) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-remote';
      el.className = 'hud-remote';
      this.root.appendChild(el);
    }
    el.hidden = false;
    const band = mode === 'band';
    el.classList.toggle('band', band);
    const total = rows.reduce((s, r) => s + (r.score || 0), 0);
    el.innerHTML = `<div class="hr-title">${band ? 'BAND' : mode === 'battle' ? 'BATTLE' : 'MATCH'}${band ? `<b class="hr-total">${total.toLocaleString()}</b>` : ''}</div>` + rows.map((r, i) => `
      <div class="hr-row ${r.mine ? 'mine' : ''} ${r.failed ? 'failed' : ''} ${r.left ? 'left' : ''}" style="--pc:${r.color}">
        <span class="hr-pos">${band ? (ICON[r.instrument] || '') : i + 1}</span><i></i><span class="hr-name">${escapeHtml(r.name)} ${band ? '' : ICON[r.instrument] || ''}</span>
        <b>${Number(r.score || 0).toLocaleString()}</b><em class="${r.odActive ? 'od' : ''}">${r.mult || 1}×</em>
      </div>`).join('');
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PlayerHud extends HudBase {
  constructor(root, index, count, cfg) {
    super();
    const hudRoot = root;
    const color = PLAYER_COLORS[index];
    const div = document.createElement('div');
    div.className = 'phud';
    div.style.left = `${(index / count) * 100}%`;
    div.style.width = `${100 / count}%`;
    div.style.setProperty('--pc', color);
    div.innerHTML = `
      <div class="phud-judge"></div>
      <div class="phud-callout"></div>
      <div class="phud-fail">FAILED<small>Another player's overdrive saves you</small></div>
      <div class="phud-panel">
        <div class="phud-name"><i></i>${cfg.name} <span>${ICON[cfg.instrument] || ''} ${cfg.instrument} · ${cfg.difficulty}${cfg.strum ? ' · strum' : ''}</span></div>
        <div class="phud-row"><b class="phud-score">0</b><span class="phud-mult">1×</span></div>
        <div class="phud-streak">0 streak</div>
        <div class="phud-meters"><div class="phud-od"><div></div></div><div class="phud-rock"><div></div></div></div>
      </div>`;
    hudRoot.appendChild(div);
    this.div = div;
    this.el = {
      judge: div.querySelector('.phud-judge'), callout: div.querySelector('.phud-callout'), fail: div.querySelector('.phud-fail'),
      score: div.querySelector('.phud-score'), mult: div.querySelector('.phud-mult'), streak: div.querySelector('.phud-streak'),
      od: div.querySelector('.phud-od > div'), odBar: div.querySelector('.phud-od'), rock: div.querySelector('.phud-rock > div'),
    };
    this.cache = {};
    this.shownScore = 0;
  }

  setFailed(on) { this.div.classList.toggle('failed', !!on); }

  frame(dt, s) {
    this.shownScore += (s.score - this.shownScore) * Math.min(1, dt * 12);
    if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
    this._set('score', Math.round(this.shownScore), (v) => { this.el.score.textContent = v.toLocaleString(); });
    this._set('mult', s.mult, (v) => { this.el.mult.textContent = `${v}×`; popClass(this.el.mult, 'bump'); });
    this._set('multCls', s.odActive ? 'od' : s.mult >= s.maxMult ? 'max' : '', (v) => { this.el.mult.dataset.state = v; });
    this._set('streak', s.streak, (v) => { this.el.streak.textContent = `${v} streak`; });
    this._set('od', Math.round(s.od * 100), (v) => { this.el.od.style.width = `${v}%`; });
    this._set('odState', s.odActive ? 'active' : s.od >= 0.5 ? 'ready' : '', (v) => { this.el.odBar.dataset.state = v; });
    this._set('rock', Math.round(s.rock * 100), (v) => {
      this.el.rock.style.width = `${v}%`;
      this.el.rock.style.background = v < 25 ? '#c7301f' : v < 60 ? '#d8a21a' : '#5da336';
    });
  }

  destroy() { this.div.remove(); }
}
