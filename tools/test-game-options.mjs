import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve('dist', `.${pathname === '/' ? '/index.html' : pathname}`);
    const body = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage();
const failures = [];
page.on('pageerror', (e) => failures.push(e.message));
page.setDefaultTimeout(8000);
await page.evaluateOnNewDocument(() => localStorage.setItem('stemstage.settings.v1', JSON.stringify({ fullscreen: false, worldLeaderboard: true })));
await page.evaluateOnNewDocument(() => {
  const original = window.fetch.bind(window);
  window.__libraryCalls = [];
  window.fetch = (input, init) => {
    const address = typeof input === 'string' ? input : input.url;
    if (!address.startsWith('https://api.stemstage.varconstint.com/v1/library?')) return original(input, init);
    const url = new URL(address);
    window.__libraryCalls.push(url.search);
    const id = url.searchParams.has('before') ? 2 : 3;
    const row = { key: String(id).padStart(16, '0'), title: `Song ${id}`, artist: 'The Artist', parts: ['guitar'], charts: 1, players: 1 };
    return Promise.resolve(new Response(JSON.stringify({ rows: [row], next: id === 3 ? 3 : null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction(() => window.stemstage?.ui); }
  catch (e) { console.error('Boot failed:', await page.$eval('#fatal', (el) => el.textContent), failures); throw e; }
  await page.evaluate(() => window.stemstage.ui.show('chartlib'));
  await page.waitForSelector('[data-key]');
  assert.equal(await page.$eval('[data-key]', (el) => el.textContent.includes('Song 3')), true);
  await page.waitForFunction(() => { const more = document.querySelector('#cl-more'); return more && !more.hidden && !more.disabled; });
  await page.$eval('#cl-more', (el) => el.click());
  try { await page.waitForFunction(() => document.querySelectorAll('#cl-list [data-key]').length === 2); }
  catch (e) { console.error('Paging failed:', await page.evaluate(() => window.__libraryCalls), await page.$eval('#cl-list', (el) => el.textContent), await page.$eval('#cl-status', (el) => el.textContent), failures); throw e; }
  assert(await page.evaluate(() => window.__libraryCalls.some((q) => q.includes('before=3'))));
  await page.$eval('#cl-q', (el) => { el.value = 'blue'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => window.__libraryCalls.some((q) => q.includes('q=blue')) && document.querySelectorAll('#cl-list [data-key]').length === 1);
  assert(await page.evaluate(() => window.__libraryCalls.some((q) => q.includes('q=blue'))));
  await page.evaluate(() => window.stemstage.ui.show('settings'));
  await page.$eval('#settings-tabs [data-tab="Video"]', (el) => el.click());
  await page.$eval('[data-setting="antialiasing"] [data-c="off"]', (el) => el.click());
  const off = await page.evaluate(() => window.stemstage.renderer.composer.renderTarget1.samples);
  await page.$eval('[data-setting="antialiasing"] [data-c="4x"]', (el) => el.click());
  await page.$eval('[data-setting="renderScale"] [data-c="75"]', (el) => el.click());
  const video = await page.evaluate(() => ({ on: window.stemstage.renderer.composer.renderTarget1.samples, ratio: window.stemstage.renderer.renderer.getPixelRatio() }));
  assert.equal(off, 0);
  assert(video.on >= 2);
  assert.equal(video.ratio, 0.75);
  await page.$eval('[data-setting="frameLimit"] [data-c="30"]', (el) => el.click());
  const draws = await page.evaluate(async () => {
    const renderer = window.stemstage.renderer;
    const original = renderer.render;
    let count = 0;
    renderer.render = function (...args) { count++; return original.apply(this, args); };
    await new Promise((resolve) => setTimeout(resolve, 1100));
    renderer.render = original;
    return count;
  });
  assert(draws > 0 && draws <= 35, `30 FPS cap drew ${draws} frames`);
  assert.deepEqual(failures, []);
  console.log('Game chart search, paging, and video controls passed');
} finally {
  await browser.close();
  server.close();
}
