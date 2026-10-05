// Characters: how a profile's band member looks on stage and which part they stand at. Kept on the profile as
// p.look; the stage builds it (game/figure.js). The people, hair and clothes are MakeHuman (MPFB) models baked by
// tools/mpfb/build_band.py; each choice here names a piece in those models. Some pieces are unlocked through play
// (economy.js).
export const PARTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
export const SKINS = ['#f3d3b8', '#e0ac85', '#c68a5f', '#9a6440', '#6b4128', '#3d2518', '#8fd0c8', '#b9a6e8'];
export const HAIR_COLORS = ['#0c0c12', '#3b2414', '#8a5a2b', '#d9b36a', '#e8e1cf', '#c8322a', '#2f6fe0', '#b14cff', '#2ed24f', '#ff7ab8'];
export const OUTFITS = ['#15120e', '#ece5d3', '#df3a2c', '#f0b429', '#2447d8', '#1c7a3a', '#6b2bb0', '#3a0d1c', '#0d1c3a', '#5a5a5a', '#2fb3a8', '#ff7ab8'];
export const FINISHES = ['#d81b3a', '#1b5ed8', '#f0b429', '#ece5d3', '#15120e', '#b86a1b', '#2ed24f', '#b14cff'];
export const GLOWS = ['', '#2fd3ff', '#ff2d7a', '#3dff8a', '#ffcf3a', '#b36bff', '#ff6a1a', '#ffffff'];

export const BODIES = ['m', 'f'];
export const FACES = ['mix', 'faceA', 'faceB', 'faceC'];
export const HAIR_STYLES = ['short', 'spiky', 'fringe', 'slick', 'long', 'bob', 'lob', 'ponytail', 'locs', 'curls', 'bald'];
// hair styles from earlier builds, as their nearest style now
const OLD_HAIR = { mohawk: 'spiky', afro: 'curls', bun: 'ponytail', shaved: 'slick' };
export const FACIAL = ['none', 'stubble', 'beard', 'goatee', 'moustache'];
export const EYEWEAR = ['none', 'shades', 'round', 'visor', 'goggles'];
export const HEADWEAR = ['none', 'beanie', 'cap', 'fedora', 'cowboy', 'bandana', 'crown', 'horns', 'halo'];
export const TOPS = ['tee', 'crop', 'longsleeve', 'shirt', 'blouse', 'jacket', 'coat'];
export const LEGS = ['jeans', 'slacks', 'skirt', 'overalls'];
// pieces from earlier builds, as their nearest piece now
const OLD_TOP = { logo: 'tee', hoodie: 'longsleeve', flannel: 'shirt', tank: 'tee', vest: 'jacket' };
const OLD_LEGS = { ripped: 'jeans', shorts: 'jeans', leggings: 'jeans' };
export const KICKS = ['sneakers', 'runners', 'boots', 'dress', 'brogues', 'hikers'];
export const EXTRAS = ['none', 'chain', 'scarf', 'spikes', 'cape', 'wings'];
export const BUILDS = ['slim', 'regular', 'broad'];
export const HEIGHTS = ['short', 'average', 'tall'];
export const MOVES = ['headbang', 'sway', 'bounce', 'power', 'spin'];

export const LABEL = {
  m: 'Body A', f: 'Body B', mix: 'Face 1', faceA: 'Face 2', faceB: 'Face 3', faceC: 'Face 4',
  short: 'Short', long: 'Long', spiky: 'Messy', ponytail: 'Ponytail', locs: 'Braid', bald: 'Bald',
  fringe: 'Side fringe', slick: 'Slicked back', bob: 'Bob', lob: 'Platinum bob', curls: 'Curls',
  none: 'None', stubble: 'Stubble', beard: 'Beard', goatee: 'Goatee', moustache: 'Moustache',
  shades: 'Shades', round: 'Round specs', visor: 'Neon visor', goggles: 'Goggles',
  beanie: 'Beanie', cap: 'Cap', fedora: 'Fedora', cowboy: 'Cowboy hat', bandana: 'Bandana', crown: 'Crown', horns: 'Magma horns', halo: 'Storm halo',
  tee: 'T-shirt', jacket: 'Jacket', coat: 'Suit jacket',
  crop: 'Sport top', longsleeve: 'Long sleeve', shirt: 'Pinstripe shirt', blouse: 'Blouse',
  jeans: 'Jeans', slacks: 'Suit trousers', skirt: 'Skirt', overalls: 'Overalls',
  sneakers: 'Sneakers', runners: 'Runners', boots: 'Boots', dress: 'Dress shoes', brogues: 'Brogues', hikers: 'Hikers',
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
  'hair.curls': { cash: 250 },
  'hair.lob': { level: 4 },
  'facial.beard': { level: 2 },
  'eyes.goggles': { cash: 400 },
  'eyes.visor': { boss: 'conductor' },
  'head.cowboy': { cash: 500 },
  'head.fedora': { cash: 300 },
  'head.crown': { ach: 'fc_expert' },
  'head.horns': { boss: 'titan' },
  'head.halo': { boss: 'thunderbird' },
  'top.coat': { level: 6, cash: 600 },
  'top.blouse': { cash: 200 },
  'legs.overalls': { level: 7 },
  'kicks.boots': { cash: 400 },
  'extra.cape': { level: 12, cash: 1500 },
  'extra.spikes': { level: 5, cash: 700 },
  'extra.wings': { boss: 'wyrm' },
  'glow.on': { boss: 'leviathan' },
  'move.spin': { level: 8 },
  'move.power': { cash: 450 },
  'skin.alien': { boss: 'conductor' },
};
const REQ_FIELD = { hair: 'hair', facial: 'facial', eyes: 'eyes', head: 'head', topStyle: 'top', legs: 'legs', kicks: 'kicks', extra: 'extra', move: 'move' };
/** The requirement id for one choice of one field (null = always free). */
export function wardrobeId(field, v) {
  if (field === 'glow') return v ? 'glow.on' : null;
  if (field === 'skin') return SKINS.indexOf(v) >= 6 ? 'skin.alien' : null;
  const key = REQ_FIELD[field] && `${REQ_FIELD[field]}.${v}`;
  return key && WARDROBE_REQ[key] ? key : null;
}

