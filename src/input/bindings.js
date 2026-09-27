// Controller config profiles: named binding sets + options, assigned per device.
//
// A binding source ("src") is one physical control:
//   keyboard   { k: 'KeyD' }
//   gamepad    { b: 6 } button · { a: 2, s: 1 } axis direction · { h: 9, d: 0 } hat direction (0=up..7=up-left)
//   MIDI       { n: 36 } note · { pc: 0 } pitch class (any octave) · { cc: 64 } controller
//
// Profile keys:
//   built-in presets   'keyboard' 'keyboard2' 'gamepad' 'guitar' 'drumkit' 'sony-raw' 'midi'  (editable, resettable)
//   pad maps           'custom:<gamepad id>'  (from the "Map buttons" wizard, for non-standard controllers)
//   your profiles      'user:<id>'            (named copies of any of the above, deletable)
// Profiles belong to a family and only apply to devices of that family:
//   'key' keyboards · 'std' standard-layout pads (incl. linked DualSense) · 'sony-raw' · 'midi' · 'raw:<gamepad id>'
const KEY = 'stemstage.bindings.v2';

export const ACTIONS = {
  five: ['lane0', 'lane1', 'lane2', 'lane3', 'lane4', 'strum', 'od', 'pause'],
  drums: ['lane0', 'lane1', 'lane2', 'lane3', 'lane4', 'od', 'pause'],
};

export const ACTION_LABELS = {
  five: { lane0: 'Lane 1 · green', lane1: 'Lane 2 · red', lane2: 'Lane 3 · yellow', lane3: 'Lane 4 · blue', lane4: 'Lane 5 · orange', strum: 'Strum (strum mode)', od: 'Overdrive', pause: 'Pause' },
  drums: { lane0: 'Kick pedal', lane1: 'Snare · red', lane2: 'Hi-hat · yellow', lane3: 'Tom · blue', lane4: 'Cymbal · green', od: 'Overdrive', pause: 'Pause' },
};

export const PROFILE_INFO = {
  keyboard: { label: 'Keyboard · keys A', short: 'Keys A', kind: 'key', family: 'key' },
  keyboard2: { label: 'Keyboard · keys B', short: 'Keys B', kind: 'key', family: 'key' },
  gamepad: { label: 'Gamepad (default)', short: 'Gamepad', kind: 'pad', family: 'std' },
  guitar: { label: 'Guitar controller (default)', short: 'Guitar', kind: 'pad', family: 'std' },
  drumkit: { label: 'Drum kit (default)', short: 'Drum kit', kind: 'pad', family: 'std' },
  'sony-raw': { label: 'PlayStation raw layout (default)', short: 'PS raw', kind: 'pad', family: 'sony-raw' },
  midi: { label: 'MIDI (default)', short: 'MIDI', kind: 'midi', family: 'midi' },
};

/** Per-profile options and their choices (first = default). */
export const OPTION_SCHEMA = [
  { key: 'strum', label: 'Strum mode', desc: 'Auto = on for guitar profiles or when a strum button is bound', options: ['auto', 'on', 'off'] },
  { key: 'lefty', label: 'Lefty flip', desc: 'Mirror the highway for this controller', options: ['global', 'on', 'off'] },
  { key: 'sensitivity', label: 'Trigger press point', desc: 'How far L2/R2 travel before they count as a press', options: ['normal', 'light', 'firm'], pad: true },
  { key: 'whammy', label: 'Whammy', desc: 'What bends sustained notes', options: ['default', 'right stick', 'left stick', 'touchpad', 'off'], pad: true },
  { key: 'rumble', label: 'Haptics', desc: 'Rumble / DualSense haptics for this controller', options: ['on', 'off'], pad: true },
  { key: 'triggers', label: 'Adaptive triggers', desc: 'DualSense trigger effects for this controller', options: ['on', 'off'], pad: true },
];
export const DEFAULT_OPTIONS = Object.fromEntries(OPTION_SCHEMA.map((o) => [o.key, o.options[0]]));

const K = (...codes) => codes.map((k) => ({ k }));
const B = (...idx) => idx.map((b) => ({ b }));
const DPAD = B(12, 13, 14, 15);
const HAT = (i) => [0, 2, 4, 6].map((d) => ({ h: i, d }));
const N = (...notes) => notes.map((n) => ({ n }));

