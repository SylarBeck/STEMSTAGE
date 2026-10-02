// Characters: how a profile's band member looks on stage and which part they stand at. Kept on the profile as
// p.look; the stage builds it (game/figure.js). v2 adds builds, heights, more hair, facial hair, eyewear, headwear,
// top styles, accessories, shoes, LED trim and a stage move, with some pieces unlocked through play (economy.js).
export const PARTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
export const SKINS = ['#f3d3b8', '#e0ac85', '#c68a5f', '#9a6440', '#6b4128', '#3d2518', '#8fd0c8', '#b9a6e8'];
export const HAIR_COLORS = ['#0c0c12', '#3b2414', '#8a5a2b', '#d9b36a', '#e8e1cf', '#c8322a', '#2f6fe0', '#b14cff', '#2ed24f', '#ff7ab8'];
export const OUTFITS = ['#15120e', '#ece5d3', '#df3a2c', '#f0b429', '#2447d8', '#1c7a3a', '#6b2bb0', '#3a0d1c', '#0d1c3a', '#5a5a5a', '#2fb3a8', '#ff7ab8'];
export const FINISHES = ['#d81b3a', '#1b5ed8', '#f0b429', '#ece5d3', '#15120e', '#b86a1b', '#2ed24f', '#b14cff'];
export const GLOWS = ['', '#2fd3ff', '#ff2d7a', '#3dff8a', '#ffcf3a', '#b36bff', '#ff6a1a', '#ffffff'];

export const HAIR_STYLES = ['short', 'long', 'mohawk', 'bun', 'shaved', 'spiky', 'afro', 'ponytail', 'locs', 'bald'];
export const FACIAL = ['none', 'stubble', 'beard', 'goatee', 'moustache'];
export const EYEWEAR = ['none', 'shades', 'round', 'visor', 'goggles'];
export const HEADWEAR = ['none', 'beanie', 'cap', 'cowboy', 'bandana', 'crown', 'horns', 'halo'];
export const TOPS = ['tee', 'tank', 'jacket', 'hoodie', 'coat', 'vest'];
export const EXTRAS = ['none', 'chain', 'scarf', 'spikes', 'cape', 'wings'];
export const BUILDS = ['slim', 'regular', 'broad'];
export const HEIGHTS = ['short', 'average', 'tall'];
export const MOVES = ['headbang', 'sway', 'bounce', 'power', 'spin'];

export const LABEL = {
  short: 'Short', long: 'Long', mohawk: 'Mohawk', bun: 'Bun', shaved: 'Buzz cut', spiky: 'Spiky', afro: 'Afro', ponytail: 'Ponytail', locs: 'Locs', bald: 'Bald',
  none: 'None', stubble: 'Stubble', beard: 'Beard', goatee: 'Goatee', moustache: 'Moustache',
  shades: 'Shades', round: 'Round specs', visor: 'Neon visor', goggles: 'Goggles',
  beanie: 'Beanie', cap: 'Cap', cowboy: 'Cowboy hat', bandana: 'Bandana', crown: 'Crown', horns: 'Magma horns', halo: 'Storm halo',
  tee: 'T-shirt', tank: 'Tank top', jacket: 'Leather jacket', hoodie: 'Hoodie', coat: 'Long coat', vest: 'Waistcoat',
  chain: 'Chain', scarf: 'Scarf', spikes: 'Shoulder spikes', cape: 'Cape', wings: 'Frost wings',
  slim: 'Slim', regular: 'Regular', broad: 'Broad', average: 'Average', tall: 'Tall',
  headbang: 'Headbanger', sway: 'Groover', bounce: 'Jumper', power: 'Power stance', spin: 'Showboat',
};
export const HAIR_LABEL = Object.fromEntries(HAIR_STYLES.map((h) => [h, LABEL[h]]));

/**
 * Wardrobe pieces that are earned or bought (anything not listed is free). Ids are `<field>.<value>`.
 * Boss pieces come from the five worlds (game/boss.js).
 */
export const WARDROBE_REQ = {
  'hair.locs': { level: 3 },
  'hair.afro': { cash: 250 },
  'hair.spiky': { cash: 250 },
  'facial.beard': { level: 2 },
  'eyes.goggles': { cash: 400 },
  'eyes.visor': { boss: 'conductor' },
  'head.cowboy': { cash: 500 },
  'head.crown': { ach: 'fc_expert' },
  'head.horns': { boss: 'titan' },
  'head.halo': { boss: 'thunderbird' },
  'top.coat': { level: 6, cash: 600 },
  'top.vest': { cash: 350 },
  'extra.cape': { level: 12, cash: 1500 },
  'extra.spikes': { level: 5, cash: 700 },
  'extra.wings': { boss: 'wyrm' },
  'glow.on': { boss: 'leviathan' },
  'move.spin': { level: 8 },
  'move.power': { cash: 450 },
  'skin.alien': { boss: 'conductor' },
};
const REQ_FIELD = { hair: 'hair', facial: 'facial', eyes: 'eyes', head: 'head', topStyle: 'top', extra: 'extra', move: 'move' };
/** The requirement id for one choice of one field (null = always free). */
export function wardrobeId(field, v) {
  if (field === 'glow') return v ? 'glow.on' : null;
  if (field === 'skin') return SKINS.indexOf(v) >= 6 ? 'skin.alien' : null;
  const key = REQ_FIELD[field] && `${REQ_FIELD[field]}.${v}`;
  return key && WARDROBE_REQ[key] ? key : null;
}

