// Gameplay performance check: plays a song in headless Chrome and reports frame times, main-thread stalls
// (long tasks), input-poll jitter and the functions that use the most CPU.
//   npm run dev   then   URL=http://127.0.0.1:5173/ node tools/perf-profile.mjs [songId] [instrument]
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://127.0.0.1:5173/';
const SONG = process.argv[2] || 'demo-neon-overdrive';
const INST = process.argv[3] || 'guitar';
const SECONDS = +(process.env.SECONDS || 20);
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction((id) => window.stemstage?.ui?.songs?.some((s) => s.id === id), { timeout: 120000 }, SONG);
await wait(1500);
await page.evaluate(async (id, inst) => {
  const ui = window.stemstage.ui;
  ui.mode = 'solo'; ui.show('library');
  await new Promise((r) => setTimeout(r, 500));
  ui.selectSong(id); ui.instrument = inst; ui.difficulty = 'expert';
  await ui.play();
}, SONG, INST);
await wait(5000); // past the count-in

const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await page.evaluate(() => {
  window.__perf = { frames: [], long: [], polls: [] };
  let last = performance.now();
  const tick = (t) => { window.__perf.frames.push(t - last); last = t; if (window.__perf.on !== false) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
  // how often the game really reads the controllers (gaps between input.poll() calls)
  const input = window.stemstage.input, orig = input.poll.bind(input);
  let lp = performance.now();
  window.__perf.slow = [];
  input.poll = () => { const n = performance.now(); window.__perf.polls.push(n - lp); const r = orig(); lp = performance.now(); if (lp - n > 8) window.__perf.slow.push(Math.round(lp - n)); return r; };
  window.__perf.restore = () => { input.poll = orig; };
});
await cdp.send('Profiler.start');
await wait(SECONDS * 1000);
const { profile } = await cdp.send('Profiler.stop');
const r = await page.evaluate(() => { window.__perf.on = false; window.__perf.restore(); return window.__perf; });

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
const f = r.frames.slice(5);
console.log(`frames: ${f.length} in ${SECONDS}s → ${(f.length / SECONDS).toFixed(1)} fps · median ${q(f, 0.5).toFixed(1)} ms · p95 ${q(f, 0.95).toFixed(1)} · p99 ${q(f, 0.99).toFixed(1)} · max ${Math.max(...f).toFixed(1)} · frames over 33 ms: ${f.filter((x) => x > 33).length}`);
console.log(`long tasks (>50 ms): ${r.long.length}${r.long.length ? ` · ${r.long.slice(0, 20).join(', ')} ms` : ''}`);
console.log(`slow polls (>8 ms): ${r.slow.length}${r.slow.length ? ` · ${r.slow.slice(0, 10).join(', ')} ms` : ''}`);
const mi = r.polls.indexOf(Math.max(...r.polls));
console.log(`largest poll gap at read #${mi} of ${r.polls.length} (the profiler starts right after read #0-#5)`);
r.polls = r.polls.slice(20);
console.log(`controller reads (gap between polls): median ${q(r.polls, 0.5).toFixed(1)} ms · p99 ${q(r.polls, 0.99).toFixed(1)} · max ${Math.max(...r.polls).toFixed(1)}`);

// CPU profile: self time per function
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
for (const [id, us] of counts) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + us);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log('\ntop CPU (self time):');
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000 / SECONDS).toFixed(2).padStart(6)} ms/s  ${k}`);
await browser.close();
