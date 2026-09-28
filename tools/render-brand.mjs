// Brand kit: app icon, wordmark, horizontal logo, the GitHub social preview and the README banner.
// Same look as the game: a stencilled logo sprayed in bone with a red pass that didn't line up, masking tape,
// the real stage behind it. Writes SVG sources + PNGs to brand/, the game's favicon to public/icon.png and the
// website's favicon + home-screen icon to site/img/.
// Run: npm run brand   (then `npx tauri icon brand/icon-1024.png` regenerates the app icons)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brand = path.join(root, 'brand');
mkdirSync(brand, { recursive: true });
// static fonts only: resvg can't pick a weight out of a variable font, so the stencil is a Black instance
const FONTS = readdirSync(path.join(brand, 'fonts')).filter((f) => f.endsWith('.ttf')).map((f) => path.join(brand, 'fonts', f));
const STENCIL = 'Big Shoulders Stencil Display Black';
const INK = '#ece5d3', RED = '#df3a2c', GOLD = '#f0b429', BG = '#0b0a09', DARK = '#15120e';
const LANES = ['#2ed24f', '#f2332b', '#ffd21f', '#2f84f0', '#ff8a1a'];

function png(svg, width, file, background = 'rgba(0,0,0,0)') {
  const out = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Barlow Condensed' }, background }).render().asPng();
  writeFileSync(file, out);
  console.log(`${path.relative(root, file)}  ${width}px  ${(out.length / 1024).toFixed(0)} KB`);
}
const dataUri = (file) => `data:image/${file.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(file).toString('base64')}`;
const TAPE = dataUri(path.join(root, 'public', 'ui', 'tape.png'));
const STAGE = dataUri(path.join(brand, 'stage.jpg'));

/** The logo: bone letters over a red pass offset down-right by `off`. */
const logo = (x, y, size, { anchor = 'middle', off = size * 0.035, spacing = 0 } = {}) => `
  <text x="${x + off}" y="${y + off}" text-anchor="${anchor}" font-family="${STENCIL}" font-size="${size}" letter-spacing="${spacing}" fill="${RED}">STEMSTAGE</text>
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${STENCIL}" font-size="${size}" letter-spacing="${spacing}" fill="${INK}">STEMSTAGE</text>`;
/** A strip of masking tape with marker on it, centred on (cx, cy). */
const tape = (cx, cy, w, h, text, size, rot = -2) => `
  <g transform="rotate(${rot} ${cx} ${cy})">
    <image x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" preserveAspectRatio="none" href="${TAPE}"/>
    <text x="${cx}" y="${cy + size * 0.34}" text-anchor="middle" font-family="Permanent Marker" font-size="${size}" fill="${DARK}">${text}</text>
  </g>`;

// ---------------------------------------------------------------- app icon
// a stencilled S under a stage light, with the five fret colours along the bottom
const SQ = 'M224 0 H800 A224 224 0 0 1 1024 224 V800 A224 224 0 0 1 800 1024 H224 A224 224 0 0 1 0 800 V224 A224 224 0 0 1 224 0 Z';
const iconBody = () => `
    <rect width="1024" height="1024" fill="${BG}"/>
    <rect width="1024" height="1024" fill="url(#spot)"/>
    <text x="548" y="826" text-anchor="middle" font-family="${STENCIL}" font-size="880" fill="${RED}">S</text>
    <text x="512" y="790" text-anchor="middle" font-family="${STENCIL}" font-size="880" fill="${INK}">S</text>
    ${LANES.map((c, i) => `<rect x="${214 + i * 124}" y="900" width="100" height="30" rx="6" fill="${c}"/>`).join('')}`;
const iconDefs = `
    <radialGradient id="spot" cx="50%" cy="-8%" r="100%"><stop offset="0" stop-color="#ffb24a" stop-opacity=".5"/><stop offset=".42" stop-color="#8a2c14" stop-opacity=".28"/><stop offset="1" stop-color="${BG}" stop-opacity="0"/></radialGradient>`;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${iconDefs}<clipPath id="clip"><path d="${SQ}"/></clipPath></defs>
  <g clip-path="url(#clip)">${iconBody()}</g>
  <path d="${SQ}" fill="none" stroke="rgba(236,229,211,0.14)" stroke-width="10"/>
</svg>`;
// full-bleed square for places that round the corners themselves (iOS home screen)
const iconSquare = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>${iconDefs}</defs>${iconBody()}</svg>`;
writeFileSync(path.join(brand, 'icon.svg'), iconSvg);
png(iconSvg, 1024, path.join(brand, 'icon-1024.png'));
png(iconSvg, 256, path.join(root, 'public', 'icon.png'));
png(iconSvg, 64, path.join(root, 'site', 'img', 'favicon.png'));
png(iconSquare, 180, path.join(root, 'site', 'img', 'apple-touch-icon.png'), BG);

// ---------------------------------------------------------------- wordmark (transparent)
const wordmark = (w = 1400, h = 340) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  ${logo(w / 2 - 6, 222, 250)}
  ${tape(w / 2, 294, 760, 72, 'any song · any instrument · split by AI', 36)}
