// Puts the runtimes the desktop app ships with into src-tauri/bin/ (bundled as the app's "bin" resource):
//   node(.exe)  Node.js LTS — runs the game server, so players don't need Node.js installed
//   uv(.exe)    Astral's uv — installs Python and the game's Python packages (controller bridge, AI splitter)
// Runs before every desktop build (tauri.conf.json → beforeBuildCommand). Downloads only what's missing or
// outdated; set STEMSTAGE_NODE_MAJOR to change the Node.js line (default 22).
// uv is pinned so builds do not depend on GitHub's anonymous API rate limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(root, 'src-tauri', 'bin');
const win = process.platform === 'win32';
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const NODE_MAJOR = process.env.STEMSTAGE_NODE_MAJOR || '22';
const UV_VERSION = process.env.STEMSTAGE_UV_VERSION || '0.12.19';
if (!/^\d+\.\d+\.\d+$/.test(UV_VERSION)) throw new Error('STEMSTAGE_UV_VERSION must be a version like 0.12.19');
fs.mkdirSync(bin, { recursive: true });
const stampFile = path.join(bin, 'versions.json');
const stamps = (() => { try { return JSON.parse(fs.readFileSync(stampFile, 'utf8')); } catch { return {}; } })();

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'STEMSTAGE build' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
// tar handles .zip too on Windows 10+ (bsdtar); on Linux it handles .tar.gz / .tar.xz
// (Windows' own tar.exe: a GNU tar from Git for Windows on PATH reads "C:" as a remote host)
const TAR = win ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
const untar = (archive, dir, ...members) => execFileSync(TAR, ['-xf', archive, '-C', dir, ...members], { stdio: 'inherit' });

// ---------------------------------------------------------------- Node.js
const releases = await (await fetch('https://nodejs.org/dist/index.json')).json();
const node = releases.find((r) => r.version.startsWith(`v${NODE_MAJOR}.`) && r.lts);
if (!node) throw new Error(`no Node.js ${NODE_MAJOR} LTS release found`);
const nodeExe = path.join(bin, win ? 'node.exe' : 'node');
if (stamps.node !== node.version || !fs.existsSync(nodeExe)) {
  console.log(`Node.js ${node.version} → src-tauri/bin`);
  if (win) await download(`https://nodejs.org/dist/${node.version}/win-${arch}/node.exe`, nodeExe);
  else {
    const name = `node-${node.version}-linux-${arch}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stemstage-node-'));
    await download(`https://nodejs.org/dist/${node.version}/${name}.tar.xz`, path.join(tmp, 'node.tar.xz'));
    untar(path.join(tmp, 'node.tar.xz'), tmp, `${name}/bin/node`);
    fs.copyFileSync(path.join(tmp, name, 'bin', 'node'), nodeExe);
    fs.chmodSync(nodeExe, 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  stamps.node = node.version;
} else console.log(`Node.js ${node.version} already in src-tauri/bin`);

// ---------------------------------------------------------------- uv
const uvVersion = UV_VERSION;
const uvExe = path.join(bin, win ? 'uv.exe' : 'uv');
if (stamps.uv !== uvVersion || !fs.existsSync(uvExe)) {
  console.log(`uv ${uvVersion} → src-tauri/bin`);
  const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${win ? 'pc-windows-msvc' : 'unknown-linux-gnu'}`;
  const file = `uv-${target}.${win ? 'zip' : 'tar.gz'}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stemstage-uv-'));
  await download(`https://github.com/astral-sh/uv/releases/download/${uvVersion}/${file}`, path.join(tmp, file));
  untar(path.join(tmp, file), tmp);
  const found = [path.join(tmp, win ? 'uv.exe' : 'uv'), path.join(tmp, `uv-${target}`, 'uv')].find((f) => fs.existsSync(f));
  if (!found) throw new Error('uv binary not found in the archive');
  fs.copyFileSync(found, uvExe);
  if (!win) fs.chmodSync(uvExe, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  stamps.uv = uvVersion;
} else console.log(`uv ${uvVersion} already in src-tauri/bin`);

fs.writeFileSync(stampFile, JSON.stringify(stamps, null, 2));
