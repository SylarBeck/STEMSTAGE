import { settings, onSettingsChange } from './settings.js';
import { AudioEngine, STEM_RATE } from './audio/engine.js';
import { createDemo } from './audio/pipeline.js';
import { getSong, getAudio, listSongs, initScores, storageMode, migrateFromBrowser, songsFolder } from './storage/library.js';
import { Stage } from './game/stage.js';
import { Renderer } from './game/renderer.js';
import { Session } from './game/session.js';
import { Hud } from './ui/hud.js';
import { Diagnostics } from './ui/diagnostics.js';
import { UI } from './ui/ui.js';
import { input } from './input/input.js';
import { dualsense } from './input/dualsense.js';
import { profiles } from './profile/profiles.js';
import { discord } from './net/discord.js';
import { Capacitor } from '@capacitor/core';

const DEMO_ID = 'demo-neon-overdrive';

function fatal(title, detail) {
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.innerHTML = `<h1>${title}</h1><p>${detail}</p>`;
}

class App {
  constructor() {
    this.engine = new AudioEngine();
    this.input = input;
    this.ds = dualsense;
    this.stage = new Stage(settings.quality);
    this.renderer = new Renderer(document.getElementById('gl'), this.stage, null, settings.quality);
    this.renderer.setQuality(settings.quality, settings.bloom);
    this.renderer.setAntialiasing(settings.antialiasing);
    this.hud = new Hud();
    this.diagnostics = new Diagnostics();
    this.game = new Session({
      engine: this.engine, stage: this.stage, renderer: this.renderer, hud: this.hud, ds: this.ds, input: this.input,
      onEnd: (r) => { this.ui.showResults(r); this.menuMusic(true); },
      onPause: () => this.ui.show('pause'),
    });
    this.ui = new UI(this);
    this.menuBeatIdx = -1;
    onSettingsChange((key) => {
      if (key === 'quality' || key === 'bloom' || key === 'filmGrain') this.renderer.setQuality(settings.quality, settings.bloom);
      if (key === 'renderScale') this.renderer.resize();
      if (key === 'antialiasing') this.renderer.setAntialiasing(settings.antialiasing);
      if (key === 'quality') this.ui.toast('Crowd size updates after a reload');
      if (key === 'menuMusicVolume' && this.menuGain) this.menuGain.gain.setTargetAtTime(settings.menuMusicVolume, this.engine.ctx.currentTime, 0.1);
      if (key === 'menuMusic' && !this.game.running) { this.menuMusic(false, true); setTimeout(() => this.menuMusic(true), 400); }
      if (key === 'fullscreen') setFullscreen(settings.fullscreen);
      if (key === 'venue' && !this.game.running) this.ui.applyVenue(false);
      if (key === 'discordPresence') discord.menus();
    });
    // Windows' microphone prompt: the game just left fullscreen so it can be seen
    window.addEventListener('stemstage:mic-prompt', () => this.ui.toast('Allow microphone access in the Windows prompt (it may be at the top or bottom of the screen)', 'ok', 'microphone'));
    window.addEventListener('error', (e) => this.ui.toast(`Error: ${e.message}`, 'err'));
    window.addEventListener('unhandledrejection', (e) => this.ui.toast(`Error: ${e.reason?.message || e.reason}`, 'err'));
  }

  async boot() {
    this.ui.show('title');
    if (!iosTouch) this.ds.autoConnect().then((ok) => { if (ok) this.ui.toast(`${this.ds.label} linked`, 'ok'); });
    this.last = performance.now();
    this.lastRender = 0;
    requestAnimationFrame((t) => this.frame(t));
    await initScores();
    await profiles.load();
    this.ui.refreshStatus();
    await this.ui.social.finishDiscordLogin(); // back from "Log in with Discord"
    discord.menus();
    if ((await storageMode()) === 'idb' && !iosTouch) this.ui.toast('Songs folder unavailable (start the game with play.bat) — using browser storage', 'err');
    try {
      const moved = await migrateFromBrowser((song) => this.ui.toast(`Moving "${song.title}" from browser storage to the songs folder...`));
      if (moved) { this.ui.toast(`Moved ${moved} song${moved === 1 ? '' : 's'} to ${songsFolder()}`, 'ok'); await this.ui.reloadSongs(); }
    } catch (e) {
      console.error(e);
      this.ui.toast(`Couldn't move songs out of browser storage: ${e.message}`, 'err');
    }
    await this.ensureDemo();
  }

