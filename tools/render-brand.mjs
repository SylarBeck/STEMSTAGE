// Brand kit: app icon, wordmark, horizontal logo and the GitHub banner / social preview.
// Writes SVG sources + PNGs to brand/ and the favicon to public/icon.png.
// Run: npm run brand   (then `npx tauri icon brand/icon-1024.png` regenerates the app icons)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brand = path.join(root, 'brand');
mkdirSync(brand, { recursive: true });
const FONTS = ['Orbitron-Black.ttf', 'Orbitron-Bold.ttf', 'Rajdhani-Bold.ttf', 'Rajdhani-SemiBold.ttf', 'Rajdhani-Medium.ttf'].map((f) => path.join(brand, 'fonts', f));
const LANES = ['#2bff5a', '#ff2b4a', '#ffe62b', '#2b8cff', '#ff8a1a'];

function png(svg, width, file) {
  const out = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Rajdhani' }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(file, out);
  console.log(`${path.relative(root, file)}  ${width}px  ${(out.length / 1024).toFixed(0)} KB`);
}
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

// ---------------------------------------------------------------- highway motif (shared)
function highway({ x0, x1, yTop, yBot, vx, vw, lanes = 5, id = 'h', gems = [], strike = 0.83, rails = true }) {
  // trapezoid from the bottom edge (x0..x1 at yBot) to the horizon (vx ± vw/2 at yTop)
  const L = (t, y) => { const k = (y - yTop) / (yBot - yTop); const left = vx - vw / 2 + (x0 - (vx - vw / 2)) * k; const right = vx + vw / 2 + (x1 - (vx + vw / 2)) * k; return left + (right - left) * t; };
  const yAt = (d) => yTop + (yBot - yTop) * d;
  let s = `<path d="M${x0} ${yBot} L${vx - vw / 2} ${yTop} L${vx + vw / 2} ${yTop} L${x1} ${yBot} Z" fill="url(#${id}Board)"/>`;
  for (let i = 1; i < lanes; i++) s += `<path d="M${L(i / lanes, yBot)} ${yBot} L${L(i / lanes, yTop)} ${yTop}" stroke="rgba(190,200,255,0.28)" stroke-width="${(yBot - yTop) * 0.004}"/>`;
  for (const d of [0.35, 0.55, 0.7, strike - 0.07]) { const y = yAt(d); s += `<path d="M${L(0, y)} ${y} L${L(1, y)} ${y}" stroke="rgba(255,255,255,${0.05 + d * 0.12})" stroke-width="${2 + d * 3}"/>`; }
  const ys = yAt(strike);
  s += `<path d="M${L(0, ys)} ${ys} L${L(1, ys)} ${ys}" stroke="#fff" stroke-width="${(yBot - yTop) * 0.012}" opacity=".9"/>`;
  if (rails) {
    for (const t of [0, 1]) s += `<path d="M${L(t, yBot)} ${yBot} L${L(t, yTop)} ${yTop}" stroke="url(#${id}Rail)" stroke-width="${(yBot - yTop) * 0.018}" stroke-linecap="round" filter="url(#${id}Glow)"/><path d="M${L(t, yBot)} ${yBot} L${L(t, yTop)} ${yTop}" stroke="url(#${id}Rail)" stroke-width="${(yBot - yTop) * 0.008}" stroke-linecap="round"/>`;
  }
  for (const [lane, d] of gems) {
    const y = yAt(d), w = (L(1, y) - L(0, y)) / lanes, cx = L((lane + 0.5) / lanes, y);
    s += `<ellipse cx="${cx}" cy="${y + w * 0.06}" rx="${w * 0.42}" ry="${w * 0.17}" fill="#000" opacity=".5"/>
      <rect x="${cx - w * 0.4}" y="${y - w * 0.16}" width="${w * 0.8}" height="${w * 0.28}" rx="${w * 0.12}" fill="${LANES[lane]}"/>
      <rect x="${cx - w * 0.28}" y="${y - w * 0.13}" width="${w * 0.56}" height="${w * 0.09}" rx="${w * 0.045}" fill="#fff" opacity=".75"/>`;
  }
  // smashers at the strikeline
  for (let lane = 0; lane < lanes; lane++) {
    const w = (L(1, ys) - L(0, ys)) / lanes, cx = L((lane + 0.5) / lanes, ys);
    s += `<rect x="${cx - w * 0.36}" y="${ys - w * 0.11}" width="${w * 0.72}" height="${w * 0.22}" rx="${w * 0.1}" fill="none" stroke="${LANES[lane]}" stroke-width="${w * 0.05}" filter="url(#${id}Glow)"/>
      <rect x="${cx - w * 0.36}" y="${ys - w * 0.11}" width="${w * 0.72}" height="${w * 0.22}" rx="${w * 0.1}" fill="rgba(10,8,20,.6)" stroke="${LANES[lane]}" stroke-width="${w * 0.03}"/>`;
  }
  return s;
}
const highwayDefs = (id, glow = 10) => `
  <linearGradient id="${id}Board" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140c26" stop-opacity="0"/><stop offset=".35" stop-color="#140c26" stop-opacity=".85"/><stop offset="1" stop-color="#0b0716"/></linearGradient>
  <linearGradient id="${id}Rail" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff2d7a"/><stop offset=".6" stop-color="#b44bff"/><stop offset="1" stop-color="#29e0ff" stop-opacity="0"/></linearGradient>
  <filter id="${id}Glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${glow}"/></filter>`;