export const PRESETS = [
  { id: 'punk', name: 'Punk', skin: SKINS[1], hair: 'mohawk', hairColor: '#c8322a', top: '#15120e', pants: '#2447d8', finish: '#f0b429', topStyle: 'jacket', accent: '#df3a2c', extra: 'chain', move: 'bounce' },
  { id: 'metal', name: 'Metalhead', skin: SKINS[0], hair: 'long', hairColor: '#0c0c12', top: '#15120e', pants: '#15120e', finish: '#15120e', topStyle: 'tee', facial: 'beard', move: 'headbang' },
  { id: 'grunge', name: 'Grunge', skin: SKINS[2], hair: 'long', hairColor: '#8a5a2b', top: '#1c7a3a', pants: '#2447d8', finish: '#b86a1b', topStyle: 'hoodie', facial: 'stubble', move: 'sway' },
  { id: 'glam', name: 'Glam', skin: SKINS[0], hair: 'long', hairColor: '#d9b36a', top: '#b14cff', pants: '#15120e', finish: '#ece5d3', topStyle: 'vest', eyes: 'shades', move: 'power' },
  { id: 'soul', name: 'Soul', skin: SKINS[4], hair: 'afro', hairColor: '#0c0c12', top: '#f0b429', pants: '#3a0d1c', finish: '#d81b3a', topStyle: 'tee', facial: 'moustache', move: 'sway' },
  { id: 'indie', name: 'Indie', skin: SKINS[3], hair: 'bun', hairColor: '#3b2414', top: '#ece5d3', pants: '#0d1c3a', finish: '#1b5ed8', topStyle: 'tee', eyes: 'round', head: 'beanie', move: 'sway' },
  { id: 'rockabilly', name: 'Rockabilly', skin: SKINS[1], hair: 'short', hairColor: '#0c0c12', top: '#df3a2c', pants: '#15120e', finish: '#ece5d3', topStyle: 'jacket', accent: '#15120e', move: 'power' },
  { id: 'hardcore', name: 'Hardcore', skin: SKINS[5], hair: 'shaved', hairColor: '#0c0c12', top: '#5a5a5a', pants: '#15120e', finish: '#df3a2c', topStyle: 'tank', facial: 'goatee', move: 'headbang' },
  { id: 'country', name: 'Outlaw', skin: SKINS[2], hair: 'long', hairColor: '#8a5a2b', top: '#ece5d3', pants: '#0d1c3a', finish: '#b86a1b', topStyle: 'vest', accent: '#3b2414', head: 'cowboy', facial: 'beard', move: 'sway' },
  { id: 'cyber', name: 'Cyberpunk', skin: SKINS[3], hair: 'spiky', hairColor: '#ff7ab8', top: '#15120e', pants: '#15120e', finish: '#2fd3ff', topStyle: 'coat', accent: '#2fb3a8', eyes: 'visor', glow: '#2fd3ff', move: 'power' },
];

const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : fallback);
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);

/** A look from anywhere (the profile file, another player online) made safe to use. Old (v1) looks fill in defaults. */
export function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const base = PRESETS[0];
  return {
    part: pick(PARTS, l.part, 'guitar'),
    preset: PRESETS.some((p) => p.id === l.preset) ? l.preset : null,
    skin: hex(l.skin, base.skin), build: pick(BUILDS, l.build, 'regular'), height: pick(HEIGHTS, l.height, 'average'),
    hair: pick(HAIR_STYLES, l.hair, 'short'), hairColor: hex(l.hairColor, base.hairColor),
    facial: pick(FACIAL, l.facial, 'none'), eyes: pick(EYEWEAR, l.eyes, 'none'), head: pick(HEADWEAR, l.head, 'none'),
    topStyle: pick(TOPS, l.topStyle, 'tee'), top: hex(l.top, base.top), accent: hex(l.accent, '#15120e'),
    pants: hex(l.pants, base.pants), shoes: hex(l.shoes, '#15120e'),
    extra: pick(EXTRAS, l.extra, 'none'), glow: l.glow ? hex(l.glow, '') : '',
    move: pick(MOVES, l.move, 'headbang'), finish: hex(l.finish, base.finish),
  };
}

/** A preset as a full look (keeping the part the player stands at). */
export const fromPreset = (id, part = 'guitar') => {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return cleanLook({ ...p, preset: p.id, part });
};

/** The fields of a look whose current choice the profile hasn't unlocked (online: other players' looks are never checked). */
export function lockedPieces(look, isUnlocked) {
  const out = [];
  for (const [field, v] of Object.entries(look || {})) {
    const id = wardrobeId(field, v);
    if (id && !isUnlocked(id, WARDROBE_REQ[id])) out.push(field);
  }
  return out;
}
