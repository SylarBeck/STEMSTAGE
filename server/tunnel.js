// Internet play without port forwarding: a Cloudflare "quick tunnel" (free, no account) gives the local
// room server a public https address like https://mean-assist-lately-dim.trycloudflare.com. Only outbound
// connections are made, so no router or firewall setup is needed. The tunnel's four words are the
// invite code friends type to join.
//
// cloudflared is used from PATH, from %LOCALAPPDATA%\stemstage\bin, or downloaded there once (~40 MB)
// from Cloudflare's official GitHub releases.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'stemstage');
const BIN_DIR = path.join(HOME, 'bin');
const EXE = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const PID_FILE = path.join(HOME, 'tunnel.pid');
const ASSET = {
  win32: { x64: 'cloudflared-windows-amd64.exe', arm64: 'cloudflared-windows-amd64.exe', ia32: 'cloudflared-windows-386.exe' },
  linux: { x64: 'cloudflared-linux-amd64', arm64: 'cloudflared-linux-arm64' },
}[process.platform]?.[process.arch];
const URL_RE = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i;

export function createTunnel() {
  const state = { status: 'off', url: null, code: null, error: null, progress: 0 };
  let proc = null;
  let token = 0;

  function findBinary() {
    const local = path.join(BIN_DIR, EXE);
    if (fs.existsSync(local)) return local;
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
  }

  async function download() {
    if (!ASSET) throw new Error(`No cloudflared download for ${process.platform}/${process.arch} — install cloudflared yourself`);
    state.status = 'downloading';
    state.progress = 0;
    await fsp.mkdir(BIN_DIR, { recursive: true });
    const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}`, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Could not download cloudflared (HTTP ${res.status})`);
    const total = +res.headers.get('content-length') || 0;
    let got = 0;
    const tmp = path.join(BIN_DIR, `${EXE}.download`);
    const counter = new TransformStream({ transform(chunk, ctl) { got += chunk.byteLength; if (total) state.progress = got / total; ctl.enqueue(chunk); } });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(tmp));
    if (process.platform !== 'win32') await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, path.join(BIN_DIR, EXE));
    return path.join(BIN_DIR, EXE);
  }

  /** A tunnel left behind by a crashed/closed game (browser mode) keeps running; clean it up. */
  function killStale() {
    try {
      const pid = +fs.readFileSync(PID_FILE, 'utf8');
      // only if that PID is still a cloudflared process (PIDs get reused)
      let name = '';
      if (process.platform === 'win32') name = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || '';
      else { try { name = fs.readFileSync(`/proc/${pid}/comm`, 'utf8'); } catch { name = ''; } }
      if (pid && /cloudflared/i.test(name)) process.kill(pid);
    } catch { /* none */ }
    try { fs.rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
  }

  /**
   * Each quick tunnel gets its own DNS record a moment after cloudflared prints the URL. A friend whose
   * lookup lands before that gets NXDOMAIN, cached for a minute, so the code is only shown once Cloudflare's
   * resolver (DNS over HTTPS — no local cache is touched) has the record.
   */
  async function waitForDns(my, host) {
    const deadline = Date.now() + 30000;
    while (my === token && Date.now() < deadline) {
      try {
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        if (j.Status === 0 && j.Answer?.length) break;
      } catch { /* DoH unreachable: fall through to the deadline */ }
      await new Promise((res) => setTimeout(res, 1000));
    }
    if (my === token && state.status === 'starting') state.status = 'ready';
  }

  async function start(port) {
    stop();
    const my = ++token;
    let registered = false;
    Object.assign(state, { status: 'starting', url: null, code: null, error: null });
    try {
      killStale();
      const bin = findBinary() || await download();
      if (my !== token) return;
      state.status = 'starting';
      proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      try { fs.writeFileSync(PID_FILE, String(proc.pid)); } catch { /* ignore */ }
      const onData = (d) => {
        const text = String(d);
        const m = URL_RE.exec(text);
        if (m && !state.url) { state.url = m[0].toLowerCase(); state.code = m[1].toLowerCase(); }
        // usable once an edge connection is registered and the name resolves
        if (/Registered tunnel connection/i.test(text) && state.url && !registered) { registered = true; waitForDns(my, new URL(state.url).hostname); }
        if (/failed to request quick Tunnel|429 Too Many Requests/i.test(text)) state.error = 'Cloudflare refused a new tunnel right now — try again in a minute';
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('exit', (code) => {
        if (my !== token) return;
        proc = null;
        try { fs.rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
        if (state.status !== 'off') Object.assign(state, { status: 'error', error: state.error || `The tunnel stopped (exit ${code})` });
      });
      proc.on('error', (e) => { if (my === token) Object.assign(state, { status: 'error', error: e.message }); });
      // a URL that never confirmed (no registration / DNS check) after 45 s is still worth trying; no URL at all is an error
      setTimeout(() => {
        if (my !== token || state.status === 'ready') return;
        if (state.url) state.status = 'ready';
        else if (state.status === 'starting') Object.assign(state, { status: 'error', error: state.error || 'Could not open an internet tunnel (is the internet reachable?)' });
      }, 45000);
    } catch (e) {
      if (my === token) Object.assign(state, { status: 'error', error: e.message });
    }
  }

  function stop() {
    token++;
    if (proc) { try { proc.kill(); } catch { /* gone */ } proc = null; }
    try { fs.rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
    Object.assign(state, { status: 'off', url: null, code: null, error: null, progress: 0 });
  }

  process.on('exit', stop);
  return { start, stop, get info() { return { ...state }; } };
}
