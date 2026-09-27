// Lyrics cross-check: Whisper hears *when* each word is sung but often mishears *what* is sung; a lyrics
// database (LRCLIB, through /api/meta/lyrics) knows the words — usually with a time for every line — but not
// each word's timing. crossref() aligns the two and keeps the best of both: the reference words, on Whisper's
// timings. Wrong words are replaced, missed words are added (timed inside their line), and words Whisper
// imagined (breaths, backing vocals, echoes) are dropped. If the reference doesn't fit the recording, the AI
// lyrics are kept as they are.

/** "Don't!" → "dont" (case, accents and punctuation don't count as mistakes). */
export const normWord = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

/** LRC text → [{ t (s) | null, text }]. Plain lyrics come back with t = null. */
export function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    const body = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    if (!tags.length) { if (body && !/^\[?[a-z]+:.*\]?$/i.test(raw.trim())) lines.push({ t: null, text: body }); continue; }
    for (const m of tags) lines.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: body });
  }
  if (lines.some((l) => l.t != null)) lines.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return lines;
}

/** Reference lines → words with their line's time window ([ls, le): line start → next line start). */
function referenceWords(lines) {
  const out = [];
  lines.forEach((l, li) => {
    if (!l.text) return;
    const next = lines.slice(li + 1).find((x) => x.t != null)?.t;
    const ls = l.t, le = l.t == null ? null : Math.min(next ?? l.t + 8, l.t + 12);
    l.text.split(' ').forEach((w, k) => {
      const n = normWord(w);
      if (n) out.push({ w, n, line: li, first: k === 0, ls, le });
    });
  });
  return out;
}

function similarity(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[lb] / Math.max(la, lb);
}

/**
 * Where the reference's clock sits against the song's: a YouTube upload with a longer intro shifts every
 * line. Tries offsets of ±40 s and keeps the one that puts the most sung words (or vocal note starts) inside
 * the line that should contain them.
 */
function estimateOffset(ref, aiWords, onsets) {
  const timed = ref.filter((r) => r.ls != null && r.first);
  if (!timed.length) return 0;
  const lineSets = new Map();
  for (const r of ref) if (r.ls != null) (lineSets.get(r.line) || lineSets.set(r.line, { ls: r.ls, le: r.le, set: new Set() }).get(r.line)).set.add(r.n);
  const lines = [...lineSets.values()].sort((a, b) => a.ls - b.ls);
  const lineAt = (t) => { // binary search: last line starting at or before t
    let lo = 0, hi = lines.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].ls <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k >= 0 && t < lines[k].le + 0.3 ? lines[k] : null;
  };
  const ai = aiWords.map((w) => ({ t: w.t, n: normWord(w.w) })).filter((w) => w.n);
  let best = 0, bestScore = -1;
  for (let off = -40; off <= 40; off += 0.25) {
    let score = 0;
    if (ai.length) {
      for (const w of ai) { const l = lineAt(w.t - off); if (l?.set.has(w.n)) score++; }
    } else if (onsets.length) {
      let k = 0;
      for (const l of lines) {
        const t = l.ls + off;
        while (k < onsets.length - 1 && onsets[k] < t - 0.4) k++;
        if (Math.abs(onsets[k] - t) <= 0.4) score++;
      }
    }
    // prefer no shift when it's (nearly) as good
    if (score > bestScore + (Math.abs(off) < Math.abs(best) ? -0.5 : 0.5)) { best = off; bestScore = score; }
  }
  return best;
}

/** Needleman–Wunsch between Whisper's words and the reference, with time windows when lines are timed. */
function align(ai, ref) {
  const N = ai.length, M = ref.length;
  const W = M + 1;
  const cost = new Float32Array((N + 1) * W);
  const move = new Uint8Array((N + 1) * W); // 1 pair, 2 skip AI word, 3 skip reference word
  const SKIP_AI = 0.8, SKIP_REF = 0.75;
  for (let i = 1; i <= N; i++) { cost[i * W] = i * SKIP_AI; move[i * W] = 2; }
  for (let j = 1; j <= M; j++) { cost[j] = j * SKIP_REF; move[j] = 3; }
  for (let i = 1; i <= N; i++) {
    const a = ai[i - 1];
    for (let j = 1; j <= M; j++) {
      const r = ref[j - 1];
      let pair = Infinity;
      const inTime = r.ls == null || (a.t >= r.ls - 1.5 && a.t <= r.le + 1.5);
      if (inTime) {
        const s = a.n === r.n ? 1 : similarity(a.n, r.n);
        pair = s === 1 ? 0 : s >= 0.6 ? 0.45 : s >= 0.34 ? 1.0 : 1.45; // near-miss → cheap fix; unrelated → costly
        if (r.ls == null) pair += 0.05; // untimed reference: rely on the words alone
      }
      const c1 = cost[(i - 1) * W + j - 1] + pair, c2 = cost[(i - 1) * W + j] + SKIP_AI, c3 = cost[i * W + j - 1] + SKIP_REF;
      const k = i * W + j;
      if (c1 <= c2 && c1 <= c3) { cost[k] = c1; move[k] = 1; } else if (c2 <= c3) { cost[k] = c2; move[k] = 2; } else { cost[k] = c3; move[k] = 3; }
    }
  }
  const pairOf = new Int32Array(M).fill(-1);
  let i = N, j = M;
  while (i > 0 || j > 0) {
    const m = move[i * W + j];
    if (m === 1) { pairOf[j - 1] = i - 1; i--; j--; } else if (m === 2) i--; else j--;
  }
  return pairOf;
}