  async ensureDemo() {
    try {
      const existing = await getSong(DEMO_ID);
      if (existing?.charts) { await this.ui.reloadSongs(); return; }
      this.ui.toast('Preparing the demo track...');
      await createDemo(() => {});
      await this.ui.reloadSongs();
      if (this.ui.screen === 'library') this.ui.renderLibrary();
      this.ui.toast('Demo track "Neon Overdrive" is in your setlist', 'ok');
      if (this.ui.screen === 'menu') this.menuMusic(true);
    } catch (e) {
      console.error(e);
      this.ui.toast(`Demo generation failed: ${e.message}`, 'err');
    }
  }

  /** Background music in menus: the demo, or a random song from the setlist. */
  async menuMusic(on, force = false) {
    const ctx = this.engine.ctx;
    if (!on) {
      if (this.menuSrc) {
        const g = this.menuGain, src = this.menuSrc;
        g.gain.setTargetAtTime(0, ctx.currentTime, force ? 0.05 : 0.15);
        setTimeout(() => { try { src.stop(); } catch { /* ok */ } }, 700);
        this.menuSrc = null;
      }
      return;
    }
    if (settings.menuMusic === 'off' || this.menuSrc || this.game.running || this._menuLoading) return;
    try {
      this._menuLoading = true;
      let id = DEMO_ID;
      if (settings.menuMusic === 'shuffle') {
        const songs = await listSongs();
        const pool = songs.length > 1 ? songs.filter((s) => s.id !== this.menuSongId) : songs;
        if (pool.length) id = pool[Math.floor(Math.random() * pool.length)].id;
      }
      if (!this.menuBuffer || this.menuSongId !== id) {
        const song = await getSong(id);
        const audio = song && await getAudio(id);
        if (!audio) return;
        const n = song.length;
        const buf = ctx.createBuffer(2, n, STEM_RATE);
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        for (const pcm of Object.values(audio.stems)) for (let i = 0; i < n; i++) { L[i] += pcm[i] / 32768; R[i] += pcm[n + i] / 32768; }
        this.menuBuffer = buf;
        this.menuBeats = song.beats;
        this.menuSongId = id;
        this.menuTitle = `${song.title} — ${song.artist}`;
      }
      if (this.game.running || this.menuSrc || settings.menuMusic === 'off') return;
      const src = ctx.createBufferSource();
      src.buffer = this.menuBuffer; src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(settings.menuMusicVolume, ctx.currentTime, 0.8);
      src.connect(g).connect(this.engine.master);
      const offset = settings.menuMusic === 'shuffle' && id !== DEMO_ID ? this.menuBuffer.duration * 0.3 : 0;
      src.start(ctx.currentTime, offset);
      this.menuStart = ctx.currentTime - offset;
      this.menuSrc = src; this.menuGain = g;
      if (settings.menuMusic === 'shuffle') this.ui.toast(`♫ ${this.menuTitle}`);
    } finally {
      this._menuLoading = false;
    }
  }