export const PRESETS = [
  { id: 'punk', name: 'Punk', body: 'm', skin: SKINS[1], hair: 'spiky', hairColor: '#c8322a', top: '#15120e', pants: '#2447d8', legs: 'jeans', kicks: 'boots', finish: '#f0b429', topStyle: 'jacket', accent: '#df3a2c', extra: 'chain', move: 'bounce' },
  { id: 'metal', name: 'Metalhead', body: 'm', skin: SKINS[0], hair: 'long', hairColor: '#0c0c12', top: '#15120e', pants: '#15120e', kicks: 'boots', finish: '#15120e', topStyle: 'tee', facial: 'beard', move: 'headbang' },
  { id: 'grunge', name: 'Grunge', body: 'm', skin: SKINS[2], hair: 'long', hairColor: '#8a5a2b', top: '#1c7a3a', pants: '#2447d8', legs: 'jeans', kicks: 'hikers', finish: '#b86a1b', topStyle: 'shirt', facial: 'stubble', move: 'sway' },
  { id: 'glam', name: 'Glam', body: 'f', skin: SKINS[0], hair: 'lob', hairColor: '#d9b36a', top: '#b14cff', pants: '#15120e', legs: 'skirt', kicks: 'boots', finish: '#ece5d3', topStyle: 'blouse', eyes: 'shades', move: 'power' },
  { id: 'soul', name: 'Soul', body: 'm', face: 'faceA', skin: SKINS[4], hair: 'curls', hairColor: '#0c0c12', top: '#f0b429', pants: '#3a0d1c', legs: 'slacks', kicks: 'dress', finish: '#d81b3a', topStyle: 'tee', facial: 'moustache', move: 'sway' },
  { id: 'indie', name: 'Indie', body: 'f', skin: SKINS[3], hair: 'bob', hairColor: '#3b2414', top: '#ece5d3', pants: '#0d1c3a', legs: 'skirt', kicks: 'sneakers', finish: '#1b5ed8', topStyle: 'blouse', eyes: 'round', head: 'beanie', move: 'sway' },
  { id: 'rockabilly', name: 'Rockabilly', body: 'm', skin: SKINS[1], hair: 'slick', hairColor: '#0c0c12', top: '#df3a2c', pants: '#15120e', kicks: 'brogues', finish: '#ece5d3', topStyle: 'jacket', accent: '#15120e', move: 'power' },
  { id: 'hardcore', name: 'Hardcore', body: 'm', skin: SKINS[5], hair: 'slick', hairColor: '#0c0c12', top: '#5a5a5a', pants: '#15120e', legs: 'overalls', kicks: 'runners', finish: '#df3a2c', topStyle: 'tee', facial: 'goatee', move: 'headbang' },
  { id: 'country', name: 'Outlaw', body: 'm', skin: SKINS[2], hair: 'long', hairColor: '#8a5a2b', top: '#ece5d3', pants: '#0d1c3a', kicks: 'boots', finish: '#b86a1b', topStyle: 'shirt', accent: '#3b2414', head: 'cowboy', facial: 'beard', move: 'sway' },
  { id: 'cyber', name: 'Cyberpunk', body: 'f', face: 'faceB', skin: SKINS[3], hair: 'ponytail', hairColor: '#ff7ab8', top: '#15120e', pants: '#15120e', legs: 'slacks', kicks: 'runners', finish: '#2fd3ff', topStyle: 'crop', accent: '#2fb3a8', eyes: 'visor', glow: '#2fd3ff', move: 'power' },
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
    body: pick(BODIES, l.body, 'm'), face: pick(FACES, l.face, 'mix'),
    hair: pick(HAIR_STYLES, OLD_HAIR[l.hair] || l.hair, 'short'), hairColor: hex(l.hairColor, base.hairColor),
    facial: pick(FACIAL, l.facial, 'none'), eyes: pick(EYEWEAR, l.eyes, 'none'), head: pick(HEADWEAR, l.head, 'none'),
    topStyle: pick(TOPS, OLD_TOP[l.topStyle] || l.topStyle, 'tee'), top: hex(l.top, base.top), accent: hex(l.accent, '#15120e'),
    pants: hex(l.pants, base.pants), shoes: hex(l.shoes, '#15120e'),
    legs: pick(LEGS, OLD_LEGS[l.legs] || l.legs, 'jeans'), kicks: pick(KICKS, l.kicks, 'sneakers'),
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
