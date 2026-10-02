// DualSense through the STEMSTAGE controller bridge (server/controller_bridge.py, built on pydualsense).
//
// The bridge talks to the controllers natively and streams their state here over ws://127.0.0.1:8766;
// we send back trigger effects, rumble, lightbar colour and player LEDs. Every bridged controller is also
// exposed to the input system as a virtual standard-mapping gamepad: once a Bluetooth DualSense receives
// full output reports, the browser's own Gamepad API can no longer read it, so input has to come from here.
import { settings, isIOS } from '../settings.js';

export const HID_PAD_BASE = 16; // virtual pad indices start here (the Gamepad API uses 0..3)
const RECONNECT_MS = 2000;

// Trigger effect encodings (11 bytes: mode + 10 params), zone positions 0..9 along the travel.
export const Trigger = {
  off: () => [0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /** Constant resistance from `pos` to the end. strength 1..8 */
  feedback(pos, strength) {
    const f = (Math.max(1, Math.min(8, Math.round(strength))) - 1) & 7;
    let force = 0, active = 0;
    for (let i = Math.max(0, Math.min(9, pos)); i < 10; i++) { force |= f << (3 * i); active |= 1 << i; }
    return [0x21, active & 0xff, (active >> 8) & 0xff, force & 0xff, (force >>> 8) & 0xff, (force >>> 16) & 0xff, (force >>> 24) & 0xff, 0, 0, 0, 0];
  },
  /** Resistance between start and end that "snaps" like a trigger break. start 2..7, end start+1..8, strength 1..8 */
  weapon(start, end, strength) {
    start = Math.max(2, Math.min(7, start));
    end = Math.max(start + 1, Math.min(8, end));
    const zones = (1 << start) | (1 << end);
    const s = (Math.max(1, Math.min(8, Math.round(strength))) - 1) & 7;
    return [0x25, zones & 0xff, (zones >> 8) & 0xff, s, 0, 0, 0, 0, 0, 0, 0];
  },
  /** Vibration from `pos` to the end. amplitude 1..8, frequency 1..255 Hz */
  vibration(pos, amplitude, frequency) {
    const a = (Math.max(1, Math.min(8, Math.round(amplitude))) - 1) & 7;
    let amp = 0, active = 0;
    for (let i = Math.max(0, Math.min(9, pos)); i < 10; i++) { amp |= a << (3 * i); active |= 1 << i; }
    return [0x26, active & 0xff, (active >> 8) & 0xff, amp & 0xff, (amp >>> 8) & 0xff, (amp >>> 16) & 0xff, (amp >>> 24) & 0xff, 0, 0, Math.max(1, Math.min(255, Math.round(frequency))), 0];
  },
};

const PLAYER_LEDS = [0x00, 0x04, 0x0a, 0x15, 0x1b, 0x1f];
const HAT_BUTTONS = 23;
const axis = (v) => Math.max(-1, Math.min(1, v / 127.5));

function makePad(info, index) {
  const product = info.edge ? '0df2' : '0ce6';
  return {
    id: `${info.name} (STANDARD GAMEPAD Vendor: 054c Product: ${product} ${info.conn === 'bt' ? 'Bluetooth' : 'USB'})`,
    index, mapping: 'standard', connected: true, timestamp: 0, hid: true, bridged: true,
    buttons: Array.from({ length: HAT_BUTTONS }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
    touch: [{ active: false, x: 0, y: 0 }, { active: false, x: 0, y: 0 }],
    battery: null,
  };
}

/** One controller behind the bridge. */
export class DualSenseDevice {
  constructor(manager, info, slot) {
    this.m = manager;
    this.id = info.id;
    this.slot = slot;
    this.left = Trigger.off();
    this.right = Trigger.off();
    this.rgb = [255, 45, 122];
    this.leds = 0;
    this.pulses = [];
    this.motor = [0, 0];
    this.dirty = true;
    this.lastSend = 0;
    this.sent = 0;
    this.reports = 0;
    this.lastReport = 0;
    this.lastError = null;
    this.present = true;
    this.pad = makePad(info, HID_PAD_BASE + slot);
    this.update(info);
  }

  update(info) {
    this.info = info;
    this.bt = info.conn === 'bt';
    this.edge = !!info.edge;
    this.present = true;
    if (info.battery) this.pad.battery = { level: info.battery[0], charging: info.battery[1] === 1, full: info.battery[1] === 2 };
  }

  get connected() { return this.present && this.m.online; }
  /** State is streaming (the bridge sends at least a heartbeat every 250 ms). */
  get live() { return this.connected && performance.now() - this.lastReport < 1500; }
  get label() { return `${this.edge ? 'DualSense Edge' : 'DualSense'} · ${this.bt ? 'Bluetooth' : 'USB'}`; }

  /** t: when the newest button/trigger change happened (on performance.now()'s clock); now: arrival. */
  applyState(s, t, now = t) {
    const B = this.pad.buttons;
    for (let i = 0; i < HAT_BUTTONS; i++) {
      const on = (s.b >>> i) & 1;
      const b = B[i];
      b.pressed = !!on; b.touched = !!on; b.value = on ? 1 : 0;
    }
    // analog triggers keep their travel so the press point can be tuned per profile
    B[6].value = s.tr[0] / 255; B[6].touched = s.tr[0] > 0;
    B[7].value = s.tr[1] / 255; B[7].touched = s.tr[1] > 0;
    const a = this.pad.axes;
    a[0] = axis(s.a[0]); a[1] = axis(s.a[1]); a[2] = axis(s.a[2]); a[3] = axis(s.a[3]);
    if (s.tp) {
      for (let k = 0; k < 2; k++) {
        const tp = this.pad.touch[k];
        tp.active = !!s.tp[k * 3]; tp.x = s.tp[k * 3 + 1] / 1919; tp.y = s.tp[k * 3 + 2] / 1079;
      }
    }
    this.pad.timestamp = t;
    this.lastReport = now;
    this.reports++;
  }

  // ---------------------------------------------------------------- effects API
  scaleT(v) { return this.m.scaleT(v); }

  setTriggers(left, right) {
    let l = left || Trigger.off(), r = right || Trigger.off();
    if (settings.triggerIntensity <= 0.01) { l = Trigger.off(); r = Trigger.off(); }
    if (l.join() !== this.left.join()) { this.left = l; this.dirty = true; }
    if (r.join() !== this.right.join()) { this.right = r; this.dirty = true; }
  }

  setLight(r, g, b) {
    if (!settings.lightbar) { r = g = b = 0; }
    const c = [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))));
    if (c[0] !== this.rgb[0] || c[1] !== this.rgb[1] || c[2] !== this.rgb[2]) { this.rgb = c; this.dirty = true; }
  }

  setPlayerLeds(count) {
    const v = PLAYER_LEDS[Math.max(0, Math.min(5, count))];
    if (v !== this.leds) { this.leds = v; this.dirty = true; }
  }

  /** Haptic pulse. strong/weak 0..255, duration ms. */
  rumble(strong, weak, ms = 80) {
    if (this.audioHapticPulse) { this.audioHapticPulse(strong, weak, ms); return; }
    const k = settings.rumbleIntensity;
    if (k <= 0.01) return;
    const now = performance.now();
    this.pulses.push({ s: Math.min(255, strong * k), w: Math.min(255, weak * k), start: now, end: now + ms });
  }

  reset() {
    this.left = Trigger.off(); this.right = Trigger.off();
    this.pulses = []; this.motor = [0, 0];
    this.dirty = true;
    this.flush(true);
  }

  tick(now = performance.now()) {
    if (!this.connected) return;
    let s = 0, w = 0;
    if (this.pulses.length) this.pulses = this.pulses.filter((p) => p.end > now);
    for (const p of this.pulses) {
      const k = Math.sqrt(Math.max(0, (p.end - now) / (p.end - p.start)));
      s = Math.max(s, p.s * k); w = Math.max(w, p.w * k);
    }
    s = Math.round(s); w = Math.round(w);
    if (s !== this.motor[0] || w !== this.motor[1]) { this.motor = [s, w]; this.dirty = true; }
    if (this.dirty && now - this.lastSend > 8) this.flush();
  }

  flush(force = false) {
    if (!this.connected || (!this.dirty && !force)) return;
    this.dirty = false;
    this.lastSend = performance.now();
    const ok = this.m.send({ t: 'out', id: this.id, l: this.left, r: this.right, rgb: this.rgb, leds: this.leds, motor: this.motor, audio: !!this.audioHapticPulse });
    if (ok) { this.sent++; this.lastError = null; } else { this.dirty = true; this.lastError = 'bridge not connected'; }
  }
}

