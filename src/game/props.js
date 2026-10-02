// The stage creator's parts (v2): backdrops, floors, lighting rigs, props for the wings / upstage / downstage /
// overhead slots, atmosphere effects, crowd sizes and colour schemes. Each item has a requirement
// (profile/economy.js); boss trophies come from the five world bosses. game/stagecraft.js puts a layout together.
import { THREE, V, rand, particleField, glow, std, canvasTex } from './worlds/common.js';

export const SLOTS = [
  { id: 'base', name: 'Venue size', icon: 'building' },
  { id: 'backdrop', name: 'Backdrop', icon: 'panorama' },
  { id: 'floor', name: 'Floor', icon: 'border-all' },
  { id: 'rig', name: 'Lights', icon: 'lightbulb' },
  { id: 'wingL', name: 'Left wing', icon: 'arrow-left' },
  { id: 'wingR', name: 'Right wing', icon: 'arrow-right' },
  { id: 'upstage', name: 'Upstage', icon: 'arrow-up' },
  { id: 'downstage', name: 'Stage front', icon: 'arrow-down' },
  { id: 'overhead', name: 'Overhead', icon: 'cloud' },
  { id: 'fx', name: 'Atmosphere', icon: 'wand-sparkles' },
  { id: 'crowd', name: 'Crowd', icon: 'people-group' },
  { id: 'gels', name: 'Colours', icon: 'palette' },
];

const TROPHIES = { leviathan: 'Leviathan skull', conductor: 'Void eye monolith', titan: 'Titan fist', wyrm: 'Wyrm horn arch', thunderbird: 'Thunderbird totem' };

/** Every choice per slot: [id, name, icon, requirement] */
export const ITEMS = {
  base: [['club', 'Club', 'house', {}], ['theater', 'Theater', 'masks-theater', {}], ['arena', 'Arena', 'building', {}], ['stadium', 'Stadium', 'city', { level: 6 }]],
  backdrop: [['led', 'LED tunnel', 'tv', {}], ['brick', 'Bare brick', 'border-none', {}], ['curtain', 'Velvet curtain', 'masks-theater', {}], ['stars', 'Starfield', 'star', { cash: 300 }],
    ['sunset', 'Synthwave sunset', 'sun', { cash: 400 }], ['ocean', 'Ocean waves', 'water', { cash: 400 }], ['matrix', 'Code rain', 'code', { level: 5, cash: 500 }], ['aurora', 'Aurora', 'wind', { boss: 'wyrm' }], ['lava', 'Lava lamp', 'fire', { cash: 500 }]],
  floor: [['gloss', 'Black gloss', 'square', {}], ['checker', 'Checkerboard', 'chess-board', { cash: 200 }], ['grid', 'Neon grid', 'border-all', { cash: 400 }], ['wood', 'Wood stage', 'tree', { cash: 250 }], ['marble', 'Marble', 'gem', { level: 7, cash: 600 }], ['chrome', 'Chrome', 'circle-half-stroke', { cash: 700 }]],
  rig: [['truss', 'Truss + movers', 'lightbulb', {}], ['minimal', 'A few spots', 'lightbulb', {}], ['lasers', 'Laser show', 'bolt', { cash: 800 }], ['disco', 'Disco', 'circle-dot', { cash: 500 }], ['none', 'House lights', 'power-off', {}]],
  wingL: null, wingR: null, // = WING
  upstage: null,
  downstage: [['none', 'Nothing', 'ban', {}], ['flames', 'Flame cannons', 'fire', { cash: 600 }], ['co2', 'CO₂ jets', 'wind', { cash: 600 }], ['lava', 'Lava lamps', 'flask', { cash: 500 }], ['pillar', 'LED pillars', 'grip-lines-vertical', {}], ['crystal', 'Crystals', 'gem', { cash: 700 }]],
  overhead: [['none', 'Nothing', 'ban', {}], ['discoball', 'Disco ball', 'circle-dot', { cash: 500 }], ['planets', 'Hanging planets', 'earth-americas', { cash: 800 }], ['chandelier', 'Chandelier', 'lightbulb', { cash: 700 }], ['jellies', 'Jellyfish lanterns', 'fish', { boss: 'leviathan' }], ['halo', 'Light halo', 'ring', { level: 10, cash: 1200 }]],
  fx: [['none', 'Clear air', 'ban', {}], ['haze', 'Dust + haze', 'smog', {}], ['bubbles', 'Bubbles', 'circle', { cash: 300 }], ['snow', 'Snow', 'snowflake', { cash: 300 }], ['embers', 'Embers', 'fire', { cash: 300 }], ['fireflies', 'Fireflies', 'bug', { cash: 400 }], ['confetti', 'Confetti rain', 'certificate', { cash: 500 }]],
  crowd: [['packed', 'Packed', 'people-group', {}], ['half', 'Half full', 'people-line', {}], ['small', 'Intimate', 'user-group', {}], ['empty', 'Empty room', 'user', {}]],
  gels: [['classic', 'Classic amber', 'sun', {}], ['neon', 'Neon', 'bolt', {}], ['ice', 'Ice', 'snowflake', {}], ['fire', 'Fire', 'fire', {}], ['toxic', 'Toxic', 'biohazard', { cash: 200 }], ['royal', 'Royal', 'crown', { cash: 200 }], ['vapor', 'Vaporwave', 'cloud-sun', { cash: 200 }]],
};
const WING = [['none', 'Nothing', 'ban', {}], ['stack', 'Speaker stack', 'volume-high', {}], ['ampwall', 'Amp wall', 'border-all', {}], ['pillar', 'LED pillar', 'grip-lines-vertical', {}],
  ['neon', 'Neon sign', 'signature', { cash: 300 }], ['palms', 'Palm trees', 'tree', { cash: 400 }], ['lava', 'Lava lamps', 'flask', { cash: 500 }], ['crystal', 'Crystals', 'gem', { cash: 700 }],
  ['tank', 'Aquarium tank', 'fish', { cash: 800 }], ['statue', 'Stone head', 'monument', { cash: 900 }], ['tesla', 'Tesla coil', 'bolt', { level: 6, cash: 900 }], ['skull', 'Giant skull', 'skull', { level: 8, cash: 1200 }], ['duck', 'Giant duck', 'kiwi-bird', { cash: 1000 }],
  ...Object.entries(TROPHIES).map(([b, n]) => [`trophy-${b}`, n, 'trophy', { boss: b }])];
