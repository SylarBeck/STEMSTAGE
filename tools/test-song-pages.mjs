import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
const server = createServer(async (req, res) => {
  try {
    const file = resolve('site', `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    const body = await readFile(file);
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = 'https://api.stemstage.varconstint.com/v1/';
const requests = [];
const song = (i) => ({ key: String(i).padStart(16, '0'), title: `Song ${i}`, artist: 'The Artist', entries: i });
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
async function pageFor(path) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('Page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('Console:', m.text()); });
  page.setDefaultTimeout(5000);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (!r.url().startsWith(api)) return r.continue();
    const u = new URL(r.url());
    requests.push(`${u.pathname}${u.search}`);
    if (u.pathname.endsWith('/songs')) return r.respond(json({ rows: u.searchParams.has('before') ? [song(2)] : [song(3)], next: u.searchParams.has('before') ? null : 3 }));
    if (u.pathname.endsWith('/library')) return r.respond(json({ rows: [{ ...song(u.searchParams.has('before') ? 2 : 3), parts: ['guitar'], charts: 1, players: 1 }], next: u.searchParams.has('before') ? null : 3 }));
    if (u.pathname.endsWith('/leaderboard')) return r.respond(json({ song: song(2), mode: 'ranked', rows: [] }));
    if (u.pathname.endsWith('/charts')) return r.respond(json({ rows: [], voteMin: 3 }));
    return r.respond(json({ rows: [], none: true, season: 1 }));
  });
  await page.goto(`${base}/${path}`, { waitUntil: 'domcontentloaded' });
  return page;
}

try {
  const leaderboard = await pageFor('leaderboard/index.html');
  await leaderboard.waitForSelector('[data-song]');
  assert.equal(await leaderboard.$eval('[data-song]', (el) => el.dataset.song), song(3).key);
  await leaderboard.click('#song-more');
  await leaderboard.waitForFunction(() => document.querySelectorAll('[data-song]').length === 2);
  assert.equal(await leaderboard.$eval('#song-more', (el) => getComputedStyle(el).display), 'none');
  assert(requests.some((u) => u.includes('/songs?') && u.includes('before=3')));
  await leaderboard.close();

  const deepLink = await pageFor(`leaderboard/index.html?song=${song(2).key}`);
  await deepLink.waitForFunction(() => document.querySelector('#selected-song')?.textContent.includes('Song 2'));
  assert(requests.some((u) => u.includes('/leaderboard?') && u.includes(`song=${song(2).key}`)));
  await deepLink.close();

  const charts = await pageFor('charts/index.html');
  await charts.waitForSelector('#songs li b');
  await charts.click('#more-songs');
  await charts.waitForFunction(() => document.querySelectorAll('#songs li b').length === 2);
  assert.equal(await charts.$eval('#more-songs', (el) => getComputedStyle(el).display), 'none');
  assert(requests.some((u) => u.includes('/library?') && u.includes('before=3')));
  await charts.close();
  console.log('Song search pages: paging and deep link passed');
} finally {
  await browser.close();
  server.close();
}
