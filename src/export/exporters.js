// Chart pack export: Clone Hero / YARG style folder (notes.mid + song.ini + WAV stems)
// plus a pitched General-MIDI transcription for DAWs, bundled into a .zip.

// ---------------------------------------------------------------- CRC32 + ZIP (store)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}
const crcFinal = (c) => (c ^ 0xffffffff) >>> 0;

export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crcFinal(crc32(data));
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameBytes.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nameBytes, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ---------------------------------------------------------------- WAV
export function wavBytes(planar, n, sampleRate = 44100) {
  const data = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true);
  data.setUint32(24, sampleRate, true); data.setUint32(28, sampleRate * 4, true);
  data.setUint16(32, 4, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, n * 4, true);
  const out = new Int16Array(data.buffer, 44, n * 2);
  for (let i = 0; i < n; i++) { out[2 * i] = planar[i]; out[2 * i + 1] = planar[n + i]; }
  return new Uint8Array(data.buffer);
}

// ---------------------------------------------------------------- MIDI
const PPQ = 480;

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

class Track {
  constructor(name) { this.events = []; if (name) this.meta(0, 0x03, new TextEncoder().encode(name)); }
  meta(tick, type, bytes) { this.events.push({ tick, order: 0, bytes: [0xff, type, ...vlq(bytes.length), ...bytes] }); }
  text(tick, s) { this.meta(tick, 0x01, new TextEncoder().encode(s)); }
  note(tick, len, pitch, vel = 100, ch = 0) {
    this.events.push({ tick, order: 2, bytes: [0x90 | ch, pitch, vel] });
    this.events.push({ tick: tick + Math.max(1, len), order: 1, bytes: [0x80 | ch, pitch, 0] });
  }
  program(tick, prog, ch) { this.events.push({ tick, order: 0, bytes: [0xc0 | ch, prog] }); }
  bytes() {
    this.events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const out = [];
    let last = 0;
    for (const e of this.events) { out.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes); last = Math.max(last, e.tick); }
    out.push(0, 0xff, 0x2f, 0);
    return out;
  }
}