ITEMS.wingL = WING; ITEMS.wingR = WING; ITEMS.upstage = WING;

export const GEL_SETS = {
  classic: [[0xff9a2e, 0xd7261c], [0xffd9a0, 0x2447d8], [0xffc233, 0x3050e0]],
  neon: [[0xff2d7a, 0x29e0ff], [0xb14cff, 0x3dff8a], [0xffe14d, 0xff2d7a]],
  ice: [[0x9fe8ff, 0xffffff], [0x5aa0ff, 0xb36bff], [0xdff6ff, 0x2fd3ff]],
  fire: [[0xff3d00, 0xffc233], [0xd7261c, 0xff6a1a], [0xffe14d, 0xb81d3a]],
  toxic: [[0x3dff8a, 0xb6ff2d], [0x1cc8a0, 0xffe14d], [0x6aff2d, 0x9b5cff]],
  royal: [[0x6b2bb0, 0xf0b429], [0x2447d8, 0xffd9a0], [0xb81d3a, 0xf0b429]],
  vapor: [[0xff7ab8, 0x29e0ff], [0xb36bff, 0xff9ad0], [0x6affd0, 0xff7ab8]],
};

export const DEFAULT_LAYOUT = { base: 'arena', backdrop: 'led', floor: 'gloss', rig: 'truss', wingL: 'stack', wingR: 'stack', upstage: 'none', downstage: 'flames', overhead: 'none', fx: 'haze', crowd: 'packed', gels: 'classic' };
export const itemId = (slot, v) => `prop.${slot === 'wingL' || slot === 'wingR' || slot === 'upstage' ? 'wing' : slot}.${v}`;
export const itemOf = (slot, v) => ITEMS[slot]?.find(([id]) => id === v) || null;

