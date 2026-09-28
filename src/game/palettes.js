// Lane colour palettes (accessibility). The highway reads FIVE_COLORS / DRUM_COLORS when a song starts,
// so applying a palette updates those arrays in place.
import { FIVE_COLORS, DRUM_COLORS } from './highway.js';

export const PALETTES = {
  // green · red · yellow · blue · orange (the classic look)
  default: { five: [0x2ed24f, 0xf2332b, 0xffd21f, 0x2f84f0, 0xff8a1a], drums: [0xff8a1a, 0xf2332b, 0xffd21f, 0x2f84f0, 0x2ed24f] },
  // red-green colour blindness (protanopia / deuteranopia): Okabe-Ito colours, no red/green pair
  redgreen: { five: [0x56b4e9, 0xe69f00, 0xf0e442, 0x0060d0, 0xcc79a7], drums: [0xe69f00, 0xcc79a7, 0xf0e442, 0x0060d0, 0x56b4e9] },
  // blue-yellow colour blindness (tritanopia): no blue/green or yellow/violet pairs
  tritan: { five: [0x3dff6a, 0xff3355, 0xffffff, 0xff7fd0, 0x8a6bff], drums: [0x8a6bff, 0xff3355, 0xffffff, 0xff7fd0, 0x3dff6a] },
  // maximum brightness and saturation
  contrast: { five: [0x00ff55, 0xff0030, 0xffff00, 0x00a0ff, 0xff7a00], drums: [0xff7a00, 0xff0030, 0xffff00, 0x00a0ff, 0x00ff55] },
};

export function applyPalette(name) {
  const p = PALETTES[name] || PALETTES.default;
  p.five.forEach((c, i) => { FIVE_COLORS[i] = c; });
  p.drums.forEach((c, i) => { DRUM_COLORS[i] = c; });
}
