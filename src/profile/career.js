// Tour mode (venues unlocked by stars; each venue is a gig = a short setlist from your library) and the
// daily challenge (one song + goal per day, bonus XP and a day streak). Progress lives on the profile.
import { profiles } from './profiles.js';

export const DIFFS = ['easy', 'medium', 'hard', 'expert'];

export const VENUES = [
  { id: 'garage', name: 'The Garage', icon: '🚪', need: 0, songs: 3, minDiff: 'easy', hue: 22, blurb: 'Where every band starts.' },
  { id: 'club', name: 'Basement Club', icon: '🎚️', need: 6, songs: 3, minDiff: 'easy', hue: 280, blurb: 'Forty people and a fog machine.' },
  { id: 'bar', name: 'Neon Dive Bar', icon: '🍺', need: 15, songs: 3, minDiff: 'medium', hue: 320, blurb: 'Loud, sticky, legendary.' },
  { id: 'theater', name: 'Grand Theater', icon: '🎭', need: 28, songs: 4, minDiff: 'medium', hue: 40, blurb: 'Velvet seats, real lights.' },
  { id: 'arena', name: 'Metro Arena', icon: '🏟️', need: 45, songs: 4, minDiff: 'hard', hue: 200, blurb: 'Ten thousand phones in the air.' },
  { id: 'stadium', name: 'Skyline Stadium', icon: '🌃', need: 65, songs: 4, minDiff: 'hard', hue: 250, blurb: 'The whole city is listening.' },
  { id: 'festival', name: 'Main Stage Festival', icon: '🎪', need: 90, songs: 5, minDiff: 'expert', hue: 140, blurb: 'Headline the biggest stage there is.' },
];
export const TOUR_MAX = VENUES.reduce((s, v) => s + v.songs * 5, 0);

const tourOf = (p) => (p.tour ||= { venues: {} });

/** Stars earned on the tour (best gig per venue). */
export function tourStars(p) {
  if (!p) return 0;
  return Object.values(tourOf(p).venues).reduce((s, v) => s + (v.stars || 0), 0);
}

export const unlocked = (p, venue) => tourStars(p) >= venue.need;

/** Peak-density difficulty of a song (0..7) for ordering the tour. */
function songRating(s) {
  let best = 0;
  for (const ch of Object.values(s.charts || {})) {
    const notes = ch?.available && ch.notes?.expert;
    if (!notes?.length) continue;
    let peak = 0;
    for (let i = 0, j = 0; i < notes.length; i++) { while (notes[j].t < notes[i].t - 4) j++; peak = Math.max(peak, (i - j + 1) / 4); }
    best = Math.max(best, peak);
  }
  return best;
}

/**
 * The songs of a venue's gig. Picked once from the library (easier songs for early venues) and then
 * locked on the profile, so the gig stays the same as the library grows.
 */
export function gigSongs(p, venue, library) {
  const t = tourOf(p);
  const rec = (t.venues[venue.id] ||= { stars: 0, score: 0, plays: 0 });
  const have = new Set(library.map((s) => s.id));
  const pool = library.filter((s) => s.method !== 'demo' || library.length < 4);
  if (rec.songs?.length && rec.songs.every((id) => have.has(id))) return rec.songs;
  const sorted = [...pool].sort((a, b) => songRating(a) - songRating(b));
  const k = VENUES.indexOf(venue);
  const n = Math.min(venue.songs, sorted.length);
  const start = sorted.length <= n ? 0 : Math.round((k / (VENUES.length - 1)) * (sorted.length - n));
  const pick = [];
  for (let i = 0; pick.length < n && i < sorted.length; i++) pick.push(sorted[(start + i) % sorted.length].id);
  rec.songs = pick;
  profiles.saveSoon();
  return pick;
}

/** Record a finished gig. Returns { stars, score, best, newVenues[], achievements[] }. */
export async function recordGig(p, venue, stars, score) {
  const before = VENUES.filter((v) => unlocked(p, v)).map((v) => v.id);
  const rec = (tourOf(p).venues[venue.id] ||= { stars: 0, score: 0, plays: 0 });
  rec.plays = (rec.plays || 0) + 1;
  const best = stars > (rec.stars || 0) || (stars === rec.stars && score > (rec.score || 0));
  if (best) { rec.stars = stars; rec.score = score; rec.date = Date.now(); }
  const newVenues = VENUES.filter((v) => unlocked(p, v) && !before.includes(v.id));
  const fresh = [];
  const award = async (id) => fresh.push(...(await profiles.award(p.id, id)));
  await award('tour_gig');
  if (unlocked(p, VENUES.find((v) => v.id === 'arena'))) await award('tour_arena');
  if (unlocked(p, VENUES.find((v) => v.id === 'festival'))) await award('tour_festival');
  if (venue.id === 'festival' && stars >= venue.songs * 5) await award('tour_legend');
  await profiles.saveSoon(true);
  return { stars, score, best, newVenues, achievements: fresh };
}

// ---------------------------------------------------------------- daily challenge
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const INST_ORDER = ['guitar', 'bass', 'drums', 'keys', 'vocals'];

/** Today's challenge: same for everyone on this PC. null if the library has nothing playable. */
export function dailyChallenge(library, date = today()) {
  const songs = library.filter((s) => INST_ORDER.some((i) => s.charts?.[i]?.available)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!songs.length) return null;
  const h = hash(date);
  const song = songs[h % songs.length];
  const insts = INST_ORDER.filter((i) => song.charts[i]?.available);
  const instrument = insts[(h >>> 8) % insts.length];
  const difficulty = ['medium', 'hard', 'hard', 'expert'][(h >>> 12) % 4];
  const notes = song.charts[instrument].notes[difficulty]?.length || 100;
  const kinds = [
    { kind: 'stars', target: 4, text: 'Earn 4 stars or more' },
    { kind: 'accuracy', target: 0.9, text: 'Finish with 90% accuracy' },
    { kind: 'streak', target: Math.max(30, Math.min(150, Math.round(notes * 0.3 / 10) * 10)), text: '' },
    { kind: 'od', target: 2, text: 'Activate overdrive twice' },
  ];
  const goal = kinds[(h >>> 16) % kinds.length];
  if (goal.kind === 'streak') goal.text = `Hit a ${goal.target}-note streak`;
  return { date, songId: song.id, title: song.title, artist: song.artist, instrument, difficulty, ...goal, xp: 400 };
}

export function dailyMet(ch, r) {
  if (!ch || r.failed) return false;
  if (ch.kind === 'stars') return r.stars >= ch.target;
  if (ch.kind === 'accuracy') return r.accuracy >= ch.target;
  if (ch.kind === 'streak') return r.maxStreak >= ch.target;
  if (ch.kind === 'od') return (r.odActivations || 0) >= ch.target;
  return false;
}

export const dailyDone = (p, date = today()) => p?.daily?.last === date;

/** Mark today's challenge done for a profile: bonus XP, day streak, badges. */
export async function completeDaily(p, ch) {
  if (dailyDone(p, ch.date)) return null;
  const d = (p.daily ||= { last: null, streak: 0 });
  const yesterday = today(new Date(Date.now() - 86400000));
  d.streak = d.last === yesterday ? (d.streak || 0) + 1 : 1;
  d.last = ch.date;
  d.total = (d.total || 0) + 1;
  p.xp = (p.xp || 0) + ch.xp;
  const fresh = [...(await profiles.award(p.id, 'daily_1'))];
  if (d.streak >= 7) fresh.push(...(await profiles.award(p.id, 'daily_7')));
  await profiles.saveSoon(true);
  return { streak: d.streak, xp: ch.xp, achievements: fresh };
}