function midiFile(tracks) {
  const chunks = [[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]];
  for (const t of tracks) {
    const body = t.bytes();
    const L = body.length;
    chunks.push([0x4d, 0x54, 0x72, 0x6b, (L >>> 24) & 0xff, (L >>> 16) & 0xff, (L >>> 8) & 0xff, L & 0xff, ...body]);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Maps seconds <-> ticks using the tracked beat grid (every beat is one quarter note). */
function tickMapper(beats) {
  const pos = (t) => {
    let lo = 0, hi = beats.length - 1;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    if (t >= beats[hi]) return hi + (t - beats[hi]) / (beats[hi] - beats[hi - 1]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  };
  const p0 = pos(0);
  return { tick: (t) => Math.max(0, Math.round((pos(t) - p0) * PPQ)), p0 };
}

function tempoTrack(song, map) {
  const tr = new Track(song.title);
  tr.meta(0, 0x58, [4, 2, 24, 8]);
  const b = song.beats;
  const i0 = Math.max(0, Math.floor(map.p0));
  const tempoAt = (i) => Math.round((b[Math.min(i + 1, b.length - 1)] - b[i]) * 1e6) || 500000;
  const put = (tick, us) => tr.meta(tick, 0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
  put(0, tempoAt(i0));
  let lastUs = tempoAt(i0);
  for (let i = i0 + 1; i < b.length - 1; i++) {
    if (b[i] > song.duration + 1) break;
    const us = tempoAt(i);
    if (Math.abs(us - lastUs) > 200) { put(map.tick(b[i]), us); lastUs = us; }
  }
  return tr;
}

const BASE = { easy: 60, medium: 72, hard: 84, expert: 96 };
const PART = { guitar: 'PART GUITAR', bass: 'PART BASS', drums: 'PART DRUMS', keys: 'PART KEYS' };

export function chartMidi(song) {
  const map = tickMapper(song.beats);
  const tracks = [tempoTrack(song, map)];
  for (const inst of ['guitar', 'bass', 'drums', 'keys']) {
    const ch = song.charts[inst];
    if (!ch?.available) continue;
    const tr = new Track(PART[inst]);
    for (const [diff, base] of Object.entries(BASE)) {
      for (const n of ch.notes[diff]) {
        const t0 = map.tick(n.t);
        const len = n.len > 0 ? Math.max(PPQ / 4, map.tick(n.t + n.len) - t0) : PPQ / 16;
        tr.note(t0, len, base + n.lane);
        if (inst === 'drums' && diff === 'expert' && n.lane === 3) tr.note(t0, PPQ / 16, 111); // blue = tom (pro drums)
      }
    }
    for (const ph of ch.phrases) tr.note(map.tick(Math.max(0, ph.start)), map.tick(ph.end) - map.tick(Math.max(0, ph.start)), 116);
    tracks.push(tr);
  }
  const ev = new Track('EVENTS');
  ev.text(map.tick(0.01), '[music_start]');
  ev.text(map.tick(song.duration - 0.5), '[music_end]');
  ev.text(map.tick(song.duration), '[end]');
  tracks.push(ev);
  return midiFile(tracks);
}

export function transcriptionMidi(song) {
  const map = tickMapper(song.beats);
  const tracks = [tempoTrack(song, map)];
  const setup = { guitar: [29, 0], bass: [33, 1], keys: [4, 2], vocals: [53, 3], drums: [0, 9] };
  for (const inst of ['drums', 'bass', 'guitar', 'keys', 'vocals']) {
    const ch = song.charts[inst];
    if (!ch?.available) continue;
    const [prog, chan] = setup[inst];
    const tr = new Track(inst[0].toUpperCase() + inst.slice(1));
    if (chan !== 9) tr.program(0, prog, chan);
    const seen = new Set();
    for (const n of ch.notes.expert) {
      const key = `${n.t}:${n.m}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t0 = map.tick(n.t);
      const len = n.len > 0 ? map.tick(n.t + n.len) - t0 : PPQ / 4;
      const vel = Math.max(40, Math.min(127, Math.round(50 + n.s * 50)));
      tr.note(t0, Math.max(30, len), Math.max(0, Math.min(127, n.m)), vel, chan);
    }
    tracks.push(tr);
  }
  return midiFile(tracks);
}

export function songIni(song) {
  const diff = (inst) => (song.charts[inst]?.available ? Math.min(6, Math.max(0, Math.round(song.charts[inst].notes.expert.length / song.duration / 1.2))) : -1);
  return [
    '[song]',
    `name = ${song.title}`,
    `artist = ${song.artist}`,
    `charter = STEMSTAGE auto-charter (${song.model})`,
    `song_length = ${Math.round(song.duration * 1000)}`,
    `diff_guitar = ${diff('guitar')}`,
    `diff_bass = ${diff('bass')}`,
    `diff_drums = ${diff('drums')}`,
    `diff_keys = ${diff('keys')}`,
    'pro_drums = True',
    'delay = 0',
    `preview_start_time = ${Math.round(song.duration * 300)}`,
    '',
  ].join('\r\n');
}

const STEM_FILE = { guitar: 'guitar.wav', bass: 'bass.wav', drums: 'drums.wav', keys: 'keys.wav', vocals: 'vocals.wav', other: 'song.wav' };
export { STEM_FILE };

export function buildChartPack(song, audio) {
  const safe = `${song.artist} - ${song.title}`.replace(/[\\/:*?"<>|]/g, '_');
  const enc = new TextEncoder();
  const files = [
    { name: `${safe}/notes.mid`, data: chartMidi(song) },
    { name: `${safe}/transcription.mid`, data: transcriptionMidi(song) },
    { name: `${safe}/song.ini`, data: enc.encode(songIni(song)) },
  ];
  for (const [stem, pcm] of Object.entries(audio.stems)) {
    if (!STEM_FILE[stem]) continue;
    files.push({ name: `${safe}/${STEM_FILE[stem]}`, data: wavBytes(pcm, song.length, song.sampleRate) });
  }
  return { blob: makeZip(files), filename: `${safe}.zip` };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
