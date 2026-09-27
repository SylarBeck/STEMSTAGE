// Renders every controller illustration to a PNG picture in public/controllers/ (used by the UI for
// device lists, the top bar, band slots and the README). Run: npm run art
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { controllerSvg, LANE_COLORS } from '../src/ui/controller-art.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'controllers');
mkdirSync(out, { recursive: true });

// keyboard picture shows the default "Keys A" lanes
const laneKeys = { KeyD: LANE_COLORS[0], KeyF: LANE_COLORS[1], Space: LANE_COLORS[2], KeyJ: LANE_COLORS[3], KeyK: LANE_COLORS[4], Enter: '#ffcf3a', ShiftLeft: '#ffcf3a', ShiftRight: '#ffcf3a' };
const KINDS = {
  dualsense: { accent: '#29e0ff' }, 'dualsense-edge': { accent: '#29e0ff' }, dualshock4: { accent: '#2b8cff' },
  xbox: { accent: '#e8e8ea' }, xbox360: { accent: '#3fbf3f' }, 'switch-pro': {}, 'joycon-l': {}, 'joycon-r': {}, 'joycon-pair': {},
  guitar: { accent: '#e8233f' }, drums: {}, 'midi-keys': {}, 'midi-drums': {}, keyboard: { laneKeys, accent: '#ff2d7a' }, gamepad: { accent: '#29e0ff' },
};

for (const [kind, opts] of Object.entries(KINDS)) {
  const svg = controllerSvg(kind, opts);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 800 }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(path.join(out, `${kind}.png`), png);
  console.log(`${kind}.png  ${(png.length / 1024).toFixed(0)} KB`);
}