/** A layout from anywhere, made safe. */
export function cleanLayout(l) {
  const out = {};
  for (const s of SLOTS) out[s.id] = itemOf(s.id, l?.[s.id]) ? l[s.id] : DEFAULT_LAYOUT[s.id];
  return out;
}

// ---------------------------------------------------------------- props
const metal = () => std(0x2a2a33, 0.4, 0.9);
const cab = () => std(0x111016, 0.7, 0.2);

/** Build one prop. → { obj, update?(dt, t, f, pulse), burst? (where effects come from) } */
export function buildProp(id) {
  const g = new THREE.Group();
  let update = null;
  if (id === 'stack' || id === 'ampwall') {
    const n = id === 'stack' ? 4 : 6;
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(id === 'stack' ? 2.4 : 1.4, 1.3, 1.4), cab());
      c.position.set(id === 'stack' ? 0 : (k % 3 - 1) * 1.45, 0.65 + (id === 'stack' ? k : Math.floor(k / 3)) * 1.32, 0);
      const gr = new THREE.Mesh(new THREE.PlaneGeometry(id === 'stack' ? 2.1 : 1.2, 1.05), std(0x040306, 1));
      gr.position.z = 0.71; c.add(gr);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.02), glow(0xff4030, 2)); led.position.set(0.5, 0.5, 0.72); c.add(led);
      g.add(c);
    }
  } else if (id === 'pillar') {
    const m = glow(0xffffff, 1);
    for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8, 0.2), m); p.position.set((k - 1) * 0.9, 4, k * 0.4); g.add(p); }
    update = (dt, t, f, pulse, cols) => m.color.copy(cols[1]).multiplyScalar(0.6 + pulse * 1.6);
  } else if (id === 'neon') {
    const tex = canvasTex(512, 256, (c, w, h) => { c.font = '900 150px Anton, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#ff2d7a'; c.shadowBlur = 24; c.strokeStyle = '#ffd1e4'; c.lineWidth = 9; c.strokeText('ROCK', w / 2, h / 2 + 6); });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(2.4, 1, 1.6), depthWrite: false });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), mat); s.position.y = 4.5; g.add(s);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.6, 0.1), std(0x111016, 0.6)); frame.position.set(0, 4.5, -0.1); g.add(frame);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 6).translate(0, 1.6, -0.15), metal()));
    update = (dt, t) => mat.color.setRGB(2.4, 1, 1.6).multiplyScalar(Math.sin(t * 17) > 0.97 ? 0.3 : 1);
  } else if (id === 'palms') {
    const trunk = std(0x6a4a2a, 0.9), leaf = std(0x2a7a3a, 0.8, 0, { side: THREE.DoubleSide });
    for (let k = 0; k < 2; k++) {
      const p = new THREE.Group(); p.position.set(k * 1.6 - 0.8, 0, k * 0.8); p.rotation.z = (k ? -1 : 1) * 0.12;
      for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.015, 0.26 - i * 0.015, 1, 8), trunk); s.position.y = 0.5 + i; s.rotation.z = i * 0.02; p.add(s); }
      for (let i = 0; i < 7; i++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 3.2, 1, 4).translate(0, 1.6, 0), leaf); l.position.y = 7; l.rotation.set(1.1, (i / 7) * Math.PI * 2, 0, 'YXZ'); p.add(l); }
      g.add(p);
    }
    update = (dt, t) => { g.children.forEach((p, i) => { p.rotation.z = (i ? -1 : 1) * 0.12 + Math.sin(t * 0.8 + i) * 0.03; }); };
  } else if (id === 'lava') {
    const blobs = [];
    for (let k = 0; k < 3; k++) {
      const l = new THREE.Group(); l.position.set((k - 1) * 1.1, 0, (k % 2) * 0.5);
      l.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 16).translate(0, 0.3, 0), metal()));
      l.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 2.4, 20, 1, true).translate(0, 1.8, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.2, 0.4), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })));
      for (let j = 0; j < 3; j++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.16 + j * 0.03, 12, 8), glow([0xff6a1a, 0xff2d7a, 0xb36bff][k], 2)); b.userData.ph = Math.random() * 6; l.add(b); blobs.push(b); }
      g.add(l);
    }
    update = (dt, t) => { for (const b of blobs) { b.position.y = 1.8 + Math.sin(t * 0.5 + b.userData.ph) * 0.9; b.scale.y = 1.2 + Math.sin(t * 1.3 + b.userData.ph) * 0.3; } };
  } else if (id === 'crystal') {
    const m = std(0x9fd8ff, 0.08, 0.2, { emissive: 0x3a7adf, emissiveIntensity: 1, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 7; k++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), m); c.scale.set(0.7, rand(2, 4.5), 0.7); c.position.set(rand(-1.4, 1.4), 1.6, rand(-0.8, 0.8)); c.rotation.set(rand(-0.4, 0.4), rand(0, 6), rand(-0.4, 0.4)); g.add(c); }
    update = (dt, t, f, pulse) => { m.emissiveIntensity = 0.6 + pulse * 1.6; };
  } else if (id === 'tank') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 1.4), new THREE.MeshStandardMaterial({ color: 0x2fa8d8, transparent: true, opacity: 0.35, roughness: 0.05, emissive: 0x0a3a5a, depthWrite: false }));
    glass.position.y = 2.2; g.add(glass);
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 1.6), cab()); base.position.y = 0.45; g.add(base);
    const fish = [];
    for (let k = 0; k < 8; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow([0xffd23a, 0x3ab0ff, 0xff7a2a][k % 3], 1.5)); f.scale.set(1.8, 0.8, 0.5); f.userData.ph = Math.random() * 6; g.add(f); fish.push(f); }
    update = (dt, t) => { for (const f of fish) { const a = t * 0.7 + f.userData.ph; f.position.set(Math.sin(a) * 1.2, 2.1 + Math.sin(a * 2.3) * 0.7, Math.cos(a) * 0.4); f.rotation.y = -a; } };
  } else if (id === 'statue') {
    const stone = std(0x8a8478, 0.95, 0, { flatShading: true });
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), stone); head.scale.set(1, 1.35, 1.1); head.position.y = 3.6; g.add(head);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.8), stone); nose.position.set(0, 3.5, 1.5); g.add(nose);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 0.6), stone); brow.position.set(0, 4.3, 1.3); g.add(brow);
    const eyes = glow(0x29e0ff, 2.5);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), eyes); e.position.set(s * 0.6, 4.0, 1.55); g.add(e); }
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), stone); plinth.position.y = 0.8; g.add(plinth);
    update = (dt, t, f, pulse) => eyes.color.setRGB(0.4, 2.2, 2.6).multiplyScalar(0.5 + pulse * 1.5);
  } else if (id === 'tesla') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 16).translate(0, 2, 0), std(0x6a3a1a, 0.4, 0.8)));
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.35, 12, 24), std(0xc9ccd6, 0.2, 1)); coil.rotation.x = Math.PI / 2; coil.position.y = 4.3; g.add(coil);
    const arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color(2, 2.2, 3.4) });
    const arcs = Array.from({ length: 4 }, () => { const l = new THREE.Line(new THREE.BufferGeometry(), arcMat); g.add(l); return l; });
    update = (dt, t, f, pulse) => {
      for (const l of arcs) {
        if (Math.random() > 0.35 + pulse * 0.5) { l.visible = false; continue; }
        l.visible = true;
        const a = Math.random() * Math.PI * 2, pts = [];
        for (let k = 0; k <= 8; k++) pts.push(V(Math.cos(a) * (0.9 + k * 0.35) + rand(-0.2, 0.2), 4.3 + rand(-0.3, 0.3) - k * 0.1, Math.sin(a) * (0.9 + k * 0.35) + rand(-0.2, 0.2)));
        l.geometry.dispose(); l.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
    };
  } else if (id === 'skull') {
    const bone = std(0xe8e1cf, 0.7);
    const sk = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 16), bone); sk.scale.set(1, 0.95, 1.1); sk.position.y = 3.2; g.add(sk);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 2), bone); jaw.position.set(0, 1.4, 0.6); g.add(jaw);
    const dark = new THREE.MeshBasicMaterial({ color: 0x000000 }), fire = glow(0xff4a10, 3);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), dark); e.position.set(s * 0.8, 3.3, 1.9); g.add(e); const f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), fire); f.position.set(s * 0.8, 3.3, 2.15); g.add(f); }
    for (let k = 0; k < 6; k++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.2), bone); t.position.set(-0.8 + k * 0.32, 2.0, 1.75); g.add(t); }
    update = (dt, t, f, pulse) => fire.color.setRGB(3, 1, 0.2).multiplyScalar(0.6 + pulse * 1.2);
  } else if (id === 'duck') {
    const yellow = std(0xffd21f, 0.35);
    const body = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), yellow); body.scale.set(1.2, 0.85, 1); body.position.y = 2.1; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 14), yellow); head.position.set(0.6, 4.6, 1.2); g.add(head);
    const beak = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), std(0xff7a1a, 0.4)); beak.scale.set(1, 0.4, 1.3); beak.position.set(0.8, 4.4, 2.5); g.add(beak);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), std(0x111111, 0.2)); e.position.set(0.6 + s * 0.55, 5.0, 2.35); g.add(e); }
    update = (dt, t, f, pulse) => { g.rotation.z = Math.sin(t * 1.5) * 0.05; g.position.y = (g.userData.y ??= g.position.y) + pulse * 0.15; };
  } else if (id.startsWith('trophy-')) {
    const boss = id.slice(7);
    const gold = std(0xf0b429, 0.3, 1);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 1.4, 8).translate(0, 0.7, 0), std(0x15120e, 0.4, 0.5)); g.add(plinth);
    const col = { leviathan: 0x2fd3ff, conductor: 0xb36bff, titan: 0xff6a1a, wyrm: 0x9fe8ff, thunderbird: 0xffe14d }[boss];
    const gm = glow(col, 2.5);
    if (boss === 'leviathan') { const s = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), gold); s.scale.set(1.8, 0.9, 1); s.position.y = 2.4; g.add(s); for (const x of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), gm); e.position.set(1.5, 2.6, x * 0.6); g.add(e); } }
    else if (boss === 'conductor') { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 0.5), gold); m.position.y = 3.4; g.add(m); const e = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), gm); e.position.set(0, 4, 0.3); g.add(e); }
    else if (boss === 'titan') { const fist = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), gold); fist.position.y = 2.6; g.add(fist); const c = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), gm); c.position.set(0, 2.6, 1); g.add(c); }
    else if (boss === 'wyrm') { const arch = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.18, 8, 24, Math.PI), gold); arch.position.y = 1.4; g.add(arch); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 6), gm); tip.position.set(0, 3.2, 0); g.add(tip); }
    else { const tot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 3.6, 8).translate(0, 3.2, 0), gold); g.add(tot); for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.4, 4), gold); w.rotation.z = s * 1.2; w.position.set(s * 1.4, 4.4, 0); g.add(w); } const e = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), gm); e.position.set(0, 4.6, 0.5); g.add(e); }
    update = (dt, t) => { g.rotation.y = Math.sin(t * 0.5) * 0.3; };
  } else if (id === 'flames' || id === 'co2') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8).translate(0, 0.25, 0), metal()); g.add(base);
    const jet = particleField({ n: 160, box: [-0.3, 0.3, 0.5, 6, -0.3, 0.3], kind: 'rise', speed: id === 'flames' ? 7 : 9, size: id === 'flames' ? 1.1 : 1.3, colors: id === 'flames' ? [0xff6a1a, 0xffc233, 0xff3d00] : [0xdfe6ff, 0xffffff], additive: id === 'flames', wobble: 0.25 });
    jet.pts.visible = false; g.add(jet.pts);
    let on = 0;
    update = (dt, t, f, pulse, cols, beat) => { jet.u.uTime.value = t; if (f.beatHit && (Math.floor(beat) % 8 === 0 || f.od)) on = 0.6; on -= dt; jet.pts.visible = on > 0; };
  }
  return { obj: g, update };
}

