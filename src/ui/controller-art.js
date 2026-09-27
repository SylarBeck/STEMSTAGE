// Controller detection, illustrations and button-prompt glyphs.
//
// detectController(device) -> { kind, family, name, maker }
// controllerSvg(kind, opts) -> SVG markup (viewBox 0 0 400 260). Interactive parts carry
//   data-b="<standard button>"  data-stick="l|r"  data-trig="6|7"  data-act="lane0..4|strum|od|whammy"
//   data-k="<KeyboardEvent.code>"  data-pc="<MIDI pitch class>"
// so the controllers screen can light them up live.
// glyph(action, family) -> inline markup for button prompts (✕ / A / B / Enter ...).

import { PACK, packSvg, packUrl } from './controller-pack.js';
let seq = 0;
const uid = (p) => `${p}${++seq}`;

const PS_COLORS = { tri: '#3fe0b0', cir: '#ff5f7a', crs: '#7aa8ff', sqr: '#f08be6' };
const XB_COLORS = { a: '#63d35f', b: '#ff5252', x: '#3b8fff', y: '#f6c343' };
export const LANE_COLORS = ['#2bff5a', '#ff2b4a', '#ffe62b', '#2b8cff', '#ff8a1a'];
const DRUM_LANE_COLORS = ['#ff8a1a', '#ff2b4a', '#ffe62b', '#2b8cff', '#2bff5a'];

// ---------------------------------------------------------------- detection
const vp = (id = '') => {
  let m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id);
  if (m) return { v: m[1].toLowerCase(), p: m[2].toLowerCase() };
  m = /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id); // Firefox
  if (m) return { v: m[1].toLowerCase(), p: m[2].toLowerCase() };
  return { v: '', p: '' };
};

const FAMILY = {
  dualsense: 'playstation', 'dualsense-edge': 'playstation', dualshock4: 'playstation', dualshock3: 'playstation',
  xbox: 'xbox', xbox360: 'xbox', 'switch-pro': 'nintendo', 'joycon-l': 'nintendo', 'joycon-r': 'nintendo', 'joycon-pair': 'nintendo',
  guitar: 'guitar', drums: 'drums', 'midi-keys': 'midi', 'midi-drums': 'midi', keyboard: 'keyboard', gamepad: 'generic', steam: 'generic',
};

