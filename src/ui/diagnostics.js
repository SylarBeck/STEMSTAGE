import { settings, onSettingsChange } from '../settings.js';
import { online } from '../net/online.js';

// A small optional overlay for players checking smoothness or an online connection.
export class Diagnostics {
  constructor() {
    this.el = document.getElementById('player-debug');
    this.fpsEl = document.getElementById('player-fps');
    this.pingEl = document.getElementById('player-ping');
    this.started = 0;
    this.frames = 0;
    this.lastPing = '';
    onSettingsChange((key) => {
      if (key === 'showFps' || key === 'showPing') this.sync();
    });
    this.sync();
  }

  sync() {
    this.el.hidden = !settings.showFps && !settings.showPing;
    this.fpsEl.hidden = !settings.showFps;
    this.pingEl.hidden = !settings.showPing;
    this.started = 0;
    this.frames = 0;
    if (settings.showFps) this.fpsEl.textContent = 'FPS —';
    if (settings.showPing) this.updatePing();
  }

  updatePing() {
    const ping = online.connected && Number.isFinite(online.rtt) ? Math.max(0, Math.round(online.rtt)) : null;
    const label = ping == null ? (online.connected ? 'PING —' : 'PING OFFLINE') : `PING ${ping} ms`;
    if (label === this.lastPing) return;
    this.lastPing = label;
    this.pingEl.textContent = label;
    this.pingEl.className = ping == null ? '' : ping >= 200 ? 'bad' : ping >= 100 ? 'warn' : '';
  }

  frame(now, paused = false) {
    if (this.el.hidden) return;
    if (settings.showFps) {
      if (paused) {
        if (this.fpsEl.textContent !== 'FPS PAUSED') this.fpsEl.textContent = 'FPS PAUSED';
        this.fpsEl.className = '';
        this.started = 0;
        this.frames = 0;
      } else {
        if (!this.started) this.started = now;
        this.frames++;
        const elapsed = now - this.started;
        if (elapsed >= 1000) {
          const fps = Math.round(this.frames * 1000 / elapsed);
          this.fpsEl.textContent = `FPS ${fps}`;
          this.fpsEl.className = fps < 30 ? 'bad' : fps < 50 ? 'warn' : '';
          this.started = now;
          this.frames = 0;
        }
      }
    }
    if (settings.showPing) this.updatePing();
  }
}
