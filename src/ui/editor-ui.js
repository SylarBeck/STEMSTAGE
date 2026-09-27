// Chart editor: a 2D highway you can play, scrub and edit with a controller, keyboard or mouse.
//   D-pad / arrows   move the cursor (up = later) and lane      ✕ / Enter   add or remove a note
//   L1 / R1 (Q / E)  snap (1/4 … 1/16, triplets)                L2 / R2     jump a measure
//   ▢ (F)            longer sustain on the note at the cursor   Share       undo
//   △ (Tab)          tools: sustains, overdrive, undo/redo, rebuild difficulties, save, revert
//   Keyboard extras: Space play/pause · 1–5 place notes (also live while playing) · Del delete ·
//   [ ] sustain · P overdrive phrase · Ctrl+Z / Ctrl+Y · Ctrl+S save · + / - zoom
// Edits are saved into song.json; the first save keeps the AI chart so it can be restored.
import { getSong, getAudio, saveSongJson } from '../storage/library.js';
import { Grid, reduceFromExpert, applyPhrases } from '../audio/charter.js';
import { FIVE_COLORS, DRUM_COLORS } from '../game/highway.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SNAPS = [1, 2, 3, 4, 6, 8]; // steps per beat
const SNAP_LABEL = { 1: '1/4', 2: '1/8', 3: '1/8 T', 4: '1/16', 6: '1/16 T', 8: '1/32' };
const SPEEDS = [0.5, 0.75, 1];
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const fmt = (t) => `${Math.floor(Math.max(0, t) / 60)}:${(Math.max(0, t) % 60).toFixed(2).padStart(5, '0')}`;
const EPS = 1e-4;

