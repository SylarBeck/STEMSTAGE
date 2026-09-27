// Copies Font Awesome Free (npm) into public/vendor/fontawesome so the game and the OBS overlay load it
// locally (no CDN). Runs before dev and build (package.json predev / prebuild).
import fs from 'node:fs';
import path from 'node:path';
const src = path.resolve('node_modules/@fortawesome/fontawesome-free');
const dst = path.resolve('public/vendor/fontawesome');
fs.mkdirSync(path.join(dst, 'css'), { recursive: true });
fs.mkdirSync(path.join(dst, 'webfonts'), { recursive: true });
fs.copyFileSync(path.join(src, 'css/all.min.css'), path.join(dst, 'css/all.min.css'));
for (const f of fs.readdirSync(path.join(src, 'webfonts'))) if (f.endsWith('.woff2')) fs.copyFileSync(path.join(src, 'webfonts', f), path.join(dst, 'webfonts', f));
fs.copyFileSync(path.join(src, 'LICENSE.txt'), path.join(dst, 'LICENSE.txt'));
console.log('Font Awesome copied to public/vendor/fontawesome');