/**
 * aiWords: [{ t, e, w }] from Whisper (may be empty), reference: { synced, plain } from LRCLIB.
 * opts.duration: song length (s); opts.onsets: vocal note start times, used to place lines when there is no AI.
 * → { ok, words: [{ t, e, w, br? }], stats } — ok false means "the reference doesn't fit; keep the AI words".
 */
export function crossref(aiWords, reference, { duration = 0, onsets = [] } = {}) {
  const lines = parseLrc(reference.synced || reference.plain || '');
  const synced = lines.some((l) => l.t != null);
  let ref = referenceWords(synced ? lines.filter((l) => l.t != null) : lines);
  const stats = { reference: ref.length, ai: aiWords.length, exact: 0, fixed: 0, added: 0, dropped: 0, offset: 0, synced };
  if (!ref.length) return { ok: false, words: aiWords, stats };

  // 1. line up the reference's clock with the song
  if (synced) {
    const off = estimateOffset(ref, aiWords, onsets);
    stats.offset = off;
    for (const r of ref) { r.ls += off; r.le = duration ? Math.min(r.le + off, duration) : r.le + off; }
    ref = ref.filter((r) => r.le > r.ls + 0.1); // lines after the end of this (shorter) version
    stats.reference = ref.length;
    if (!ref.length) return { ok: false, words: aiWords, stats };
  }
  const ai = aiWords.map((w) => ({ ...w, n: normWord(w.w) })).filter((w) => w.n);

  // 2. no AI words: synced lines only, words spread over each line
  if (!ai.length) {
    if (!synced) return { ok: false, words: aiWords, stats };
    const out = [];
    const byLine = new Map();
    for (const r of ref) (byLine.get(r.line) || byLine.set(r.line, []).get(r.line)).push(r);
    for (const ws of byLine.values()) {
      const { ls, le } = ws[0];
      const span = Math.max(0.4, Math.min(le - ls - 0.1, ws.length * 0.42 + 0.2));
      ws.forEach((r, k) => out.push({ t: +(ls + (span * k) / ws.length).toFixed(3), e: +(ls + (span * (k + 1)) / ws.length - 0.03).toFixed(3), w: r.w, ...(k === 0 ? { br: true } : {}) }));
    }
    stats.added = out.length;
    return { ok: true, words: out.filter((w) => w.t >= 0), stats };
  }

  // 3. align, then judge whether the reference really is this recording
  const pairOf = align(ai, ref);
  let similar = 0;
  const used = new Set();
  pairOf.forEach((i, j) => {
    if (i < 0) return;
    used.add(i);
    const s = ai[i].n === ref[j].n ? 1 : similarity(ai[i].n, ref[j].n);
    if (s === 1) stats.exact++; else if (s >= 0.6) similar++;
  });
  const agree = stats.exact + similar;
  stats.confidence = +(agree / Math.min(ai.length, ref.length)).toFixed(3);
  if (stats.exact < 4 || stats.confidence < (synced ? 0.3 : 0.4)) return { ok: false, words: aiWords, stats };

  // 4. reference words on Whisper's timings; missed words fill the gaps inside their line
  const out = ref.map((r, j) => {
    const i = pairOf[j];
    const w = { w: r.w, t: null, e: null, line: r.line, ls: r.ls, le: r.le };
    if (i >= 0) {
      w.t = ai[i].t; w.e = ai[i].e;
      if (ai[i].n !== r.n) stats.fixed++;
    }
    return w;
  });
  for (let j = 0; j < out.length; j++) {
    if (out[j].t != null) continue;
    let k = j;
    while (k < out.length && out[k].t == null) k++;
    const prev = out[j - 1], next = out[k];
    let a = prev ? prev.e : Math.max(0, (next?.t ?? 0) - (k - j) * 0.35);
    let b = next ? next.t : a + (k - j) * 0.35;
    if (synced) { // keep the fill inside the gap words' own line
      const { ls, le } = out[j];
      if (prev?.line !== out[j].line) a = Math.max(a, ls);
      if (next?.line !== out[j].line) b = Math.min(b, Math.max(a + 0.2, Math.min(le, a + (k - j) * 0.45)));
    }
    if (!(b > a)) b = a + 0.2 * (k - j);
    const step = (b - a) / (k - j);
    for (let q = j; q < k; q++) { out[q].t = a + step * (q - j) + 0.01; out[q].e = a + step * (q - j + 1) - 0.01; stats.added++; }
    j = k - 1;
  }
  stats.dropped = ai.length - used.size;
  let last = 0;
  const words = out.map((w, j) => {
    const t = Math.max(last, w.t), e = Math.max(t + 0.05, w.e);
    last = t;
    const word = { t: +t.toFixed(3), e: +e.toFixed(3), w: w.w };
    if (j === 0 || out[j - 1].line !== w.line) word.br = true;
    return word;
  });
  return { ok: true, words, stats };
}
