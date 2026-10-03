// itch.io page art, drawn like the brand kit (tools/render-brand.mjs): the cover (630×500, rendered at 2×), the page
// banner (960 wide) and the page background, plus itch/preview.html, a local look at the page with itch/description.html
// and itch/theme.css in a copy of itch's layout. Run: npm run itch
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brand = path.join(root, 'brand');
const out = path.join(root, 'itch');
mkdirSync(out, { recursive: true });
const FONTS = readdirSync(path.join(brand, 'fonts')).filter((f) => f.endsWith('.ttf')).map((f) => path.join(brand, 'fonts', f));
const STENCIL = 'Big Shoulders Stencil Display Black';
const INK = '#ece5d3', RED = '#df3a2c', BG = '#0b0a09', DARK = '#15120e';

function png(svg, width, file, background = BG) {
  const data = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Barlow Condensed' }, background }).render().asPng();
  writeFileSync(file, data);
  console.log(`${path.relative(root, file)}  ${width}px  ${(data.length / 1024).toFixed(0)} KB`);
}
const dataUri = (file) => `data:image/${file.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(file).toString('base64')}`;
const TAPE = dataUri(path.join(root, 'public', 'ui', 'tape.png'));
const STAGE = dataUri(path.join(brand, 'stage.jpg'));
const SHOT = dataUri(path.join(root, 'docs', 'screenshots', 'bossfight.jpg'));

const logo = (x, y, size, { anchor = 'middle', off = size * 0.035 } = {}) => `
  <text x="${x + off}" y="${y + off}" text-anchor="${anchor}" font-family="${STENCIL}" font-size="${size}" fill="${RED}">STEMSTAGE</text>
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${STENCIL}" font-size="${size}" fill="${INK}">STEMSTAGE</text>`;
const tape = (cx, cy, w, h, text, size, rot = -2) => `
  <g transform="rotate(${rot} ${cx} ${cy})">
    <image x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" preserveAspectRatio="none" href="${TAPE}"/>
    <text x="${cx}" y="${cy + size * 0.34}" text-anchor="middle" font-family="Permanent Marker" font-size="${size}" fill="${DARK}">${text}</text>
  </g>`;

// ---------------------------------------------------------------- cover (630×500; itch shows it at 315×250 in lists)
// big logo, the highway polaroid, the tagline on tape: still readable at half size
const cover = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 630 500" width="630" height="500">
  <defs>
    <radialGradient id="c-shade" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${BG}" stop-opacity=".55"/><stop offset="1" stop-color="${BG}" stop-opacity=".2"/></radialGradient>
    <linearGradient id="c-floor" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity=".95"/></linearGradient>
    <filter id="c-drop" x="-10%" y="-10%" width="130%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="7"/><feOffset dy="9"/><feComponentTransfer><feFuncA type="linear" slope=".65"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <image width="630" height="500" preserveAspectRatio="xMidYMid slice" href="${STAGE}"/>
  <rect width="630" height="500" fill="url(#c-shade)"/>
  <rect width="630" height="500" fill="url(#c-floor)"/>
  <g transform="rotate(-3 315 330)" filter="url(#c-drop)">
    <rect x="120" y="212" width="390" height="244" fill="#f5f1e6"/>
    <image x="130" y="222" width="370" height="208" preserveAspectRatio="xMidYMid slice" href="${SHOT}"/>
    <text x="498" y="449" text-anchor="end" font-family="Permanent Marker" font-size="15" fill="${DARK}">boss fight: the Leviathan</text>
  </g>
  <image x="262" y="198" width="110" height="30" preserveAspectRatio="none" href="${TAPE}" transform="rotate(4 317 213)"/>
  ${logo(315, 122, 118)}
  ${tape(315, 168, 446, 44, 'any song · any instrument · split by AI', 21, -1.5)}
