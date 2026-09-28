// The ranked-chart format, shared by the game (src/net/charts.js) and the leaderboard API so both compute the
// same chart id for the same notes. A chart is one instrument of one song: its four difficulties and its
// overdrive phrases, times in milliseconds on the uploader's recording.
//
//   { v: 1, instrument: "guitar",
//     phrases: [[startMs, endMs], ...],
//     notes: { easy: [[timeMs, lane, sustainMs, midiNote, strength×100, phrase], ...], medium: …, hard: …, expert: … } }

export const CHART_VERSION = 1;
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
export const INSTRUMENTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const MAX_MS = 3_600_000;
const MAX_NOTES = 20_000;
const MAX_PHRASES = 2_000;

const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Validate a chart and put it in canonical form (integers, sorted, fixed key order). Throws on anything odd. */
export function canonicalChart(c) {
  if (!c || c.v !== CHART_VERSION) throw new Error('unknown chart version');
  if (!INSTRUMENTS.includes(c.instrument)) throw new Error('bad chart instrument');
  const int = (v, lo, hi) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error('bad chart value');
    return n;
  };
  const notes = {};
  let total = 0;
  for (const d of DIFFICULTIES) {
    const list = c.notes?.[d] ?? [];
    if (!Array.isArray(list) || list.length > MAX_NOTES) throw new Error('bad chart notes');
    notes[d] = list.map((n) => {
      if (!Array.isArray(n) || n.length !== 6) throw new Error('bad chart note');
      return [int(n[0], 0, MAX_MS), int(n[1], 0, 7), int(n[2], 0, MAX_MS), int(n[3], 0, 127), int(n[4], 0, 1000), int(n[5], -1, 9999)];
    }).sort(cmp);
    total += notes[d].length;
  }
  if (!total) throw new Error('empty chart');
  const phrases = (Array.isArray(c.phrases) ? c.phrases : []).slice(0, MAX_PHRASES)
    .map((p) => [int(p?.[0], 0, MAX_MS), int(p?.[1], 0, MAX_MS)]).sort(cmp);
  return { v: CHART_VERSION, instrument: c.instrument, phrases, notes };
}

export const noteCounts = (c) => Object.fromEntries(DIFFICULTIES.map((d) => [d, c.notes[d].length]));

/** The chart's id: sha256 of its canonical JSON, first 16 hex characters. */
export async function chartId(canonical) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