/** An overhead piece (hangs at the top of the stage). */
export function buildOverhead(id) {
  const g = new THREE.Group();
  let update = null;
  if (id === 'discoball') {
    const tex = canvasTex(256, 128, (c, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const v = 120 + Math.random() * 135; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, 7, 7); } });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.4, 32, 20), new THREE.MeshStandardMaterial({ map: tex, metalness: 1, roughness: 0.15, emissive: 0x333333, emissiveMap: tex }));
    g.add(ball);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4).translate(0, 3.4, 0), metal()));
    const spots = particleField({ n: 220, box: [-20, 20, 0.2, 10, -8, 20], kind: 'twinkle', speed: 0, size: 0.35, colors: [0xffffff, 0xffd9a0, 0x9fe8ff], wobble: 4 });
    g.add(spots.pts); spots.pts.position.y = -9;
    update = (dt, t) => { ball.rotation.y += dt * 0.6; spots.u.uTime.value = t; };
  } else if (id === 'planets') {
    const cols = [0xff9a2e, 0x2fd3ff, 0xb36bff, 0x3dff8a, 0xff2d7a];
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.6 + k * 0.25, 24, 16), std(cols[k], 0.6, 0.1, { emissive: cols[k], emissiveIntensity: 0.25 }));
      p.position.set((k - 2) * 4, -1 - (k % 2) * 1.5, (k % 3) - 1);
      if (k === 2) { const r = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 48), new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })); r.rotation.x = 1.2; p.add(r); }
      g.add(p);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 4, 3).translate(p.position.x, p.position.y + 2, p.position.z), metal()));
    }
    update = (dt, t) => { g.children.forEach((c, i) => { if (c.geometry?.type === 'SphereGeometry') c.rotation.y = t * (0.2 + i * 0.05); }); g.rotation.y = Math.sin(t * 0.1) * 0.2; };
  } else if (id === 'chandelier') {
    const gold = std(0xf0b429, 0.3, 1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 8, 48), gold); ring.rotation.x = Math.PI / 2; g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.1, 8, 36), gold); ring2.rotation.x = Math.PI / 2; ring2.position.y = -0.8; g.add(ring2);
    const flame = glow(0xffd9a0, 3);
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r = k % 2 ? 2.6 : 1.6, y = k % 2 ? 0.25 : -0.55; const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), flame); c.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.add(c); }
    for (let k = 0; k < 24; k++) { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), std(0xdff6ff, 0.05, 0.3, { emissive: 0x4a6a8a })); const a = (k / 24) * Math.PI * 2; cr.position.set(Math.cos(a) * 2.4, -0.6 - (k % 3) * 0.3, Math.sin(a) * 2.4); g.add(cr); }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4, 4).translate(0, 2, 0), gold));
    update = (dt, t) => { g.rotation.y = t * 0.1; flame.color.setRGB(3, 2.5, 1.6).multiplyScalar(0.85 + Math.random() * 0.15); };
  } else if (id === 'jellies') {
    const js = [];
    for (let k = 0; k < 7; k++) {
      const col = new THREE.Color([0x6affd0, 0xff9ad0, 0xb48cff, 0x3ab0ff][k % 4]);
      const j = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      j.position.set((k - 3) * 3, -1 - (k % 2) * 1.4, (k % 3) - 1); j.userData.ph = k;
      const ten = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.1, 2.6, 10, 6, true).translate(0, -1.3, 0), new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      j.add(ten); g.add(j); js.push(j);
    }
    update = (dt, t, f, pulse) => { for (const j of js) { j.position.y = -1 - (j.userData.ph % 2) * 1.4 + Math.sin(t * 0.6 + j.userData.ph) * 0.5; j.scale.set(1 + pulse * 0.12, 1 - pulse * 0.15, 1 + pulse * 0.12); } };
  } else if (id === 'halo') {
    const m = glow(0xffffff, 2);
    for (let k = 0; k < 3; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(5 + k * 1.5, 0.08, 6, 96), m); r.rotation.x = Math.PI / 2; r.position.y = -k * 0.6; g.add(r); }
    update = (dt, t, f, pulse, cols) => { m.color.copy(cols[0]).multiplyScalar(1.2 + pulse * 2); g.children.forEach((r, i) => { r.rotation.z = t * (0.2 + i * 0.1) * (i % 2 ? -1 : 1); r.rotation.x = Math.PI / 2 + Math.sin(t * 0.5 + i) * 0.15; }); };
  }
  return { obj: g, update };
}

