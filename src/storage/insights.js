// What the game knows about the songs in your library (no audio needed: song.json only). Used by the setlist,
// Runs (game/runs.js) and the library brain (ui/discover-ui.js).
import { estimateKey } from '../audio/freestyle.js';

/** 1..7 difficulty rating from note density (peak notes/second over 4 s windows); 0 without notes. */
export function rating(notes) {
  if (!notes?.length) return 0;
  let peak = 0;
  for (let i = 0, j = 0; i < notes.length; i++) {
    while (notes[j].t < notes[i].t - 4) j++;
    peak = Math.max(peak, (i - j + 1) / 4);
  }
  return Math.max(1, Math.min(7, Math.round(Math.log2(peak + 1) * 2.1)));
}

/** A part's rating at a difficulty (0 when the song has no chart for it). */
export function partRating(song, inst, diff) {
  const c = song?.charts?.[inst];
  return c?.available ? rating(c.notes?.[diff]) : 0;
}

/** Songs with a chart for this part. */
export const playable = (songs, inst) => songs.filter((s) => s.charts?.[inst]?.available);

// ---------------------------------------------------------------- the library brain

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const DAY = 86_400_000;

/** The song's key from its charts' pitches ("A minor"), cached on the song; null without pitched parts. */
export function songKey(song) {
  if (song._key !== undefined) return song._key;
  const notes = ['bass', 'guitar', 'keys', 'vocals'].flatMap((i) => (song.charts?.[i]?.available ? song.charts[i].notes?.expert || [] : []));
  const k = notes.length >= 24 ? estimateKey(notes) : null;
  Object.defineProperty(song, '_key', { value: k ? `${NAMES[k.tonic]} ${k.mode}` : null, enumerable: false, configurable: true });
  return song._key;
}

/** How busy the whole band is: expert notes per second across every charted part. */
export function energy(song) {
  const dur = Math.max(30, song.duration || 180);
  return ['guitar', 'bass', 'drums', 'keys', 'vocals'].reduce((s, i) => s + (song.charts?.[i]?.available ? (song.charts[i].notes?.expert?.length || 0) : 0), 0) / dur;
}

const minutes = (songs) => songs.reduce((s, x) => s + (x.duration || 0), 0) / 60;
function fill(sorted, target = 20) {
  const out = [];
  for (const s of sorted) { if (minutes(out) >= target) break; out.push(s); }
  return out;
}

/**
 * Setlists the game builds from your library and your plays. → [{ id, name, desc, icon, songs: [ids], minutes }]
 * (only the ones with at least two songs). plays: play history entries (profile/profiles.js).
 */
export function smartSetlists(songs, plays, { inst = 'guitar', diff = 'medium', now = Date.now() } = {}) {
  const mine = playable(songs, inst);
  const last = new Map(), count = new Map();
  for (const p of plays) { last.set(p.songId, Math.max(last.get(p.songId) || 0, p.date || 0)); count.set(p.songId, (count.get(p.songId) || 0) + 1); }
  const lists = [];
  const add = (id, name, desc, icon, list) => { if (list.length >= 2) lists.push({ id, name, desc, icon, songs: list.map((s) => s.id), minutes: Math.round(minutes(list)) }); };
  add('climb', 'The climb', `About 20 minutes of ${inst}, from your easiest song to your hardest`, 'stairs',
    fill([...mine].sort((a, b) => partRating(a, inst, diff) - partRating(b, inst, diff) || (a.duration || 0) - (b.duration || 0))).sort((a, b) => partRating(a, inst, diff) - partRating(b, inst, diff)));
  add('energy', 'All killer', 'Your busiest, loudest songs back to back, slowest tempo first', 'bolt',
    fill([...mine].sort((a, b) => energy(b) - energy(a))).sort((a, b) => (a.bpm || 0) - (b.bpm || 0)));
  add('dusty', 'Dusty records', 'Songs you haven’t played in a month, or ever', 'record-vinyl',
    fill(mine.filter((s) => now - (last.get(s.id) || 0) > 30 * DAY).sort((a, b) => (last.get(a.id) || 0) - (last.get(b.id) || 0))));
  const keys = new Map();
  for (const s of mine) { const k = songKey(s); if (k) keys.set(k, [...(keys.get(k) || []), s]); }
  const [key, inKey] = [...keys.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (key) add('key', `In ${key}`, `${inKey.length} of your songs share a key: a set that flows`, 'music', fill(inKey, 30));
  add('quick', 'Quick set', 'Your three shortest songs, for when there’s ten minutes', 'stopwatch',
    [...mine].sort((a, b) => (a.duration || 0) - (b.duration || 0)).slice(0, 3));
  add('favourites', 'Your favourites', 'The songs you play most', 'heart',
    fill(mine.filter((s) => count.get(s.id)).sort((a, b) => count.get(b.id) - count.get(a.id))));
  add('workout', `${inst[0].toUpperCase()}${inst.slice(1)} workout`, `The hardest ${inst} parts you have, on ${diff}`, 'dumbbell',
    fill([...mine].sort((a, b) => partRating(b, inst, diff) - partRating(a, inst, diff)), 15));
  return lists;
}

/** Your playing in numbers, from the play history (one profile's entries). */
export function playStats(plays) {
  if (!plays.length) return null;
  const by = (key) => { const m = new Map(); for (const p of plays) m.set(p[key], (m.get(p[key]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const hours = new Array(24).fill(0);
  for (const p of plays) hours[new Date(p.date).getHours()]++;
  const topSong = by('songId')[0];
  const song = plays.find((p) => p.songId === topSong[0]);
  return {
    plays: plays.length,
    hours: plays.reduce((s, p) => s + (p.seconds || 0), 0) / 3600,
    songs: new Set(plays.map((p) => p.songId)).size,
    days: new Set(plays.map((p) => new Date(p.date).toDateString())).size,
    topSong: { title: song.songTitle, artist: song.songArtist, plays: topSong[1] },
    topInstrument: by('instrument')[0][0],
    accuracy: plays.reduce((s, p) => s + (p.accuracy || 0), 0) / plays.length,
    bestStreak: Math.max(...plays.map((p) => p.maxStreak || 0)),
    fcs: plays.filter((p) => p.fc).length,
    hour: hours.indexOf(Math.max(...hours)),
    since: Math.min(...plays.map((p) => p.date)),
  };
}

/** Your most-played artists (for "because you play …"), most played first. */
export function topArtists(plays, songs, n = 6) {
  const m = new Map();
  for (const p of plays) { const a = (p.songArtist || '').trim(); if (a) m.set(a, (m.get(a) || 0) + 1); }
  for (const s of songs) { const a = (s.artist || '').trim(); if (a && !m.has(a)) m.set(a, 0); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a);
}
