// Characters: how a profile's band member looks on stage (skin, hair, clothes, instrument finish) and which
// part they stand at in the menus. Kept on the profile as p.look; the stage applies it (Stage.setLook).
import { HAIR_STYLES } from '../game/stage.js';

export const PARTS = ['guitar', 'bass', 'drums', 'keys'];
export const SKINS = ['#f3d3b8', '#e0ac85', '#c68a5f', '#9a6440', '#6b4128', '#3d2518'];
export const HAIR_COLORS = ['#0c0c12', '#3b2414', '#8a5a2b', '#d9b36a', '#e8e1cf', '#c8322a', '#2f6fe0', '#b14cff', '#2ed24f'];
export const OUTFITS = ['#15120e', '#ece5d3', '#df3a2c', '#f0b429', '#2447d8', '#1c7a3a', '#6b2bb0', '#3a0d1c', '#0d1c3a', '#5a5a5a'];
export const FINISHES = ['#d81b3a', '#1b5ed8', '#f0b429', '#ece5d3', '#15120e', '#b86a1b', '#2ed24f', '#b14cff'];
export { HAIR_STYLES };
export const HAIR_LABEL = { short: 'Short', long: 'Long', mohawk: 'Mohawk', bun: 'Bun', shaved: 'Buzz cut' };

export const PRESETS = [
  { id: 'punk', name: 'Punk', skin: SKINS[1], hair: 'mohawk', hairColor: '#c8322a', top: '#15120e', pants: '#2447d8', finish: '#f0b429' },
  { id: 'metal', name: 'Metalhead', skin: SKINS[0], hair: 'long', hairColor: '#0c0c12', top: '#15120e', pants: '#15120e', finish: '#15120e' },
  { id: 'grunge', name: 'Grunge', skin: SKINS[2], hair: 'long', hairColor: '#8a5a2b', top: '#1c7a3a', pants: '#2447d8', finish: '#b86a1b' },
  { id: 'glam', name: 'Glam', skin: SKINS[0], hair: 'long', hairColor: '#d9b36a', top: '#b14cff', pants: '#15120e', finish: '#ece5d3' },
  { id: 'soul', name: 'Soul', skin: SKINS[4], hair: 'short', hairColor: '#0c0c12', top: '#f0b429', pants: '#3a0d1c', finish: '#d81b3a' },
  { id: 'indie', name: 'Indie', skin: SKINS[3], hair: 'bun', hairColor: '#3b2414', top: '#ece5d3', pants: '#0d1c3a', finish: '#1b5ed8' },
  { id: 'rockabilly', name: 'Rockabilly', skin: SKINS[1], hair: 'short', hairColor: '#0c0c12', top: '#df3a2c', pants: '#15120e', finish: '#ece5d3' },
  { id: 'hardcore', name: 'Hardcore', skin: SKINS[5], hair: 'shaved', hairColor: '#0c0c12', top: '#5a5a5a', pants: '#15120e', finish: '#df3a2c' },
];

const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : fallback);

/** A look from anywhere (the profile file, another player online) made safe to use. */
export function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const base = PRESETS[0];
  return {
    part: PARTS.includes(l.part) ? l.part : 'guitar',
    preset: PRESETS.some((p) => p.id === l.preset) ? l.preset : null,
    skin: hex(l.skin, base.skin), hair: HAIR_STYLES.includes(l.hair) ? l.hair : 'short', hairColor: hex(l.hairColor, base.hairColor),
    top: hex(l.top, base.top), pants: hex(l.pants, base.pants), finish: hex(l.finish, base.finish),
  };
}

/** A preset as a full look (keeping the part the player stands at). */
export const fromPreset = (id, part = 'guitar') => {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return cleanLook({ ...p, preset: p.id, part });
};