/** device: an entry from input.listDevices() (or { id: 'kb1' }). profileBase: the config profile's base preset. */
export function detectController(device, profileBase = null) {
  if (!device) return info('keyboard', 'Keyboard', '');
  if (device.id === 'kb1' || device.id === 'kb2' || device.kind === 'key') return info('keyboard', device.id === 'kb2' ? 'Keyboard · keys B' : 'Keyboard · keys A', '');
  if (device.kind === 'midi' || device.id?.startsWith('midi:')) {
    const n = device.midiName || device.label || '';
    const drums = /drum|kit|\btd-?\d|alesis|nitro|surge|strike|dm10|dtx|e-?drum|pad|pro adapter|roland v/i.test(n);
    return info(drums ? 'midi-drums' : 'midi-keys', n.replace(/^MIDI · /, '') || 'MIDI device', 'MIDI');
  }
  const pad = device.pad;
  const id = pad?.id || device.label || '';
  const { v, p } = vp(id);
  const name = (id.split('(')[0] || '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim();
  if (profileBase === 'guitar') return info('guitar', /guitar/i.test(name) ? name : 'Guitar controller', 'Rock Band / Guitar Hero');
  if (profileBase === 'drumkit') return info('drums', /drum/i.test(name) ? name : 'Drum kit', 'Rock Band / Guitar Hero');
  if (v === '054c' || /dualsense|dualshock/i.test(id)) {
    if (p === '0df2' || /edge/i.test(id)) return info('dualsense-edge', 'DualSense Edge', 'Sony');
    if (p === '0ce6' || /dualsense/i.test(id)) return info('dualsense', 'DualSense', 'Sony');
    if (['05c4', '09cc', '0ba0'].includes(p) || /dualshock 4|wireless controller/i.test(id)) return info('dualshock4', 'DualShock 4', 'Sony');
    if (p === '0268' || /dualshock 3|playstation\(r\)3/i.test(id)) return info('dualshock3', 'DualShock 3', 'Sony');
    return info('dualshock4', name || 'PlayStation controller', 'Sony');
  }
  if (v === '057e' || /joy-?con|pro controller|nintendo/i.test(id)) {
    if (p === '200e' || /l\+r|joy-?con.*pair/i.test(id)) return info('joycon-pair', 'Joy-Con (L+R)', 'Nintendo');
    if (['2006', '2066'].includes(p) || /joy-?con.*\(l\)|joy-?con l\b/i.test(id)) return info('joycon-l', 'Joy-Con (L)', 'Nintendo');
    if (['2007', '2067'].includes(p) || /joy-?con.*\(r\)|joy-?con r\b/i.test(id)) return info('joycon-r', 'Joy-Con (R)', 'Nintendo');
    return info('switch-pro', p === '2069' ? 'Switch 2 Pro Controller' : 'Pro Controller', 'Nintendo');
  }
  if (/guitar|stratocaster|jaguar|les paul|gibson/i.test(id) || ['12ba', '1430', '1bad'].includes(v) && !['0120', '0210', '0005', '3110', '0003'].includes(p) && !/drum/i.test(id)) return info('guitar', name || 'Guitar controller', 'Rock Band / Guitar Hero');
  if (/drum/i.test(id) || ['12ba', '1430', '1bad'].includes(v)) return info('drums', name || 'Drum kit', 'Rock Band / Guitar Hero');
  if (v === '045e' || /xbox|xinput/i.test(id)) {
    if (['028e', '028f', '0291', '0719'].includes(p)) return info('xbox360', 'Xbox 360 Controller', 'Microsoft');
    return info('xbox', /xinput/i.test(id) ? 'Xbox / XInput controller' : (name || 'Xbox Controller'), 'Microsoft');
  }
  if (v === '28de' || /steam/i.test(id)) return info('steam', name || 'Steam Controller', 'Valve');
  return info('gamepad', name || 'Controller', '');
}
function info(kind, name, maker) { return { kind, family: FAMILY[kind] || 'generic', name, maker }; }

export const KIND_LABEL = {
  dualsense: 'PlayStation 5 · DualSense', 'dualsense-edge': 'PlayStation 5 · DualSense Edge', dualshock4: 'PlayStation 4 · DualShock 4', dualshock3: 'PlayStation 3 · DualShock 3',
  xbox: 'Xbox Wireless Controller', xbox360: 'Xbox 360 Controller', 'switch-pro': 'Nintendo Switch Pro Controller', 'joycon-l': 'Nintendo Joy-Con (L)', 'joycon-r': 'Nintendo Joy-Con (R)',
  'joycon-pair': 'Nintendo Joy-Con pair', guitar: 'Guitar controller', drums: 'Drum kit', 'midi-keys': 'MIDI keyboard', 'midi-drums': 'MIDI drum kit', keyboard: 'Computer keyboard',
  gamepad: 'Gamepad', steam: 'Steam controller',
};

// ---------------------------------------------------------------- shared SVG parts
function sticks(lx, ly, rx, ry, well = '#0b0b0f', cap = '#26262d', rim = '#3a3a44') {
  const one = (x, y, side, b) => `
    <circle cx="${x}" cy="${y}" r="25" fill="${well}"/><circle cx="${x}" cy="${y + 1.5}" r="23.5" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="3"/>
    <g class="b" data-b="${b}"><g data-stick="${side}" style="transform-origin:${x}px ${y}px">
      <circle class="cap" cx="${x}" cy="${y}" r="18" fill="${cap}" stroke="${rim}" stroke-width="3"/>
      <circle cx="${x}" cy="${y}" r="15.5" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="2.2" stroke-dasharray="1.4 2.2"/>
      <circle cx="${x}" cy="${y + 1}" r="10.5" fill="rgba(0,0,0,0.28)"/>
      <circle cx="${x}" cy="${y}" r="10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.2"/>
      ${domed(x, y, 18)}
    </g></g>`;
  return one(lx, ly, 'l', 10) + one(rx, ry, 'r', 11);
}

function dpadCross(cx, cy, fill = '#1a1a20', arrow = 'rgba(255,255,255,0.55)', size = 1) {
  const arm = (b, rot) => `<g class="b" data-b="${b}" transform="rotate(${rot} ${cx} ${cy})">
      <path class="cap" d="M${cx - 8 * size} ${cy - 5 * size} L${cx - 8 * size} ${cy - 22 * size} Q${cx - 8 * size} ${cy - 26 * size} ${cx - 4 * size} ${cy - 26 * size} L${cx + 4 * size} ${cy - 26 * size} Q${cx + 8 * size} ${cy - 26 * size} ${cx + 8 * size} ${cy - 22 * size} L${cx + 8 * size} ${cy - 5 * size} L${cx} ${cy + 2 * size} Z" fill="${fill}"/>
      <path d="M${cx - 8 * size} ${cy - 5 * size} L${cx - 8 * size} ${cy - 22 * size} Q${cx - 8 * size} ${cy - 26 * size} ${cx - 4 * size} ${cy - 26 * size} L${cx + 4 * size} ${cy - 26 * size} Q${cx + 8 * size} ${cy - 26 * size} ${cx + 8 * size} ${cy - 22 * size} L${cx + 8 * size} ${cy - 5 * size} L${cx} ${cy + 2 * size} Z" fill="url(#gloss__K__)" pointer-events="none"/>
      <path d="M${cx} ${cy - 21 * size} l${-4 * size} ${6 * size} h${8 * size} z" fill="${arrow}"/></g>`;
  return arm(12, 0) + arm(15, 90) + arm(13, 180) + arm(14, 270);
}

function psFace(cx, cy, r = 11, off = 24, base = '#15151b') {
  const sym = {
    3: `<path d="M${cx} ${cy - off - 5.5} l6 10 h-12 z" fill="none" stroke="${PS_COLORS.tri}" stroke-width="2"/>`,
    1: `<circle cx="${cx + off}" cy="${cy}" r="5.5" fill="none" stroke="${PS_COLORS.cir}" stroke-width="2"/>`,
    0: `<path d="M${cx - 5} ${cy + off - 5} l10 10 M${cx + 5} ${cy + off - 5} l-10 10" stroke="${PS_COLORS.crs}" stroke-width="2.2"/>`,
    2: `<rect x="${cx - off - 5}" y="${cy - 5}" width="10" height="10" fill="none" stroke="${PS_COLORS.sqr}" stroke-width="2"/>`,
  };
  const pos = { 3: [cx, cy - off], 1: [cx + off, cy], 0: [cx, cy + off], 2: [cx - off, cy] };
  return [3, 1, 0, 2].map((b) => `<g class="b" data-b="${b}"><circle class="cap" cx="${pos[b][0]}" cy="${pos[b][1]}" r="${r}" fill="${base}" stroke="rgba(255,255,255,0.12)"/>${domed(pos[b][0], pos[b][1], r)}${sym[b]}</g>`).join('');
}

function letterFace(cx, cy, letters, colors, { r = 11, off = 24, base = '#101114', glossy = false, text = null } = {}) {
  // letters: { top, right, bottom, left } -> standard indices top 3, right 1, bottom 0, left 2
  const pos = [['bottom', 0, cx, cy + off], ['right', 1, cx + off, cy], ['left', 2, cx - off, cy], ['top', 3, cx, cy - off]];
  return pos.map(([k, b, x, y]) => {
    const col = colors[k];
    const fill = glossy ? col : base;
    const tc = text || (glossy ? '#fff' : col);
    return `<g class="b" data-b="${b}"><circle cx="${x}" cy="${y + 1.5}" r="${r}" fill="rgba(0,0,0,0.35)"/><circle class="cap" cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="rgba(255,255,255,${glossy ? 0.5 : 0.1})"/>${domed(x, y, r)}
      ${glossy ? `<ellipse cx="${x}" cy="${y - r * 0.45}" rx="${r * 0.6}" ry="${r * 0.3}" fill="rgba(255,255,255,0.35)"/>` : ''}
      <text x="${x}" y="${y + 4.5}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${r + 2}" fill="${tc}">${letters[k]}</text></g>`;
  }).join('');
}

const shoulder = (b, d, fill, label, lx, ly) => `<g class="b" data-b="${b}"><path class="cap" d="${d}" fill="${fill}"/><path d="${d}" fill="url(#gloss__K__)" pointer-events="none"/>${label ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Arial" font-size="9" font-weight="700" fill="rgba(255,255,255,0.55)">${label}</text>` : ''}</g>`;
const trigger = (b, d, fill, accent, label, lx, ly) => `<g class="b" data-b="${b}" data-trig="${b}"><path class="cap" d="${d}" fill="${fill}"/><path d="${d}" fill="url(#gloss__K__)" pointer-events="none"/><path class="tfill" d="${d}" fill="${accent}" opacity="0"/>${label ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Arial" font-size="9" font-weight="700" fill="rgba(255,255,255,0.6)">${label}</text>` : ''}</g>`;

// Classic "gamepad with two grips" silhouette (used by PlayStation-style art)
const PS_BODY = 'M200 60 C240 60 282 52 316 58 C352 64 372 92 382 128 C394 170 400 212 386 234 C372 254 340 252 326 236 C312 220 300 196 280 188 C258 180 230 182 200 182 C170 182 142 180 120 188 C100 196 88 220 74 236 C60 252 28 254 14 234 C0 212 6 170 18 128 C28 92 48 64 84 58 C118 52 160 60 200 60 Z';
const XB_BODY = 'M200 66 C236 66 262 58 298 58 C338 58 360 80 374 118 C390 162 398 206 384 232 C370 256 338 254 322 236 C306 218 292 200 268 194 C246 188 224 192 200 192 C176 192 154 188 132 194 C108 200 94 218 78 236 C62 254 30 256 16 232 C2 206 10 162 26 118 C40 80 62 58 102 58 C138 58 164 66 200 66 Z';

// Studio styling shared by every illustration: floor shadow, top-lit gloss, edge shading, rim light,
// domed button highlights and a fine grip texture. '__K__' makes the ids unique per SVG.
const KIT = (k) => `
  <linearGradient id="gloss${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".28" stop-color="#fff" stop-opacity=".1"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>
  <radialGradient id="edge${k}" cx=".5" cy=".38" r=".66"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".36"/></radialGradient>
  <linearGradient id="rim${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
  <radialGradient id="btn${k}" cx=".38" cy=".28" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".45" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient>
  <filter id="blur${k}" x="-30%" y="-150%" width="160%" height="400%"><feGaussianBlur stdDeviation="7"/></filter>
  <pattern id="dots${k}" width="4.5" height="4.5" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".65" fill="#000" opacity=".13"/></pattern>`;
const floor = (cx = 200, cy = 246, rx = 172, ry = 11) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".55" filter="url(#blur__K__)"/>`;
const glossy = (d, texture = false) => `<path d="${d}" fill="url(#edge__K__)" pointer-events="none"/>${texture ? `<path d="${d}" fill="url(#dots__K__)" pointer-events="none"/>` : ''}<path d="${d}" fill="url(#gloss__K__)" pointer-events="none"/><path d="${d}" fill="none" stroke="url(#rim__K__)" stroke-width="1.6" pointer-events="none"/>`;
const domed = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#btn__K__)" pointer-events="none"/>`;

function frame(inner, defs = '') {
  const k = uid('k');
  return `<svg class="ctl-svg" viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg"><defs>${KIT(k)}${defs.split('__K__').join(k)}</defs>${inner.split('__K__').join(k)}</svg>`;
}

// ---------------------------------------------------------------- PlayStation
function dualsense({ accent = '#29e0ff', edge = false } = {}) {
  const gBody = uid('dsb'), gPanel = uid('dsp'), gPad = uid('dst'), glow = uid('dsg');
  const defs = `
    <linearGradient id="${gBody}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#e6e8ef"/><stop offset="1" stop-color="#c9ccd6"/></linearGradient>
    <linearGradient id="${gPanel}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23242b"/><stop offset="1" stop-color="#0c0c10"/></linearGradient>
    <linearGradient id="${gPad}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34353d"/><stop offset="1" stop-color="#15161b"/></linearGradient>
    <filter id="${glow}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>`;
  const white = edge ? '#f3f4f7' : `url(#${gBody})`;
  return frame(`${floor()}
    ${trigger(6, 'M76 52 C92 36 130 32 152 40 L150 52 C128 46 100 48 82 60 Z', '#9ea2ad', accent, 'L2', 118, 45)}
    ${trigger(7, 'M324 52 C308 36 270 32 248 40 L250 52 C272 46 300 48 318 60 Z', '#9ea2ad', accent, 'R2', 282, 45)}
    ${shoulder(4, 'M72 64 C92 52 130 50 152 56 L150 64 C128 60 98 62 78 72 Z', '#d7d9e0', 'L1', 116, 62)}
    ${shoulder(5, 'M328 64 C308 52 270 50 248 56 L250 64 C272 60 302 62 322 72 Z', '#d7d9e0', 'R1', 284, 62)}
    <path d="${PS_BODY}" fill="${white}" stroke="#b7bac6" stroke-width="1.5"/>${glossy(PS_BODY, true)}
    <path d="M128 66 C150 62 250 62 272 66 C286 96 292 136 280 172 C256 184 144 184 120 172 C108 136 114 96 128 66 Z" fill="url(#${gPanel})"/>${glossy('M128 66 C150 62 250 62 272 66 C286 96 292 136 280 172 C256 184 144 184 120 172 C108 136 114 96 128 66 Z')}
    ${edge ? '<path d="M20 170 C30 200 44 226 64 236" stroke="#15161b" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M380 170 C370 200 356 226 336 236" stroke="#15161b" stroke-width="6" fill="none" stroke-linecap="round"/>' : ''}
    <g class="b" data-b="17"><path class="cap" d="M146 64 L254 64 C256 90 252 108 244 118 L156 118 C148 108 144 90 146 64 Z" fill="url(#${gPad})" stroke="rgba(255,255,255,0.08)"/></g>
    <g filter="url(#${glow})"><path d="M146 66 C144 90 148 108 157 121" stroke="${accent}" stroke-width="4" fill="none"/><path d="M254 66 C256 90 252 108 243 121" stroke="${accent}" stroke-width="4" fill="none"/></g>
    <path d="M146 66 C144 90 148 108 157 121" stroke="${accent}" stroke-width="1.6" fill="none"/><path d="M254 66 C256 90 252 108 243 121" stroke="${accent}" stroke-width="1.6" fill="none"/>
    ${shoulder(8, 'M131 70 h8 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-8 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3 Z', '#1b1c22', '', 0, 0)}
    ${shoulder(9, 'M261 70 h8 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-8 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3 Z', '#1b1c22', '', 0, 0)}
    ${dpadCross(88, 114, '#e9ebf1', 'rgba(20,20,30,0.45)')}
    ${psFace(312, 114, 11, 24, '#eceef4')}
    ${sticks(150, 152, 250, 152)}
    <g class="b" data-b="16"><circle class="cap" cx="200" cy="150" r="9" fill="#0f0f13" stroke="rgba(255,255,255,0.25)"/><path d="M196 146 v9 M196 146 h4 a2.5 2.5 0 0 1 0 5 h-4" stroke="#cfd2dc" stroke-width="1.6" fill="none"/></g>
    <g class="b" data-b="18"><rect class="cap" x="193" y="166" width="14" height="5" rx="2.5" fill="#2a2b31"/></g>
    ${edge ? `<g class="b" data-b="19"><rect class="cap" x="140" y="180" width="18" height="6" rx="3" fill="#1b1c22"/></g><g class="b" data-b="20"><rect class="cap" x="242" y="180" width="18" height="6" rx="3" fill="#1b1c22"/></g>
      <g class="b" data-b="21"><path class="cap" d="M40 206 q10 14 26 16" stroke="#2a2b31" stroke-width="7" fill="none" stroke-linecap="round"/></g><g class="b" data-b="22"><path class="cap" d="M360 206 q-10 14 -26 16" stroke="#2a2b31" stroke-width="7" fill="none" stroke-linecap="round"/></g>` : ''}
  `, defs);
}

function dualshock4({ accent = '#29e0ff' } = {}) {
  const gBody = uid('d4b'), glow = uid('d4g');
  const defs = `<linearGradient id="${gBody}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2e36"/><stop offset="1" stop-color="#101116"/></linearGradient>
    <filter id="${glow}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>`;
  return frame(`${floor()}
    ${trigger(6, 'M78 52 C94 38 128 34 150 42 L148 54 C126 48 100 50 84 60 Z', '#3a3c46', accent, 'L2', 118, 47)}
    ${trigger(7, 'M322 52 C306 38 272 34 250 42 L252 54 C274 48 300 50 316 60 Z', '#3a3c46', accent, 'R2', 282, 47)}
    ${shoulder(4, 'M72 64 C92 52 130 50 152 56 L150 64 C128 60 98 62 78 72 Z', '#2a2c34', 'L1', 116, 62)}
    ${shoulder(5, 'M328 64 C308 52 270 50 248 56 L250 64 C272 60 302 62 322 72 Z', '#2a2c34', 'R1', 284, 62)}
    <path d="${PS_BODY}" fill="url(#${gBody})" stroke="#4a4c57" stroke-width="1.5"/>${glossy(PS_BODY, true)}
    <g filter="url(#${glow})"><path d="M150 62 L250 62" stroke="${accent}" stroke-width="5" stroke-linecap="round"/></g>
    <path d="M150 62 L250 62" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
    <g class="b" data-b="17"><rect class="cap" x="152" y="68" width="96" height="50" rx="8" fill="#16171c" stroke="rgba(255,255,255,0.1)"/></g>
    ${shoulder(8, 'M134 70 h6 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-6 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3 Z', '#3a3c46', '', 0, 0)}
    ${shoulder(9, 'M260 70 h6 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-6 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3 Z', '#3a3c46', '', 0, 0)}
    ${dpadCross(88, 114, '#1d1e25', 'rgba(255,255,255,0.4)')}
    ${psFace(312, 114, 11, 24, '#17181e')}
    ${sticks(150, 154, 250, 154, '#08080b', '#2e3039', '#454753')}
    <g class="b" data-b="16"><circle class="cap" cx="200" cy="150" r="9" fill="#0d0d11" stroke="rgba(255,255,255,0.3)"/><path d="M196 146 v9 M196 146 h4 a2.5 2.5 0 0 1 0 5 h-4" stroke="#cfd2dc" stroke-width="1.6" fill="none"/></g>
  `, defs);
}

// ---------------------------------------------------------------- Xbox
function xbox({ accent = '#29e0ff', classic = false } = {}) {
  const gBody = uid('xbb'), glow = uid('xbg');
  const body = classic ? ['#fbfbfc', '#d4d5da'] : ['#2a2c31', '#141519'];
  const defs = `<linearGradient id="${gBody}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${body[0]}"/><stop offset="1" stop-color="${body[1]}"/></linearGradient>
    <filter id="${glow}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3"/></filter>`;
  const bump = classic ? '#cfd0d6' : '#24262b';
  const trig = classic ? '#b9bac1' : '#1c1d21';
  return frame(`${floor(200, 248)}
    ${trigger(6, 'M84 56 C100 40 134 36 152 44 L150 56 C130 50 104 54 90 64 Z', trig, accent, 'LT', 122, 50)}
    ${trigger(7, 'M316 56 C300 40 266 36 248 44 L250 56 C270 50 296 54 310 64 Z', trig, accent, 'RT', 278, 50)}
    ${shoulder(4, 'M76 70 C96 56 132 54 156 60 L154 70 C130 64 102 68 84 78 Z', bump, 'LB', 118, 68)}
    ${shoulder(5, 'M324 70 C304 56 268 54 244 60 L246 70 C270 64 298 68 316 78 Z', bump, 'RB', 282, 68)}
    <path d="${XB_BODY}" fill="url(#${gBody})" stroke="${classic ? '#b9bbc4' : '#40424b'}" stroke-width="1.5"/>${glossy(XB_BODY, !classic)}
    ${sticks(108, 108, 252, 160, classic ? '#2d2e33' : '#0b0b0e', classic ? '#3a3b41' : '#23242a', classic ? '#55565e' : '#383a42')}
    ${classic
      ? `<circle cx="148" cy="160" r="24" fill="#c5c6cc"/>${dpadCross(148, 160, '#e4e5ea', 'rgba(0,0,0,0.35)', 0.85)}`
      : `<circle cx="148" cy="160" r="23" fill="#0f1013"/>${dpadCross(148, 160, '#2b2d33', 'rgba(255,255,255,0.35)', 0.85)}`}
    ${letterFace(292, 108, { top: 'Y', right: 'B', bottom: 'A', left: 'X' }, { top: XB_COLORS.y, right: XB_COLORS.b, bottom: XB_COLORS.a, left: XB_COLORS.x }, { glossy: classic, base: '#0e0f12' })}
    <g class="b" data-b="16">
      ${classic ? '' : `<circle cx="200" cy="84" r="15" fill="${accent}" opacity="0.35" filter="url(#${glow})"/>`}
      <circle class="cap" cx="200" cy="84" r="13" fill="${classic ? '#d8d9de' : '#1b1c20'}" stroke="${classic ? '#3fbf3f' : 'rgba(255,255,255,0.35)'}" stroke-width="${classic ? 3 : 1.5}"/>
      <path d="M194 78 l12 12 M206 78 l-12 12" stroke="${classic ? '#3fbf3f' : '#e8e8ea'}" stroke-width="2.6" stroke-linecap="round"/>
    </g>
    ${shoulder(8, 'M166 106 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', classic ? '#b3b4bb' : '#101114', '', 0, 0)}
    ${shoulder(9, 'M234 106 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', classic ? '#b3b4bb' : '#101114', '', 0, 0)}
    ${classic ? '' : '<rect x="194" y="116" width="12" height="6" rx="3" fill="#101114"/>'}
  `, defs);
}

// ---------------------------------------------------------------- Nintendo
function switchPro({ accent = '#29e0ff' } = {}) {
  const gBody = uid('spb'), gGrip = uid('spg');
  const defs = `<linearGradient id="${gBody}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2b30"/><stop offset="1" stop-color="#111114"/></linearGradient>
    <linearGradient id="${gGrip}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(160,160,175,0.55)"/><stop offset="1" stop-color="rgba(70,70,80,0.75)"/></linearGradient>`;
  return frame(`${floor(200, 248)}
    ${trigger(6, 'M84 56 C100 40 134 36 152 44 L150 56 C130 50 104 54 90 64 Z', '#1c1c20', accent, 'ZL', 122, 50)}
    ${trigger(7, 'M316 56 C300 40 266 36 248 44 L250 56 C270 50 296 54 310 64 Z', '#1c1c20', accent, 'ZR', 278, 50)}
    ${shoulder(4, 'M76 70 C96 56 132 54 156 60 L154 70 C130 64 102 68 84 78 Z', '#26262b', 'L', 118, 68)}
    ${shoulder(5, 'M324 70 C304 56 268 54 244 60 L246 70 C270 64 298 68 316 78 Z', '#26262b', 'R', 282, 68)}
    <path d="${XB_BODY}" fill="url(#${gGrip})" stroke="#5a5a66" stroke-width="1.5"/>
    ${glossy(XB_BODY)}<path d="M200 66 C236 66 262 58 298 58 C338 58 358 80 368 112 C360 150 330 176 290 182 L110 182 C70 176 40 150 32 112 C42 80 62 58 102 58 C138 58 164 66 200 66 Z" fill="url(#${gBody})"/>${glossy('M200 66 C236 66 262 58 298 58 C338 58 358 80 368 112 C360 150 330 176 290 182 L110 182 C70 176 40 150 32 112 C42 80 62 58 102 58 C138 58 164 66 200 66 Z', true)}
    ${sticks(108, 108, 252, 160, '#0a0a0c', '#1f1f24', '#34343c')}
    <circle cx="148" cy="160" r="23" fill="#0c0c0e"/>${dpadCross(148, 160, '#232327', 'rgba(255,255,255,0.4)', 0.85)}
    ${letterFace(292, 108, { top: 'X', right: 'A', bottom: 'B', left: 'Y' }, { top: '#e8e8ec', right: '#e8e8ec', bottom: '#e8e8ec', left: '#e8e8ec' }, { base: '#1d1d22' })}
    ${shoulder(8, 'M162 86 h12 v4 h-12 Z', '#6d6d78', '', 0, 0)}
    <g class="b" data-b="9"><path class="cap" d="M226 88 h12 M232 82 v12" stroke="#6d6d78" stroke-width="4"/></g>
    <g class="b" data-b="17"><rect class="cap" x="170" y="112" width="12" height="12" rx="2" fill="#2e2e35"/><circle cx="176" cy="118" r="3" fill="#15151a"/></g>
    <g class="b" data-b="16"><circle class="cap" cx="224" cy="118" r="8" fill="#2e2e35" stroke="rgba(255,255,255,0.18)"/><path d="M220 120 v-3 l4 -3 l4 3 v3 z" fill="#9a9aa6"/></g>
  `, defs);
}

const JOYCON_L = 'M244 22 L244 238 L200 238 C176 238 158 222 158 196 L158 64 C158 38 176 22 200 22 Z';
const JOYCON_R = 'M156 22 L200 22 C224 22 242 38 242 64 L242 196 C242 222 224 238 200 238 L156 238 Z';

function joyconL(color = '#09b9e6', dx = 0, accent = '#29e0ff') {
  const g = uid('jcl');
  return `<g transform="translate(${dx} 0)"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.18)}"/></linearGradient></defs>
    ${trigger(6, 'M168 30 C176 16 196 12 214 14 L212 22 C196 22 182 26 176 36 Z', '#1d1d22', accent, '', 0, 0)}
    ${shoulder(4, 'M160 50 C164 34 178 24 200 22 L206 30 C186 32 172 40 168 54 Z', shade(color, -0.3), '', 0, 0)}
    <path d="${JOYCON_L}" fill="url(#${g})" stroke="${shade(color, -0.35)}" stroke-width="1.5"/>${glossy(JOYCON_L)}
    <rect x="238" y="30" width="6" height="200" rx="2" fill="#1c1c22"/>
    <circle cx="200" cy="78" r="22" fill="#15151a"/>
    <g class="b" data-b="10"><g data-stick="l" style="transform-origin:200px 78px"><circle class="cap" cx="200" cy="78" r="15" fill="#26262c" stroke="#3a3a44" stroke-width="3"/></g></g>
    ${[[12, 200, 134, 0], [15, 218, 152, 90], [13, 200, 170, 180], [14, 182, 152, 270]].map(([b, x, y, r]) => `<g class="b" data-b="${b}"><circle class="cap" cx="${x}" cy="${y}" r="10" fill="#1d1d23"/><path d="M${x} ${y - 5} l-4 7 h8 z" fill="rgba(255,255,255,0.5)" transform="rotate(${r} ${x} ${y})"/></g>`).join('')}
    ${shoulder(8, 'M218 38 h12 v4 h-12 Z', '#1d1d23', '', 0, 0)}
    <g class="b" data-b="17"><rect class="cap" x="208" y="200" width="12" height="12" rx="2" fill="#1d1d23"/></g>
  </g>`;
}

function joyconR(color = '#ff3c28', dx = 0, accent = '#29e0ff') {
  const g = uid('jcr');
  return `<g transform="translate(${dx} 0)"><defs><linearGradient id="${g}" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.18)}"/></linearGradient></defs>
    ${trigger(7, 'M232 30 C224 16 204 12 186 14 L188 22 C204 22 218 26 224 36 Z', '#1d1d22', accent, '', 0, 0)}
    ${shoulder(5, 'M240 50 C236 34 222 24 200 22 L194 30 C214 32 228 40 232 54 Z', shade(color, -0.3), '', 0, 0)}
    <path d="${JOYCON_R}" fill="url(#${g})" stroke="${shade(color, -0.35)}" stroke-width="1.5"/>${glossy(JOYCON_R)}
    <rect x="156" y="30" width="6" height="200" rx="2" fill="#1c1c22"/>
    ${letterFace(200, 84, { top: 'X', right: 'A', bottom: 'B', left: 'Y' }, { top: '#e0e0e6', right: '#e0e0e6', bottom: '#e0e0e6', left: '#e0e0e6' }, { r: 10, off: 18, base: '#1d1d23' })}
    <circle cx="200" cy="156" r="22" fill="#15151a"/>
    <g class="b" data-b="11"><g data-stick="r" style="transform-origin:200px 156px"><circle class="cap" cx="200" cy="156" r="15" fill="#26262c" stroke="#3a3a44" stroke-width="3"/></g></g>
    <g class="b" data-b="9"><path class="cap" d="M168 40 h12 M174 34 v12" stroke="#1d1d23" stroke-width="4"/></g>
    <g class="b" data-b="16"><circle class="cap" cx="186" cy="204" r="8" fill="#1d1d23" stroke="rgba(255,255,255,0.2)"/></g>
  </g>`;
}

// ---------------------------------------------------------------- instruments
function guitar({ accent = '#ff2d7a', laneColors = LANE_COLORS } = {}) {
  const gBody = uid('gb'), gNeck = uid('gn');
  const defs = `<radialGradient id="${gBody}" cx="0.45" cy="0.5" r="0.7"><stop offset="0" stop-color="${shade(accent, 0.15)}"/><stop offset="0.7" stop-color="${shade(accent, -0.25)}"/><stop offset="1" stop-color="#1a0a10"/></radialGradient>
    <linearGradient id="${gNeck}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2618"/><stop offset="1" stop-color="#22160e"/></linearGradient>`;
  const frets = [0, 1, 2, 3, 4].map((i) => {
    const x = 342 - i * 15;
    return `<g class="b" data-act="lane${i}"><rect class="cap" x="${x - 6}" y="116" width="12" height="28" rx="3" fill="${laneColors[i]}" stroke="rgba(0,0,0,0.5)"/><rect x="${x - 4}" y="118" width="8" height="6" rx="2" fill="rgba(255,255,255,0.35)"/></g>`;
  }).join('');
  return frame(`${floor(210, 234, 190, 9)}
    <path d="M188 118 L364 116 L364 144 L188 142 Z" fill="url(#${gNeck})" stroke="#140c07"/>
    ${[210, 232, 252, 270, 286, 300].map((x) => `<line x1="${x}" y1="118" x2="${x}" y2="142" stroke="rgba(220,220,230,0.35)" stroke-width="1.2"/>`).join('')}
    <path d="M362 112 L392 100 C398 110 398 150 392 160 L362 148 Z" fill="#1d1d22" stroke="#0d0d10"/>
    ${[108, 120, 132, 144].map((y) => `<circle cx="380" cy="${y + 2}" r="2.5" fill="#bfc2cc"/>`).join('')}
    <path d="M60 104 C38 74 62 44 100 58 C124 66 138 84 156 90 L194 104 L194 156 L156 170 C138 176 122 196 94 206 C56 220 34 188 58 158 C68 144 72 120 60 104 Z" fill="url(#${gBody})" stroke="#12060a" stroke-width="1.5"/>${glossy('M60 104 C38 74 62 44 100 58 C124 66 138 84 156 90 L194 104 L194 156 L156 170 C138 176 122 196 94 206 C56 220 34 188 58 158 C68 144 72 120 60 104 Z')}
    <path d="M86 94 C106 88 132 96 150 104 L178 112 L178 148 L150 156 C130 164 104 172 86 166 C74 150 74 110 86 94 Z" fill="#f2f0ea" opacity="0.92"/>
    <g class="b" data-act="strum"><rect class="cap" x="120" y="106" width="16" height="48" rx="7" fill="#2a2b31" stroke="#0e0e12"/><rect x="123" y="110" width="10" height="40" rx="5" fill="rgba(255,255,255,0.12)"/></g>
    ${[152, 164].map((x) => `<rect x="${x}" y="114" width="6" height="32" rx="2" fill="#1c1c20"/>`).join('')}
    <g class="b" data-act="whammy"><path class="cap" d="M150 160 C164 176 178 188 200 196" stroke="#c9ccd6" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="202" cy="197" r="5" fill="#f2f2f5"/></g>
    <g class="b" data-act="od"><circle class="cap" cx="96" cy="176" r="8" fill="#1b1c22" stroke="#ffcf3a" stroke-width="2"/><path d="M96 170 l1.8 4 4.2 .4 -3.2 2.8 1 4.2 -3.8 -2.2 -3.8 2.2 1 -4.2 -3.2 -2.8 4.2 -.4 z" fill="#ffcf3a"/></g>
    <g class="b" data-b="9"><circle class="cap" cx="78" cy="148" r="5" fill="#1b1c22"/></g>
    <g class="b" data-b="8"><circle class="cap" cx="78" cy="112" r="5" fill="#1b1c22"/></g>
    <circle cx="70" cy="130" r="6" fill="#d5d7de"/>
    ${frets}
  `, defs);
}

function drumkit({ laneColors = DRUM_LANE_COLORS } = {}) {
  const pad = (lane, cx, cy) => `<g class="b" data-act="lane${lane}"><ellipse cx="${cx}" cy="${cy + 6}" rx="42" ry="19" fill="#0c0c10"/><ellipse class="cap" cx="${cx}" cy="${cy}" rx="42" ry="19" fill="${laneColors[lane]}" stroke="rgba(0,0,0,0.5)" stroke-width="2"/><ellipse cx="${cx}" cy="${cy - 2}" rx="33" ry="13" fill="rgba(255,255,255,0.18)"/></g>`;
  const cym = (lane, cx, cy) => `<g class="b" data-act="lane${lane}"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + 60}" stroke="#6b6e78" stroke-width="3"/><ellipse class="cap" cx="${cx}" cy="${cy}" rx="34" ry="11" fill="#d8b24a" stroke="${laneColors[lane]}" stroke-width="4"/><ellipse cx="${cx}" cy="${cy}" rx="6" ry="2.5" fill="#8a6e22"/></g>`;
  return frame(`${floor(200, 248, 170, 9)}
    <path d="M60 196 L340 196 M80 196 L90 150 M320 196 L310 150 M200 196 L200 150" stroke="#565963" stroke-width="5" stroke-linecap="round"/>
    ${cym(2, 118, 58)}${cym(3, 206, 44)}${cym(4, 296, 60)}
    ${pad(1, 78, 150)}${pad(2, 162, 136)}${pad(3, 246, 136)}${pad(4, 326, 150)}
    <g class="b" data-act="lane0"><rect x="180" y="206" width="40" height="44" rx="6" fill="#1b1c22"/><path class="cap" d="M184 246 L188 214 L212 214 L216 246 Z" fill="${laneColors[0]}" stroke="rgba(0,0,0,0.5)"/></g>
  `);
}

function midiKeys({ laneColors = LANE_COLORS } = {}) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // pc -> white index it sits after
  const n = 15, x0 = 40, w = 320 / n, y0 = 118, h = 84;
  let keys = '', bk = '';
  for (let i = 0; i < n; i++) {
    const pc = whites[i % 7];
    const lane = [0, 2, 4, 5, 7].indexOf(pc);
    keys += `<g class="b" data-pc="${pc}"><rect class="cap" x="${x0 + i * w}" y="${y0}" width="${w - 1.5}" height="${h}" rx="2" fill="#f4f4f6" stroke="#9a9ca6"/>${lane >= 0 ? `<circle cx="${x0 + i * w + w / 2 - 0.75}" cy="${y0 + h - 10}" r="3.5" fill="${laneColors[lane]}"/>` : ''}</g>`;
  }
  for (let o = 0; o < 2; o++) {
    for (const [pc, wi] of Object.entries(blacks)) {
      const x = x0 + (o * 7 + wi + 1) * w - w * 0.3;
      bk += `<g class="b" data-pc="${pc}"><rect class="cap" x="${x}" y="${y0}" width="${w * 0.6}" height="${h * 0.6}" rx="2" fill="#15151a"/></g>`;
    }
  }
  return frame(`
${floor(200, 222, 185, 9)}<rect x="18" y="62" width="364" height="150" rx="12" fill="#1a1b21" stroke="#34353e" stroke-width="2"/><rect x="18" y="62" width="364" height="150" rx="12" fill="url(#gloss__K__)"/><rect x="18" y="62" width="364" height="150" rx="12" fill="none" stroke="url(#rim__K__)" stroke-width="1.6"/>
    <rect x="30" y="72" width="16" height="36" rx="6" fill="#0d0d11"/><rect x="52" y="72" width="16" height="36" rx="6" fill="#0d0d11"/>
    <rect x="34" y="84" width="8" height="10" rx="3" fill="#62646e"/><rect x="56" y="80" width="8" height="10" rx="3" fill="#62646e"/>
    <rect x="160" y="76" width="80" height="26" rx="4" fill="#0b1a20" stroke="#29e0ff" stroke-opacity="0.4"/><text x="200" y="94" text-anchor="middle" font-family="Arial" font-size="11" fill="#29e0ff">MIDI</text>
    ${[270, 296, 322, 348].map((x) => `<circle cx="${x}" cy="89" r="8" fill="#26272e" stroke="#44454f"/><line x1="${x}" y1="89" x2="${x}" y2="82" stroke="#bfc1ca" stroke-width="2"/>`).join('')}
    ${keys}${bk}
  `);
}