</svg>`;
png(cover, 1260, path.join(out, 'cover.png')); // 630×500 at 2×: sharp on high-DPI screens, itch scales it down

// ---------------------------------------------------------------- page banner (960 wide, sits at the top of the page column)
const banner = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 960 300" width="960" height="300">
  <defs>
    <radialGradient id="b-shade" cx="50%" cy="46%" r="64%"><stop offset="0" stop-color="${BG}" stop-opacity=".78"/><stop offset=".6" stop-color="${BG}" stop-opacity=".45"/><stop offset="1" stop-color="${BG}" stop-opacity=".25"/></radialGradient>
    <linearGradient id="b-floor" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity=".96"/></linearGradient>
  </defs>
  <image width="960" height="300" preserveAspectRatio="xMidYMid slice" href="${STAGE}"/>
  <rect width="960" height="300" fill="url(#b-shade)"/>
  <rect width="960" height="300" fill="url(#b-floor)"/>
  ${logo(480, 162, 142)}
  ${tape(480, 212, 520, 48, 'any song · any instrument · split by AI', 24, -1.5)}
  <text x="480" y="276" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="15" letter-spacing="5" fill="#b6ad99">GUITAR · BASS · DRUMS · KEYS · VOCALS · FREE FOR WINDOWS &amp; LINUX</text>
</svg>`;
png(banner, 960, path.join(out, 'banner.png'));

// ---------------------------------------------------------------- page background (Edit theme → Background: fixed, no repeat)
// the stage, dark enough that the page column stays the thing to read
const bg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <filter id="g-blur"><feGaussianBlur stdDeviation="6"/></filter>
    <radialGradient id="g-vig" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${BG}" stop-opacity=".45"/><stop offset=".7" stop-color="${BG}" stop-opacity=".8"/><stop offset="1" stop-color="${BG}" stop-opacity=".96"/></radialGradient>
    <linearGradient id="g-floor" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}"/></linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="${BG}"/>
  <image width="1920" height="900" preserveAspectRatio="xMidYMid slice" href="${STAGE}" filter="url(#g-blur)" opacity=".9"/>
  <rect width="1920" height="1080" fill="url(#g-vig)"/>
  <rect width="1920" height="1080" fill="url(#g-floor)"/>