// ---------------------------------------------------------------- app icon
const SQ = 'M224 0 H800 A224 224 0 0 1 1024 224 V800 A224 224 0 0 1 800 1024 H224 A224 224 0 0 1 0 800 V224 A224 224 0 0 1 224 0 Z';
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="78%"><stop offset="0" stop-color="#3a1466"/><stop offset=".5" stop-color="#150a2a"/><stop offset="1" stop-color="#05030b"/></radialGradient>
    <linearGradient id="sFill" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffd0e4"/><stop offset=".22" stop-color="#ff4d91"/><stop offset=".62" stop-color="#ff2d7a"/><stop offset="1" stop-color="#ff7a2f"/></linearGradient>
    <filter id="sGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="30"/></filter>
    <radialGradient id="flare" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#29e0ff" stop-opacity=".55"/><stop offset="1" stop-color="#29e0ff" stop-opacity="0"/></radialGradient>
    <clipPath id="clip"><path d="${SQ}"/></clipPath>
    ${highwayDefs('i', 14)}
  </defs>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <ellipse cx="512" cy="330" rx="300" ry="120" fill="url(#flare)"/>
    ${highway({ x0: 40, x1: 984, yTop: 330, yBot: 1060, vx: 512, vw: 90, id: 'i', gems: [[0, 0.55], [2, 0.68], [3, 0.42]], strike: 0.84 })}
    <text x="512" y="742" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="640" fill="#ff2d7a" filter="url(#sGlow)" opacity=".85">S</text>
    <text x="512" y="742" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="640" fill="url(#sFill)" stroke="#fff" stroke-opacity=".35" stroke-width="6">S</text>
  </g>
  <path d="${SQ}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="8"/>
</svg>`;
writeFileSync(path.join(brand, 'icon.svg'), iconSvg);
png(iconSvg, 1024, path.join(brand, 'icon-1024.png'));
png(iconSvg, 256, path.join(root, 'public', 'icon.png'));

// ---------------------------------------------------------------- wordmark
const wordmark = (w = 1400, h = 260, tagline = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="wm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#ffe3ef"/><stop offset="1" stop-color="#ffb3cf"/></linearGradient>
    <filter id="wg" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="wc" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <text x="${w / 2}" y="170" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="168" letter-spacing="10" fill="#29e0ff" filter="url(#wc)" opacity=".45">STEMSTAGE</text>
  <text x="${w / 2}" y="170" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="168" letter-spacing="10" fill="#ff2d7a" filter="url(#wg)" opacity=".9">STEMSTAGE</text>
  <text x="${w / 2 - 5}" y="170" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="168" letter-spacing="10" fill="#29e0ff" opacity=".55">STEMSTAGE</text>
  <text x="${w / 2}" y="170" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="168" letter-spacing="10" fill="url(#wm)">STEMSTAGE</text>
  ${tagline ? `<text x="${w / 2}" y="238" text-anchor="middle" font-family="Orbitron" font-weight="700" font-size="30" letter-spacing="14" fill="#29e0ff">ANY SONG · ANY INSTRUMENT · SPLIT BY AI</text>` : ''}
</svg>`;
writeFileSync(path.join(brand, 'wordmark.svg'), wordmark());
png(wordmark(), 1400, path.join(brand, 'wordmark.png'));

