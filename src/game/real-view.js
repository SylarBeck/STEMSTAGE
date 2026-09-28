// What to play in real instrument mode, drawn the way musicians read it: a scrolling tablature for guitar and
// bass (string + fret for every note, fingered around where the hand already is) and a keyboard with the notes
// falling onto their keys for keys. Both show what you're playing right now as well.
import { FIVE_COLORS } from './highway.js';

export const TUNINGS = {
  guitar: { open: [40, 45, 50, 55, 59, 64], names: ['E', 'A', 'D', 'G', 'B', 'e'], frets: 22 }, // standard, low → high
  bass: { open: [28, 33, 38, 43], names: ['E', 'A', 'D', 'G'], frets: 20 },
};
const LOOK = 2.8; // seconds of music ahead on screen
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

// ---------------------------------------------------------------- fingering
/** Every (string, fret) that plays pitch m; out-of-range pitches move by octaves into the instrument's range. */
function positions(m, tuning) {
  const { open, frets } = tuning;
  let p = Math.round(m);
  while (p < open[0]) p += 12;
  while (p > open[open.length - 1] + frets) p -= 12;
  const out = [];
  open.forEach((o, s) => { const f = p - o; if (f >= 0 && f <= frets) out.push({ s, f }); });
  return out;
}

/** Cost of fretting f with the first finger at fret `hand` (a four-fret box); open strings are nearly free. */
const reach = (f, hand) => (f === 0 ? 0.5 : f < hand ? (hand - f) * 1.2 : f > hand + 3 ? (f - hand - 3) * 1.2 : 0) + f * 0.015;
/** Moving the hand costs something, more the further it goes. */
const shift = (a, b) => (a === b ? 0 : 0.9 + Math.abs(a - b) * 0.2);

/** Ways to finger one chord (or single note): every pitch on its own string, fretted notes within a hand span. */
function fingerings(pitches, tuning) {
  const cands = pitches.map((m) => positions(m, tuning));
  const out = [];
  const pick = [];
  const walk = (k, used) => {
    if (out.length >= 64) return;
    if (k === cands.length) {
      const fretted = pick.filter((p) => p && p.f > 0).map((p) => p.f);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span <= 5) out.push({ pos: pick.slice(), extra: Math.max(0, span - 3) * 3 });
      return;
    }
    let placed = false;
    for (const c of cands[k]) {
      if (used & (1 << c.s)) continue;
      placed = true;
      pick.push(c); walk(k + 1, used | (1 << c.s)); pick.pop();
    }
    if (!placed) { pick.push(null); walk(k + 1, used); pick.pop(); } // no free string: leave this pitch out
  };
  walk(0, 0);
  return out;
}

/**
 * Annotate notes with .str / .fret, the way a player would finger them: a Viterbi pass over hand positions
 * picks, for the whole part at once, where the hand sits for every chord or note, so runs stay in a box and the
 * hand only moves when it pays off later. Chords (same time) go on different strings, as close together as possible.
 */
export function assignTab(notes, tuning) {
  const groups = [];
  for (let i = 0; i < notes.length;) {
    let j = i;
    while (j < notes.length && Math.abs(notes[j].t - notes[i].t) < 1e-3) j++;
    const group = notes.slice(i, j).filter((n) => n.m > 0);
    i = j;
    if (!group.length) continue;
    const pitches = [...new Set(group.map((n) => Math.round(n.m)))].sort((a, b) => b - a).slice(0, tuning.open.length); // melody (top) first
    const opts = fingerings(pitches, tuning);
    if (opts.length) groups.push({ group, pitches, opts });
  }
  const H = tuning.frets - 2; // hand positions 1 .. frets-3
  let cost = new Float64Array(H).fill(0);
  const back = []; // per group: [best previous hand, best fingering] for each hand position
  for (const g of groups) {
    const next = new Float64Array(H), from = new Int16Array(H), opt = new Int16Array(H);
    for (let h = 0; h < H; h++) {
      let bo = 0, be = Infinity;
      g.opts.forEach((o, k) => {
        const e = o.extra + o.pos.reduce((c, p) => c + (p ? reach(p.f, h + 1) : 2), 0);
        if (e < be) { be = e; bo = k; }
      });
      let bp = 0, bc = Infinity;
      for (let p = 0; p < H; p++) { const c = cost[p] + shift(p, h); if (c < bc) { bc = c; bp = p; } }
      next[h] = bc + be; from[h] = bp; opt[h] = bo;
    }
    back.push({ from, opt });
    cost = next;
  }
  let h = 0;
  for (let k = 1; k < H; k++) if (cost[k] < cost[h]) h = k;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const { group, pitches, opts } = groups[gi];
    const chosen = opts[back[gi].opt[h]].pos;
    const byPitch = new Map(pitches.map((m, k) => [m, chosen[k]]));
    for (const n of group) { const p = byPitch.get(Math.round(n.m)); if (p) { n.str = p.s; n.fret = p.f; } }
    h = back[gi].from[h];
  }
  return notes;
}

