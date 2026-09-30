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
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && /WebGL|shader/i.test(message.text())) failures.push(message.text()); });
  await page.evaluateOnNewDocument(() => localStorage.setItem('stemstage.settings.v1', JSON.stringify({ quality: 'ultra', fullscreen: false })));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.stemstage?.stage?.crowd);
  const result = await page.evaluate(async () => {
    const app = window.stemstage;
    const stage = app.stage;
    stage.setVenue('arena');
    const before = stage.crowd.instanceMatrix.version;
    for (let i = 0; i < 120; i++) stage.update(1 / 60, { mode: 'game', beat: i / 30, intensity: 0.7, od: i > 60 });
    app.renderer.render(stage.scene, stage.camera);
    return {
      count: stage.crowd.count,
      before, after: stage.crowd.instanceMatrix.version,
      culling: stage.crowd.frustumCulled && stage.crowd.boundingSphere?.radius > 0,
      uniforms: Object.fromEntries(Object.entries(stage.crowdUniforms).map(([key, item]) => [key, item.value])),
      attributes: ['aCrowdPhase', 'aCrowdAmp', 'aCrowdJumper'].map((key) => stage.crowd.geometry.getAttribute(key)?.count),
    };
  });
  assert.equal(result.count, 1700);
  assert.equal(result.after, result.before, 'crowd matrices must not upload during animation');
  assert(result.culling, 'the crowd should still be culled outside the camera');
  assert.deepEqual(result.attributes, [1700, 1700, 1700]);
  assert(result.uniforms.uCrowdTime > 0 && result.uniforms.uCrowdJump > 0 && result.uniforms.uCrowdOD === 1);
  assert.deepEqual(failures, []);
  console.log('Ultra crowd animates with static instance matrices and a compiled GPU shader');
} finally {
  await browser.close();
  server.close();
}