export const DEFAULT_PROFILES = {
  keyboard: {
    five: { lane0: K('KeyD', 'Digit1'), lane1: K('KeyF', 'Digit2'), lane2: K('Space', 'Digit3'), lane3: K('KeyJ', 'Digit4'), lane4: K('KeyK', 'Digit5'), strum: [], od: K('Enter', 'ShiftLeft', 'ShiftRight'), pause: K('Escape') },
    drums: { lane0: K('Space', 'Digit1'), lane1: K('KeyD', 'Digit2'), lane2: K('KeyF', 'Digit3'), lane3: K('KeyJ', 'Digit4'), lane4: K('KeyK', 'Digit5'), od: K('Enter', 'ShiftLeft', 'ShiftRight'), pause: K('Escape') },
  },
  keyboard2: {
    five: { lane0: K('KeyU', 'Numpad1'), lane1: K('KeyI', 'Numpad2'), lane2: K('KeyO', 'Numpad3'), lane3: K('KeyP', 'Numpad4'), lane4: K('BracketLeft', 'Numpad5'), strum: [], od: K('Backslash', 'NumpadEnter'), pause: K('Backspace') },
    drums: { lane0: K('KeyY', 'Numpad0'), lane1: K('KeyU', 'Numpad1'), lane2: K('KeyI', 'Numpad2'), lane3: K('KeyO', 'Numpad3'), lane4: K('KeyP', 'Numpad4'), od: K('Backslash', 'NumpadEnter'), pause: K('Backspace') },
  },
  gamepad: {
    five: { lane0: B(6), lane1: B(4), lane2: [...DPAD, ...B(0, 1, 2)], lane3: B(5), lane4: B(7), strum: [], od: B(3, 17, 10, 11, 8), pause: B(9) },
    drums: { lane0: B(6, 7), lane1: B(4), lane2: DPAD, lane3: B(0, 1, 2), lane4: B(5), od: B(3, 17, 10, 11, 8), pause: B(9) },
    whammy: { stick: [2, 3] },
  },
  guitar: {
    // Xbox 360 RB/GH guitars in Chrome: A green, B red, Y yellow, X blue, LB orange, D-pad = strum bar,
    // Back = star power, right stick X = whammy, right stick Y = tilt.
    five: { lane0: B(0), lane1: B(1), lane2: B(3), lane3: B(2), lane4: B(4), strum: B(12, 13), od: [...B(8), { a: 3, s: 1 }, { a: 3, s: -1 }], pause: B(9) },
    drums: { lane0: B(4, 5), lane1: B(1), lane2: B(3), lane3: B(2), lane4: B(0), od: B(8), pause: B(9) },
    whammy: { bar: 2 },
  },
  drumkit: {
    // Xbox 360 RB/GH drums in Chrome: A green, B red, X blue, Y yellow, LB (and RB) kick pedal.
    five: { lane0: B(0), lane1: B(1), lane2: B(3), lane3: B(2), lane4: B(4), strum: [], od: B(8), pause: B(9) },
    drums: { lane0: B(4, 5), lane1: B(1), lane2: B(3), lane3: B(2), lane4: B(0), od: B(8), pause: B(9) },
  },
  'sony-raw': {
    // DirectInput order: 0 □, 1 ✕, 2 ◯, 3 △, 4 L1, 5 R1, 6 L2, 7 R2, 8 Create, 9 Options, 10 L3, 11 R3, 12 PS, 13 touchpad; D-pad = hat
    five: { lane0: B(6), lane1: B(4), lane2: [...B(0, 1, 2), ...HAT(9), ...B(14, 15, 16, 17)], lane3: B(5), lane4: B(7), strum: [], od: B(3, 13, 10, 11, 8), pause: B(9) },
    drums: { lane0: B(6, 7), lane1: B(4), lane2: [...HAT(9), ...B(14, 15, 16, 17)], lane3: B(0, 1, 2), lane4: B(5), od: B(3, 13, 10, 11, 8), pause: B(9) },
    whammy: { stick: [2, 5] },
  },
  midi: {
    // Keyboards: white keys C D E F G in any octave; A or sustain pedal = overdrive.
    five: { lane0: [{ pc: 0 }], lane1: [{ pc: 2 }], lane2: [{ pc: 4 }], lane3: [{ pc: 5 }], lane4: [{ pc: 7 }], strum: [], od: [{ pc: 9 }, { cc: 64 }], pause: [] },
    // General MIDI drum map (Roland, Alesis, Yamaha e-kits, RB3 MIDI Pro Adapter in drum mode)
    drums: {
      lane0: N(35, 36), lane1: N(37, 38, 39, 40), lane2: N(22, 26, 42, 44, 46),
      lane3: N(41, 43, 45, 47, 48, 50, 58), lane4: N(49, 51, 52, 53, 55, 57, 59), od: [{ cc: 64 }], pause: [],
    },
  },
};