// ---------------------------------------------------------------- shared canvas plumbing
class CanvasView {
  constructor(parent, cls) {
    this.el = document.createElement('div');
    this.el.className = `real-view ${cls}`;
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);
    this.g = this.canvas.getContext('2d');
    this.w = this.h = 0;
  }

  /** Match the canvas to its box (and the screen's pixel density); returns false while hidden. */
  fit() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.g.clearRect(0, 0, w, h);
    return true;
  }

  remove() { this.el.remove(); }
}

const noteColor = (n) => (n.missed ? '#e5402f' : hex(FIVE_COLORS[n.lane] ?? 0xffffff));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------------------------------------------------------------- tablature (guitar / bass)
export class TabView extends CanvasView {
  constructor(parent, inst, beats = []) {
    super(parent, `real-tab ${inst}`);
    this.tuning = TUNINGS[inst] || TUNINGS.guitar;
    this.beats = beats;
  }

  /** player: { notes, pitch, matches(target, played) } */
  draw(t, player) {
    if (!this.fit()) return;
    const { g, w, h } = this;
    const S = this.tuning.open.length;
    const top = 20, bottom = h - 18, gap = (bottom - top) / (S - 1);
    const yOf = (s) => bottom - s * gap; // high string on top, as tab is written
    const x0 = 58, x1 = w - 12, xOf = (tt) => x0 + ((tt - t) / LOOK) * (x1 - x0);

    // beat lines (bar lines stronger)
    g.lineWidth = 1;
    let bi = 0;
    while (bi < this.beats.length && this.beats[bi] < t - 0.3) bi++;
    for (let k = bi; k < this.beats.length && this.beats[k] < t + LOOK; k++) {
      const x = xOf(this.beats[k]);
      if (x < x0 - 30) continue;
      g.strokeStyle = k % 4 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(x, top - 6); g.lineTo(x, bottom + 6); g.stroke();
    }
    // strings + names
    g.font = "600 13px 'Barlow Condensed', sans-serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let s = 0; s < S; s++) {
      const y = yOf(s);
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = 1 + (S - 1 - s) * 0.25;
      g.beginPath(); g.moveTo(26, y); g.lineTo(w - 6, y); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText(this.tuning.names[s], 13, y);
    }
    // the "now" line
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, top - 10); g.lineTo(x0, bottom + 10); g.stroke();
    // notes that went by fade out before they reach the string names
    g.save();
    g.beginPath(); g.rect(30, 0, w - 30, h); g.clip();

    // notes: sustains first, then chord brackets, then the fret chips on top
    const vis = [];
    for (const n of player.notes) {
      if (n.str == null) continue;
      const end = n.t + (n.len || 0);
      if (end < t - 0.35) continue;
      if (n.t > t + LOOK) break;
      vis.push(n);
    }
    for (const n of vis) {
      if (!(n.len > 0.15)) continue;
      const y = yOf(n.str);
      g.strokeStyle = noteColor(n); g.globalAlpha = n.hit ? 0.35 : 0.55; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(Math.max(x0, xOf(n.t)), y); g.lineTo(Math.min(x1, xOf(n.t + n.len)), y); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
    for (let k = 0; k < vis.length; k++) {
      const a = vis[k];
      let lo = a.str, hi = a.str, j = k;
      while (j + 1 < vis.length && Math.abs(vis[j + 1].t - a.t) < 1e-3) { j++; lo = Math.min(lo, vis[j].str); hi = Math.max(hi, vis[j].str); }
      if (hi > lo) {
        const x = xOf(a.t) - 13;
        g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x + 4, yOf(hi)); g.lineTo(x, yOf(hi)); g.lineTo(x, yOf(lo)); g.lineTo(x + 4, yOf(lo)); g.stroke();
      }
      k = j;
    }
    g.font = "16px Anton, 'Barlow Condensed', sans-serif";
    for (const n of vis) {
      const x = xOf(n.t), y = yOf(n.str);
      const label = String(n.fret);
      const bw = label.length > 1 ? 26 : 20;
      const gone = Math.max(0, (t - n.t) / 0.35); // 0 at the now line → 1 when it leaves
      g.globalAlpha = n.hit ? Math.max(0, 1 - (t - n.t) / 0.3) : Math.max(0, (n.missed ? 0.6 : 1) * (1 - gone));
      if (g.globalAlpha <= 0) continue;
      const c = noteColor(n);
      roundRect(g, x - bw / 2, y - 10, bw, 20, 6);
      g.fillStyle = n.hit ? '#8dc044' : '#0d0b09'; g.fill();
      g.lineWidth = 2; g.strokeStyle = n.hit ? '#8dc044' : c; g.stroke();
      g.fillStyle = n.hit ? '#0d0b09' : '#fff';
      g.fillText(label, x, y + 1);
    }
    g.globalAlpha = 1;
    g.restore();

    // what you're playing: a gold chip at the now line, on the fingering nearest the next note
    if (player.pitch > 0) {
      const next = player.notes.find((n) => !n.judged && n.str != null && n.t > t - 0.2);
      const pos = positions(player.pitch, this.tuning);
      if (pos.length) {
        const ref = next ? { s: next.str, f: next.fret } : pos[0];
        pos.sort((a, b) => Math.abs(a.s - ref.s) * 3 + Math.abs(a.f - ref.f) - (Math.abs(b.s - ref.s) * 3 + Math.abs(b.f - ref.f)));
        const ok = next && player.matches(next.m, player.pitch);
        const p = pos[0], y = yOf(p.s);
        g.fillStyle = ok ? 'rgba(141,192,68,0.25)' : 'rgba(240,180,41,0.2)';
        g.beginPath(); g.arc(x0, y, 15, 0, Math.PI * 2); g.fill();
        g.lineWidth = 2; g.strokeStyle = ok ? '#8dc044' : '#f0b429'; g.stroke();
        g.fillStyle = ok ? '#8dc044' : '#f0b429';
        g.font = "14px Anton, 'Barlow Condensed', sans-serif";
        g.fillText(String(p.f), x0, y + 1);
      }
    }
  }
}