/** The atmosphere: a particle field (or null for clear air). */
export function buildFx(id) {
  const box = [-28, 28, 0, 14, -8, 24];
  if (id === 'none') return null;
  if (id === 'haze') return particleField({ n: 500, box, kind: 'float', speed: 0.1, size: 0.05, color: 0x7a6a5a, wobble: 1 });
  if (id === 'bubbles') return particleField({ n: 400, box, kind: 'rise', speed: 1.2, size: 0.18, color: 0xbfefff, ring: true, wobble: 0.3 });
  if (id === 'snow') return particleField({ n: 900, box, kind: 'fall', speed: 1.1, size: 0.08, color: 0xffffff, wobble: 1.2 });
  if (id === 'embers') return particleField({ n: 600, box, kind: 'rise', speed: 1.6, size: 0.1, colors: [0xff6a1a, 0xffc233], wobble: 1.4 });
  if (id === 'fireflies') return particleField({ n: 300, box, kind: 'float', speed: 0.3, size: 0.14, colors: [0xd4ff6a, 0xffe14d], wobble: 2 });
  if (id === 'confetti') return particleField({ n: 700, box, kind: 'fall', speed: 1.6, size: 0.12, colors: [0xff2d7a, 0x29e0ff, 0xffe14d, 0x3dff8a, 0xffffff], additive: false, wobble: 1.6 });
  return null;
}

