// Dev only: a smoke test in headless Chrome. Opens the game, plays the demo song for a while (in a venue, with a
// boss forced if it's a world), and reports page errors, frame times and a screenshot of the stage.
//   npx vite --port 5273   then   node tools/smoke.mjs <out.png> [venue] [seconds]
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const [out = 'smoke.png', venue = 'arena', secs = '20'] = process.argv.slice(2);
const URL = process.env.URL || 'http://127.0.0.1:5273/';
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--mute-audio'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|8766|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.stemstage?.ui?.songs?.length, { timeout: 120000 });
const res = await page.evaluate(async (venue, secs) => {
  const S = window.stemstage, ui = S.ui;
  const prev = { venue: S.settings.venue, bosses: S.settings.bosses };
  S.settings.venue = venue; S.settings.bosses = 'always';
  ui.selected = ui.songs.find((s) => s.id.includes('demo'));
  ui.instrument = 'guitar'; ui.difficulty = 'expert'; ui.mode = 'solo';
  const frames = []; let last = performance.now(), on = true;
  const rec = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(rec); };
  requestAnimationFrame(rec);
  await ui.play();
  await new Promise((r) => setTimeout(r, secs * 1000));
  on = false;
  Object.assign(S.settings, prev);
  const d = frames.slice(30).sort((a, b) => a - b);
  const q = (p) => +d[Math.floor(p * (d.length - 1))].toFixed(1);
  return { frames: d.length, p50: q(0.5), p95: q(0.95), max: q(1), long: d.filter((x) => x > 100).length, scale: S.renderer.dyn?.scale, boss: S.game.boss?.state || null };
}, venue, +secs);
await page.screenshot({ path: out });
console.log(JSON.stringify(res));
console.log(errors.length ? errors.slice(0, 15).join('\n') : 'no errors');
await browser.close();
