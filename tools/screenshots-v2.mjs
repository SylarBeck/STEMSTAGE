// Captures the 2.0 pictures for the website (site/img/v2-*.webp): the five worlds with their bosses, a boss fight,
// and the Backstage screens. Needs a running STEMSTAGE with a signed-in profile (default the dev server):
//   npx vite --port 5273        then        URL=http://127.0.0.1:5273/ node tools/screenshots-v2.mjs
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'site', 'img');
mkdirSync(out, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:5273/';
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.stemstage?.ui?.songs?.length, { timeout: 120000 });
await wait(1500);
const run = (fn, ...args) => page.evaluate(fn, ...args);
// Backstage needs a profile: sign in the first one on this server (one without a PIN)
await run(async () => { const { profiles } = await import('/src/profile/profiles.js'); const p = profiles.list.find((x) => !x.pinHash); if (p) await profiles.signIn(p.id); window.stemstage.ui.refreshStatus(); });
const ONLY = process.env.ONLY || '';
const shot = async (name, settle = 800) => { await wait(settle); await page.screenshot({ path: path.join(out, `v2-${name}.webp`), type: 'webp', quality: 82 }); console.log(`v2-${name}.webp`); };
const chrome = (on) => run((v) => { for (const id of ['ui', 'topbar', 'legend', 'toasts']) { const el = document.getElementById(id); if (el) el.style.visibility = v ? '' : 'hidden'; } }, on);

// the worlds: the boss arrives and attacks, framed from the crowd
const WORLDS = {
  aquarium: { pos: [0, 5, 13], tgt: [0, 9, -22], attack: 'ink', after: 9 },
  nebula: { pos: [0, 6, 15], tgt: [0, 15, -30], attack: 'meteor', after: 6 },
  forge: { pos: [0, 6, 17], tgt: [0, 14, -30], attack: 'quake', after: 6 },
  aurora: { pos: [0, 7, 15], tgt: [0, 17, -24], attack: 'frost', after: 8 },
  citadel: { pos: [0, 6, 17], tgt: [0, 15, -30], attack: 'lightning', after: 6 },
};
await run(() => window.stemstage.ui.show('menu'));
await chrome(false);
for (const [id, w] of Object.entries(ONLY === 'backstage' ? {} : WORLDS)) {
  await run((id, w) => {
    const st = window.stemstage.stage;
    const V = (a) => ({ x: a[0], y: a[1], z: a[2] });
    st.setVenue(id);
    st.designView({ pos: st.camera.position.clone().set(...w.pos), tgt: st.camera.position.clone().set(...w.tgt) });
    st.world.boss.enter();
    window.__venueLock = setInterval(() => { if (st.venueId !== id) st.setVenue(id); }, 100);
    void V;
  }, id, w);
  await wait(w.after * 1000);
  await run((kind) => window.stemstage.stage.world.boss.attack(kind), w.attack);
  await shot(`world-${id}`, 900);
  await run(() => { clearInterval(window.__venueLock); window.stemstage.stage.designView(null); });
}
await chrome(true);

// a boss fight in a song (bosses always on): keep the streak going and capture the fight
if (ONLY !== 'backstage') {
await run(async () => {
  const a = window.stemstage;
  a.settings.bosses = 'always'; a.settings.venue = 'aquarium';
  a.ui.mode = 'solo'; a.ui.show('library');
  await new Promise((r) => setTimeout(r, 600));
  const demo = a.ui.songs.find((s) => s.method === 'demo') || a.ui.songs[0];
  a.ui.selectSong(demo.id); a.ui.instrument = 'guitar'; a.ui.difficulty = 'expert';
  await a.ui.play();
  window.__keep = setInterval(() => { const p = a.game.players[0]; if (p) { p.rock = 0.95; if (p.streak < 31) { p.streak = 31; p._updateMult(); } p.od = Math.max(p.od, 0.6); } }, 30);
});
await page.waitForFunction(() => window.stemstage.game.boss?.state === 'fight' && window.stemstage.game.boss.next >= 1, { timeout: 90000, polling: 200 });
await run(() => window.stemstage.game.boss._damage(window.stemstage.game.boss.hpMax * 0.45));
await shot('bossfight', 1200);
await run(() => { clearInterval(window.__keep); window.stemstage.game.stop(); window.stemstage.settings.bosses = 'random'; window.stemstage.settings.venue = 'auto'; window.stemstage.ui.show('menu'); });
}

// Backstage: character, instruments, stages
await run(() => window.stemstage.ui.action('creator'));
await wait(1200);
await run(() => { const ui = window.stemstage.ui; const items = ui.navItems(); ui.focus = items.findIndex((x) => x.dataset.crCat === '6'); ui.applyFocus(false); const bs = window.stemstage.backstage; bs.autoSpin = false; bs.spin = -0.25; bs.turn(0); bs.autoSpin = false; });
await shot('backstage-character', 3500);
await run(() => { window.stemstage.backstage.autoSpin = true; });
await run(() => document.querySelector('[data-cr-mode="instrument"]').click());
await wait(600);
await run(() => { const ui = window.stemstage.ui; const items = ui.navItems(); ui.focus = items.findIndex((x) => x.dataset.crCat === '3'); ui.applyFocus(false); });
await shot('backstage-gear', 3500);
await run(() => document.querySelector('[data-cr-mode="stage"]').click());
await wait(600);
await run(() => { const ui = window.stemstage.ui; const items = ui.navItems(); ui.focus = items.findIndex((x) => x.dataset.crCat === '1'); ui.applyFocus(false); });
await shot('backstage-stage', 3000);
await run(() => document.querySelector('[data-cr-mode="character"]').click());
await run(() => window.stemstage.ui.show('menu'));
await browser.close();