function midiDrums({ laneColors = DRUM_LANE_COLORS } = {}) {
  const mesh = (lane, cx, cy, r) => `<g class="b" data-act="lane${lane}"><circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#2a2b31"/><circle class="cap" cx="${cx}" cy="${cy}" r="${r}" fill="#3b3d46" stroke="${laneColors[lane]}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/></g>`;
  const cym = (lane, cx, cy, r) => `<g class="b" data-act="lane${lane}"><circle class="cap" cx="${cx}" cy="${cy}" r="${r}" fill="#23242a" stroke="${laneColors[lane]}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r * 0.22}" fill="#3a3b43"/></g>`;
  return frame(`${floor(200, 236, 175, 9)}
    <rect x="40" y="200" width="320" height="8" rx="4" fill="#3d3f48"/>
    ${cym(2, 82, 118, 32)}${cym(4, 150, 50, 34)}${cym(4, 330, 70, 40)}
    ${mesh(3, 172, 112, 26)}${mesh(3, 236, 104, 26)}${mesh(3, 300, 162, 32)}
    ${mesh(1, 136, 172, 30)}
    <g class="b" data-act="lane0"><rect class="cap" x="196" y="150" width="46" height="70" rx="8" fill="#2c2d34" stroke="${laneColors[0]}" stroke-width="3"/><circle cx="219" cy="182" r="14" fill="#1a1b20"/></g>
  `);
}