// Menu navigation per layout (not rebindable except through the custom-pad wizard)
export const PAD_MENU = {
  standard: {
    confirm: B(0), back: B(1), alt: B(3), alt2: B(2), start: B(9), select: B(8), prev: B(4), next: B(5), pgup: B(6), pgdn: B(7),
    up: [{ b: 12 }, { a: 1, s: -1 }], down: [{ b: 13 }, { a: 1, s: 1 }], left: [{ b: 14 }, { a: 0, s: -1 }], right: [{ b: 15 }, { a: 0, s: 1 }],
  },
  'sony-raw': {
    confirm: B(1), back: B(2), alt: B(3), alt2: B(0), start: B(9), select: B(8), prev: B(4), next: B(5), pgup: B(6), pgdn: B(7),
    up: [{ h: 9, d: 0 }, ...B(14)], down: [{ h: 9, d: 4 }, ...B(15)], left: [{ h: 9, d: 6 }, ...B(16)], right: [{ h: 9, d: 2 }, ...B(17)],
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

let store = { profiles: {}, custom: {}, padTypes: {}, user: {}, assign: {}, options: {} };
try { store = { ...store, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* default */ }
for (const k of ['profiles', 'custom', 'padTypes', 'user', 'assign', 'options']) store[k] ||= {};
// migrate the v1 custom-pad maps from the first release
try {
  const v1 = JSON.parse(localStorage.getItem('stemstage.padmaps.v1') || '{}');
  for (const [id, m] of Object.entries(v1)) {
    if (store.custom[id]) continue;
    const conv = (s) => (s ? [s.t === 'b' ? { b: s.i } : s.t === 'a' ? { a: s.i, s: s.s } : { h: s.i, d: s.d }] : []);
    const lanes = Object.fromEntries(['lane0', 'lane1', 'lane2', 'lane3', 'lane4'].map((l) => [l, conv(m[l])]));
    store.custom[id] = {
      five: { ...lanes, strum: [], od: conv(m.od), pause: conv(m.pause) },
      drums: { ...lanes, od: conv(m.od), pause: conv(m.pause) },
      menu: { confirm: conv(m.confirm), back: conv(m.back), start: conv(m.pause), up: conv(m.up), down: conv(m.down), left: conv(m.lane0), right: conv(m.lane4) },
    };
  }
} catch { /* ignore */ }
// migrate per-pad "type" overrides into device assignments
for (const [padKey, type] of Object.entries(store.padTypes)) {
  if (type && !store.assign[`pad:${padKey}`]) store.assign[`pad:${padKey}`] = type;
}
store.padTypes = {};

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ } };
const listeners = new Set();
const changed = () => { save(); listeners.forEach((fn) => fn()); };

function familyOfBase(base) {
  if (!base) return null;
  if (base.startsWith('custom:')) return `raw:${base.slice(7)}`;
  return PROFILE_INFO[base]?.family || null;
}

export const bindings = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  exists(key) {
    if (!key) return false;
    if (key.startsWith('user:')) return !!store.user[key.slice(5)];
    if (key.startsWith('custom:')) return !!store.custom[key.slice(7)];
    return !!DEFAULT_PROFILES[key];
  },

  /** Effective bindings for a profile key: { five, drums, whammy?, menu? } */
  profile(key) {
    if (!key) return null;
    if (key.startsWith('user:')) {
      const u = store.user[key.slice(5)];
      return u ? { five: u.five, drums: u.drums, whammy: u.whammy, menu: u.menu } : null;
    }
    if (key.startsWith('custom:')) return store.custom[key.slice(7)] || null;
    const base = DEFAULT_PROFILES[key];
    if (!base) return null;
    const over = store.profiles[key] || {};
    const out = clone(base);
    for (const mode of ['five', 'drums']) Object.assign(out[mode], over[mode] || {});
    return out;
  },

  /** The built-in preset (or 'custom:<id>') a profile was made from. */
  baseOf(key) {
    if (key?.startsWith('user:')) return store.user[key.slice(5)]?.base || null;
    return key;
  },
  family(key) { return familyOfBase(this.baseOf(key)); },
  kind(key) { const f = this.family(key); return f === 'key' ? 'key' : f === 'midi' ? 'midi' : 'pad'; },
  isUser(key) { return !!key?.startsWith('user:'); },
  isBuiltin(key) { return !!DEFAULT_PROFILES[key]; },

  label(key, padName = (id) => id) {
    if (!key) return 'None';
    if (key.startsWith('user:')) return store.user[key.slice(5)]?.name || 'Profile';
    if (key.startsWith('custom:')) return `${padName(key.slice(7))} · button map`;
    return PROFILE_INFO[key]?.label || key;
  },
  shortLabel(key, padName = (id) => id) {
    if (key?.startsWith('user:')) return store.user[key.slice(5)]?.name || 'Profile';
    if (key?.startsWith('custom:')) return `${padName(key.slice(7))} map`;
    return PROFILE_INFO[key]?.short || key;
  },

  /** Every profile usable by a device of `family` (padId: that gamepad's id, for its button map), built-ins first. */
  list(family, padId = null) {
    const out = [];
    for (const [k, info] of Object.entries(PROFILE_INFO)) if (info.family === family) out.push(k);
    if (padId && store.custom[padId]) out.push(`custom:${padId}`);
    const users = Object.values(store.user).filter((u) => familyOfBase(u.base) === family || (padId && u.base === `custom:${padId}`));
    users.sort((a, b) => (a.created || 0) - (b.created || 0));
    for (const u of users) out.push(`user:${u.id}`);
    return out;
  },

  // ---------------------------------------------------------------- editing
  set(key, mode, action, srcList) {
    if (key.startsWith('user:')) {
      const u = store.user[key.slice(5)];
      if (u) { u[mode][action] = srcList; changed(); }
      return;
    }
    if (key.startsWith('custom:')) {
      const p = store.custom[key.slice(7)];
      if (p) { p[mode][action] = srcList; changed(); }
      return;
    }
    store.profiles[key] = store.profiles[key] || {};
    store.profiles[key][mode] = store.profiles[key][mode] || {};
    store.profiles[key][mode][action] = srcList;
    changed();
  },

  /** Built-ins: back to factory bindings. User profiles: back to their base preset. */
  reset(key) {
    if (key.startsWith('user:')) {
      const u = store.user[key.slice(5)];
      const base = u && this.profile(u.base);
      if (base) { u.five = clone(base.five); u.drums = clone(base.drums); u.whammy = base.whammy ? clone(base.whammy) : undefined; }
    } else if (key.startsWith('custom:')) delete store.custom[key.slice(7)];
    else { delete store.profiles[key]; delete store.options[key]; }
    changed();
  },

  /** New named profile copied from `fromKey` (bindings and options). Returns its key. */
  create(fromKey, name) {
    const src = this.profile(fromKey);
    if (!src) throw new Error('Unknown profile');
    const id = uid();
    store.user[id] = {
      id, name: String(name || 'My profile').slice(0, 28), base: this.baseOf(fromKey), created: Date.now(),
      five: clone(src.five), drums: clone(src.drums), whammy: src.whammy ? clone(src.whammy) : undefined, menu: src.menu ? clone(src.menu) : undefined,
      options: { ...this.options(fromKey) },
    };
    changed();
    return `user:${id}`;
  },

  rename(key, name) {
    const u = key.startsWith('user:') && store.user[key.slice(5)];
    if (!u) return;
    u.name = String(name || u.name).trim().slice(0, 28) || u.name;
    changed();
  },

  remove(key) {
    if (!key.startsWith('user:')) return;
    delete store.user[key.slice(5)];
    for (const [dev, k] of Object.entries(store.assign)) if (k === key) delete store.assign[dev];
    changed();
  },

  options(key) {
    const own = key?.startsWith('user:') ? store.user[key.slice(5)]?.options : store.options[key];
    return { ...DEFAULT_OPTIONS, ...(own || {}) };
  },
  setOption(key, name, value) {
    if (key.startsWith('user:')) {
      const u = store.user[key.slice(5)];
      if (!u) return;
      u.options = { ...(u.options || {}), [name]: value };
    } else store.options[key] = { ...(store.options[key] || {}), [name]: value };
    changed();
  },

  // ---------------------------------------------------------------- device assignment
  /** deviceKeys: most specific first, e.g. ['pad:<id>#1', 'pad:<id>'] */
  assigned(deviceKeys) {
    for (const k of deviceKeys) { const v = store.assign[k]; if (v && this.exists(v)) return v; }
    return null;
  },
  /** Assign a profile to a device (and make it the default for that controller model). */
  assign(deviceKeys, profileKey) {
    for (const k of deviceKeys) { if (profileKey) store.assign[k] = profileKey; else delete store.assign[k]; }
    changed();
  },

  // ---------------------------------------------------------------- pad maps (wizard)
  hasCustom(padId) { return !!store.custom[padId]; },
  setCustom(padId, profile) { store.custom[padId] = profile; changed(); },
  customIds() { return Object.keys(store.custom); },
};