/** Floors: a texture set for the stage floor. → { map, emissiveMap?, roughness, metalness, color } */
const floorCache = {};
export function floorLook(id) {
  if (floorCache[id]) return floorCache[id];
  const rep = [40, 40];
  let look;
  if (id === 'checker') look = { map: canvasTex(128, 128, (c) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = (x + y) % 2 ? '#e8e1cf' : '#111'; c.fillRect(x * 64, y * 64, 64, 64); } }, rep), roughness: 0.3, metalness: 0.2 };
  else if (id === 'grid') { const t = canvasTex(128, 128, (c) => { c.fillStyle = '#05030a'; c.fillRect(0, 0, 128, 128); c.strokeStyle = '#ff2d7a'; c.lineWidth = 4; c.strokeRect(0, 0, 128, 128); }, rep); look = { map: t, emissiveMap: t, emissive: 0xffffff, roughness: 0.25, metalness: 0.5 }; }
  else if (id === 'wood') look = { map: canvasTex(256, 256, (c) => { for (let y = 0; y < 256; y += 32) { c.fillStyle = `hsl(28 40% ${20 + Math.random() * 10}%)`; c.fillRect(0, y, 256, 31); for (let k = 0; k < 20; k++) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(Math.random() * 256, y + Math.random() * 30, 40, 1); } } }, [24, 24]), roughness: 0.6, metalness: 0 };
  else if (id === 'marble') look = { map: canvasTex(256, 256, (c) => { c.fillStyle = '#e8e4dc'; c.fillRect(0, 0, 256, 256); c.strokeStyle = 'rgba(80,80,90,0.35)'; for (let k = 0; k < 14; k++) { c.lineWidth = Math.random() * 2; c.beginPath(); c.moveTo(Math.random() * 256, 0); c.bezierCurveTo(Math.random() * 256, 90, Math.random() * 256, 170, Math.random() * 256, 256); c.stroke(); } }, [16, 16]), roughness: 0.15, metalness: 0.1 };
  else if (id === 'chrome') look = { map: null, color: 0x9a9aa8, roughness: 0.08, metalness: 1 };
  else look = { map: null, color: 0x07060c, roughness: 0.32, metalness: 0.65 };
  floorCache[id] = look;
  return look;
}