// ---------------------------------------------------------------- keyboard
const KB_ROWS = [
  [['Escape', 'Esc', 1], [null, '', 0.5], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => [`F${n}`, `F${n}`, 1])],
  [['Backquote', '`', 1], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => [`Digit${n}`, String(n), 1]), ['Minus', '-', 1], ['Equal', '=', 1], ['Backspace', '⌫', 2]],
  [['Tab', 'Tab', 1.5], ...'QWERTYUIOP'.split('').map((c) => [`Key${c}`, c, 1]), ['BracketLeft', '[', 1], ['BracketRight', ']', 1], ['Backslash', '\\', 1.5]],
  [['CapsLock', 'Caps', 1.75], ...'ASDFGHJKL'.split('').map((c) => [`Key${c}`, c, 1]), ['Semicolon', ';', 1], ['Quote', "'", 1], ['Enter', 'Enter', 2.25]],
  [['ShiftLeft', 'Shift', 2.25], ...'ZXCVBNM'.split('').map((c) => [`Key${c}`, c, 1]), ['Comma', ',', 1], ['Period', '.', 1], ['Slash', '/', 1], ['ShiftRight', 'Shift', 2.75]],
  [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', 'Win', 1.25], ['AltLeft', 'Alt', 1.25], ['Space', '', 6.25], ['AltRight', 'Alt', 1.25], ['MetaRight', 'Win', 1.25], ['ContextMenu', '≡', 1.25], ['ControlRight', 'Ctrl', 1.25]],
];

