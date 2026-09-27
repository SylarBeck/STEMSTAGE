// Compressed copies of song stems for online play: a 4-minute song is ~250 MB of WAV stems but ~25 MB
// as Opus. Uses ffmpeg (Opus 128 kbps) when it's on PATH, otherwise the game's Python environment
// (soundfile, Ogg Vorbis). Results are cached next to the song in <song folder>/.net/.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const VENV_PY = path.join(process.env.LOCALAPPDATA || '', 'stemstage', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
let ffmpegPath;

function findFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
  ffmpegPath = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
  return ffmpegPath;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `${cmd} exited with ${code}`))));
  });
}

const PY_ENCODE = [
  'import sys, soundfile as sf',
  'data, sr = sf.read(sys.argv[1], dtype="float32")',
  'sf.write(sys.argv[2], data, sr, format="OGG", subtype="VORBIS")',
].join('\n');

const pending = new Map();

/** Path of a compressed copy of `wavPath` (created on first use), or null if no encoder is available. */
export async function compressedStem(wavPath) {
  const dir = path.join(path.dirname(wavPath), '.net');
  const base = path.basename(wavPath, '.wav');
  const out = path.join(dir, `${base}.ogg`);
  try {
    const [a, b] = await Promise.all([fsp.stat(out), fsp.stat(wavPath)]);
    if (a.size > 0 && a.mtimeMs >= b.mtimeMs) return out;
  } catch { /* not cached yet */ }
  if (pending.has(out)) return pending.get(out);
  const job = (async () => {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${out}.${process.pid}.tmp.ogg`;
    try {
      const ff = findFfmpeg();
      if (ff) await run(ff, ['-y', '-v', 'error', '-i', wavPath, '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-application', 'audio', tmp]);
      else if (fs.existsSync(VENV_PY)) await run(VENV_PY, ['-c', PY_ENCODE, wavPath, tmp]);
      else return null;
      await fsp.rename(tmp, out);
      return out;
    } catch (e) {
      console.warn(`[online] could not compress ${wavPath}: ${e.message}`);
      await fsp.rm(tmp, { force: true });
      return null;
    }
  })();
  pending.set(out, job);
  try { return await job; } finally { pending.delete(out); }
}

/** Start compressing every stem of a song folder in the background (so friends don't wait). */
export async function precompress(dir) {
  try {
    const names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.wav') && f !== 'preview.wav');
    for (const f of names) await compressedStem(path.join(dir, f));
  } catch { /* song folder vanished */ }
}