</svg>`;
png(bg, 1920, path.join(out, 'background.png'));

// ---------------------------------------------------------------- itch/preview.html
// itch's own page layout (roughly: a centred 960px column, a wide text column and a narrow screenshot column) with the
// theme editor's settings from itch/README.md, then itch/theme.css and itch/description.html as they'd be on itch.
const description = readFileSync(path.join(out, 'description.html'), 'utf8');
const shots = ['v2-bossfight', 'v2-world-aquarium', 'v2-backstage-character', 'v2-world-nebula', 'gameplay'];
const fontFace = (family, file, weight = 400) => `@font-face { font-family: '${family}'; src: url('../brand/fonts/${file}') format('truetype'); font-weight: ${weight}; }`;
const preview = `<!doctype html>
<!-- Made by tools/render-itch.mjs (npm run itch) from itch/description.html and itch/theme.css. A local look only: -->
<!-- the page layout below approximates itch.io's, and the fonts come from brand/fonts instead of Google Fonts. -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>STEMSTAGE itch page preview</title>
<style>
  ${fontFace('Anton', 'Anton-Regular.ttf')}
  ${fontFace('Barlow Condensed', 'BarlowCondensed-SemiBold.ttf', 500)}
  ${fontFace('Barlow Condensed', 'BarlowCondensed-SemiBold.ttf', 600)}
  ${fontFace('Barlow Condensed', 'BarlowCondensed-Bold.ttf', 700)}
  ${fontFace('Barlow Condensed', 'BarlowCondensed-ExtraBold.ttf', 800)}
  ${fontFace('Big Shoulders Stencil Display', 'BigShouldersStencilDisplay-Black.ttf', 900)}
  ${fontFace('Permanent Marker', 'PermanentMarker-Regular.ttf')}
  /* itch's layout, roughly */
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.4 'Barlow Condensed', sans-serif; }
  #wrapper { min-height: 100vh; padding: 40px 16px 60px; background: #0b0a09 url('background.png') center top / cover fixed no-repeat; }
  .inner_column { max-width: 960px; margin: 0 auto; }
  .header img { max-width: 100%; }
  .columns { display: flex; gap: 0; }
  .left_col { flex: 1 1 60%; min-width: 0; padding: 20px 30px 30px; }
  .right_col { flex: 0 0 34%; padding: 20px 20px 30px 0; }
  .screenshot_list a { display: block; margin: 0 0 16px; }
  .screenshot_list img { display: block; width: 100%; }
  .buy_row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 16px; margin: 0 0 24px; }
  .button { display: inline-block; padding: 10px 18px; font-size: 18px; text-decoration: none; cursor: pointer; }
  .uploads { margin: 26px 0; }
  .upload { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
  .upload .info_column { min-width: 0; flex: 1 1 200px; }
  .upload .download_btn { padding: 7px 14px; font-size: 15px; }
  .more_information_toggle { margin: 22px 0; }
  .game_info_panel_widget table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .game_info_panel_widget td { padding: 6px 8px; border-bottom: 1px solid; }
  .game_comments_widget { padding: 0 30px 30px; }
  @media (max-width: 700px) {
    #wrapper { padding: 0 0 40px; }
    .columns { flex-direction: column; }
    .left_col { padding: 16px; }
    .right_col { padding: 0 16px 16px; }
  }
</style>
<link rel="stylesheet" href="theme.css" />
</head>
<body>
<div id="wrapper" class="main wrapper">
  <div class="inner_column size_large">
    <div class="header has_image"><img src="banner.png" width="960" alt="STEMSTAGE: any song, any instrument, split by AI" /></div>
    <div class="columns">
      <div class="left_col column">
        <div class="buy_row">
          <a class="button buy_btn" href="#download">Download</a>
          <span class="buy_message">Free · Windows and Linux</span>
        </div>
        <div class="formatted_description user_formatted">
${description.replace(/^/gm, '          ')}
        </div>
        <div class="more_information_toggle">
          <a class="toggle_info_btn" href="#info">More information</a>
          <div class="game_info_panel_widget"><table><tbody>
            <tr><td>Status</td><td>In development</td></tr>
            <tr><td>Platforms</td><td>Windows, Linux</td></tr>
            <tr><td>Genre</td><td>Rhythm</td></tr>
            <tr><td>Tags</td><td>Guitar Hero, Rock Band, Music, AI, Multiplayer, Local multiplayer, Open Source</td></tr>
          </tbody></table></div>
        </div>
        <div class="uploads" id="download">
          <div class="upload"><div class="info_column"><div class="upload_name"><strong class="name">STEMSTAGE_x.y.z_x64-setup.exe</strong> <span class="file_size">40 MB</span></div></div><a class="button download_btn" href="#">Download</a></div>
          <div class="upload"><div class="info_column"><div class="upload_name"><strong class="name">STEMSTAGE_x.y.z_amd64.AppImage</strong> <span class="file_size">150 MB</span></div></div><a class="button download_btn" href="#">Download</a></div>
          <div class="upload"><div class="info_column"><div class="upload_name"><strong class="name">STEMSTAGE_x.y.z_amd64.deb</strong> <span class="file_size">70 MB</span></div></div><a class="button download_btn" href="#">Download</a></div>
        </div>
      </div>
      <div class="right_col column">
        <div class="screenshot_list">
${shots.map((s) => `          <a href="#"><img class="screenshot" src="../site/img/${s}.webp" alt="${s}" /></a>`).join('\n')}
        </div>
      </div>
    </div>
    <div class="game_comments_widget"><h2>Comments</h2></div>
  </div>
</div>
</body>
</html>
`;
writeFileSync(path.join(out, 'preview.html'), preview);
console.log('itch/preview.html');