function keyboard({ laneKeys = {}, accent = '#29e0ff' } = {}) {
  const u = 20, x0 = 12, y0 = 64, gap = 1.6;
  let caps = '';
  KB_ROWS.forEach((row, r) => {
    let x = x0;
    const y = y0 + r * u + (r > 0 ? 6 : 0);
    for (const [code, label, w] of row) {
      if (code) {
        const col = laneKeys[code];
        caps += `<g class="b" data-k="${code}"><rect class="cap" x="${x + gap / 2}" y="${y + gap / 2}" width="${w * u - gap}" height="${u - gap}" rx="3" fill="${col || '#23242b'}" stroke="${col ? 'rgba(0,0,0,0.4)' : '#3a3b45'}"/><rect x="${x + gap / 2}" y="${y + gap / 2}" width="${w * u - gap}" height="${u - gap}" rx="3" fill="url(#gloss__K__)" pointer-events="none"/>
          <text x="${x + (w * u) / 2}" y="${y + u / 2 + 3.5}" text-anchor="middle" font-family="Arial" font-size="${label.length > 2 ? 6.5 : 8.5}" font-weight="700" fill="${col ? '#0a0814' : 'rgba(255,255,255,0.7)'}">${label}</text></g>`;
      }
      x += w * u;
    }
  });
  // arrows + nav cluster
  const ax = x0 + 15 * u + 8;
  const arrow = (code, lbl, x, y) => { const col = laneKeys[code]; return `<g class="b" data-k="${code}"><rect class="cap" x="${x}" y="${y}" width="${u - gap}" height="${u - gap}" rx="3" fill="${col || '#23242b'}" stroke="#3a3b45"/><text x="${x + u / 2}" y="${y + u / 2 + 3}" text-anchor="middle" font-family="Arial" font-size="9" fill="rgba(255,255,255,0.75)">${lbl}</text></g>`; };
  caps += arrow('PageUp', 'Pg↑', ax + u, y0 + u + 6) + arrow('PageDown', 'Pg↓', ax + u, y0 + 2 * u + 6);
  caps += arrow('ArrowUp', '↑', ax + u, y0 + 4 * u + 6) + arrow('ArrowLeft', '←', ax, y0 + 5 * u + 6) + arrow('ArrowDown', '↓', ax + u, y0 + 5 * u + 6) + arrow('ArrowRight', '→', ax + 2 * u, y0 + 5 * u + 6);
  return frame(`${floor(200, 214, 190, 8)}<rect x="4" y="54" width="392" height="150" rx="10" fill="#131419" stroke="#2c2d36" stroke-width="2"/><rect x="4" y="54" width="392" height="150" rx="10" fill="none" stroke="url(#rim__K__)" stroke-width="1.6"/>
    <rect x="4" y="54" width="392" height="3" rx="1.5" fill="${accent}" opacity="0.6"/>${caps}`);
}