  menuFeatures() {
    const lv = this.engine.levels();
    let beat = performance.now() / 500, beatHit = false;
    if (this.menuSrc && this.menuBeats?.length > 1) {
      const ctx = this.engine.ctx;
      const t = (ctx.currentTime - this.menuStart - (ctx.outputLatency || 0)) % this.menuBuffer.duration;
      const b = this.menuBeats;
      let i = Math.max(0, Math.min(this.menuBeatIdx, b.length - 2));
      if (t < b[i]) i = 0; // looped song or newly selected track
      while (i < b.length - 2 && b[i + 1] <= t) i++;
      beat = i + Math.max(0, Math.min(1, (t - b[i]) / (b[i + 1] - b[i])));
      if (i !== this.menuBeatIdx) { beatHit = this.menuBeatIdx !== -1; this.menuBeatIdx = i; if (i % 32 === 0 && beatHit) this.stage.nextPalette(); }
    }
    const c = this.stage.colA;
    this.ds.setLight(c.r * 255, c.g * 255, c.b * 255);
    return { mode: 'menu', beat, beatHit, bass: lv.bass, mid: lv.mid, high: lv.high, spectrum: lv.spectrum, od: false, intensity: 0.35 + lv.level, focus: 'guitar' };
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // The pause menu is HTML over a frozen game frame. Keep input/UI responsive without redrawing
    // the whole HDR stage, crowd and bloom chain behind the dark overlay.
    if (this.game.paused) {
      this.ds.tick(now);
      this.ui.frame();
      this.diagnostics.frame(now, true);
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
    const f = this.game.update(dt) || this.menuFeatures();
    this.stage.update(dt, f);
    this.ds.tick(now);
    this.ui.frame();
    const cap = Number(settings.frameLimit);
    const drawn = !Number.isFinite(cap) || cap < 1 || !this.lastRender || now - this.lastRender >= 1000 / cap - 1;
    if (drawn) { this.renderer.render(this.lastRender ? Math.min(0.05, (now - this.lastRender) / 1000) : dt); this.lastRender = now; }
    this.diagnostics.frame(now, false, drawn);
    requestAnimationFrame((t) => this.frame(t));
  }
}

// Scale the UI (designed at 1600x900) to the window so everything fits with no scrollbars.
import { applyPalette } from './game/palettes.js';
function applyAccessibility() {
  applyPalette(settings.palette);
  document.documentElement.dataset.hud = settings.hudSize || 'normal';
}
applyAccessibility();
onSettingsChange((key) => { if (key === 'palette' || key === 'hudSize') applyAccessibility(); });

function fitUi() {
  const s = Math.max(0.5, Math.min(2.4, Math.min(window.innerWidth / 1600, window.innerHeight / 900)));
  document.documentElement.style.zoom = String(s);
  window.__uiScale = s;
}
fitUi();
window.addEventListener('resize', fitUi);

const iosTouch = Capacitor.getPlatform() === 'ios' || /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iosTouch) {
  document.documentElement.classList.add('ios-touch');
  document.querySelector('#drop .drop-title').textContent = 'Tap to choose audio files';
  document.querySelector('#screen-menu [data-action="import"] em').textContent = 'Choose audio files from this device';
  const controls = document.getElementById('touch-controls');
  controls.hidden = false;
  const active = new Map();
  const laneAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('#touch-lanes [data-lane]')?.dataset.lane ?? null;
  const setLane = (id, next) => {
    const prev = active.get(id) ?? null;
    if (prev === next) return;
    if (prev !== null) {
      input.touchAction(`lane${prev}`, false, id);
      controls.querySelector(`[data-lane="${prev}"]`)?.classList.remove('pressed');
    }
    if (next !== null) {
      input.touchAction(`lane${next}`, true, id);
      controls.querySelector(`[data-lane="${next}"]`)?.classList.add('pressed');
      active.set(id, next);
    } else active.delete(id);
  };
  const lanes = document.getElementById('touch-lanes');
  lanes.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lanes.setPointerCapture(e.pointerId);
    setLane(e.pointerId, laneAt(e.clientX, e.clientY));
  });
  lanes.addEventListener('pointermove', (e) => {
    if (active.has(e.pointerId) || e.buttons) setLane(e.pointerId, laneAt(e.clientX, e.clientY));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    lanes.addEventListener(type, (e) => setLane(e.pointerId, null));
  }
  document.getElementById('touch-overdrive').addEventListener('pointerdown', (e) => {
    e.preventDefault(); input.touchAction('od', true, e.pointerId);
  });
  document.getElementById('touch-pause').addEventListener('pointerdown', (e) => {
    e.preventDefault(); input.touchAction('pause', true, e.pointerId);
  });
  window.addEventListener('blur', () => { for (const id of active.keys()) setLane(id, null); });
}

// Fullscreen first: the desktop app starts fullscreen (tauri.conf.json); in a browser we ask on the first
// click / key press (browsers only allow it after a user gesture). Settings → Video → Fullscreen turns it off.
const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();
export async function setFullscreen(on) {
  if (iosTouch) return;
  if (tauriWindow) { try { await tauriWindow.setFullscreen(on); } catch { /* not allowed */ } return; }
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch { /* needs a user gesture */ }
}
if (!tauriWindow) {
  const firstGesture = () => { if (settings.fullscreen) setFullscreen(true); };
  window.addEventListener('pointerdown', firstGesture, { once: true });
  window.addEventListener('keydown', (e) => { if (e.key !== 'Escape') firstGesture(); }, { once: true });
} else if (!settings.fullscreen) setFullscreen(false);

// Desktop app (Tauri): F11 / Alt+Enter toggles fullscreen, and no browser context menu.
if (tauriWindow) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11' || (e.key === 'Enter' && e.altKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      tauriWindow.isFullscreen().then((f) => tauriWindow.setFullscreen(!f)).catch(() => {});
    }
  }, true);
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('desktop-app');
}

try {
  const test = document.createElement('canvas').getContext('webgl2');
  if (!test) throw new Error('WebGL2 is not available');
  const app = new App();
  window.stemstage = app;
  app.boot();
} catch (e) {
  console.error(e);
  fatal('STEMSTAGE could not start', `${e.message}. Use a recent Chrome or Edge with hardware acceleration enabled.`);
}