// ---------------------------------------------------------------- labels
const KEY_NAMES = { Space: 'Space', Enter: 'Enter', Escape: 'Esc', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', Backspace: 'Bksp', Backslash: '\\', BracketLeft: '[', BracketRight: ']', NumpadEnter: 'Num Enter', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', Tab: 'Tab', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', PageUp: 'PgUp', PageDown: 'PgDn', Backquote: '`' };
const PAD_NAMES = { 0: '✕ / A', 1: '◯ / B', 2: '▢ / X', 3: '△ / Y', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Create', 9: 'Options', 10: 'L3', 11: 'R3', 12: 'D↑', 13: 'D↓', 14: 'D←', 15: 'D→', 16: 'PS', 17: 'Touchpad', 18: 'Mute', 19: 'Fn L', 20: 'Fn R', 21: 'Paddle L', 22: 'Paddle R' };
const FAMILY_NAMES = {
  playstation: { 0: '✕', 1: '◯', 2: '▢', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Create', 9: 'Options', 10: 'L3', 11: 'R3', 16: 'PS', 17: 'Touchpad' },
  xbox: { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'View', 9: 'Menu', 10: 'LS', 11: 'RS', 16: 'Xbox' },
  nintendo: { 0: 'B', 1: 'A', 2: 'Y', 3: 'X', 4: 'L', 5: 'R', 6: 'ZL', 7: 'ZR', 8: '−', 9: '+', 10: 'L-stick', 11: 'R-stick', 16: 'Home', 17: 'Capture' },
};
const GUITAR_NAMES = { 0: 'Green', 1: 'Red', 2: 'Blue', 3: 'Yellow', 4: 'Orange', 5: 'RB', 8: 'Star power', 9: 'Start', 12: 'Strum ↑', 13: 'Strum ↓' };
const DRUM_NAMES = { 0: 'Green pad', 1: 'Red pad', 2: 'Blue pad', 3: 'Yellow pad', 4: 'Kick', 5: 'Kick 2', 8: 'Back', 9: 'Start' };
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const HAT_NAMES = ['Hat ↑', 'Hat ↗', 'Hat →', 'Hat ↘', 'Hat ↓', 'Hat ↙', 'Hat ←', 'Hat ↖'];

/** Human label for a control. padFamily: 'playstation' | 'xbox' | 'nintendo' for exact glyph names. */
export function srcLabel(src, profileKey = 'gamepad', padFamily = null) {
  if (!src) return '—';
  const base = bindings.baseOf(profileKey) || profileKey;
  if (src.k) return KEY_NAMES[src.k] || src.k.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  if (src.b != null) {
    if (base === 'guitar' && GUITAR_NAMES[src.b]) return GUITAR_NAMES[src.b];
    if (base === 'drumkit' && DRUM_NAMES[src.b]) return DRUM_NAMES[src.b];
    if (base?.startsWith('custom:')) return `Button ${src.b + 1}`;
    if (padFamily && FAMILY_NAMES[padFamily]?.[src.b]) return FAMILY_NAMES[padFamily][src.b];
    return PAD_NAMES[src.b] || `Button ${src.b + 1}`;
  }
  if (src.a != null) {
    if (base === 'guitar' && src.a === 3) return `Tilt ${src.s > 0 ? '+' : '−'}`;
    if (!base?.startsWith('custom:') && src.a <= 3) return `${src.a < 2 ? 'L-stick' : 'R-stick'} ${src.a % 2 ? (src.s > 0 ? '↓' : '↑') : (src.s > 0 ? '→' : '←')}`;
    return `Axis ${src.a + 1}${src.s > 0 ? '+' : '−'}`;
  }
  if (src.h != null) return HAT_NAMES[src.d] || 'Hat';
  if (src.n != null) return `Note ${src.n} (${NOTE[src.n % 12]}${Math.floor(src.n / 12) - 1})`;
  if (src.pc != null) return `Any ${NOTE[src.pc]}`;
  if (src.cc != null) return src.cc === 64 ? 'Sustain pedal' : `CC ${src.cc}`;
  return '?';
}

export const sameSrc = (a, b) => JSON.stringify(a) === JSON.stringify(b);