// ---------------------------------------------------------------- keyboard (keys)
export class KeysView extends CanvasView {
  constructor(parent, notes) {
    super(parent, 'real-keys');
    const ms = notes.filter((n) => n.m > 0).map((n) => Math.round(n.m));
    let lo = ms.length ? Math.min(...ms) : 48, hi = ms.length ? Math.max(...ms) : 72;
    lo = Math.max(21, lo - (((lo % 12) + 12) % 12)); // down to a C
    hi = Math.min(108, hi + (11 - (((hi % 12) + 12) % 12))); // up to a B
    while (hi - lo < 23) { if (lo > 21) lo -= 12; else hi += 12; } // at least two octaves
    this.lo = Math.max(21, lo); this.hi = Math.min(108, hi);
    this.whites = [];
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) this.whites.push(m);
  }

  /** x position and width of key m (white keys share the width; black keys sit on the lines between). */
  key(m, W) {
    const ww = W / this.whites.length;
    if (!isBlack(m)) return { x: this.whites.indexOf(m) * ww, w: ww, black: false };
    const left = this.whites.indexOf(m - 1);
    return { x: (left + 1) * ww - ww * 0.3, w: ww * 0.6, black: true };
  }

  /** player: { notes, held: Map<midi>, pitch, matches } */
  draw(t, player) {
    if (!this.fit()) return;
    const { g, w, h } = this;
    const kbH = Math.min(58, h * 0.42), kbTop = h - kbH, fallH = kbTop - 4;
    const yOf = (tt) => kbTop - ((tt - t) / LOOK) * fallH;
    const held = player.held ? new Set([...player.held.keys()].map(Math.round)) : new Set();
    if (!held.size && player.pitch > 0) held.add(Math.round(player.pitch));
    const inRange = (m) => m >= this.lo && m <= this.hi;

    // octave guides behind the falling notes
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (const m of this.whites) if (m % 12 === 0) { const { x } = this.key(m, w); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, kbTop); g.stroke(); }

    // falling notes
    const due = new Map(); // key → colour for notes at the strike line now
    for (const n of player.notes) {
      if (!(n.m > 0)) continue;
      const end = n.t + Math.max(n.len || 0, 0.08);
      if (end < t - 0.1) continue;
      if (n.t > t + LOOK) break;
      const m = Math.round(n.m);
      if (!inRange(m)) continue;
      const k = this.key(m, w);
      const c = noteColor(n);
      const y1 = yOf(n.t), y0 = Math.max(0, yOf(end));
      if (Math.abs(n.t - t) < 0.12 && !n.judged) due.set(m, c);
      g.globalAlpha = n.hit ? 0.25 : 1;
      roundRect(g, k.x + 1.5, y0, k.w - 3, Math.max(6, Math.min(kbTop, y1) - y0), 4);
      g.fillStyle = c; g.fill();
      g.globalAlpha = 1;
    }

    // the keyboard
    g.fillStyle = '#070605'; g.fillRect(0, kbTop - 2, w, kbH + 2);
    const drawKey = (m) => {
      const k = this.key(m, w);
      const on = held.has(m), want = due.get(m);
      const ok = on && player.notes.some((n) => !n.missed && Math.abs(n.t - t) < 0.25 && player.matches(n.m, m));
      let fill = k.black ? '#171411' : '#ece5d3';
      if (want) fill = want;
      if (on) fill = ok ? '#8dc044' : '#f0b429';
      roundRect(g, k.x + 1, kbTop, k.w - 2, k.black ? kbH * 0.62 : kbH, 3);
      g.fillStyle = fill; g.fill();
      if (!k.black && m % 12 === 0) {
        g.fillStyle = on || want ? '#0d0b09' : 'rgba(0,0,0,0.45)';
        g.font = "600 11px 'Barlow Condensed', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillText(`C${Math.floor(m / 12) - 1}`, k.x + k.w / 2, h - 4);
      }
    };
    for (const m of this.whites) drawKey(m);
    for (let m = this.lo; m <= this.hi; m++) if (isBlack(m)) drawKey(m);
    // strike line
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(0, kbTop - 3, w, 2);
  }
}
