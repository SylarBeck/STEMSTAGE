// Unified input for up to 4 players: keyboard (two layouts), gamepads (standard, guitar, drums,
// raw Sony, custom-mapped, DualSense through the pydualsense bridge), and MIDI. Every device produces "control"
// edges (e.g. 'b6', 'a2+', 'h9:0', 'n36', 'k:KeyD'); the device's config profile turns controls into
// actions; routing sends them to the owning player.
import { bindings, ACTIONS, PAD_MENU } from './bindings.js';
import { dualsense } from './dualsense.js';

export const BTN = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, TOUCHPAD: 17 };
const TRIGGER = { light: [0.2, 0.12], normal: [0.42, 0.28], firm: [0.72, 0.55] };
const AXIS_ON = 0.6, AXIS_OFF = 0.45;
const KEY_NAV = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Space: 'confirm', NumpadEnter: 'confirm',
  Escape: 'back', Backspace: 'back', Tab: 'alt', KeyQ: 'prev', KeyE: 'next', PageUp: 'pgup', PageDown: 'pgdn', KeyF: 'alt2',
};
const NAV_REPEAT = new Set(['up', 'down', 'left', 'right']);

/** Hat-switch axes (Chrome/Windows): -1 = up ... 1 = up-left, ~3.29 = centred. Returns 0..7 or -1. */
export function hatDir(v) {
  if (v == null || Math.abs(v) > 1.05) return -1;
  return Math.round((v + 1) * 3.5) % 8;
}

export const srcKey = (s) => (s.k ? `k:${s.k}` : s.b != null ? `b${s.b}` : s.a != null ? `a${s.a}${s.s > 0 ? '+' : '-'}` : s.h != null ? `h${s.h}:${s.d}` : s.n != null ? `n${s.n}` : s.pc != null ? `pc${s.pc}` : s.cc != null ? `cc${s.cc}` : '?');
export function keyToSrc(key) {
  let m;
  if (key.startsWith('k:')) return { k: key.slice(2) };
  if ((m = /^b(\d+)$/.exec(key))) return { b: +m[1] };
  if ((m = /^a(\d+)([+-])$/.exec(key))) return { a: +m[1], s: m[2] === '+' ? 1 : -1 };
  if ((m = /^h(\d+):(\d)$/.exec(key))) return { h: +m[1], d: +m[2] };
  if ((m = /^n(\d+)$/.exec(key))) return { n: +m[1] };
  if ((m = /^pc(\d+)$/.exec(key))) return { pc: +m[1] };
  if ((m = /^cc(\d+)$/.exec(key))) return { cc: +m[1] };
  return null;
}