function gamepad({ accent = '#29e0ff' } = {}) {
  const gBody = uid('gpb');
  const defs = `<linearGradient id="${gBody}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4d57"/><stop offset="1" stop-color="#23252c"/></linearGradient>`;
  return frame(`${floor(200, 248)}
    ${trigger(6, 'M84 56 C100 40 134 36 152 44 L150 56 C130 50 104 54 90 64 Z', '#2d2f36', accent, 'L2', 122, 50)}
    ${trigger(7, 'M316 56 C300 40 266 36 248 44 L250 56 C270 50 296 54 310 64 Z', '#2d2f36', accent, 'R2', 278, 50)}
    ${shoulder(4, 'M76 70 C96 56 132 54 156 60 L154 70 C130 64 102 68 84 78 Z', '#3a3d46', 'L1', 118, 68)}
    ${shoulder(5, 'M324 70 C304 56 268 54 244 60 L246 70 C270 64 298 68 316 78 Z', '#3a3d46', 'R1', 282, 68)}
    <path d="${XB_BODY}" fill="url(#${gBody})" stroke="#5c606c" stroke-width="1.5"/>${glossy(XB_BODY, true)}
    ${sticks(108, 108, 252, 160, '#15161a', '#30323a', '#4b4e58')}
    <circle cx="148" cy="160" r="23" fill="#1a1b20"/>${dpadCross(148, 160, '#393c45', 'rgba(255,255,255,0.4)', 0.85)}
    ${letterFace(292, 108, { top: '4', right: '2', bottom: '1', left: '3' }, { top: '#dfe1e8', right: '#dfe1e8', bottom: '#dfe1e8', left: '#dfe1e8' }, { base: '#2c2e35' })}
    ${shoulder(8, 'M166 100 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', '#1b1c21', '', 0, 0)}
    ${shoulder(9, 'M234 100 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', '#1b1c21', '', 0, 0)}
    <g class="b" data-b="16"><circle class="cap" cx="200" cy="84" r="11" fill="#1b1c21" stroke="${accent}" stroke-opacity="0.6" stroke-width="2"/></g>
  `, defs);
}

