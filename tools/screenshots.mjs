// Captures the README screenshots from a running STEMSTAGE (default http://127.0.0.1:5191 — start one with an
// empty library so only the built-in demo song shows):
//   PORT=5191 STEMSTAGE_SONGS=%TEMP%\ss-songs STEMSTAGE_DATA=%TEMP%\ss-data node server/app.js
//   npm run screenshots
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:5191/';
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.stemstage?.ui, { timeout: 30000 });
// the demo song is generated on first run
await page.waitForFunction(() => window.stemstage.ui.songs.some((s) => s.id === 'demo-neon-overdrive'), { timeout: 120000 });
await wait(1500);

const shot = async (name, settle = 900) => { await wait(settle); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log(`${name}.png`); };
const run = (fn, ...args) => page.evaluate(fn, ...args);

await shot('title', 2500);
await page.keyboard.press('Enter');
await wait(800);
await run(() => { const ui = window.stemstage.ui; if (ui.screen !== 'menu') ui.show('menu'); });
await shot('menu', 1500);

await run(() => { const ui = window.stemstage.ui; ui.mode = 'solo'; ui.show('library'); });
await wait(800);
await run(() => { const ui = window.stemstage.ui; ui.selectSong('demo-neon-overdrive', true); ui.instrument = 'guitar'; ui.difficulty = 'expert'; ui.renderDetail(ui.selected); });
await shot('setlist', 1200);

// gameplay: keep the crowd happy and a streak going so the board shows its multiplier lights
const play = async (instrument, od = false) => {
  await run(async (inst) => {
    const ui = window.stemstage.ui;
    ui.mode = 'solo'; ui.show('library');
    await new Promise((r) => setTimeout(r, 600));
    ui.selectSong('demo-neon-overdrive'); ui.instrument = inst; ui.difficulty = 'expert';
    await ui.play();
    clearInterval(window.__keep);
    window.__keep = setInterval(() => { const p = window.stemstage.game.players[0]; if (p) { p.rock = 0.95; if (p.streak < 27) { p.streak = 27 + Math.floor(Math.random() * 3); p._updateMult(); } p.od = Math.max(p.od, 0.75); } }, 30);
  }, instrument);
  await wait(9000);
  if (od) { await run(() => { const p = window.stemstage.game.players[0]; p.od = 1; p.activateOD(); }); await wait(1600); }
};
await play('guitar');
await shot('gameplay', 200);
await run(() => { const p = window.stemstage.game.players[0]; p.od = 1; p.activateOD(); });
await shot('overdrive', 1600);
await run(() => { clearInterval(window.__keep); window.stemstage.game.stop(); });
await play('drums');
await shot('drums', 200);
await run(() => { clearInterval(window.__keep); window.stemstage.game._finish(); });
await wait(3500);
await shot('results', 1500);

await run(() => { const ui = window.stemstage.ui; ui.show('controller'); });
await wait(1200);
await run(() => { const ui = window.stemstage.ui; const i = ui.navItems().findIndex((x) => x.dataset.dev?.startsWith('pad:')); if (i >= 0) { ui.focus = i; ui.applyFocus(false); } });
await shot('controllers', 1500);

await run(() => { const ui = window.stemstage.ui; ui.party = []; ui.show('band'); });
await wait(500);
await page.keyboard.press('KeyD');
await wait(500);
await page.keyboard.press('KeyU');
await wait(400);
await run(() => { const ui = window.stemstage.ui; ui.party[1].instrument = 'drums'; ui.party[1].strum = false; ui.party[0].ready = true; ui.renderBand(true); });
await shot('band', 1200);

await browser.close();