export function padName(id = '') {
  const clean = id.replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').split('(')[0].trim();
  return clean || 'Controller';
}
export const isDualSensePad = (pad) => !!pad && (/dualsense/i.test(pad.id) || (/054c/i.test(pad.id) && /0ce6|0df2/i.test(pad.id)));
const isSony = (pad) => /054c/i.test(pad.id) || /dualsense|dualshock|wireless controller/i.test(pad.id);

export class Input {
  constructor() {
    this.menu = true;
    this.players = [];
    this.held = [0, 1, 2, 3].map(() => [0, 1, 2, 3, 4].map(() => new Set()));
    this.whammyByPlayer = [0, 0, 0, 0];
    this.gameListeners = new Set();
    this.navListeners = new Set();
    this.anyListeners = new Set();
    this.padActive = new Map();
    this.hatAxes = new Map();
    this.navHold = new Map();
    this.midiActive = new Map();
    this.midiInputs = new Map();
    this.keysDown = new Set();
    this.capture = null;
    this.lookupCache = new Map();
    this.profileCache = new Map();
    this.lastDevice = 'kb1';
    this.warnedPads = new Set();
    this.mirrors = new Map(); // Gamepad API index -> { stamp, since, mirror } for DualSense copies of linked controllers
    bindings.onChange(() => { this.lookupCache.clear(); this.profileCache.clear(); });

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keysDown.clear(); this.releaseAll(); });
    this._startPolling();
    dualsense.onState = () => this.poll(); // bridged DualSense: react the moment its state arrives
    this._autoMidi();
  }

  /**
   * Read the gamepads every ~4 ms. A plain setInterval can wait behind rendering for 100+ ms at a time, and the
   * Gamepad API only shows the current state, so a quick tap in such a gap was lost. The poll runs as a
   * "user-blocking" task (ahead of rendering work) where the browser supports it, and once every frame as well.
   */
  _startPolling() {
    const sched = globalThis.scheduler;
    if (sched?.postTask) {
      const loop = () => {
        try { this.poll(); } catch (e) { console.warn(e); }
        sched.postTask(loop, { priority: 'user-blocking', delay: 4 }).catch(() => setTimeout(loop, 4));
      };
      sched.postTask(loop, { priority: 'user-blocking', delay: 4 });
    } else setInterval(() => this.poll(), 4);
    const frame = () => { try { this.poll(); } catch { /* next frame */ } requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- public API
  onGame(fn) { this.gameListeners.add(fn); return () => this.gameListeners.delete(fn); }
  onNav(fn) { this.navListeners.add(fn); return () => this.navListeners.delete(fn); }
  onAny(fn) { this.anyListeners.add(fn); return () => this.anyListeners.delete(fn); }

  /** Menu mode: navigation events only. */
  setMenu() { this.releaseAll(); this.menu = true; this.players = []; }

  /** Game mode. players: [{ device: 'any' | 'kb1' | 'kb2' | 'pad:0' | 'midi:<id>', mode: 'five' | 'drums' }] */
  setGame(players) { this.releaseAll(); this.players = players.map((p) => ({ ...p })); this.menu = false; }

  isHeld(player, lane) { return this.held[player]?.[lane]?.size > 0; }
  whammy(player) { return this.whammyByPlayer[player] || 0; }

  /** Connected gamepads: Gamepad API pads + DualSense controllers read by the controller bridge. */
  getPads() {
    const nav = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    const hid = dualsense.virtualPads();
    if (!hid.length) { if (this.mirrors.size) this.mirrors.clear(); return nav; }
    const dsNav = nav.filter(isDualSensePad);
    if (!dsNav.length) return [...nav, ...hid];
    const now = performance.now();
    let shadow;
    if (dsNav.length <= hid.length) shadow = new Set(dsNav);
    else {
      // more DualSense pads than linked ones: hide the copies that are frozen (Bluetooth) or mirror a linked pad (USB)
      shadow = new Set();
      for (const p of dsNav) {
        let st = this.mirrors.get(p.index);
        if (!st || st.id !== p.id) { st = { id: p.id, stamp: p.timestamp, since: now, mirror: false }; this.mirrors.set(p.index, st); }
        if (p.timestamp !== st.stamp) { st.stamp = p.timestamp; st.since = now; }
        const pressed = p.buttons.map((b) => b.pressed);
        if (!st.mirror && pressed.some(Boolean)) st.mirror = hid.some((h) => pressed.every((on, i) => i > 17 || on === !!h.buttons[i]?.pressed));
        if (st.mirror || now - st.since > 1500) shadow.add(p);
      }
    }
    return [...nav.filter((p) => !shadow.has(p)), ...hid];
  }

  /** Preferred single pad (for status displays): linked DualSense > DualSense > standard > mapped > anything. */
  getPad() {
    const pads = this.getPads();
    return pads.find((p) => p.hid) || pads.find(isDualSensePad) || pads.find((p) => p.mapping === 'standard') || pads.find((p) => this.padProfileKey(p)) || pads[0] || null;
  }

  padKey(pad) { return `${pad.id}#${pad.index}`; }
  /** Assignment keys for a device, most specific first. */
  deviceKeys(deviceId, pad = null) {
    if (deviceId?.startsWith('pad:')) {
      pad ||= this.getPads().find((p) => `pad:${p.index}` === deviceId);
      return pad ? [`pad:${pad.id}#${pad.index}`, `pad:${pad.id}`] : [];
    }
    if (deviceId?.startsWith('midi:')) {
      const inp = this.midiInputs.get(deviceId.slice(5));
      return inp ? [`midi:${inp.name}`] : [deviceId];
    }
    return [deviceId];
  }

  /** 'std' | 'sony-raw' | 'raw:<id>' */
  padFamily(pad) {
    if (pad.mapping === 'standard') return 'std';
    if (isSony(pad) && !bindings.hasCustom(pad.id)) return 'sony-raw';
    return `raw:${pad.id}`;
  }

  /** Auto-detected default profile for a pad. */
  padDefaultProfile(pad) {
    if (bindings.hasCustom(pad.id)) return `custom:${pad.id}`;
    if (pad.mapping === 'standard') return /guitar/i.test(pad.id) ? 'guitar' : /drum/i.test(pad.id) ? 'drumkit' : 'gamepad';
    if (isSony(pad)) return 'sony-raw';
    return null;
  }

  /** Config profile in use by a pad (null = needs a button map). */
  padProfileKey(pad) {
    const ck = this.padKey(pad);
    if (this.profileCache.has(ck)) return this.profileCache.get(ck);
    const fam = this.padFamily(pad);
    let key = bindings.assigned(this.deviceKeys(`pad:${pad.index}`, pad));
    if (key && bindings.family(key) !== fam && key !== `custom:${pad.id}`) key = null;
    key ||= this.padDefaultProfile(pad);
    this.profileCache.set(ck, key);
    return key;
  }

  /** Config profile in use by any device id. */
  profileFor(deviceId) {
    if (!deviceId || deviceId === 'any') return null;
    if (deviceId === 'kb1' || deviceId === 'kb2') {
      const ck = `kb|${deviceId}`;
      if (this.profileCache.has(ck)) return this.profileCache.get(ck);
      let key = bindings.assigned([deviceId]);
      if (key && bindings.family(key) !== 'key') key = null;
      key ||= deviceId === 'kb2' ? 'keyboard2' : 'keyboard';
      this.profileCache.set(ck, key);
      return key;
    }
    if (deviceId.startsWith('midi:')) {
      const key = bindings.assigned(this.deviceKeys(deviceId));
      return key && bindings.family(key) === 'midi' ? key : 'midi';
    }
    const pad = this.getPads().find((p) => `pad:${p.index}` === deviceId);
    return pad ? this.padProfileKey(pad) : null;
  }

  optionsFor(deviceId) {
    const key = this.profileFor(deviceId === 'any' ? this.lastDevice : deviceId);
    return bindings.options(key);
  }

  listDevices() {
    const out = [
      { id: 'kb1', label: 'Keyboard · keys A', profileKey: this.profileFor('kb1'), family: 'key', kind: 'key' },
      { id: 'kb2', label: 'Keyboard · keys B', profileKey: this.profileFor('kb2'), family: 'key', kind: 'key' },
    ];
    for (const p of this.getPads()) {
      const pk = this.padProfileKey(p);
      out.push({ id: `pad:${p.index}`, label: `${padName(p.id)}${pk ? '' : ' (needs mapping)'}`, profileKey: pk, pad: p, family: this.padFamily(p), kind: 'pad', hid: !!p.hid });
    }
    for (const [id, inp] of this.midiInputs) out.push({ id: `midi:${id}`, label: `MIDI · ${inp.name}`, profileKey: this.profileFor(`midi:${id}`), family: 'midi', kind: 'midi', midiName: inp.name });
    return out;
  }

  deviceLabel(deviceId) {
    if (deviceId === 'any') return 'Any device';
    return this.listDevices().find((d) => d.id === deviceId)?.label || deviceId;
  }

  /** Controls currently held on a device (for live controller art). */
  activeControls(deviceId) {
    if (deviceId === 'kb1' || deviceId === 'kb2') return new Set([...this.keysDown].map((c) => `k:${c}`));
    if (deviceId?.startsWith('pad:')) return this.padActive.get(+deviceId.slice(4))?.set || new Set();
    if (deviceId?.startsWith('midi:')) {
      const counts = this.midiActive.get(deviceId);
      return new Set(counts ? [...counts].filter(([, c]) => c > 0).map(([k]) => k) : []);
    }
    return new Set();
  }

  /** Actions (lane0..4, strum, od, pause) a set of controls triggers under a profile. */
  actionsFor(profileKey, mode, controls) {
    const out = new Set();
    if (!profileKey) return out;
    const map = this._lookup(profileKey, mode);
    for (const k of controls) for (const a of map.get(k) || []) out.add(a);
    return out;
  }

  /** Capture the next control. kind: 'key' | 'pad' | 'midi' | 'any'. cb({ deviceId, profileKey, src, key, pad }) */
  startCapture(kind, cb, opts = {}) { this.capture = { kind, cb, padIndex: opts.padIndex, armed: performance.now() + 250 }; }
  stopCapture() { this.capture = null; }

  releaseAll() {
    const t = performance.now();
    this.held.forEach((lanes, p) => lanes.forEach((set, lane) => {
      if (set.size) { set.clear(); this._emitGame({ type: 'release', player: p, lane, t }); }
    }));
  }

  /** Direct touch controls for the first local player. Pointer IDs keep chords and sustains independent. */
  touchAction(action, down, pointerId = 0) {
    if (this.menu || !this.players.length) return;
    const t = performance.now();
    const player = 0;
    if (action.startsWith('lane')) {
      const lane = Number(action.slice(4));
      if (!Number.isInteger(lane) || lane < 0 || lane > 4) return;
      const source = `touch:${pointerId}`;
      const held = this.held[player][lane];
      if (down) {
        if (held.has(source)) return;
        held.add(source);
        this._emitGame({ type: 'press', player, lane, t, device: 'touch' });
      } else if (held.delete(source) && held.size === 0) {
        this._emitGame({ type: 'release', player, lane, t, device: 'touch' });
      }
    } else if (down && (action === 'od' || action === 'pause')) {
      this._emitGame({ type: action, player, t, device: 'touch' });
    }
  }

  // ---------------------------------------------------------------- emit helpers
  _emitGame(ev) { this.gameListeners.forEach((fn) => fn(ev)); }
  _emitNav(dir, deviceId) { this.navListeners.forEach((fn) => fn(dir, deviceId)); }
  _emitAny(deviceId, key) { this.anyListeners.forEach((fn) => fn(deviceId, key)); }

  _lookup(profileKey, mode) {
    const ck = `${profileKey}|${mode}`;
    let map = this.lookupCache.get(ck);
    if (!map) {
      map = new Map();
      const prof = bindings.profile(profileKey);
      const sect = prof?.[mode] || {};
      for (const action of ACTIONS[mode]) {
        for (const src of sect[action] || []) {
          const k = srcKey(src);
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(action);
        }
      }
      this.lookupCache.set(ck, map);
    }
    return map;
  }

  _menuLookup(profileKey) {
    const ck = `${profileKey}|menu`;
    let map = this.lookupCache.get(ck);
    if (!map) {
      map = new Map();
      const fam = profileKey ? bindings.family(profileKey) : null;
      let menu = null;
      if (fam?.startsWith('raw:')) menu = bindings.profile(profileKey)?.menu;
      else if (fam === 'sony-raw') menu = PAD_MENU['sony-raw'];
      else if (fam === 'std') menu = PAD_MENU.standard;
      for (const [dir, list] of Object.entries(menu || {})) for (const src of list || []) if (!map.has(srcKey(src))) map.set(srcKey(src), dir);
      this.lookupCache.set(ck, map);
    }
    return map;
  }

  _routes(player, deviceId) {
    return player.device === 'any' || player.device === deviceId;
  }

  /** Core: a control on a device changed state. */
  _control(deviceId, profileKey, key, down, t, extra = {}) {
    if (this.capture) {
      const c = this.capture;
      const kind = deviceId.startsWith('kb') ? 'key' : deviceId.startsWith('pad') ? 'pad' : 'midi';
      if (down && performance.now() > c.armed && (c.kind === 'any' || c.kind === kind) && (c.padIndex == null || extra.pad?.index === c.padIndex)) {
        c.cb({ deviceId, profileKey, key, src: keyToSrc(key), pad: extra.pad });
      }
      return;
    }
    if (down) { this.lastDevice = deviceId; this._emitAny(deviceId, key); }
    if (this.menu) return;
    this.players.forEach((pl, p) => {
      if (!this._routes(pl, deviceId) || !profileKey) return;
      const actions = this._lookup(profileKey, pl.mode).get(key);
      if (!actions) return;
      for (const action of actions) {
        const source = `${deviceId}|${key}`;
        if (action.startsWith('lane')) {
          const lane = +action[4];
          if (down) { this.held[p][lane].add(source); this._emitGame({ type: 'press', player: p, lane, t, device: deviceId }); }
          else if (this.held[p][lane].delete(source) && this.held[p][lane].size === 0) this._emitGame({ type: 'release', player: p, lane, t, device: deviceId });
        } else if (down) {
          this._emitGame({ type: action, player: p, t, device: deviceId });
        }
      }
    });
  }

  // ---------------------------------------------------------------- keyboard
  _key(e, down) {
    if (down) this.keysDown.add(e.code); else this.keysDown.delete(e.code);
    const tag = e.target?.tagName;
    if ((tag === 'INPUT' && ['text', 'password', 'search'].includes(e.target.type)) || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (down && e.code === 'Escape') e.target.blur();
      return;
    }
    if (this.capture?.kind === 'key' || this.capture?.kind === 'any') {
      if (!down || e.repeat) return;
      e.preventDefault();
      if (performance.now() < this.capture.armed) return;
      if (e.code === 'Escape') { this.capture.cb({ cancel: true }); return; }
      if (e.code === 'Delete') { this.capture.cb({ clear: true }); return; }
      this.capture.cb({ deviceId: 'kb1', profileKey: this.profileFor('kb1'), key: `k:${e.code}`, src: { k: e.code } });
      return;
    }
    if (this.capture) { if (down && e.code === 'Escape') this.capture.cb({ cancel: true }); return; }
    const t = e.timeStamp || performance.now();
    const kb1 = this.profileFor('kb1'), kb2 = this.profileFor('kb2');
    if (this.menu) {
      if (!down) return;
      const key = `k:${e.code}`;
      const dev = !this._lookup(kb1, 'five').has(key) && !this._lookup(kb1, 'drums').has(key) && (this._lookup(kb2, 'five').has(key) || this._lookup(kb2, 'drums').has(key)) ? 'kb2' : 'kb1';
      if (!e.repeat) { this.lastDevice = dev; this._emitAny(dev, key); }
      const dir = KEY_NAV[e.code];
      if (dir && (!e.repeat || NAV_REPEAT.has(dir))) { e.preventDefault(); this._emitNav(dir, 'kb1'); }
      else if (dir) e.preventDefault();
      return;
    }
    if (['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    const key = `k:${e.code}`;
    this._control('kb1', kb1, key, down, t);
    this._control('kb2', kb2, key, down, t);
  }

  // ---------------------------------------------------------------- gamepads
  _padControls(pad, profileKey) {
    const active = new Set();
    const prev = this.padActive.get(pad.index)?.set || new Set();
    const fam = profileKey ? bindings.family(profileKey) : null;
    const analogTriggers = fam === 'std';
    const [on0, off0] = TRIGGER[bindings.options(profileKey).sensitivity] || TRIGGER.normal;
    pad.buttons.forEach((b, i) => {
      let on;
      if (analogTriggers && (i === 6 || i === 7)) on = prev.has(`b${i}`) ? b.value > off0 : b.value > on0 || (b.pressed && b.value === 0);
      else on = b.pressed || b.value > 0.5;
      if (on) active.add(`b${i}`);
    });
    let hats = this.hatAxes.get(pad.index);
    if (!hats) { hats = new Set(); this.hatAxes.set(pad.index, hats); }
    pad.axes.forEach((v, i) => {
      if (Math.abs(v) > 1.05) hats.add(i);
      if (hats.has(i)) {
        const d = hatDir(v);
        if (d >= 0) {
          active.add(`h${i}:${d}`);
          if (d % 2 === 1) { active.add(`h${i}:${(d + 7) % 8}`); active.add(`h${i}:${(d + 1) % 8}`); }
        }
        return;
      }
      const plus = prev.has(`a${i}+`) ? v > AXIS_OFF : v > AXIS_ON;
      const minus = prev.has(`a${i}-`) ? v < -AXIS_OFF : v < -AXIS_ON;
      if (plus) active.add(`a${i}+`);
      if (minus) active.add(`a${i}-`);
    });
    return active;
  }

  _whammyValue(pad, profileKey) {
    if (!profileKey) return 0;
    const opt = bindings.options(profileKey).whammy;
    if (opt === 'off') return 0;
    const stick = (x, y) => Math.min(1, Math.max(0, Math.hypot(pad.axes[x] || 0, pad.axes[y] || 0) - 0.15) / 0.85);
    if (opt === 'right stick') return stick(2, 3);
    if (opt === 'left stick') return stick(0, 1);
    if (opt === 'touchpad') {
      // finger resting on the DualSense touchpad: vertical position bends the note
      const t = pad.touch?.[0];
      return t?.active ? Math.max(0, Math.min(1, 1 - t.y)) : 0;
    }
    const w = bindings.profile(profileKey)?.whammy;
    if (w?.stick) return stick(w.stick[0], w.stick[1]);
    if (w?.bar != null) return Math.max(0, Math.min(1, ((pad.axes[w.bar] ?? -1) + 1) / 2 - 0.05) / 0.95);
    return 0;
  }

  poll() {
    const pads = this.getPads();
    const now = performance.now();
    const whammy = [0, 0, 0, 0];
    const seen = new Set();
    for (const pad of pads) {
      seen.add(pad.index);
      const deviceId = `pad:${pad.index}`;
      const profileKey = this.padProfileKey(pad);
      const t = pad.timestamp > 0 && pad.timestamp <= now + 1 ? pad.timestamp : now;
      const active = this._padControls(pad, profileKey);
      const state = this.padActive.get(pad.index);
      const prev = state?.set || new Set();
      if (state && state.id !== pad.id) prev.clear();
      for (const k of active) if (!prev.has(k)) this._padEdge(deviceId, profileKey, k, true, t, pad);
      for (const k of prev) if (!active.has(k)) this._padEdge(deviceId, profileKey, k, false, t, pad);
      this.padActive.set(pad.index, { set: active, id: pad.id });

      const wv = this._whammyValue(pad, profileKey);
      if (wv > 0 && !this.menu) this.players.forEach((pl, p) => { if (this._routes(pl, deviceId)) whammy[p] = Math.max(whammy[p], wv); });

      if (this.menu && !this.capture && profileKey) this._navRepeat(deviceId, profileKey, active, now);
    }
    // a pad vanished (unplugged, or hidden because the bridge now reads it): release what it held
    for (const [idx, state] of this.padActive) {
      if (seen.has(idx)) continue;
      for (const k of state.set) this._padEdge(`pad:${idx}`, null, k, false, now, { index: idx, id: state.id });
      this.padActive.delete(idx);
    }
    this.whammyByPlayer = whammy;
  }

  _padEdge(deviceId, profileKey, key, down, t, pad) {
    if (!profileKey && !this.capture) {
      if (!down) {
        // release through every player's routing (profile may have changed while held)
        this.held.forEach((lanes, p) => lanes.forEach((set, lane) => {
          if (set.delete(`${deviceId}|${key}`) && set.size === 0) this._emitGame({ type: 'release', player: p, lane, t, device: deviceId });
        }));
        return;
      }
      if (key.startsWith('b')) {
        this._emitAny(deviceId, key);
        if (!this.warnedPads.has(pad.id)) { this.warnedPads.add(pad.id); this.onUnknownPad?.(pad); }
      }
      return;
    }
    if (this.menu && !this.capture) {
      if (!down) return;
      this.lastDevice = deviceId;
      this._emitAny(deviceId, key);
      const dir = this._menuLookup(profileKey).get(key);
      if (dir && !NAV_REPEAT.has(dir)) this._emitNav(dir, deviceId);
      return;
    }
    this._control(deviceId, profileKey, key, down, t, { pad });
  }

  _navRepeat(deviceId, profileKey, active, now) {
    const map = this._menuLookup(profileKey);
    const dirs = { up: false, down: false, left: false, right: false };
    for (const k of active) { const d = map.get(k); if (d in dirs) dirs[d] = true; }
    for (const [dir, held] of Object.entries(dirs)) {
      const hk = `${deviceId}:${dir}`;
      const st = this.navHold.get(hk);
      if (held && !st) { this.navHold.set(hk, { next: now + 380 }); this._emitNav(dir, deviceId); }
      else if (held && st && now >= st.next) { st.next = now + 110; this._emitNav(dir, deviceId); }
      else if (!held && st) this.navHold.delete(hk);
    }
  }

  // ---------------------------------------------------------------- MIDI
  get midiSupported() { return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator; }
  get midiEnabled() { return !!this.midiAccess; }

  async _autoMidi() {
    try {
      const st = await navigator.permissions?.query({ name: 'midi' });
      if (st?.state === 'granted') await this.enableMidi();
    } catch { /* permission API may not know 'midi' */ }
  }

  async enableMidi() {
    if (!this.midiSupported) throw new Error('Web MIDI is not available in this browser (use Chrome or Edge)');
    if (this.midiAccess) return this.midiInputs.size;
    this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    const attach = () => {
      for (const inp of this.midiAccess.inputs.values()) {
        if (this.midiInputs.has(inp.id) && inp.state === 'connected') continue;
        if (inp.state !== 'connected') { this.midiInputs.delete(inp.id); continue; }
        this.midiInputs.set(inp.id, { name: inp.name || 'MIDI input', port: inp });
        inp.onmidimessage = (e) => this._midiMessage(inp, e);
      }
      for (const id of [...this.midiInputs.keys()]) if (![...this.midiAccess.inputs.values()].some((i) => i.id === id && i.state === 'connected')) this.midiInputs.delete(id);
      this.onDevicesChanged?.();
    };
    this.midiAccess.onstatechange = attach;
    attach();
    return this.midiInputs.size;
  }

  /** Raw MIDI notes: fn({ note, on, velocity, t, deviceId }). Returns an unsubscribe function. */
  onMidiNote(fn) { (this.midiNoteListeners ||= new Set()).add(fn); return () => this.midiNoteListeners.delete(fn); }

  _midiMessage(inp, e) {
    const [st, d1, d2 = 0] = e.data;
    const cmd = st & 0xf0;
    const deviceId = `midi:${inp.id}`;
    const t = e.timeStamp || performance.now();
    if (this.midiNoteListeners?.size && (cmd === 0x90 || cmd === 0x80)) {
      const ev = { note: d1, on: cmd === 0x90 && d2 > 0, velocity: d2, t, deviceId };
      this.midiNoteListeners.forEach((fn) => fn(ev));
    }
    let counts = this.midiActive.get(deviceId);
    if (!counts) { counts = new Map(); this.midiActive.set(deviceId, counts); }
    const edge = (key, on) => {
      const c = counts.get(key) || 0;
      if (on) { counts.set(key, c + 1); if (c === 0) this._midiEdge(deviceId, key, true, t); }
      else if (c > 0) { counts.set(key, c - 1); if (c === 1) this._midiEdge(deviceId, key, false, t); }
    };
    if (cmd === 0x90 && d2 > 0) { edge(`n${d1}`, true); edge(`pc${d1 % 12}`, true); }
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) { edge(`n${d1}`, false); edge(`pc${d1 % 12}`, false); }
    else if (cmd === 0xb0) {
      const on = d2 >= 64;
      const was = (counts.get(`cc${d1}`) || 0) > 0;
      if (on !== was) edge(`cc${d1}`, on);
    }
  }

  _midiEdge(deviceId, key, down, t) {
    if (this.menu && !this.capture) {
      if (down) { this.lastDevice = deviceId; this._emitAny(deviceId, key); }
      return;
    }
    if (this.capture && key.startsWith('pc')) return; // capture exact notes, not pitch classes
    this._control(deviceId, this.profileFor(deviceId), key, down, t);
  }
}

export const input = new Input();