// ---------------------------------------------------------------- horizontal logo (icon + wordmark)
const horizontal = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1700 300" width="1700" height="300">
  <image x="10" y="10" width="280" height="280" href="${dataUri(path.join(brand, 'icon-1024.png'))}"/>
  <svg x="300" y="20" width="1400" height="260" viewBox="0 0 1400 260">${wordmark().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>
</svg>`;
png(horizontal, 1700, path.join(brand, 'logo-horizontal.png'));

// ---------------------------------------------------------------- banner / social preview (1280x640)
const pic = (k) => dataUri(path.join(root, 'public', 'controllers', `${k}.png`));
const banner = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1280 640" width="1280" height="640">
  <defs>
    <radialGradient id="bbg" cx="72%" cy="30%" r="85%"><stop offset="0" stop-color="#2b0f52"/><stop offset=".45" stop-color="#12081f"/><stop offset="1" stop-color="#05030a"/></radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="beamP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2d7a" stop-opacity=".35"/><stop offset="1" stop-color="#ff2d7a" stop-opacity="0"/></linearGradient>
    <linearGradient id="beamC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#29e0ff" stop-opacity=".3"/><stop offset="1" stop-color="#29e0ff" stop-opacity="0"/></linearGradient>
    <pattern id="led" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.6" fill="#ff2d7a" opacity=".35"/></pattern>
    <linearGradient id="ledFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#05030a"/></linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
    ${highwayDefs('b', 9)}
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#05030a" stop-opacity=".95"/><stop offset=".45" stop-color="#05030a" stop-opacity=".6"/><stop offset=".62" stop-color="#05030a" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#bbg)"/>
  <rect x="620" y="40" width="640" height="300" fill="url(#led)"/>
  <rect x="620" y="40" width="640" height="300" fill="url(#ledFade)"/>
  <path d="M760 0 L700 640 L900 640 Z" fill="url(#beamP)"/><path d="M1180 0 L1000 640 L1180 640 Z" fill="url(#beamC)"/><path d="M980 0 L880 640 L1060 640 Z" fill="url(#beam)"/>
  ${highway({ x0: 640, x1: 1340, yTop: 250, yBot: 700, vx: 960, vw: 70, id: 'b', gems: [[0, 0.62], [1, 0.46], [2, 0.74], [4, 0.36], [3, 0.55]], strike: 0.86 })}
  <rect width="1280" height="640" fill="url(#fade)"/>
  <image x="70" y="84" width="120" height="120" href="${dataUri(path.join(brand, 'icon-1024.png'))}"/>
  <svg x="40" y="210" width="700" height="130" viewBox="0 0 1400 260">${wordmark().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>
  <text x="76" y="392" font-family="Rajdhani" font-weight="700" font-size="34" fill="#eef0ff">The rhythm game that plays <tspan fill="#ff2d7a">any song</tspan>.</text>
  <text x="76" y="432" font-family="Rajdhani" font-weight="600" font-size="23" fill="#b9b7d6">AI splits your music into stems and charts guitar, bass, drums, keys and vocals.</text>
  ${['Demucs AI stems', 'DualSense triggers + haptics', 'Rock Band gear + MIDI', 'Up to 4 players'].map((t, i) => {
    const x = [76, 276, 76, 320][i], w = [186, 256, 230, 170][i], y = i < 2 ? 468 : 518;
    return `<rect x="${x}" y="${y}" width="${w}" height="40" rx="20" fill="rgba(255,255,255,0.06)" stroke="rgba(170,150,255,0.35)"/><text x="${x + w / 2}" y="${y + 26}" text-anchor="middle" font-family="Rajdhani" font-weight="700" font-size="19" fill="#eef0ff">${t}</text>`;
  }).join('')}
  <image x="860" y="392" width="290" height="189" href="${pic('dualsense')}"/>
  <image x="1060" y="444" width="210" height="137" href="${pic('guitar')}"/>
  <text x="76" y="606" font-family="Orbitron" font-weight="700" font-size="15" letter-spacing="4" fill="#6f6c93">DESKTOP APP FOR WINDOWS · THREE.JS · TAURI · DEMUCS</text>
</svg>`;
writeFileSync(path.join(brand, 'banner.svg'), banner);
png(banner, 1280, path.join(brand, 'banner.png'));
png(banner, 2560, path.join(brand, 'banner@2x.png'));
