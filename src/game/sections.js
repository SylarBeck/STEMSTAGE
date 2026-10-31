// Song sections from the charts — intro, verses, choruses, solos, breaks, outro — for any song, old charts included.
// Every 4-bar phrase gets a fingerprint (how busy each part is, whether anyone sings, crashes); neighbouring phrases
// that sound alike join into one section, and each section is named by what's in it. Solos are the stretches where
// nobody sings and the guitar or keys get much busier than usual.

const PARTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const PHRASE = 4;      // bars per phrase
const SPLIT = 0.4;     // fingerprint distance that starts a new section
const SAME = 0.86;     // two sung sections this alike (harmony + melody) are the same part coming back
export const SOLO_NAME = { guitar: 'Guitar solo', keys: 'Keys solo' };

/** The song's bars as [start, end] times (4/4 from the downbeat). */
export function songBars(song) {
  const beats = song.beats || [];
  const bars = [];
  for (let b = Math.max(0, Math.round(song.downbeat || 0)); b + 4 < beats.length; b += 4) bars.push([beats[b], beats[b + 4]]);
  return bars;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** → [{ start, end, kind: intro|verse|chorus|solo|break|outro, name, inst? }] in song order (cached on the song). */
export function detectSections(song) {
  if (song._sections) return song._sections;
  const bars = songBars(song);
  const out = [];
  Object.defineProperty(song, '_sections', { value: out, enumerable: false, configurable: true });
  if (bars.length < PHRASE * 3) return out;
  const barAt = (t) => {
    let lo = 0, hi = bars.length - 1;
    if (t < bars[0][0] || t >= bars[hi][1]) return -1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m][0] <= t) lo = m; else hi = m - 1; }
    return lo;
  };
  const count = bars.map(() => ({ guitar: 0, bass: 0, drums: 0, keys: 0, vocals: 0, crash: 0, harm: new Float32Array(12), mel: new Float32Array(12) }));
  const has = {};
  for (const inst of PARTS) {
    const c = song.charts?.[inst];
    has[inst] = !!c?.available;
    if (!has[inst]) continue;
    for (const n of c.notes?.expert || []) {
      const i = barAt(n.t);
      if (i < 0) continue;
      count[i][inst]++;
      if (inst === 'drums' && n.lane === 4) count[i].crash++;
      // pitch classes: the harmony (bass, guitar, keys) and the sung melody tell a chorus from a verse
      if (inst !== 'drums' && n.m != null) count[i][inst === 'vocals' ? 'mel' : 'harm'][((Math.round(n.m) % 12) + 12) % 12] += 1 + (n.len || 0) * 2;
    }
  }
  let first = count.findIndex((c) => PARTS.some((p) => c[p] > 0));
  let last = count.length - 1;
  while (last > 0 && !PARTS.some((p) => count[last][p] > 0)) last--;
  if (first < 0 || last - first + 1 < PHRASE * 2) return out;
  first -= first % PHRASE; // phrases line up with 4-bar boundaries from the downbeat

  // one fingerprint per phrase: each part's busyness (relative to its busiest phrase), singing, crashes
  const phrases = [];
  for (let b = first; b <= last; b += PHRASE) {
    const span = count.slice(b, Math.min(b + PHRASE, last + 1));
    const f = { start: b, end: b + span.length, sing: 0, crash: 0 };
    for (const p of PARTS) f[p] = Math.log1p(span.reduce((s, c) => s + c[p], 0) / span.length);
    f.sing = has.vocals ? span.filter((c) => c.vocals > 0).length / span.length : 0;
    f.crash = span.reduce((s, c) => s + c.crash, 0) / span.length;
    for (const k of ['harm', 'mel']) { f[k] = new Float32Array(12); for (const c of span) for (let j = 0; j < 12; j++) f[k][j] += c[k][j]; }
    phrases.push(f);
  }
  const cos = (a, b) => {
    let ab = 0, aa = 0, bb = 0;
    for (let j = 0; j < 12; j++) { ab += a[j] * b[j]; aa += a[j] * a[j]; bb += b[j] * b[j]; }
    return aa && bb ? ab / Math.sqrt(aa * bb) : aa === bb ? 1 : 0;
  };
  const peak = Object.fromEntries([...PARTS, 'crash'].map((p) => [p, Math.max(1e-6, ...phrases.map((f) => f[p]))]));
  for (const f of phrases) for (const p of [...PARTS, 'crash']) f[p] /= peak[p];
  const dist = (a, b) => PARTS.filter((p) => p !== 'vocals').reduce((s, p) => s + Math.abs(a[p] - b[p]), 0) / 2
    + Math.abs(a.sing - b.sing) * 1.2 + Math.abs(a.crash - b.crash) * 0.5 + (1 - cos(a.harm, b.harm)) * 0.6;

  const groups = [];
  for (const f of phrases) {
    const g = groups.at(-1);
    // a section is at most 16 bars: verses and choruses rarely run longer without a change the fingerprint misses
    if (g && g.phrases.length < 4 && dist(g.last, f) < SPLIT) { g.phrases.push(f); g.last = f; } else groups.push({ phrases: [f], last: f });
  }
  const avg = (g, k) => g.phrases.reduce((s, f) => s + f[k], 0) / g.phrases.length;
  const hist = (g, k) => { const h = new Float32Array(12); for (const f of g.phrases) for (let j = 0; j < 12; j++) h[j] += f[k][j]; return h; };
  const energy = (g) => PARTS.filter((p) => p !== 'vocals').reduce((s, p) => s + avg(g, p), 0) + avg(g, 'crash') * 0.5;
  const sung = groups.filter((g) => avg(g, 'sing') >= 0.4);
  const firstSung = groups.indexOf(sung[0]), lastSung = groups.indexOf(sung.at(-1));
  const busy = { guitar: median(phrases.map((f) => f.guitar)), keys: median(phrases.map((f) => f.keys)) };

  // sung sections that come back (same harmony and melody) form families; the chorus is the loudest family that
  // repeats, the verse the other big one
  const families = [];
  for (const g of sung) {
    const sig = { harm: hist(g, 'harm'), mel: hist(g, 'mel') };
    const fam = families.find((x) => (cos(x.harm, sig.harm) + cos(x.mel, sig.mel)) / 2 >= SAME);
    if (fam) { fam.members.push(g); for (const k of ['harm', 'mel']) for (let j = 0; j < 12; j++) fam[k][j] += sig[k][j]; } else families.push({ ...sig, members: [g] });
  }
  const famEnergy = (f) => f.members.reduce((s, g) => s + energy(g), 0) / f.members.length;
  const repeating = families.filter((f) => f.members.length > 1).sort((a, b) => famEnergy(b) - famEnergy(a));
  // a family holding most of the singing isn't a chorus, it's a song whose parts all sound alike
  const distinct = repeating[0] && repeating[0].members.length <= sung.length * 0.6 && families.length > 1;
  const chorus = new Set(distinct ? repeating[0].members : []);
  if (!chorus.size && sung.length > 2) { // nothing repeats clearly: the loudest third of the singing
    const cut = [...sung].map(energy).sort((a, b) => b - a)[Math.floor(sung.length / 3)];
    for (const g of sung) if (energy(g) > cut) chorus.add(g);
  }

  groups.forEach((g, i) => {
    const sing = avg(g, 'sing');
    let kind;
    const lead = ['guitar', 'keys'].filter((p) => has[p]).sort((a, b) => avg(g, b) / (busy[b] || 1) - avg(g, a) / (busy[a] || 1))[0];
    const soloing = lead && sing < 0.25 && avg(g, lead) >= 0.55 && avg(g, lead) >= (busy[lead] || 0) * 1.25 && (has.vocals ? sung.length > 0 && i > firstSung : avg(g, lead) >= 0.8);
    if (soloing && i > 0 && i < groups.length - 1) kind = 'solo';
    else if (sung.length && i < firstSung) kind = 'intro';
    else if (sung.length && i > lastSung) kind = 'outro';
    else if (sing >= 0.4) kind = chorus.has(g) ? 'chorus' : 'verse';
    else kind = i === 0 ? 'intro' : i === groups.length - 1 ? 'outro' : 'break';
    const b0 = g.phrases[0].start, b1 = g.phrases.at(-1).end;
    out.push({ start: bars[b0][0], end: bars[Math.min(b1, bars.length) - 1][1], kind, ...(kind === 'solo' ? { inst: lead } : {}) });
  });
  // a short dip inside a solo (≤ 8 bars between two solo stretches) is part of the solo
  const barLen = (bars.at(-1)[1] - bars[0][0]) / bars.length;
  for (let i = out.length - 2; i > 0; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if (a.kind === 'solo' && c.kind === 'solo' && a.inst === c.inst && b.end - b.start <= 8 * barLen + 0.01) { a.end = c.end; out.splice(i, 2); }
  }
  // neighbours of the same kind are one section (two verse phrases that differed a little)
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].kind === out[i - 1].kind && out[i].inst === out[i - 1].inst) { out[i - 1].end = out[i].end; out.splice(i, 1); }
  }
  const seen = {};
  for (const s of out) {
    seen[s.kind] = (seen[s.kind] || 0) + 1;
    const base = s.kind === 'solo' ? SOLO_NAME[s.inst] : s.kind[0].toUpperCase() + s.kind.slice(1);
    const numbered = ['verse', 'chorus', 'break', 'solo'].includes(s.kind) && out.filter((x) => x.kind === s.kind && x.inst === s.inst).length > 1;
    s.name = numbered ? `${base} ${out.filter((x) => x.kind === s.kind && x.inst === s.inst).indexOf(s) + 1}` : base;
  }
  return out;
}

/** The section playing at time t (or null). */
export function sectionAt(sections, t) {
  for (const s of sections) if (t >= s.start && t < s.end) return s;
  return null;
}
