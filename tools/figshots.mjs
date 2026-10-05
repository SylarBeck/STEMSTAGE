// Dev only: photographs band members on tools/figtest.html with headless Chrome, for checking the MPFB bodies.
//   npx vite --port 5273   then   node tools/figshots.mjs <out-dir> "<query>|<view yaw>|<view framing>[|<js to run first>]" ...
//   e.g. node tools/figshots.mjs shots "part=guitar&preset=metal&t=1.3|0.3|full"
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [out, ...jobs] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:5273/tools/figtest.html';
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 800, height: 600 }, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));
for (const [i, job] of jobs.entries()) {
  const [q, yaw = '0', framing = 'full', js = ''] = job.split('|');
  await page.goto(`${URL}?${q}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.fig?.fig?.retarget, { timeout: 60000 });
  await page.evaluate((y, z) => window.view(+y, z.startsWith('[') ? JSON.parse(z) : z), yaw, framing);
  if (js) await page.evaluate(js);
  await new Promise((r) => setTimeout(r, 600));
  const file = path.join(out, `shot${i}.png`);
  await page.screenshot({ path: file });
  console.log(file, job);
}
await browser.close();
