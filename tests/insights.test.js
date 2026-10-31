// v3: the library brain — keys, smart setlists, play stats.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { songKey, smartSetlists, playStats, topArtists, rating } from '../src/storage/insights.js';

const notes = (n, pitches = [57, 60, 64, 69]) => Array.from({ length: n }, (_, i) => ({ t: i * 0.5, lane: i % 5, m: pitches[i % pitches.length], len: 0.2 }));
const song = (id, n, extra = {}) => ({ id, title: `T${id}`, artist: `A${id}`, duration: 150 + n, bpm: 100 + n, charts: { guitar: { available: true, notes: { easy: notes(n), medium: notes(n * 2), hard: notes(n * 3), expert: notes(n * 4) } } }, ...extra });
const songs = [song('a', 10), song('b', 40), song('c', 25), song('d', 60), song('e', 15), song('f', 30, { charts: { guitar: { available: true, notes: { medium: notes(60, [60, 64, 67, 72]), expert: notes(240, [60, 64, 67, 72, 65, 62]) } } } })];

test('a song knows its key, without saving it into song.json', () => {
  assert.equal(songKey(songs[0]), 'A minor');
  assert.ok(!Object.keys(songs[0]).includes('_key'));
});

test('smart setlists: the climb rises, dusty records skip what was played this month', () => {
  const now = Date.UTC(2026, 9, 31);
  const plays = [{ songId: 'a', date: now - 86_400_000 }, { songId: 'a', date: now - 2 * 86_400_000 }, { songId: 'd', date: now - 60 * 86_400_000 }];
  const lists = Object.fromEntries(smartSetlists(songs, plays, { inst: 'guitar', diff: 'medium', now }).map((l) => [l.id, l]));
  const climb = lists.climb.songs.map((id) => songs.find((s) => s.id === id));
  for (let i = 1; i < climb.length; i++) assert.ok(rating(climb[i].charts.guitar.notes.medium) >= rating(climb[i - 1].charts.guitar.notes.medium));
  assert.ok(!lists.dusty.songs.includes('a'));
  assert.ok(lists.dusty.songs.includes('d'));
  assert.deepEqual(lists.favourites.songs.slice(0, 1), ['a']);
  assert.ok(lists.quick.songs.length === 3);
  for (const l of Object.values(lists)) assert.ok(l.songs.length >= 2 && l.minutes >= 0);
});

test('play stats and top artists', () => {
  const t = Date.UTC(2026, 9, 1, 20);
  const plays = [
    { songId: 'a', songTitle: 'Ta', songArtist: 'Aa', instrument: 'drums', accuracy: 0.9, maxStreak: 120, fc: true, seconds: 180, date: t },
    { songId: 'a', songTitle: 'Ta', songArtist: 'Aa', instrument: 'drums', accuracy: 0.8, maxStreak: 80, seconds: 180, date: t + 86_400_000 },
    { songId: 'b', songTitle: 'Tb', songArtist: 'Ab', instrument: 'guitar', accuracy: 0.7, maxStreak: 40, seconds: 240, date: t + 2 * 86_400_000 },
  ];
  const s = playStats(plays);
  assert.equal(s.plays, 3); assert.equal(s.songs, 2); assert.equal(s.days, 3); assert.equal(s.fcs, 1);
  assert.equal(s.topSong.title, 'Ta'); assert.equal(s.topInstrument, 'drums'); assert.equal(s.bestStreak, 120);
  assert.ok(Math.abs(s.hours - 0.1667) < 0.01);
  assert.equal(playStats([]), null);
  // the artists you play most, then the rest of your library
  assert.deepEqual(topArtists(plays, songs, 3), ['Aa', 'Ab', 'Ac']);
});