</svg>`;
writeFileSync(path.join(brand, 'wordmark.svg'), wordmark());
png(wordmark(), 1400, path.join(brand, 'wordmark.png'));

// ---------------------------------------------------------------- horizontal logo (icon + wordmark)
const horizontal = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1400 300" width="1400" height="300">
  <image x="10" y="10" width="280" height="280" href="${dataUri(path.join(brand, 'icon-1024.png'))}"/>
  ${logo(326, 238, 236, { anchor: 'start' })}
</svg>`;
png(horizontal, 1400, path.join(brand, 'logo-horizontal.png'));

// ---------------------------------------------------------------- GitHub social preview (1280x640, under 1 MB for GitHub)
const shot = dataUri(path.join(root, 'docs', 'screenshots', 'overdrive.png'));
/** Rubber stamps in rows starting at (x, y); widths are estimated from the text so they sit side by side. */
const stamps = (x, y, rows) => rows.map((row, r) => {
  let cx = x;
  return row.map(([text, color, rot]) => {
    const w = text.length * 12.4 + 30, sx = cx;
    cx += w + 16;
    return `<g transform="rotate(${rot} ${sx + w / 2} ${y + r * 52 + 17})"><rect x="${sx}" y="${y + r * 52}" width="${w}" height="34" fill="none" stroke="${color}" stroke-width="3"/>
      <text x="${sx + w / 2}" y="${y + r * 52 + 24}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="19" letter-spacing="2.2" fill="${color}">${text}</text></g>`;
  }).join('');
}).join('');
const banner = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1280 640" width="1280" height="640">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${BG}" stop-opacity=".94"/><stop offset=".5" stop-color="${BG}" stop-opacity=".72"/><stop offset="1" stop-color="${BG}" stop-opacity=".35"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity=".9"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="drop" x="-10%" y="-10%" width="130%" height="130%"><feGaussianBlur in="SourceAlpha" stdDeviation="10"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope=".6"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <image width="1280" height="640" preserveAspectRatio="xMidYMid slice" href="${STAGE}" opacity=".85" filter="url(#soft)"/>
  <rect width="1280" height="640" fill="url(#shade)"/>
  <rect width="1280" height="640" fill="url(#floor)"/>
  <g transform="rotate(3 1010 300)" filter="url(#drop)">
    <rect x="770" y="160" width="480" height="290" fill="#f5f1e6"/>
    <image x="782" y="172" width="456" height="256.5" preserveAspectRatio="xMidYMid slice" href="${shot}"/>
    <text x="1226" y="444" text-anchor="end" font-family="Permanent Marker" font-size="17" fill="${DARK}">overdrive, 2× score</text>
  </g>
  <image x="950" y="140" width="130" height="36" preserveAspectRatio="none" href="${TAPE}" transform="rotate(-4 1015 158)"/>
  ${logo(70, 196, 158, { anchor: 'start' })}
  ${tape(318, 250, 520, 54, 'any song · any instrument · split by AI', 25)}
  <text x="74" y="352" font-family="Anton" font-size="50" fill="${INK}">THE RHYTHM GAME THAT</text>
  <text x="74" y="408" font-family="Anton" font-size="50" fill="${INK}">PLAYS ANY SONG</text>
  <text x="76" y="450" font-family="Barlow Condensed" font-weight="600" font-size="24" fill="#cfc7b4">AI splits your music into stems and charts guitar, bass, drums, keys and vocals.</text>
  ${stamps(76, 480, [[['DEMUCS AI STEMS', RED, -2], ['DUALSENSE TRIGGERS', GOLD, 1.5], ['ROCK BAND GEAR + MIDI', INK, -1]], [['UP TO 4 PLAYERS', INK, 1], ['REAL GUITAR + KEYS', RED, -1.5]]])}
  <text x="76" y="608" font-family="Barlow Condensed" font-weight="800" font-size="17" letter-spacing="4" fill="#8d8575">FREE FOR WINDOWS &amp; LINUX · THREE.JS · TAURI · DEMUCS</text>
</svg>`;
writeFileSync(path.join(brand, 'banner.svg'), banner);
png(banner, 1280, path.join(brand, 'banner.png'));
png(banner, 2560, path.join(brand, 'banner@2x.png'));

// ---------------------------------------------------------------- README banner (2000x800): the logo on the stage
const hero = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 2000 800" width="2000" height="800">
  <defs>
    <radialGradient id="hshade" cx="50%" cy="48%" r="62%"><stop offset="0" stop-color="${BG}" stop-opacity=".78"/><stop offset=".6" stop-color="${BG}" stop-opacity=".45"/><stop offset="1" stop-color="${BG}" stop-opacity=".2"/></radialGradient>
    <linearGradient id="hfloor" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}"/></linearGradient>
  </defs>
  <image width="2000" height="800" preserveAspectRatio="xMidYMid slice" href="${STAGE}"/>
  <rect width="2000" height="800" fill="url(#hshade)"/>
  <rect width="2000" height="800" fill="url(#hfloor)"/>
  ${logo(1000, 452, 330)}
  ${tape(1000, 556, 1010, 92, 'any song · any instrument · split by AI', 48)}
  <text x="1000" y="700" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="30" letter-spacing="10" fill="#b6ad99">GUITAR · BASS · DRUMS · KEYS · VOCALS</text>
</svg>`;
png(hero, 2000, path.join(brand, 'banner-hero.png'), BG);