/**
 * Every controller the bridge reports. Keeps the single-controller API (setTriggers, rumble, setLight, ...)
 * for the primary controller; forDevice() returns the controller behind a player's device so each player
 * in a band gets their own triggers and haptics.
 */
export class DualSenseManager {
  constructor() {
    this.devices = [];
    this.listeners = new Set();
    this.ws = null;
    this.online = false;
    this.everOnline = false;
    this.tries = 0;
    if (!isIOS) this._connect();
    window.addEventListener('beforeunload', () => this.reset());
  }

  get url() { return settings.bridgeUrl || 'ws://127.0.0.1:8766'; }
  /** The bridge approach works in any browser (and the desktop app). */
  get supported() { return !isIOS && typeof WebSocket !== 'undefined'; }
  get connected() { return this.devices.some((d) => d.connected); }
  get primary() { return this.devices.find((d) => d.connected) || null; }
  get label() {
    const p = this.primary;
    if (!p) return null;
    const more = this.devices.filter((d) => d.connected).length - 1;
    return `${p.label}${more > 0 ? ` +${more}` : ''}`;
  }
  get bt() { return !!this.primary?.bt; }
  get sent() { return this.primary?.sent || 0; }
  get lastError() { return this.online ? this.primary?.lastError || null : 'controller bridge not running'; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }

  // ---------------------------------------------------------------- bridge connection
  _connect() {
    if (isIOS) return;
    clearTimeout(this._retry);
    let ws;
    try { ws = new WebSocket(this.url); } catch { this._scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => { this.online = true; this.everOnline = true; this.tries = 0; this.clockOff = this._winMin = null; this.emit(); };
    ws.onmessage = (e) => this._message(e);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.online;
      this.online = false;
      this.ws = null;
      for (const d of this.devices) d.present = false;
      this.devices = [];
      if (was) this.emit();
      this._scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  _scheduleRetry() {
    this.tries++;
    this._retry = setTimeout(() => this._connect(), Math.min(10000, RECONNECT_MS * Math.min(5, this.tries)));
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  _message(e) {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'hello' || m.t === 'devices') { this._devices(m.devices || []); return; }
    if (m.t === 's') {
      const now = performance.now();
      if (m.now != null) this._clock(m.now, now);
      for (const s of m.d) {
        // time the change by when the bridge read it, not by when this (busy, rendering) thread got the message
        const t = s.ts > 0 && this.clockOff != null ? Math.max(now - 100, Math.min(now, s.ts + this.clockOff)) : now;
        this.devices.find((d) => d.id === s.id)?.applyState(s, t, now);
      }
      // heartbeat keeps idle controllers "live"
      for (const d of this.devices) if (d.present && now - d.lastReport > 200) d.lastReport = now;
      this.onState?.();
    }
  }

  /**
   * Bridge clock → performance.now(). The quickest delivery seen is the one that waited least in the main
   * thread's queue, so the smallest (arrival − send) is the clock offset; re-measured every few seconds.
   */
  _clock(sent, now) {
    const off = now - sent;
    if (this.clockOff == null || off < this.clockOff) this.clockOff = off;
    if (this._winMin == null || off < this._winMin) this._winMin = off;
    if (now - (this._winAt || 0) > 4000) { this.clockOff = this._winMin; this._winMin = null; this._winAt = now; }
  }

  _devices(list) {
    let changed = false;
    for (const info of list) {
      const d = this.devices.find((x) => x.id === info.id);
      if (d) { const before = `${d.bt}|${d.pad.battery?.level}`; d.update(info); if (`${d.bt}|${d.pad.battery?.level}` !== before) changed = true; continue; }
      const used = new Set(this.devices.map((x) => x.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      this.devices.push(new DualSenseDevice(this, info, slot));
      this.devices.sort((a, b) => a.slot - b.slot);
      changed = true;
    }
    const gone = this.devices.filter((d) => !list.some((i) => i.id === d.id));
    if (gone.length) { this.devices = this.devices.filter((d) => !gone.includes(d)); changed = true; }
    if (changed) this.emit();
  }

  /** Wait (briefly) for the bridge and its controller list. */
  async autoConnect() {
    if (!this.ws) this._connect();
    const t0 = performance.now();
    while (performance.now() - t0 < 2500 && !this.connected) await new Promise((r) => setTimeout(r, 100));
    return this.connected;
  }

  /** "Find DualSense": ask the bridge to rescan now. */
  async request() {
    if (!this.online) { this._connect(); await new Promise((r) => setTimeout(r, 800)); }
    if (!this.online) throw new Error('The controller bridge is not running. Start the game from the desktop app or play.bat (or run npm run bridge).');
    this.send({ t: 'scan' });
    const t0 = performance.now();
    while (performance.now() - t0 < 4000 && !this.connected) await new Promise((r) => setTimeout(r, 100));
    return this.connected;
  }

  /** Virtual standard gamepads for every controller that is streaming. */
  virtualPads() {
    const out = [];
    for (const d of this.devices) if (d.live) out.push(d.pad);
    return out;
  }

  deviceForPad(pad) { return pad?.hid ? this.devices.find((d) => d.pad === pad || d.pad.index === pad.index) || null : null; }

  /**
   * The controller that should give feedback to a player on `deviceId` ('any', 'pad:<index>', ...).
   * Returns a DualSenseDevice, or null when that player isn't holding a bridged DualSense.
   */
  forDevice(deviceId, isDualSenseIndex) {
    if (!this.connected) return null;
    if (deviceId === 'any') return this.primary;
    const m = /^pad:(\d+)$/.exec(deviceId || '');
    if (!m) return null;
    const idx = +m[1];
    const hit = this.devices.find((d) => d.pad.index === idx && d.connected);
    if (hit) return hit;
    if (isDualSenseIndex?.(idx) && this.devices.filter((d) => d.connected).length === 1) return this.primary;
    return null;
  }

  // ---------------------------------------------------------------- single-controller API (primary)
  scaleT(v) { return Math.max(1, Math.min(8, Math.round(v * settings.triggerIntensity))); }
  setTriggers(l, r) { this.primary?.setTriggers(l, r); }
  setLight(r, g, b) { for (const d of this.devices) d.setLight(r, g, b); }
  setPlayerLeds(n) { this.primary?.setPlayerLeds(n); }
  rumble(strong, weak, ms = 80) {
    if (this.primary) { this.primary.rumble(strong, weak, ms); return; }
    const k = settings.rumbleIntensity;
    if (k > 0.01) gamepadRumble(strong * k / 255, weak * k / 255, ms);
  }
  offAll() { for (const d of this.devices) { d.setTriggers(Trigger.off(), Trigger.off()); d.setPlayerLeds(0); } }
  reset() { if (this.online) this.send({ t: 'reset' }); for (const d of this.devices) { d.left = Trigger.off(); d.right = Trigger.off(); d.pulses = []; d.motor = [0, 0]; } }
  tick(now = performance.now()) { for (const d of this.devices) d.tick(now); }
}

/** Rumble through the Gamepad API (Xbox pads, DualSense without the bridge, ...). */
export function gamepadRumble(strong, weak, ms, index = null) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p?.vibrationActuator || (index != null && p.index !== index)) continue;
    p.vibrationActuator.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch?.(() => {});
  }
}

export const dualsense = new DualSenseManager();