export function installEditor(ui) {
  const app = ui.app;
  const E = { open: false };
  let canvas, g2, raf = 0;

  // ---------------------------------------------------------------- open / close
  async function open(songId, inst, diff) {
    const song = await getSong(songId);
    if (!song?.charts?.[inst]?.available) { ui.toast('That part has no chart to edit', 'err'); return; }
    ui.toast('Loading the editor...');
    const audio = await getAudio(songId);
    Object.assign(E, {
      open: true, song, inst, diff, drums: inst === 'drums',
      grid: new Grid(song.beats), snap: 4, lane: 2, pos: 0, zoom: 90, speed: 1,
      notes: song.charts[inst].notes[diff].map(clean), phrases: (song.charts[inst].phrases || []).map((p) => ({ ...p })),
      undo: [], redo: [], dirty: false, playing: false, ticks: true, buffer: null,
    });
    E.pos = Math.max(0, snapPos(E.grid.pos(E.notes[0]?.t ?? song.beats[0])));
    E.buffer = audio ? mixBuffer(audio.stems, song) : null;
    app.menuMusic(false);
    ui.stopPreview?.();
    ui.show('editor');
    canvas = $('#ed-canvas');
    g2 = canvas.getContext('2d');
    status();
    cancelAnimationFrame(raf);
    const loop = () => { if (!E.open) return; draw(); raf = requestAnimationFrame(loop); };
    loop();
  }

  const clean = (n) => ({ t: n.t, lane: n.lane, len: n.len || 0, m: n.m ?? 60, s: n.s ?? 1, p: n.p ?? -1, q: n.q });

  function close() {
    stop();
    E.open = false;
    cancelAnimationFrame(raf);
    ui.show('library');
  }

  async function leave() {
    if (E.dirty && !(await ui.confirmDialog('Leave the editor?', 'You have unsaved changes', 'Leave without saving'))) return;
    close();
  }

  // ---------------------------------------------------------------- audio
  function mixBuffer(stems, song) {
    const ctx = app.engine.ctx;
    const len = song.length;
    const buf = ctx.createBuffer(2, len, song.sampleRate || 44100);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const names = Object.keys(stems);
    const k = 1 / 32768 / Math.max(1, Math.sqrt(names.length) * 0.8);
    for (const name of names) {
      const s = stems[name];
      for (let i = 0; i < len; i++) { L[i] += s[i] * k; R[i] += s[len + i] * k; }
    }
    return buf;
  }

  function play() {
    if (!E.buffer) { ui.toast('No audio for this song', 'err'); return; }
    const ctx = app.engine.ctx;
    app.engine.unlock();
    const from = Math.max(0, E.grid.time(E.pos));
    const src = ctx.createBufferSource();
    src.buffer = E.buffer;
    src.playbackRate.value = E.speed;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(ctx.destination);
    src.start(ctx.currentTime + 0.03, from);
    E.src = src;
    E.playFrom = from;
    E.playAt = ctx.currentTime + 0.03;
    E.playing = true;
    E.lastTickT = from;
    src.onended = () => { if (E.src === src) { E.playing = false; E.src = null; } };
  }

  function stop() {
    if (!E.playing) return;
    const t = playTime();
    try { E.src?.stop(); } catch { /* ended */ }
    E.src = null;
    E.playing = false;
    E.pos = snapPos(E.grid.pos(t)); // the cursor lands where playback stopped
    status();
  }

  const playTime = () => E.playFrom + Math.max(0, app.engine.ctx.currentTime - E.playAt) * E.speed;
  const curTime = () => (E.playing ? playTime() : E.grid.time(E.pos));

  // ---------------------------------------------------------------- editing
  const snapPos = (p) => Math.round(p * E.snap) / E.snap;
  const sorted = () => E.notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const noteAt = (t, lane) => E.notes.find((n) => n.lane === lane && Math.abs(n.t - t) < 0.012);

  function snapshot() {
    E.undo.push(JSON.stringify({ n: E.notes, p: E.phrases }));
    if (E.undo.length > 200) E.undo.shift();
    E.redo = [];
    E.dirty = true;
  }
  function restore(from, to) {
    if (!from.length) return false;
    to.push(JSON.stringify({ n: E.notes, p: E.phrases }));
    const s = JSON.parse(from.pop());
    E.notes = s.n; E.phrases = s.p;
    E.dirty = true;
    status();
    return true;
  }

  function toggle(lane = E.lane, pos = E.pos) {
    const t = E.grid.time(pos);
    const hit = noteAt(t, lane);
    snapshot();
    if (hit) E.notes.splice(E.notes.indexOf(hit), 1);
    else {
      const n = { t, lane, len: 0, m: 60, s: 1, p: -1 };
      E.notes.push(n);
      sorted();
      applyPhrases(E.notes, E.phrases);
      if (E.ticks) app.engine.sfxTick(0, false);
    }
    status();
  }

  /** Live charting: place a note at the playhead while the song plays. */
  function recordAt(lane) {
    const pos = snapPos(E.grid.pos(playTime() - 0.02));
    const t = E.grid.time(pos);
    if (noteAt(t, lane)) return;
    snapshot();
    E.notes.push({ t, lane, len: 0, m: 60, s: 1, p: -1 });
    sorted();
    applyPhrases(E.notes, E.phrases);
    status();
  }

  function sustain(d) {
    if (E.drums) { ui.toast('Drums have no sustains'); return; }
    const n = noteAt(E.grid.time(E.pos), E.lane);
    if (!n) { ui.toast('Put the cursor on a note first'); return; }
    snapshot();
    const endPos = E.grid.pos(n.t + n.len) + d / E.snap;
    const startPos = E.grid.pos(n.t);
    n.len = endPos <= startPos + EPS ? 0 : Math.max(0, E.grid.time(endPos) - n.t);
    status();
  }

  function moveNoteLane(d) {
    const n = noteAt(E.grid.time(E.pos), E.lane);
    const to = E.lane + d;
    if (!n || to < 0 || to > 4 || noteAt(n.t, to)) return false;
    snapshot();
    n.lane = to;
    E.lane = to;
    status();
    return true;
  }

  /** Overdrive phrase: add or remove one covering the measure at the cursor. */
  function togglePhrase() {
    const t = curTime();
    const hit = E.phrases.find((p) => t >= p.start && t <= p.end);
    snapshot();
    if (hit) E.phrases.splice(E.phrases.indexOf(hit), 1);
    else {
      const down = E.song.downbeat || 0;
      const bar = Math.floor((E.grid.pos(t) - down) / 4) * 4 + down;
      E.phrases.push({ start: E.grid.time(bar) - 0.01, end: E.grid.time(bar + 4) - 0.02 });
      E.phrases.sort((a, b) => a.start - b.start);
    }
    applyPhrases(E.notes, E.phrases);
    ui.toast(hit ? 'Overdrive phrase removed' : 'Overdrive phrase added for this measure');
    status();
  }

  function move(dPos) {
    if (E.playing) stop();
    const max = E.song.beats.length - 1;
    E.pos = Math.max(-1, Math.min(max, snapPos(E.pos + dPos)));
    status();
  }

  function setSnap(d) {
    E.snap = SNAPS[Math.max(0, Math.min(SNAPS.length - 1, SNAPS.indexOf(E.snap) + d))];
    E.pos = snapPos(E.pos);
    status();
  }

  // ---------------------------------------------------------------- save
  async function save() {
    const song = E.song;
    const chart = song.charts[E.inst];
    sorted();
    applyPhrases(E.notes, E.phrases);
    chart.aiNotes ||= {};
    if (!chart.aiNotes[E.diff]) chart.aiNotes[E.diff] = chart.notes[E.diff]; // keep the AI version once
    chart.aiPhrases ||= chart.phrases;
    chart.notes[E.diff] = E.notes.map((n) => ({ ...n, q: Math.round(E.grid.pos(n.t) * 48) / 48 }));
    chart.phrases = E.phrases;
    for (const d of Object.keys(chart.notes)) if (d !== E.diff) applyPhrases(chart.notes[d], E.phrases);
    chart.edited = { ...(chart.edited || {}), [E.diff]: Date.now() };
    try {
      await saveSongJson(song);
      E.dirty = false;
      await ui.reloadSongs();
      ui.toast(`Saved ${E.inst} · ${E.diff}`, 'ok');
    } catch (e) { ui.toast(e.message, 'err'); }
    status();
  }

  async function rebuildLower() {
    if (E.diff !== 'expert') { ui.toast('Open the Expert chart to rebuild the easier ones from it'); return; }
    if (!(await ui.confirmDialog('Rebuild Easy, Medium and Hard?', 'They are regenerated from this Expert chart (your other edits to them are replaced)', 'Rebuild'))) return;
    const out = reduceFromExpert(E.inst, E.notes, E.song.beats, E.phrases, E.song.sub || 4);
    const chart = E.song.charts[E.inst];
    chart.aiNotes ||= {};
    for (const d of ['easy', 'medium', 'hard']) {
      if (!chart.aiNotes[d]) chart.aiNotes[d] = chart.notes[d];
      chart.notes[d] = out[d].map(clean);
    }
    await save();
    ui.toast(`Easy ${out.easy.length} · Medium ${out.medium.length} · Hard ${out.hard.length} notes`, 'ok');
  }

  async function revert() {
    const chart = E.song.charts[E.inst];
    const ai = chart.aiNotes?.[E.diff];
    if (!ai) { ui.toast('This chart has not been edited'); return; }
    if (!(await ui.confirmDialog('Restore the AI chart?', `${E.inst} · ${E.diff} goes back to what the AI made`, 'Restore'))) return;
    snapshot();
    E.notes = ai.map(clean);
    if (chart.aiPhrases) { E.phrases = chart.aiPhrases.map((p) => ({ ...p })); applyPhrases(E.notes, E.phrases); }
    await save();
  }

  function tools() {
    const n = noteAt(E.grid.time(E.pos), E.lane);
    ui.openSheet({
      title: 'Chart tools', sub: `${E.song.title} · ${E.inst} · ${E.diff}${E.dirty ? ' · unsaved' : ''}`,
      items: [
        { label: '💾 Save', desc: 'Write the chart into the song', run: () => save() },
        { label: E.playing ? '⏸ Pause' : '▶ Play from cursor', desc: `Speed ${Math.round(E.speed * 100)}% · Space on the keyboard`, run: () => (E.playing ? stop() : play()) },
        { label: `Playback speed: ${Math.round(E.speed * 100)}%`, desc: 'Slower playback for tricky parts', run: () => { E.speed = SPEEDS[(SPEEDS.indexOf(E.speed) + 1) % SPEEDS.length]; if (E.playing) { stop(); play(); } status(); } },
        { label: `Note ticks: ${E.ticks ? 'on' : 'off'}`, desc: 'Click on every note during playback', run: () => { E.ticks = !E.ticks; status(); } },
        { label: 'Longer sustain', desc: 'On the note at the cursor ( ] )', disabled: !n || E.drums, run: () => sustain(1) },
        { label: 'Shorter sustain', desc: '( [ )', disabled: !n || !n.len, run: () => sustain(-1) },
        { label: 'Overdrive phrase', desc: 'Add / remove one for this measure ( P )', run: () => togglePhrase() },
        { label: 'Undo', desc: `${E.undo.length} step(s) · Ctrl+Z`, disabled: !E.undo.length, run: () => restore(E.undo, E.redo) },
        { label: 'Redo', desc: 'Ctrl+Y', disabled: !E.redo.length, run: () => restore(E.redo, E.undo) },
        { label: 'Rebuild Easy / Medium / Hard', desc: 'From this Expert chart', disabled: E.diff !== 'expert', run: () => rebuildLower() },
        { label: 'Switch part', desc: 'Edit another instrument or difficulty', run: () => switchPart() },
        { label: 'Restore AI chart', desc: 'Undo every saved edit to this part', danger: true, disabled: !E.song.charts[E.inst].aiNotes?.[E.diff], run: () => revert() },
        { label: 'Exit editor', run: () => leave() },
      ],
    });
  }

  async function switchPart() {
    if (E.dirty && !(await ui.confirmDialog('Switch part?', 'Unsaved changes will be lost', 'Switch'))) return;
    const insts = Object.keys(E.song.charts).filter((i) => E.song.charts[i]?.available);
    const items = [];
    for (const i of insts) for (const d of ['easy', 'medium', 'hard', 'expert']) {
      items.push({ label: `${i} · ${d}`, desc: `${E.song.charts[i].notes[d]?.length || 0} notes${E.song.charts[i].edited?.[d] ? ' · edited' : ''}`, disabled: i === E.inst && d === E.diff, run: () => { stop(); open(E.song.id, i, d); } });
    }
    setTimeout(() => ui.openSheet({ title: 'Switch part', items }), 0);
  }

  // ---------------------------------------------------------------- input
  ui.navHooks.push((dir) => {
    if (ui.screen !== 'editor' || ui.sheet || ui.osk.open) return false;
    switch (dir) {
      case 'up': move(1 / E.snap); break;
      case 'down': move(-1 / E.snap); break;
      case 'left': if (E.lane > 0) { E.lane--; status(); } break;
      case 'right': if (E.lane < 4) { E.lane++; status(); } break;
      case 'confirm': if (E.playing) recordAt(E.lane); else toggle(); break;
      case 'prev': setSnap(-1); break;
      case 'next': setSnap(1); break;
      case 'pgup': move(-4); break;
      case 'pgdn': move(4); break;
      case 'alt': tools(); break;
      case 'alt2': sustain(1); break;
      case 'select': restore(E.undo, E.redo); break;
      case 'start': if (E.playing) stop(); else play(); break;
      case 'back': if (E.playing) stop(); else leave(); break;
      default: return false;
    }
    return true;
  });

  document.addEventListener('keydown', (e) => {
    if (ui.screen !== 'editor' || ui.sheet || ui.osk.open) return;
    const k = e.key;
    let handled = true;
    if (k === ' ') { if (E.playing) stop(); else play(); }
    else if (/^[1-5]$/.test(k) && !e.ctrlKey) { const lane = +k - 1; if (E.playing) recordAt(lane); else { E.lane = lane; toggle(lane); } }
    else if (k === 'Delete' || k === 'Backspace') { const n = noteAt(E.grid.time(E.pos), E.lane); if (n) toggle(); } // never "back" here
    else if (k === ']') sustain(1);
    else if (k === '[') sustain(-1);
    else if (k === 'p' || k === 'P') togglePhrase();
    else if (e.ctrlKey && (k === 'z' || k === 'Z')) { if (e.shiftKey) restore(E.redo, E.undo); else restore(E.undo, E.redo); }
    else if (e.ctrlKey && (k === 'y' || k === 'Y')) restore(E.redo, E.undo);
    else if (e.ctrlKey && (k === 's' || k === 'S')) save();
    else if (k === '+' || k === '=') { E.zoom = Math.min(260, E.zoom * 1.2); }
    else if (k === '-' || k === '_') { E.zoom = Math.max(30, E.zoom / 1.2); }
    else if (e.altKey && k === 'ArrowLeft') handled = moveNoteLane(-1);
    else if (e.altKey && k === 'ArrowRight') handled = moveNoteLane(1);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // mouse: click = toggle a note, right click = delete, wheel = scroll
  function canvasHit(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width, y = ((e.clientY - r.top) / r.height) * canvas.height;
    const L = layout();
    const lane = Math.floor((x - L.x0) / L.lw);
    if (lane < 0 || lane > 4) return null;
    const pos = snapPos(L.cur + (L.strike - y) / E.zoom);
    return { lane, pos };
  }
  document.addEventListener('click', (e) => {
    if (ui.screen !== 'editor' || e.target.id !== 'ed-canvas') return;
    const h = canvasHit(e);
    if (!h) return;
    E.lane = h.lane; E.pos = h.pos;
    toggle(h.lane, h.pos);
  });
  document.addEventListener('contextmenu', (e) => {
    if (ui.screen !== 'editor' || e.target.id !== 'ed-canvas') return;
    const h = canvasHit(e);
    if (h && noteAt(E.grid.time(h.pos), h.lane)) { E.lane = h.lane; E.pos = h.pos; toggle(h.lane, h.pos); }
  });
  document.addEventListener('wheel', (e) => {
    if (ui.screen !== 'editor' || e.target.id !== 'ed-canvas') return;
    if (e.ctrlKey) E.zoom = Math.max(30, Math.min(260, E.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    else move((e.deltaY < 0 ? 1 : -1) / E.snap);
    e.preventDefault();
  }, { passive: false });

  // keyboard: Space plays (Enter places notes), so the Play prompt is only shown for controllers
  ui.legendHooks.editor = () => [['confirm', 'Note'], ['ud', 'Scroll'], ['lr', 'Lane'], ['prevnext', 'Snap'], ['alt2', 'Sustain'], ['alt', 'Tools'], ...(ui.family === 'keyboard' ? [] : [['start', 'Play']]), ['back', 'Exit']];

  // ---------------------------------------------------------------- drawing
  function layout() {
    const W = canvas.width, H = canvas.height;
    const lw = Math.min(110, (W * 0.5) / 5);
    const x0 = (W - lw * 5) / 2;
    const strike = H * 0.82;
    const cur = E.playing ? E.grid.pos(playTime()) : E.pos;
    return { W, H, lw, x0, strike, cur };
  }

  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const L = layout();
    const { W, H, lw, x0, strike, cur } = L;
    const z = E.zoom * dpr / (dpr); // zoom is in canvas px per beat
    const yOf = (p) => strike - (p - cur) * z;
    const pTop = cur + strike / z, pBot = cur - (H - strike) / z;
    g2.clearRect(0, 0, W, H);
    // lanes
    g2.fillStyle = 'rgba(10,8,22,0.92)';
    g2.fillRect(x0, 0, lw * 5, H);
    const colors = (E.drums ? DRUM_COLORS : FIVE_COLORS).map(hex);
    for (let l = 0; l <= 5; l++) { g2.fillStyle = 'rgba(255,255,255,0.08)'; g2.fillRect(x0 + l * lw - 1, 0, 2, H); }
    // overdrive phrases
    for (const p of E.phrases) {
      const a = yOf(E.grid.pos(p.end)), b = yOf(E.grid.pos(p.start));
      if (b < 0 || a > H) continue;
      g2.fillStyle = 'rgba(41,160,255,0.13)';
      g2.fillRect(x0, a, lw * 5, b - a);
      g2.fillStyle = 'rgba(80,190,255,0.85)';
      g2.fillRect(x0 - 10, a, 5, b - a);
      g2.fillRect(x0 + lw * 5 + 5, a, 5, b - a);
    }
    // grid lines
    const down = E.song.downbeat || 0;
    for (let b = Math.floor(pBot); b <= Math.ceil(pTop); b++) {
      const measure = (((b - down) % 4) + 4) % 4 === 0;
      const y = yOf(b);
      g2.fillStyle = measure ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
      g2.fillRect(x0, y - (measure ? 1.5 : 0.75), lw * 5, measure ? 3 : 1.5);
      if (measure) {
        g2.fillStyle = 'rgba(255,255,255,0.5)';
        g2.font = `${12 * dpr}px Rajdhani, sans-serif`;
        g2.textAlign = 'right';
        g2.fillText(String(Math.floor((b - down) / 4) + 1), x0 - 16, y + 4);
      }
      for (let s = 1; s < E.snap; s++) {
        const ys = yOf(b + s / E.snap);
        g2.fillStyle = 'rgba(255,255,255,0.06)';
        g2.fillRect(x0, ys - 0.5, lw * 5, 1);
      }
    }
    // notes
    const tTop = E.grid.time(pTop + 1), tBot = E.grid.time(pBot - 1);
    const nowT = E.playing ? playTime() : -1;
    for (const n of E.notes) {
      if (n.t + n.len < tBot || n.t > tTop) continue;
      const y = yOf(E.grid.pos(n.t));
      const cx = x0 + n.lane * lw + lw / 2;
      if (n.len > 0) {
        const ye = yOf(E.grid.pos(n.t + n.len));
        g2.fillStyle = colors[n.lane];
        g2.globalAlpha = 0.55;
        g2.fillRect(cx - lw * 0.1, ye, lw * 0.2, y - ye);
        g2.globalAlpha = 1;
      }
      const passed = E.playing && n.t <= nowT;
      g2.fillStyle = colors[n.lane];
      g2.globalAlpha = passed ? 0.45 : 1;
      roundRect(cx - lw * 0.38, y - 9 * dpr, lw * 0.76, 18 * dpr, 7 * dpr);
      g2.fill();
      if (n.p >= 0) { g2.strokeStyle = '#bfe8ff'; g2.lineWidth = 3 * dpr; g2.stroke(); }
      g2.globalAlpha = 1;
    }
    // strike line + cursor
    g2.fillStyle = E.playing ? '#ff2d7a' : 'rgba(41,224,255,0.9)';
    g2.fillRect(x0 - 6, strike - 2, lw * 5 + 12, 4);
    if (!E.playing) {
      g2.strokeStyle = '#29e0ff';
      g2.lineWidth = 3 * dpr;
      roundRect(x0 + E.lane * lw + 4, strike - 14 * dpr, lw - 8, 28 * dpr, 9 * dpr);
      g2.stroke();
    }
    // tick notes as the playhead crosses them
    if (E.playing && E.ticks) {
      const t = playTime();
      for (const n of E.notes) if (n.t > E.lastTickT && n.t <= t) { app.engine.sfxTick(0, n.lane === 0); break; }
      E.lastTickT = t;
      if (Math.floor(t * 4) !== E._lastStatus) { E._lastStatus = Math.floor(t * 4); status(); }
    }
  }

  function roundRect(x, y, w, h, r) {
    g2.beginPath();
    g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r);
    g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath();
  }

  function status() {
    if (!E.open) return;
    const t = curTime();
    const down = E.song.downbeat || 0;
    const p = E.grid.pos(t) - down;
    const bar = Math.floor(p / 4) + 1, beat = Math.floor(((p % 4) + 4) % 4) + 1;
    const n = !E.playing && noteAt(E.grid.time(E.pos), E.lane);
    $('#ed-title').textContent = `${E.song.title}`;
    $('#ed-sub').textContent = `${E.song.artist} · ${E.inst} · ${E.diff}`;
    $('#ed-status').innerHTML = [
      `<span><b>${fmt(t)}</b>time</span>`, `<span><b>${bar}.${beat}</b>bar</span>`, `<span><b>${SNAP_LABEL[E.snap]}</b>snap</span>`,
      `<span><b>${E.notes.length}</b>notes</span>`, `<span><b>${E.phrases.length}</b>overdrive</span>`,
      `<span><b>${Math.round(E.speed * 100)}%</b>speed</span>`,
      n ? `<span><b>${n.len ? `${n.len.toFixed(2)}s` : 'tap'}</b>note</span>` : '',
      E.dirty ? '<span class="dirty"><b>●</b>unsaved</span>' : '<span class="saved"><b>✓</b>saved</span>',
    ].join('');
  }

  return { open, isOpen: () => E.open };
}