function shade(hex, k) {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  r = f(r); g = f(g); b = f(b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const PICTURE = { dualshock3: 'dualshock4', steam: 'gamepad' };
const PICTURES = new Set(['dualsense', 'dualsense-edge', 'dualshock4', 'xbox', 'xbox360', 'switch-pro', 'joycon-l', 'joycon-r', 'joycon-pair', 'guitar', 'drums', 'midi-keys', 'midi-drums', 'keyboard', 'gamepad']);
/** Pre-rendered picture of a controller (public/controllers/*.png, made by npm run art). */
export function controllerPicture(kind) {
  const pack = packUrl(kind) || (!PICTURES.has(kind) && !PICTURE[kind] ? packUrl('gamepad') : null);
  if (pack) return `<img class="ctl-img" src="${pack}" alt="" draggable="false">`;
  const k = PICTURE[kind] || kind;
  return `<img class="ctl-img" src="/controllers/${k}.png" alt="" draggable="false">`;
}

/** SVG markup for a controller kind. opts: { accent, laneKeys (keyboard), laneColors } */
export function controllerSvg(kind, opts = {}) {
  if (PACK[kind]) return packSvg(kind); // Gamepad Asset Pack picture + live hotspots
  switch (kind) {
    case 'dualsense': return dualsense(opts);
    case 'dualsense-edge': return dualsense({ ...opts, edge: true });
    case 'dualshock4': case 'dualshock3': return dualshock4(opts);
    case 'xbox': return xbox(opts);
    case 'xbox360': return xbox({ ...opts, classic: true });
    case 'switch-pro': return switchPro(opts);
    case 'joycon-l': return frame(floor(200, 246, 60, 9) + joyconL('#09b9e6', 0, opts.accent));
    case 'joycon-r': return frame(floor(200, 246, 60, 9) + joyconR('#ff3c28', 0, opts.accent));
    case 'joycon-pair': return frame(floor(200, 246, 110, 10) + joyconL('#09b9e6', -48, opts.accent) + joyconR('#ff3c28', 48, opts.accent));
    case 'guitar': return guitar(opts);
    case 'drums': return drumkit(opts);
    case 'midi-keys': return midiKeys(opts);
    case 'midi-drums': return midiDrums(opts);
    case 'keyboard': return keyboard(opts);
    default: return gamepad(opts);
  }
}

/**
 * Light up an art element from live input.
 * state: { controls: Set('b0','k:KeyD','pc0',...), actions: Set('lane0',...), pad (Gamepad-like, optional), whammy }
 */
export function paintArt(root, state) {
  if (!root) return;
  const { controls, actions, pad } = state;
  for (const el of root.querySelectorAll('[data-b]')) el.classList.toggle('on', controls.has(`b${el.dataset.b}`) || (+el.dataset.b >= 12 && +el.dataset.b <= 15 && hatOn(controls, +el.dataset.b)));
  for (const el of root.querySelectorAll('[data-act]')) el.classList.toggle('on', actions.has(el.dataset.act) || (el.dataset.act === 'whammy' && state.whammy > 0.25));
  for (const el of root.querySelectorAll('[data-k]')) el.classList.toggle('on', controls.has(`k:${el.dataset.k}`));
  for (const el of root.querySelectorAll('[data-pc]')) el.classList.toggle('on', controls.has(`pc${el.dataset.pc}`));
  if (pad) {
    for (const el of root.querySelectorAll('[data-stick]')) {
      const [x, y] = el.dataset.stick === 'l' ? [pad.axes[0] || 0, pad.axes[1] || 0] : [pad.axes[2] || 0, pad.axes[3] || 0];
      const ok = Math.abs(x) <= 1.05 && Math.abs(y) <= 1.05;
      const k = +(el.dataset.move || 7);
      el.style.transform = ok ? `translate(${(x * k).toFixed(1)}px, ${(y * k).toFixed(1)}px)` : '';
    }
    for (const el of root.querySelectorAll('[data-trig]')) {
      const v = pad.buttons[+el.dataset.trig]?.value || 0;
      const f = el.querySelector('.tfill');
      if (f) f.setAttribute('opacity', (v * 0.9).toFixed(2));
    }
  }
}
const hatOn = (controls, b) => {
  const want = { 12: [7, 0, 1], 15: [1, 2, 3], 13: [3, 4, 5], 14: [5, 6, 7] }[b];
  for (const k of controls) { const m = /^h\d+:(\d)$/.exec(k); if (m && want.includes(+m[1])) return true; }
  return false;
};

// ---------------------------------------------------------------- button prompts
const GLYPH_BTN = { confirm: 0, back: 1, alt: 3, alt2: 2, prev: 4, next: 5, pgup: 6, pgdn: 7, start: 9, select: 8 };
const KEY_GLYPH = { confirm: 'Enter', back: 'Esc', alt: 'Tab', alt2: 'F', prev: 'Q', next: 'E', pgup: 'PgUp', pgdn: 'PgDn', start: 'Enter', select: '—', dpad: '↑↓←→', lr: '←→', ud: '↑↓', prevnext: 'Q/E' };

function circle(inner, bg = '#111', ring = 'rgba(255,255,255,0.35)') {
  return `<svg class="gl-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="${bg}" stroke="${ring}" stroke-width="1.2"/>${inner}</svg>`;
}
function pill(text, bg = '#1c1d24') {
  return `<span class="gl-pill" style="background:${bg}">${text}</span>`;
}

/** Inline prompt for a menu action on the current input family. */
export function glyph(action, family = 'keyboard') {
  if (action === 'prevnext') return `${glyph('prev', family)}${glyph('next', family)}`;
  if (action === 'lr' || action === 'ud' || action === 'dpad') {
    if (family === 'keyboard' || family === 'midi') return `<span class="gl-key">${KEY_GLYPH[action]}</span>`;
    const hl = action === 'lr' ? 'M4 12h16' : action === 'ud' ? 'M12 4v16' : '';
    return `<svg class="gl-svg" viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#1c1d24" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>${hl ? `<path d="${hl}" stroke="#29e0ff" stroke-width="2.4" stroke-linecap="round"/>` : ''}</svg>`;
  }
  if (family === 'keyboard' || family === 'midi') return `<span class="gl-key">${KEY_GLYPH[action] || action}</span>`;
  const b = GLYPH_BTN[action];
  if (family === 'guitar' || family === 'drums') {
    const cols = family === 'guitar' ? { 0: LANE_COLORS[0], 1: LANE_COLORS[1], 3: LANE_COLORS[2], 2: LANE_COLORS[3], 4: LANE_COLORS[4] } : { 0: '#2bff5a', 1: '#ff2b4a', 3: '#ffe62b', 2: '#2b8cff', 4: '#ff8a1a' };
    if (cols[b]) return `<svg class="gl-svg" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="4" fill="${cols[b]}" stroke="rgba(0,0,0,0.4)"/></svg>`;
    if (b === 9) return pill('START');
    if (b === 8) return pill(family === 'guitar' ? '★' : 'BACK');
    return pill(['', '', '', '', '', 'RB', 'LT', 'RT'][b] || '?');
  }
  if (family === 'playstation') {
    if (b === 0) return circle(`<path d="M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="${PS_COLORS.crs}" stroke-width="2.2" stroke-linecap="round"/>`);
    if (b === 1) return circle(`<circle cx="12" cy="12" r="5" fill="none" stroke="${PS_COLORS.cir}" stroke-width="2.2"/>`);
    if (b === 2) return circle(`<rect x="7.5" y="7.5" width="9" height="9" fill="none" stroke="${PS_COLORS.sqr}" stroke-width="2"/>`);
    if (b === 3) return circle(`<path d="M12 6.5l5.5 9.5h-11z" fill="none" stroke="${PS_COLORS.tri}" stroke-width="2" stroke-linejoin="round"/>`);
    return pill(['', '', '', '', 'L1', 'R1', 'L2', 'R2', 'CREATE', 'OPTIONS'][b]);
  }
  if (family === 'nintendo') {
    const L = { 0: 'B', 1: 'A', 2: 'Y', 3: 'X' };
    if (L[b]) return circle(`<text x="12" y="16.5" text-anchor="middle" font-family="Arial" font-weight="700" font-size="12" fill="#eee">${L[b]}</text>`, '#26262c');
    return pill(['', '', '', '', 'L', 'R', 'ZL', 'ZR', '−', '+'][b]);
  }
  // xbox + generic
  const L = { 0: ['A', XB_COLORS.a], 1: ['B', XB_COLORS.b], 2: ['X', XB_COLORS.x], 3: ['Y', XB_COLORS.y] };
  if (L[b]) return circle(`<text x="12" y="16.5" text-anchor="middle" font-family="Arial" font-weight="800" font-size="12" fill="${family === 'xbox' ? L[b][1] : '#eee'}">${L[b][0]}</text>`, '#15161a');
  return pill(['', '', '', '', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU'][b]);
}
