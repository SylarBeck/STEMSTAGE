// Screenshots of real instrument mode (tablature + keyboard) for the README, site and wiki:
//   npm run dev  (or any running STEMSTAGE)   then   URL=http://127.0.0.1:5173/ node tools/screenshots-real.mjs
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:5173/';
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--mute-audio',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], // a fake input stands in for the guitar
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.stemstage?.ui?.songs?.some((s) => s.id === 'demo-neon-overdrive'), { timeout: 120000 });
await wait(1500);

for (const inst of ['guitar', 'bass', 'keys']) {
  await page.evaluate(async (i) => {
    const { settings } = await import('/src/settings.js').catch(() => ({ settings: null }));
    if (settings) settings.realInstrument = true;
    const ui = window.stemstage.ui;
    window.stemstage.game.stop();
    ui.mode = 'solo'; ui.show('library');
    await new Promise((r) => setTimeout(r, 600));
    ui.selectSong('demo-neon-overdrive'); ui.instrument = i; ui.difficulty = 'expert';
    await ui.play();
    // mark the notes that go by as hit so the view shows its hit colours
    clearInterval(window.__keep);
    window.__keep = setInterval(() => {
      const p = window.stemstage.game.players[0];
      if (!p) return;
      const t = window.stemstage.engine.songTime;
      for (const n of p.notes) if (!n.judged && n.t < t - 0.02) p.hit(n, 0.01);
      p.rock = 0.95;
    }, 30);
  }, inst);
  await wait(inst === 'keys' ? 14000 : 11000);
  await page.screenshot({ path: path.join(out, `real-${inst}.png`) });
  console.log(`real-${inst}.png`);
}
await browser.close();
