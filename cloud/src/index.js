// STEMSTAGE online leaderboard: a Cloudflare Worker on D1 (SQLite), at https://api.stemstage.varconstint.com
//
//   POST /v1/scores                 the game submits a finished run (see submit() for the body)
//   GET  /v1/leaderboard?song=<key>&instrument=&difficulty=&limit=   best runs on one chart
//   GET  /v1/players?limit=         overall: every player's best scores added up
//   GET  /v1/songs?limit=&q=&before=  paged songs with scores
//   GET  /v1/recent?limit=          newest runs
//   POST /v1/profile                the game shares a profile card (level, achievements, stats)
//   POST /v1/link                   link (or unlink) a Discord account: the game passes the Discord login's token,
//                                   which the API checks with Discord itself
//   GET  /v1/player?id=             a shared profile + its world stats (the website's /player/ page)
//   GET  /v1/me                     "Log in with Discord" on the website: Authorization: Bearer <Discord OAuth token>
//                                   → the Discord user (checked with Discord) + the STEMSTAGE profiles linked to it
//   POST /v1/charts                 the game uploads the chart a run was played on (notes + a fingerprint of the audio)
//   GET  /v1/charts?song=&instrument=   the charts players uploaded for a song part, ranked one first, with votes
//   GET  /v1/chart?id=              one chart in full (the game downloads it and lines it up with its own audio)
//   POST /v1/charts/vote            vote for the chart a song part should be ranked on
//   GET  /v1/library?q=&limit=&before=  paged chart library: songs with uploaded charts, their parts and players
//   GET  /v1/challenge?player=      this week's challenge (a ranked song part) and its board
//   GET  /v1/season?player=         this season's standings (points from the weekly challenges)
//   GET  /v1/rooms                  public online rooms (hosts re-announce every 30 s; listed for 90 s)
//   POST /v1/rooms                  a host lists / refreshes its room   POST /v1/rooms/close   takes it down
//   POST /v1/match                  matchmaking: the best open room for a player, or a ticket to keep searching (v2)
//   POST /v1/match/cancel           stop searching                      GET /v1/lobby   rooms open, players, searching
//   POST /v1/bosses                 a signed-in player beat a world boss (v2)
//   GET  /v1/bosses?boss=           the boss hall of fame: fastest kills and most kills (all bosses without ?boss=)
//   GET  /v1/health
//
// Every GET answers JSON with CORS, or JSONP with ?callback=<function name>. Songs are matched across players by
// artist + title (normalised), so everyone who imported the same song shares its boards.
//
// Ranked charts: every import makes its own AI chart, so a raw score only compares with runs on the same chart.
// Each song part (song + instrument) is ranked on one chart: the first one uploaded, until players vote in a
// better one (VOTE_MIN votes from players who played it, and more votes than the ranked chart has). The game
// downloads the ranked chart and lines it up with the player's own recording (src/audio/fingerprint.js), so
// everyone on a board played the same notes. Runs on other charts are kept on their own chart's board.
//
// Players are identified by an id the game makes per profile plus a secret only that game knows: the first run
// registers sha256(secret), later runs must present the same secret, so nobody can post under someone else's
// name. A Discord account is only shown next to a player once the API has checked a Discord login for it
// (POST /v1/link). Scores can't be verified (the game runs on the player's PC), so the API rejects impossible
// values (on a known chart: more than its notes can score), rate-limits each address and counts chart votes once
// per address; moderators can delete rows with wrangler (see cloud/README.md).
//
// Optional callback: set the secret DISCORD_WEBHOOK (a Discord channel webhook URL) to announce every new #1.

import { canonicalChart, chartId as idOfChart, noteCounts, INSTRUMENTS, DIFFICULTIES } from './chart.js';
import { pickRoom, MODES as MATCH_MODES } from './match.js';

const MAX_SCORE = 20_000_000;
const VOTE_MIN = 3; // votes a chart needs before it can replace the ranked one
const MAX_CHART_BYTES = 1_500_000, MAX_BODY_BYTES = 64_000;
const RATE = { window: 600, max: 40 }; // runs per address per 10 minutes
const ROOM_FRESH = 90, ROOM_KEEP = 600, ROOM_MODES = ['versus', 'battle', 'band'];
const ROOM_STAGES = ['arena', 'garage', 'club', 'bar', 'theater', 'stadium', 'festival', 'aquarium', 'nebula', 'forge', 'aurora', 'citadel'];
const TICKET_FRESH = 20;
const BOSSES = ['leviathan', 'conductor', 'titan', 'wyrm', 'thunderbird'];
// weekly challenges: weeks start on Monday 00:00 UTC; a season is six weeks
const WEEK0 = Date.UTC(2026, 8, 28) / 1000, WEEK = 7 * 86400, SEASON_WEEKS = 6; // week 0 = season 1 starts Monday 28 September 2026
const WEEK_DIFFS = ['hard', 'expert', 'medium', 'expert', 'hard', 'expert'];

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
/** A POST body as JSON, refused before it's read when it's bigger than max (Content-Length) or while reading. */
async function readJson(req, max = MAX_BODY_BYTES) {
  if (+(req.headers.get('Content-Length') || 0) > max) throw new HttpError(413, 'request too big');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'request too big');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'body must be JSON'); }
}

/** JSON, or JSONP when ?callback= names a function. */
function reply(url, data, cacheSeconds = 15) {
  const cb = url.searchParams.get('callback');
  const cache = { 'Cache-Control': `public, max-age=${cacheSeconds}` };
  if (cb) {
    if (!/^[A-Za-z_$][\w$.]{0,63}$/.test(cb)) return json({ error: 'bad callback name' }, 400);
    return new Response(`/**/${cb}(${JSON.stringify(data)});`, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...cache } });
  }
  return json(data, 200, cache);
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, '').replace(/\b(feat|ft)\b.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The shared key for a song: the same artist + title from any player's import. */
export const songKey = async (artist, title) => (await sha256(`${norm(artist)}|${norm(title)}`)).slice(0, 16);

const clampInt = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : null);
const limitOf = (url, def, max) => clampInt(url.searchParams.get('limit') ?? def, 1, max);
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);

const avatarOf = (r) => (r.discord_id && r.discord_avatar ? `https://cdn.discordapp.com/avatars/${r.discord_id}/${r.discord_avatar}.png?size=64` : null);
const publicRow = (r) => ({
  player: r.name, playerId: r.player_id, avatar: avatarOf(r), score: r.score, stars: r.stars, accuracy: r.accuracy, fc: !!r.fc,
  maxStreak: r.max_streak, instrument: r.instrument, difficulty: r.difficulty, date: r.created,
  chart: r.chart_id || null, ...(r.ranked_id !== undefined ? { ranked: !!r.chart_id && r.chart_id === r.ranked_id } : {}),
  ...(r.title !== undefined ? { song: { key: r.song_key, title: r.title, artist: r.artist } } : {}),
});
const isChartId = (v) => /^[0-9a-f]{16}$/.test(v || '');
const rankedOf = (env, key, instrument) => env.DB.prepare('SELECT chart_id FROM ranked_charts WHERE song_key = ? AND instrument = ?').bind(key, instrument).first().then((r) => r?.chart_id || null);
// a player's best run on each board, whichever chart it was on (so totals never count a song twice)
const BEST_PER_BOARD = `SELECT * FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.player_id, s.song_key, s.instrument, s.difficulty ORDER BY s.score DESC) AS rn FROM scores s) WHERE rn = 1`;

// ---------------------------------------------------------------- players
/**
 * Check a submitted player ({ id, secret, name }): → { ok, id, name, secretHash, discordId, discordAvatar } or { error, status }.
 * The Discord account is the one stored for the player (linked through POST /v1/link); what the game says about it
 * isn't trusted, so nobody can show someone else's Discord name and avatar on their runs.
 */
async function checkPlayer(env, p = {}) {
  if (!p || typeof p !== 'object') return { error: 'bad player id/secret', status: 400 };
  const name = cleanName(p.name);
  if (typeof p.id !== 'string' || !/^[\w-]{8,64}$/.test(p.id) || typeof p.secret !== 'string' || p.secret.length < 16 || p.secret.length > 200) return { error: 'bad player id/secret', status: 400 };
  if (!name) return { error: 'player name required', status: 400 };
  const secretHash = await sha256(p.secret);
  // the first request registers the secret; afterwards it has to match
  const known = await env.DB.prepare('SELECT secret_hash, discord_id, discord_avatar FROM players WHERE id = ?').bind(p.id).first();
  if (known && known.secret_hash !== secretHash) return { error: 'this player id belongs to someone else', status: 403 };
  return { ok: true, id: p.id, name, secretHash, discordId: known?.discord_id || null, discordAvatar: known?.discord_avatar || null };
}
const upsertPlayer = (env, pl, now) => env.DB.prepare(`INSERT INTO players (id, secret_hash, name, created, updated) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated = excluded.updated`)
  .bind(pl.id, pl.secretHash, pl.name, now, now);

async function rateLimited(env, ip, now) {
  const { results: [{ n }] } = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE ip = ? AND ts > ?').bind(ip, now - RATE.window).all();
  return n >= RATE.max;
}

/** Discord markdown in a player's text shown as typed (no masked links, bold or mentions in the announcement). */
const discordText = (s) => String(s ?? '').replace(/[\\`*_~|>[\]()<@#]/g, (c) => `\\${c}`).replace(/:\/\//g, ':\u200b//');

/**
 * The most a run on a chart can score, per difficulty: every note hit at the top multiplier with overdrive on
 * (src/game/player.js: 50 a note, 25 per half second of sustain; ×4, ×6 on bass; ×2 overdrive). Vocals score per
 * phrase (src/game/vocals.js: up to 1000 × 4 × 2), bounded by 8000 a note.
 */
function chartLimits(chart) {
  const out = {};
  const top = (chart.instrument === 'bass' ? 6 : 4) * 2;
  for (const d of DIFFICULTIES) {
    const notes = chart.notes[d];
    const max = chart.instrument === 'vocals' ? notes.length * 8000 : notes.reduce((sum, n) => sum + 50 + (n[2] / 500) * 25, 0) * top;
    out[d] = [notes.length, Math.ceil(max * 1.01) + 100];
  }
  return out;
}

/** A chart's limits (stored at upload; worked out once for charts uploaded before 1.8.1). null = unknown chart. */
async function limitsOf(env, id) {
  const row = await env.DB.prepare('SELECT song_key, instrument, data, limits FROM charts WHERE id = ?').bind(id).first();
  if (!row) return null;
  let limits = null;
  try { limits = row.limits ? JSON.parse(row.limits) : null; } catch { limits = null; }
  if (!limits) {
    limits = chartLimits(JSON.parse(row.data));
    await env.DB.prepare('UPDATE charts SET limits = ? WHERE id = ?').bind(JSON.stringify(limits), id).run();
  }
  return { songKey: row.song_key, instrument: row.instrument, limits };
}

// ---------------------------------------------------------------- POST /v1/scores
/*
  {
    player: { id: "<uuid>", secret: "<random, kept by the game>", name: "Varconstint", discord?: { id, avatar } },
    song: { title, artist, duration },
    instrument: "guitar", difficulty: "expert", chartId?: "<16 hex, the chart it was played on>",
    score: 123456, stars: 5, accuracy: 0.97, fc: false, maxStreak: 321, notes: 800, version: "1.5.0"
  }
*/
async function submit(req, env, ctx) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many runs from this address, try again later' }, 429);

  const b = await readJson(req);
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  const { name, discordId, discordAvatar } = pl;
  const p = { id: pl.id };
  if (!INSTRUMENTS.includes(b.instrument) || !DIFFICULTIES.includes(b.difficulty)) return json({ error: 'bad instrument/difficulty' }, 400);
  const title = String(b.song?.title || '').trim().slice(0, 120), artist = String(b.song?.artist || '').trim().slice(0, 120);
  if (!norm(title)) return json({ error: 'song title required' }, 400);
  const score = clampInt(b.score, 0, MAX_SCORE), stars = clampInt(b.stars, 0, 6), notes = clampInt(b.notes, 1, 100000), streak = clampInt(b.maxStreak, 0, 100000);
  const accuracy = Number.isFinite(+b.accuracy) ? Math.max(0, Math.min(1, +b.accuracy)) : null;
  if (score === null || stars === null || accuracy === null || notes === null || streak === null) return json({ error: 'bad score fields' }, 400);
  if (streak > notes || score > notes * 2000) return json({ error: 'score out of range for this chart' }, 400);
  const fc = b.fc ? 1 : 0;
  const key = await songKey(artist, title);
  const chart = isChartId(b.chartId) ? b.chartId : '';
  // a run on a chart the API has: it can't have more notes, or score more, than that chart allows
  const known = chart ? await limitsOf(env, chart) : null;
  if (known) {
    if (known.songKey !== key || known.instrument !== b.instrument) return json({ error: 'that chart is for another song part' }, 400);
    const [count, max] = known.limits[b.difficulty] || [0, 0];
    if (score > max || streak > count) return json({ error: 'score out of range for this chart' }, 400);
  }
  const rankedId = await rankedOf(env, key, b.instrument);
  const ranked = !!chart && chart === rankedId;
  const prevTop = await env.DB.prepare('SELECT s.score, pl.name FROM scores s JOIN players pl ON pl.id = s.player_id WHERE s.song_key = ? AND s.instrument = ? AND s.difficulty = ? AND s.chart_id = ? ORDER BY s.score DESC LIMIT 1')
    .bind(key, b.instrument, b.difficulty, chart).first();
  const mine = await env.DB.prepare('SELECT score FROM scores WHERE player_id = ? AND song_key = ? AND instrument = ? AND difficulty = ? AND chart_id = ?').bind(p.id, key, b.instrument, b.difficulty, chart).first();

  const stmts = [
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    upsertPlayer(env, pl, now),
    env.DB.prepare(`INSERT INTO songs (key, title, artist, duration, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`)
      .bind(key, title, artist, clampInt(b.song?.duration, 0, 7200), now),
    env.DB.prepare('INSERT INTO runs (player_id, song_key, instrument, difficulty, score, created, chart_id) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(p.id, key, b.instrument, b.difficulty, score, now, chart),
  ];
  const best = !mine || score > mine.score;
  if (best) {
    stmts.push(env.DB.prepare(`INSERT INTO scores (player_id, song_key, instrument, difficulty, chart_id, score, stars, accuracy, fc, max_streak, notes, version, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id, song_key, instrument, difficulty, chart_id) DO UPDATE SET score = excluded.score, stars = excluded.stars, accuracy = excluded.accuracy,
        fc = excluded.fc, max_streak = excluded.max_streak, notes = excluded.notes, version = excluded.version, created = excluded.created`)
      .bind(p.id, key, b.instrument, b.difficulty, chart, score, stars, accuracy, fc, streak, known ? known.limits[b.difficulty]?.[0] ?? notes : notes, String(b.version || '').replace(/[^\w.-]/g, '').slice(0, 16), now));
  }
  // keep the rate-limit table small
  stmts.push(env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(now - 3600));
  await env.DB.batch(stmts);

  const { results: [{ rank }] } = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE song_key = ? AND instrument = ? AND difficulty = ? AND chart_id = ? AND score > ?')
    .bind(key, b.instrument, b.difficulty, chart, best ? score : mine.score).all();
  const newTop = best && (!prevTop || score > prevTop.score);
  // only the board people compete on is announced: the ranked chart (or, before a song has one, the unranked board)
  const announced = ranked || (!rankedId && !chart);
  if (newTop && announced && env.DISCORD_WEBHOOK) ctx.waitUntil(announce(env.DISCORD_WEBHOOK, { name, title, artist, instrument: b.instrument, difficulty: b.difficulty, score, stars, fc, prev: prevTop, avatar: avatarOf({ discord_id: discordId, discord_avatar: discordAvatar }) }));
  return json({ ok: true, songKey: key, chartId: chart || null, ranked, rankedChart: rankedId, personalBest: best, rank, newTop });
}

/** The callback: a new #1 posted to a Discord channel webhook. */
async function announce(webhook, r) {
  const board = `https://stemstage.varconstint.com/leaderboard/`;
  await fetch(webhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'STEMSTAGE', allowed_mentions: { parse: [] },
      embeds: [{
        title: `🏆 New #1: ${r.title}${r.artist ? ` — ${r.artist}` : ''}`.slice(0, 256), url: board, color: 0xdf3a2c, // titles show no markdown
        description: `**${discordText(r.name)}** set **${r.score.toLocaleString('en-US')}** on ${r.instrument} · ${r.difficulty}${r.fc ? ' · full combo' : ''} (${'★'.repeat(Math.min(5, r.stars))})` +
          (r.prev ? `\nBeating ${discordText(r.prev.name)}'s ${r.prev.score.toLocaleString('en-US')}` : '\nThe first score on this chart'),
        ...(r.avatar ? { thumbnail: { url: r.avatar } } : {}),
      }],
    }),
  }).catch(() => {});
}

// ---------------------------------------------------------------- charts
/*
  POST /v1/charts
  { player: { id, secret, name, discord? }, song: { title, artist, duration }, instrument: "guitar",
    chart: { v: 1, instrument, phrases, notes } (see chart.js),
    fp: { v: 1, fps: 50, onset: "<base64>", loud: "<base64>" } (src/audio/fingerprint.js, the uploader's recording),
    meta: { edited: false, method: "<how it was charted>", version: "1.6.0" } }
  → { ok, chartId, known, ranked, rankedChart }: the first chart uploaded for a song part becomes its ranked chart
*/
const FP_MAX = Math.ceil((3600 * 50) / 3) * 4; // an hour of fingerprint frames, in base64
function cleanFingerprint(fp) {
  const ok = (s) => typeof s === 'string' && s.length > 0 && s.length <= FP_MAX && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  if (!fp || fp.v !== 1 || fp.fps !== 50 || !ok(fp.onset) || !ok(fp.loud) || fp.onset.length !== fp.loud.length) return null;
  return { v: 1, fps: 50, onset: fp.onset, loud: fp.loud };
}

async function uploadChart(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many requests from this address, try again later' }, 429);
  const b = await readJson(req, MAX_CHART_BYTES);
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  const title = String(b.song?.title || '').trim().slice(0, 120), artist = String(b.song?.artist || '').trim().slice(0, 120);
  if (!norm(title)) return json({ error: 'song title required' }, 400);
  let canonical;
  try { canonical = canonicalChart(b.chart); } catch (e) { return json({ error: e.message }, 400); }
  const fp = cleanFingerprint(b.fp);
  if (!fp) return json({ error: 'bad fingerprint' }, 400);
  const key = await songKey(artist, title);
  const id = await idOfChart(canonical);
  const counts = noteCounts(canonical);
  const known = await env.DB.prepare('SELECT song_key, instrument FROM charts WHERE id = ?').bind(id).first();
  if (known && (known.song_key !== key || known.instrument !== canonical.instrument)) return json({ error: 'this chart belongs to another song' }, 409);
  const duration = Number.isFinite(+b.song?.duration) ? Math.max(0, Math.min(7200, +b.song.duration)) : null;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    upsertPlayer(env, pl, now),
    env.DB.prepare('INSERT INTO songs (key, title, artist, duration, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(key, title, artist, clampInt(duration, 0, 7200), now),
    env.DB.prepare(`INSERT INTO charts (id, song_key, instrument, data, fp, duration, notes, edited, method, version, player_id, created, limits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(id, key, canonical.instrument, JSON.stringify(canonical), JSON.stringify(fp), duration, counts.expert || Math.max(...Object.values(counts)),
        b.meta?.edited ? 1 : 0, cleanText(b.meta?.method, 40) || null, String(b.meta?.version || '').replace(/[^\w.-]/g, '').slice(0, 16) || null, pl.id, now,
        JSON.stringify(chartLimits(canonical))),
    // the first chart of a song part is its ranked chart (players can vote in another one later)
    env.DB.prepare('INSERT INTO ranked_charts (song_key, instrument, chart_id, since) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(key, canonical.instrument, id, now),
  ]);
  const rankedId = await rankedOf(env, key, canonical.instrument);
  return json({ ok: true, chartId: id, songKey: key, known: !!known, ranked: id === rankedId, rankedChart: rankedId });
}

/** GET /v1/charts?song=<key>&instrument=&player=<id>: the charts of a song part, the ranked one first. */
async function listCharts(url, env) {
  const key = url.searchParams.get('song') || '', instrument = url.searchParams.get('instrument') || 'guitar';
  if (!/^[0-9a-f]{16}$/.test(key) || !INSTRUMENTS.includes(instrument)) return json({ error: 'song=<key> and instrument required' }, 400);
  const rankedId = await rankedOf(env, key, instrument);
  const { results } = await env.DB.prepare(`SELECT c.id, c.duration, c.notes, c.edited, c.method, c.version, c.created, p.name AS uploader,
      (SELECT COUNT(*) FROM chart_votes v WHERE v.chart_id = c.id) AS votes,
      (SELECT COUNT(*) FROM runs r WHERE r.chart_id = c.id) AS runs,
      (SELECT COUNT(DISTINCT r.player_id) FROM runs r WHERE r.chart_id = c.id) AS players
    FROM charts c LEFT JOIN players p ON p.id = c.player_id WHERE c.song_key = ? AND c.instrument = ?
    ORDER BY (c.id = ?) DESC, votes DESC, players DESC, c.created ASC LIMIT 50`).bind(key, instrument, rankedId || '').all();
  const who = url.searchParams.get('player') || '';
  const myVote = /^[\w-]{8,64}$/.test(who)
    ? (await env.DB.prepare('SELECT chart_id FROM chart_votes WHERE song_key = ? AND instrument = ? AND player_id = ?').bind(key, instrument, who).first())?.chart_id || null
    : null;
  return reply(url, {
    song: key, instrument, rankedChart: rankedId, voteMin: VOTE_MIN, myVote,
    rows: results.map((r) => ({ id: r.id, ranked: r.id === rankedId, votes: r.votes, runs: r.runs, players: r.players, notes: r.notes,
      duration: r.duration, edited: !!r.edited, method: r.method, version: r.version, uploader: r.uploader, date: r.created })),
  });
}

/** GET /v1/chart?id=: one chart in full, with its fingerprint (a chart never changes, so it caches for a day). */
async function getChart(url, env) {
  const id = url.searchParams.get('id') || '';
  if (!isChartId(id)) return json({ error: 'id required' }, 400);
  const c = await env.DB.prepare('SELECT c.*, p.name AS uploader FROM charts c LEFT JOIN players p ON p.id = c.player_id WHERE c.id = ?').bind(id).first();
  if (!c) return json({ error: 'no such chart' }, 404);
  return reply(url, {
    id: c.id, song: c.song_key, instrument: c.instrument, duration: c.duration, edited: !!c.edited, method: c.method, version: c.version,
    uploader: c.uploader, date: c.created, chart: JSON.parse(c.data), fp: JSON.parse(c.fp),
  }, 86400);
}

/*
  POST /v1/charts/vote  { player: { id, secret, name }, chartId }
  One vote per player per song part, for a chart they've finished a run on. A chart with VOTE_MIN votes and more
  votes than the ranked chart becomes the ranked chart.
*/
async function vote(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many requests from this address, try again later' }, 429);
  const b = await readJson(req);
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  if (!isChartId(b.chartId)) return json({ error: 'chartId required' }, 400);
  const c = await env.DB.prepare('SELECT song_key, instrument FROM charts WHERE id = ?').bind(b.chartId).first();
  if (!c) return json({ error: 'no such chart' }, 404);
  const played = await env.DB.prepare('SELECT 1 FROM runs WHERE chart_id = ? AND player_id = ? LIMIT 1').bind(b.chartId, pl.id).first();
  if (!played) return json({ error: 'play this chart before voting for it' }, 403);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    env.DB.prepare(`INSERT INTO chart_votes (song_key, instrument, player_id, chart_id, created, voter) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(song_key, instrument, player_id) DO UPDATE SET chart_id = excluded.chart_id, created = excluded.created, voter = excluded.voter`)
      .bind(c.song_key, c.instrument, pl.id, b.chartId, now, await sha256(`vote|${ip}`)),
  ]);
  const rankedId = await rankedOf(env, c.song_key, c.instrument);
  // one address counts once, however many profiles vote from it (votes from before 1.8.1 count per player)
  const count = (id) => env.DB.prepare('SELECT COUNT(DISTINCT COALESCE(voter, player_id)) AS n FROM chart_votes WHERE chart_id = ?').bind(id || '').first().then((r) => r.n);
  const votes = await count(b.chartId), rankedVotes = b.chartId === rankedId ? votes : await count(rankedId);
  let promoted = false;
  if (b.chartId !== rankedId && votes >= VOTE_MIN && votes > rankedVotes) {
    await env.DB.prepare(`INSERT INTO ranked_charts (song_key, instrument, chart_id, since) VALUES (?, ?, ?, ?)
      ON CONFLICT(song_key, instrument) DO UPDATE SET chart_id = excluded.chart_id, since = excluded.since`).bind(c.song_key, c.instrument, b.chartId, now).run();
    promoted = true;
  }
  return json({ ok: true, chartId: b.chartId, votes, voteMin: VOTE_MIN, rankedVotes, rankedChart: promoted ? b.chartId : rankedId, promoted });
}

// ---------------------------------------------------------------- public rooms
/*
  POST /v1/rooms  { code: "WORD-WORD-WORD-WORD", key, name, host, mode, song, artist, players, max, playing, version }
  The first announce of a code registers sha256(key); later announces and the close need the same key. Room
  announces don't count toward the run rate limit (a host sends one every 30 s), but a busy address is refused.
*/
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const isRoomCode = (c) => /^[A-Z]{2,20}(-[A-Z]{2,20}){1,9}$/.test(c || '');

async function announceRoom(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many requests from this address, try again later' }, 429);
  const b = await readJson(req, 8_000);
  const code = String(b?.code || '').toUpperCase();
  if (!isRoomCode(code) || typeof b.key !== 'string' || b.key.length < 16 || b.key.length > 100) return json({ error: 'bad room code/key' }, 400);
  const keyHash = await sha256(b.key);
  const known = await env.DB.prepare('SELECT key_hash FROM rooms WHERE code = ?').bind(code).first();
  if (known && known.key_hash !== keyHash) return json({ error: 'this room belongs to someone else' }, 403);
  const max = clampInt(b.max, 2, 16) ?? 8;
  const row = {
    name: cleanText(b.name, 40) || 'STEMSTAGE room', host: cleanText(b.host, 24), mode: ROOM_MODES.includes(b.mode) ? b.mode : 'versus',
    song: cleanText(b.song, 120), artist: cleanText(b.artist, 120), players: clampInt(b.players, 1, max) ?? 1, max, playing: b.playing ? 1 : 0,
    version: /^\d+\.\d+\.\d+$/.test(b.version || '') ? b.version : null,
    continent: /^[A-Z]{2}$/.test(req.cf?.continent || '') ? req.cf.continent : null, rating: clampInt(b.rating, 0, 4000) ?? 1000,
    stage: ROOM_STAGES.includes(b.stage) ? b.stage : 'arena', gear: b.gear ? 1 : 0, mm: b.mm ? 1 : 0,
  };
  await env.DB.batch([
    // a new listing counts toward the address's rate limit; refreshing one doesn't
    ...(known ? [] : [env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now)]),
    env.DB.prepare(`INSERT INTO rooms (code, key_hash, name, host, mode, song, artist, players, max, playing, version, continent, rating, stage, gear, mm, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, host = excluded.host, mode = excluded.mode,
        song = excluded.song, artist = excluded.artist, players = excluded.players, max = excluded.max, playing = excluded.playing,
        version = excluded.version, continent = excluded.continent, rating = excluded.rating, stage = excluded.stage, gear = excluded.gear, mm = excluded.mm, updated = excluded.updated`)
      .bind(code, keyHash, row.name, row.host, row.mode, row.song, row.artist, row.players, row.max, row.playing, row.version, row.continent, row.rating, row.stage, row.gear, row.mm, now, now),
    env.DB.prepare('DELETE FROM rooms WHERE updated < ?').bind(now - ROOM_KEEP),
  ]);
  return json({ ok: true, code, listedFor: ROOM_FRESH });
}

async function closeRoomListing(req, env) {
  const b = await readJson(req, 8_000);
  const code = String(b?.code || '').toUpperCase();
  if (!isRoomCode(code) || typeof b.key !== 'string') return json({ error: 'bad room code/key' }, 400);
  const r = await env.DB.prepare('DELETE FROM rooms WHERE code = ? AND key_hash = ?').bind(code, await sha256(b.key)).run();
  return json({ ok: true, closed: !!r.meta?.changes });
}

async function rooms(url, env) {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(`SELECT code, name, host, mode, song, artist, players, max, playing, version, continent, rating, stage, gear, mm, created, updated FROM rooms
    WHERE updated >= ? ORDER BY playing ASC, players DESC, updated DESC LIMIT ?`).bind(now - ROOM_FRESH, limitOf(url, 50, 100)).all();
  return reply(url, { rows: results.map((r) => ({ ...r, playing: !!r.playing, gear: !!r.gear, mm: !!r.mm })) }, 5);
}

// ---------------------------------------------------------------- matchmaking (v2)
/*
  POST /v1/match { mode: any|versus|battle|band, rating, version, ticket?, waited }
  → { room } (join it) | { ticket, searching, rooms } (keep searching with the same ticket; the game asks again every
  few seconds and hosts a matchmaking room itself after ~20 s). Rooms are chosen by cloud/src/match.js.
*/
async function match(req, env) {
  const b = await readJson(req, 4_000);
  const now = Math.floor(Date.now() / 1000);
  const mode = b?.mode === 'any' || MATCH_MODES.includes(b?.mode) ? b.mode : 'any';
  const version = /^\d+\.\d+\.\d+$/.test(b?.version || '') ? b.version : null;
  const continent = /^[A-Z]{2}$/.test(req.cf?.continent || '') ? req.cf.continent : null;
  const rating = clampInt(b?.rating, 0, 4000) ?? 1000;
  const waited = clampInt(b?.waited, 0, 600) ?? 0;
  const ticket = typeof b?.ticket === 'string' && /^[a-f0-9]{24}$/.test(b.ticket) ? b.ticket : [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const { results } = await env.DB.prepare(`SELECT code, name, host, mode, song, artist, players, max, playing, version, continent, rating, stage, gear, mm FROM rooms
    WHERE updated >= ? AND playing = 0 AND players < max LIMIT 200`).bind(now - ROOM_FRESH).all();
  const room = pickRoom(results, { mode, version, continent, rating, waited });
  if (room) {
    await env.DB.prepare('DELETE FROM mm_tickets WHERE ticket = ?').bind(ticket).run();
    return json({ room: { ...room, playing: false, gear: !!room.gear, mm: !!room.mm } });
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO mm_tickets (ticket, mode, rating, continent, version, updated) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticket) DO UPDATE SET mode = excluded.mode, rating = excluded.rating, updated = excluded.updated`).bind(ticket, mode, rating, continent, version, now),
    env.DB.prepare('DELETE FROM mm_tickets WHERE updated < ?').bind(now - TICKET_FRESH),
  ]);
  const searching = await env.DB.prepare('SELECT COUNT(*) AS n FROM mm_tickets WHERE updated >= ?').bind(now - TICKET_FRESH).first();
  return json({ ticket, searching: searching?.n || 1, rooms: results.length });
}

async function matchCancel(req, env) {
  const b = await readJson(req, 1_000);
  if (typeof b?.ticket === 'string' && /^[a-f0-9]{24}$/.test(b.ticket)) await env.DB.prepare('DELETE FROM mm_tickets WHERE ticket = ?').bind(b.ticket).run();
  return json({ ok: true });
}

/** GET /v1/lobby: how busy online play is right now. */
async function lobby(url, env) {
  const now = Math.floor(Date.now() / 1000);
  const [r, s, m] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS rooms, COALESCE(SUM(players), 0) AS players FROM rooms WHERE updated >= ?').bind(now - ROOM_FRESH),
    env.DB.prepare('SELECT COUNT(*) AS n FROM mm_tickets WHERE updated >= ?').bind(now - TICKET_FRESH),
    env.DB.prepare('SELECT mode, COUNT(*) AS n FROM rooms WHERE updated >= ? GROUP BY mode').bind(now - ROOM_FRESH),
  ]);
  const byMode = Object.fromEntries((m.results || []).map((x) => [x.mode, x.n]));
  return reply(url, { rooms: r.results?.[0]?.rooms || 0, players: r.results?.[0]?.players || 0, searching: s.results?.[0]?.n || 0, byMode }, 5);
}

// ---------------------------------------------------------------- boss hall of fame (v2)
async function bossKill(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many requests from this address, try again later' }, 429);
  const b = await readJson(req, 8_000);
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  if (!BOSSES.includes(b.boss)) return json({ error: 'unknown boss' }, 400);
  const seconds = Number.isFinite(+b.seconds) ? Math.max(1, Math.min(120, +b.seconds)) : null;
  if (seconds === null) return json({ error: 'bad time' }, 400);
  const damage = clampInt(b.damage, 0, 1_000_000) ?? 0;
  const inst = INSTRUMENTS.includes(b.instrument) ? b.instrument : null, diff = DIFFICULTIES.includes(b.difficulty) ? b.difficulty : null;
  const song = cleanText(`${b.song?.artist ? `${b.song.artist} – ` : ''}${b.song?.title || ''}`, 160);
  await env.DB.batch([
    upsertPlayer(env, pl, now),
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    env.DB.prepare(`INSERT INTO boss_kills (player_id, boss, seconds, damage, flawless, song, instrument, difficulty, mode, version, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(pl.id, b.boss, seconds, damage, b.flawless ? 1 : 0, song, inst, diff, cleanText(b.mode, 12), cleanText(b.version, 16), now),
  ]);
  const rank = await env.DB.prepare('SELECT COUNT(*) AS n FROM (SELECT player_id, MIN(seconds) AS s FROM boss_kills WHERE boss = ? GROUP BY player_id) WHERE s < ?').bind(b.boss, seconds).first();
  const kills = await env.DB.prepare('SELECT COUNT(*) AS n FROM boss_kills WHERE boss = ? AND player_id = ?').bind(b.boss, pl.id).first();
  return json({ ok: true, rank: (rank?.n || 0) + 1, kills: kills?.n || 1 });
}

async function bossBoard(url, env) {
  const boss = url.searchParams.get('boss');
  const limit = limitOf(url, 20, 100);
  if (!boss) {
    const { results } = await env.DB.prepare('SELECT boss, COUNT(*) AS kills, COUNT(DISTINCT player_id) AS slayers, MIN(seconds) AS best FROM boss_kills GROUP BY boss').all();
    return reply(url, { bosses: Object.fromEntries(BOSSES.map((id) => { const r = results.find((x) => x.boss === id); return [id, { kills: r?.kills || 0, slayers: r?.slayers || 0, best: r?.best || null }]; })) }, 30);
  }
  if (!BOSSES.includes(boss)) return json({ error: 'unknown boss' }, 400);
  const [fast, most] = await env.DB.batch([
    env.DB.prepare(`SELECT k.player_id, p.name, p.discord_id, p.discord_avatar, p.discord_verified, MIN(k.seconds) AS seconds, MAX(k.flawless) AS flawless
      FROM boss_kills k JOIN players p ON p.id = k.player_id WHERE k.boss = ? GROUP BY k.player_id ORDER BY seconds ASC LIMIT ?`).bind(boss, limit),
    env.DB.prepare(`SELECT k.player_id, p.name, p.discord_id, p.discord_avatar, p.discord_verified, COUNT(*) AS kills
      FROM boss_kills k JOIN players p ON p.id = k.player_id WHERE k.boss = ? GROUP BY k.player_id ORDER BY kills DESC LIMIT ?`).bind(boss, limit),
  ]);
  const who = (r) => ({ playerId: r.player_id, player: r.name, avatar: r.discord_verified ? avatarOf(r) : null });
  return reply(url, {
    boss,
    fastest: (fast.results || []).map((r) => ({ ...who(r), seconds: r.seconds, flawless: !!r.flawless })),
    most: (most.results || []).map((r) => ({ ...who(r), kills: r.kills })),
  }, 15);
}

// Search returns bounded pages of song keys first. FTS handles title/artist words; the separate detail query only
// calculates chart/score counts for the page, instead of aggregating the entire catalog on every request.
async function songPage(url, env, kind, max = 200) {
  const raw = String(url.searchParams.get('q') || '').slice(0, 120);
  const terms = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2).slice(0, 8);
  const limit = limitOf(url, 30, max);
  if (raw.trim() && !terms.length) return { rows: [], next: null };
  const before = clampInt(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
  const offset = clampInt(url.searchParams.get('offset') ?? 0, 0, 1000); // compatibility; new clients use before
  const searched = terms.length > 0;
  const sql = `SELECT g.rowid AS cursor, g.key, g.title, g.artist, g.duration
    FROM ${searched ? 'song_search JOIN songs g ON g.rowid = song_search.rowid' : 'songs g'}
    WHERE ${searched ? 'song_search MATCH ? AND ' : ''}g.rowid < ?
      AND EXISTS (SELECT 1 FROM ${kind} x WHERE x.song_key = g.key)
    ORDER BY g.rowid DESC LIMIT ? OFFSET ?`;
  const match = terms.map((t) => `"${t}"*`).join(' AND ');
  const { results } = await env.DB.prepare(sql).bind(...(searched ? [match] : []), before, limit + 1, offset).all();
  const hasMore = results.length > limit;
  const rows = results.slice(0, limit);
  return { rows, next: hasMore ? rows.at(-1).cursor : null };
}

// ---------------------------------------------------------------- chart library
/** Songs with charts; each result page is bounded even when the catalog has millions of songs. */
async function library(url, env) {
  const page = await songPage(url, env, 'charts');
  if (!page.rows.length) return reply(url, { rows: [], next: null }, 60);
  const keys = page.rows.map((r) => r.key);
  const { results } = await env.DB.prepare(`SELECT g.key,
      (SELECT COUNT(*) FROM charts c WHERE c.song_key = g.key) AS charts,
      (SELECT GROUP_CONCAT(rc.instrument) FROM ranked_charts rc WHERE rc.song_key = g.key) AS parts,
      (SELECT COUNT(DISTINCT r.player_id) FROM runs r WHERE r.song_key = g.key) AS players,
      (SELECT MAX(c.created) FROM charts c WHERE c.song_key = g.key) AS updated
    FROM songs g WHERE g.key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const details = new Map(results.map((r) => [r.key, r]));
  const order = Object.fromEntries(INSTRUMENTS.map((i, k) => [i, k]));
  return reply(url, {
    rows: page.rows.map((g) => { const r = details.get(g.key); return { key: g.key, title: g.title, artist: g.artist, duration: g.duration, charts: r.charts, players: r.players, updated: r.updated,
      parts: String(r.parts || '').split(',').filter(Boolean).sort((a, b) => order[a] - order[b]) }; }),
    next: page.next,
  }, 60);
}

// ---------------------------------------------------------------- weekly challenges + seasons
const weekOf = (t) => Math.floor((t - WEEK0) / WEEK);
const weekRange = (w) => [WEEK0 + w * WEEK, WEEK0 + (w + 1) * WEEK];
const seasonOf = (w) => Math.floor(w / SEASON_WEEKS) + 1;
/** Season points for a place on a weekly board: 100 for first, down to 10 for taking part. */
const pointsFor = (rank) => [0, 100, 80, 65, 55, 50][rank] ?? Math.max(10, 50 - (rank - 5) * 2);

/**
 * The challenge of a week: picked the first time anyone asks, among the ranked song parts most people play
 * (so most players can have the song), and then kept. null when nothing is ranked yet.
 */
async function challengeOf(env, week, create) {
  const row = await env.DB.prepare(`SELECT c.*, g.title, g.artist FROM challenges c JOIN songs g ON g.key = c.song_key WHERE c.week = ?`).bind(week).first();
  if (row || !create) return row || null;
  const { results } = await env.DB.prepare(`SELECT rc.song_key, rc.instrument, rc.chart_id,
      (SELECT COUNT(DISTINCT r.player_id) FROM runs r WHERE r.chart_id = rc.chart_id) AS players
    FROM ranked_charts rc JOIN songs g ON g.key = rc.song_key ORDER BY players DESC, rc.song_key LIMIT 24`).all();
  if (!results.length) return null;
  // not last week's song again when there's a choice
  const last = await env.DB.prepare('SELECT song_key FROM challenges WHERE week = ?').bind(week - 1).first();
  const pool = results.length > 1 ? results.filter((r) => r.song_key !== last?.song_key) : results;
  const hash = [...(await sha256(`stemstage-week-${week}`))].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pick = pool[hash % pool.length];
  await env.DB.prepare('INSERT INTO challenges (week, song_key, instrument, difficulty, chart_id, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(week) DO NOTHING')
    .bind(week, pick.song_key, pick.instrument, WEEK_DIFFS[((week % WEEK_DIFFS.length) + WEEK_DIFFS.length) % WEEK_DIFFS.length], pick.chart_id, Math.floor(Date.now() / 1000)).run();
  return challengeOf(env, week, false);
}

/** A challenge's board: each player's best run on its chart during its week. */
async function challengeBoard(env, c, limit = 100) {
  const [from, to] = weekRange(c.week);
  const { results } = await env.DB.prepare(`SELECT r.player_id, MAX(r.score) AS score, MIN(r.created) AS first, COUNT(*) AS runs, p.name, p.discord_id, p.discord_avatar
    FROM runs r JOIN players p ON p.id = r.player_id
    WHERE r.chart_id = ? AND r.song_key = ? AND r.instrument = ? AND r.difficulty = ? AND r.created >= ? AND r.created < ?
    GROUP BY r.player_id ORDER BY score DESC, first ASC LIMIT ?`).bind(c.chart_id, c.song_key, c.instrument, c.difficulty, from, to, limit).all();
  return results.map((r, i) => ({ rank: i + 1, player: r.name, playerId: r.player_id, avatar: avatarOf(r), score: r.score, runs: r.runs, points: pointsFor(i + 1) }));
}

const challengeInfo = (c) => ({
  week: c.week, season: seasonOf(c.week), starts: weekRange(c.week)[0], ends: weekRange(c.week)[1],
  song: { key: c.song_key, title: c.title, artist: c.artist }, instrument: c.instrument, difficulty: c.difficulty, chart: c.chart_id,
});

async function challenge(url, env) {
  const now = Math.floor(Date.now() / 1000);
  const week = weekOf(now);
  const c = await challengeOf(env, week, true);
  if (!c) return reply(url, { week, season: seasonOf(week), starts: weekRange(week)[0], ends: weekRange(week)[1], none: true }, 60);
  const rows = await challengeBoard(env, c, 200);
  const who = url.searchParams.get('player') || '';
  const me = rows.find((r) => r.playerId === who) || null;
  return reply(url, { ...challengeInfo(c), players: rows.length, rows: rows.slice(0, limitOf(url, 25, 100)), me }, 30);
}

async function season(url, env) {
  const now = Math.floor(Date.now() / 1000);
  const week = weekOf(now), s = seasonOf(week);
  const first = (s - 1) * SEASON_WEEKS;
  const weeks = [];
  const table = new Map();
  for (let w = first; w <= week; w++) {
    const c = await challengeOf(env, w, w === week);
    if (!c) continue;
    const rows = await challengeBoard(env, c, 500);
    weeks.push({ ...challengeInfo(c), players: rows.length, winner: rows[0] ? { player: rows[0].player, playerId: rows[0].playerId, score: rows[0].score } : null });
    for (const r of rows) {
      const t = table.get(r.playerId) || { player: r.player, playerId: r.playerId, avatar: r.avatar, points: 0, weeks: 0, wins: 0 };
      t.points += r.points; t.weeks++; if (r.rank === 1) t.wins++;
      table.set(r.playerId, t);
    }
  }
  const rows = [...table.values()].sort((a, b) => b.points - a.points || b.wins - a.wins).map((r, i) => ({ rank: i + 1, ...r }));
  const who = url.searchParams.get('player') || '';
  return reply(url, {
    season: s, starts: weekRange(first)[0], ends: weekRange(first + SEASON_WEEKS - 1)[1], week, weeks,
    rows: rows.slice(0, limitOf(url, 25, 100)), me: rows.find((r) => r.playerId === who) || null, players: rows.length,
  }, 60);
}

// ---------------------------------------------------------------- reads
/*
  GET /v1/leaderboard?song=<key>&instrument=&difficulty=&chart=
    chart=ranked (default): runs on the song part's ranked chart; before it has one, the unranked board
    chart=all: everyone's best run on any chart (not a fair comparison: charts differ)
    chart=<id>: runs on that chart
*/
async function leaderboard(url, env) {
  const key = url.searchParams.get('song') || '';
  const instrument = url.searchParams.get('instrument') || 'guitar', difficulty = url.searchParams.get('difficulty') || 'expert';
  if (!/^[0-9a-f]{16}$/.test(key)) return json({ error: 'song=<key> required (from /v1/songs, or computed from artist + title)' }, 400);
  if (!INSTRUMENTS.includes(instrument) || !DIFFICULTIES.includes(difficulty)) return json({ error: 'bad instrument/difficulty' }, 400);
  const song = await env.DB.prepare('SELECT key, title, artist, duration FROM songs WHERE key = ?').bind(key).first();
  const rankedId = await rankedOf(env, key, instrument);
  const want = url.searchParams.get('chart') || 'ranked';
  const limit = limitOf(url, 50, 200);
  const cols = 's.*, p.name, p.discord_id, p.discord_avatar, ? AS ranked_id';
  let mode, chart = null, results;
  if (want === 'all') {
    mode = 'all';
    ({ results } = await env.DB.prepare(`SELECT ${cols} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC) AS rn FROM scores
      WHERE song_key = ? AND instrument = ? AND difficulty = ?) s JOIN players p ON p.id = s.player_id WHERE s.rn = 1 ORDER BY s.score DESC, s.created ASC LIMIT ?`)
      .bind(rankedId, key, instrument, difficulty, limit).all());
  } else {
    chart = isChartId(want) ? want : rankedId || '';
    mode = chart ? (chart === rankedId ? 'ranked' : 'chart') : 'unranked';
    ({ results } = await env.DB.prepare(`SELECT ${cols} FROM scores s JOIN players p ON p.id = s.player_id
      WHERE s.song_key = ? AND s.instrument = ? AND s.difficulty = ? AND s.chart_id = ? ORDER BY s.score DESC, s.created ASC LIMIT ?`)
      .bind(rankedId, key, instrument, difficulty, chart, limit).all());
  }
  const { results: [{ others }] } = await env.DB.prepare('SELECT COUNT(*) AS others FROM charts WHERE song_key = ? AND instrument = ? AND id != ?').bind(key, instrument, rankedId || '').all();
  return reply(url, { song, instrument, difficulty, mode, chart: chart || null, rankedChart: rankedId, otherCharts: others, rows: results.map(publicRow) });
}

async function players(url, env) {
  const { results } = await env.DB.prepare(`SELECT p.id, p.name, p.discord_id, p.discord_avatar, SUM(s.score) AS total, SUM(s.stars) AS stars,
      SUM(s.fc) AS fcs, COUNT(*) AS charts, MAX(s.created) AS last
    FROM (${BEST_PER_BOARD}) s JOIN players p ON p.id = s.player_id GROUP BY p.id ORDER BY total DESC LIMIT ?`).bind(limitOf(url, 50, 200)).all();
  return reply(url, { rows: results.map((r) => ({ player: r.name, playerId: r.id, avatar: avatarOf(r), total: r.total, stars: r.stars, fcs: r.fcs, charts: r.charts, last: r.last })) });
}

async function songs(url, env) {
  const page = await songPage(url, env, 'scores', 500);
  if (!page.rows.length) return reply(url, { rows: [], next: null }, 60);
  const keys = page.rows.map((r) => r.key);
  const { results } = await env.DB.prepare(`SELECT g.key,
      (SELECT COUNT(DISTINCT s.player_id) FROM scores s WHERE s.song_key = g.key) AS entries,
      (SELECT MAX(s.score) FROM scores s WHERE s.song_key = g.key) AS best,
      (SELECT MAX(s.created) FROM scores s WHERE s.song_key = g.key) AS last,
      (SELECT COUNT(*) FROM ranked_charts r WHERE r.song_key = g.key) AS ranked
    FROM songs g WHERE g.key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const details = new Map(results.map((r) => [r.key, r]));
  return reply(url, { rows: page.rows.map((g) => ({ key: g.key, title: g.title, artist: g.artist, ...details.get(g.key) })), next: page.next }, 60);
}

async function recent(url, env) {
  const { results } = await env.DB.prepare(`SELECT s.*, p.name, p.discord_id, p.discord_avatar, g.title, g.artist, rc.chart_id AS ranked_id FROM scores s
    JOIN players p ON p.id = s.player_id JOIN songs g ON g.key = s.song_key
    LEFT JOIN ranked_charts rc ON rc.song_key = s.song_key AND rc.instrument = s.instrument ORDER BY s.created DESC LIMIT ?`).bind(limitOf(url, 20, 100)).all();
  return reply(url, { rows: results.map(publicRow) });
}

// ---------------------------------------------------------------- profiles
/*
  POST /v1/profile
  { player: { id, secret, name, discord? },
    profile: { color, level, rank, xp, progress, favorite,
               stats: { plays, songs, seconds, stars, fcs, bestStreak, accuracy, notes },
               instruments: { guitar: { plays, best, accuracy, fcs }, ... },
               achievements: [{ id, name, desc, icon, at }] } }     (at: unlock time in ms, or null = locked)
*/
async function saveProfile(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many requests from this address, try again later' }, 429);
  const b = await readJson(req);
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  const pr = b?.profile && typeof b.profile === 'object' ? b.profile : {};
  const num = (v, max) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, +v)) : 0);
  const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
  const st = pr.stats || {};
  const clean = {
    color: /^#[0-9a-f]{6}$/i.test(pr.color || '') ? pr.color : '#ff2d7a',
    level: Math.round(num(pr.level, 999)), rank: str(pr.rank, 40), xp: Math.round(num(pr.xp, 1e9)), progress: num(pr.progress, 1),
    favorite: INSTRUMENTS.includes(pr.favorite) ? pr.favorite : null,
    stats: {
      plays: Math.round(num(st.plays, 1e7)), songs: Math.round(num(st.songs, 1e6)), seconds: Math.round(num(st.seconds, 1e9)),
      stars: Math.round(num(st.stars, 1e7)), fcs: Math.round(num(st.fcs, 1e7)), bestStreak: Math.round(num(st.bestStreak, 1e6)),
      accuracy: num(st.accuracy, 1), notes: Math.round(num(st.notes, 1e10)),
    },
    // online versus / battle record
    ...(pr.versus ? { versus: { wins: Math.round(num(pr.versus.wins, 1e6)), losses: Math.round(num(pr.versus.losses, 1e6)), draws: Math.round(num(pr.versus.draws, 1e6)), best: Math.round(num(pr.versus.best, 1e6)) } } : {}),
    instruments: Object.fromEntries(INSTRUMENTS.filter((i) => pr.instruments?.[i]).map((i) => {
      const x = pr.instruments[i];
      return [i, { plays: Math.round(num(x.plays, 1e7)), best: Math.round(num(x.best, MAX_SCORE)), accuracy: num(x.accuracy, 1), fcs: Math.round(num(x.fcs, 1e7)) }];
    })),
    achievements: (Array.isArray(pr.achievements) ? pr.achievements : []).slice(0, 100).map((a) => ({
      id: str(a.id, 40), name: str(a.name, 60), desc: str(a.desc, 140), icon: /^[a-z0-9-]{1,40}$/.test(a.icon || '') ? a.icon : 'award',
      at: Number.isFinite(+a.at) && +a.at > 0 ? Math.round(+a.at) : null,
    })),
  };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    upsertPlayer(env, pl, now),
    env.DB.prepare('UPDATE players SET profile = ?, profile_updated = ? WHERE id = ?').bind(JSON.stringify(clean), now, pl.id),
  ]);
  return json({ ok: true, url: `https://stemstage.varconstint.com/player/?id=${encodeURIComponent(pl.id)}` });
}

async function player(url, env) {
  const id = url.searchParams.get('id') || '';
  if (!/^[\w-]{8,64}$/.test(id)) return json({ error: 'id required' }, 400);
  const p = await env.DB.prepare('SELECT id, name, discord_id, discord_avatar, profile, profile_updated, created FROM players WHERE id = ?').bind(id).first();
  if (!p) return json({ error: 'no such player' }, 404);
  const world = await env.DB.prepare(`SELECT COALESCE(SUM(score), 0) AS total, COUNT(*) AS charts, COALESCE(SUM(stars), 0) AS stars, COALESCE(SUM(fc), 0) AS fcs
    FROM (${BEST_PER_BOARD}) WHERE player_id = ?`).bind(id).first();
  const { results: [{ rank }] } = await env.DB.prepare(`SELECT COUNT(*) + 1 AS rank FROM (SELECT player_id, SUM(score) AS t FROM (${BEST_PER_BOARD}) GROUP BY player_id) WHERE t > ?`).bind(world.total).all();
  // records: #1 on a board people compete on (the ranked chart, or the unranked board of a song without one)
  const { results: [{ records }] } = await env.DB.prepare(`SELECT COUNT(*) AS records FROM scores s LEFT JOIN ranked_charts rc ON rc.song_key = s.song_key AND rc.instrument = s.instrument
    WHERE s.player_id = ? AND s.chart_id = COALESCE(rc.chart_id, '') AND s.score = (
      SELECT MAX(score) FROM scores t WHERE t.song_key = s.song_key AND t.instrument = s.instrument AND t.difficulty = s.difficulty AND t.chart_id = s.chart_id)`).bind(id).all();
  const { results: best } = await env.DB.prepare(`SELECT s.*, g.title, g.artist, ? AS name, rc.chart_id AS ranked_id FROM scores s JOIN songs g ON g.key = s.song_key
    LEFT JOIN ranked_charts rc ON rc.song_key = s.song_key AND rc.instrument = s.instrument WHERE s.player_id = ? ORDER BY s.score DESC LIMIT 12`).bind(p.name, id).all();
  let profile = null;
  try { profile = p.profile ? JSON.parse(p.profile) : null; } catch { /* ignore */ }
  return reply(url, {
    id: p.id, name: p.name, avatar: avatarOf(p), since: p.created, updated: p.profile_updated, profile,
    world: { rank: world.charts ? rank : null, total: world.total, charts: world.charts, stars: world.stars, fcs: world.fcs, records },
    best: best.map((r) => publicRow({ ...r, player_id: id })),
  }, 30);
}

// ---------------------------------------------------------------- Discord link
/** The Discord user behind an OAuth token (scope identify), asked of Discord itself. */
async function discordUser(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]{10,200}$/.test(token)) throw new HttpError(400, 'bad Discord token');
  const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'STEMSTAGE' } });
  if (r.status === 401) throw new HttpError(401, 'Discord login expired');
  if (!r.ok) throw new HttpError(502, `Discord ${r.status}`);
  const u = await r.json();
  if (!/^\d{15,21}$/.test(u.id || '')) throw new HttpError(502, 'Discord sent no user');
  return u;
}

/*
  POST /v1/link  { player: { id, secret, name }, token: "<Discord OAuth token, scope identify>" }   link / refresh
                 { player: { id, secret, name }, unlink: true }                                    unlink
  The game calls it right after "Log in with Discord"; the token is checked with Discord and not kept.
*/
async function link(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env, ip, now)) return json({ error: 'too many requests from this address, try again later' }, 429);
  const b = await readJson(req, 8_000);
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  if (b.unlink === true) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
      upsertPlayer(env, pl, now),
      env.DB.prepare('UPDATE players SET discord_id = NULL, discord_avatar = NULL, discord_verified = 0 WHERE id = ?').bind(pl.id),
    ]);
    return json({ ok: true, discord: null });
  }
  const u = await discordUser(b.token);
  const avatar = /^(a_)?[0-9a-f]{32}$/.test(u.avatar || '') ? u.avatar : null;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    upsertPlayer(env, pl, now),
    env.DB.prepare('UPDATE players SET discord_id = ?, discord_avatar = ?, discord_verified = 1 WHERE id = ?').bind(u.id, avatar, pl.id),
  ]);
  return json({ ok: true, discord: { id: u.id, avatar: avatarOf({ discord_id: u.id, discord_avatar: avatar }) } });
}

// ---------------------------------------------------------------- website login
/** Who is logged in on the website: the token is checked with Discord itself, so it can't be faked. */
async function me(req, env) {
  const token = /^Bearer ([A-Za-z0-9._-]{10,200})$/.exec(req.headers.get('Authorization') || '')?.[1];
  if (!token) return json({ error: 'log in with Discord first' }, 401);
  const u = await discordUser(token);
  // STEMSTAGE profiles whose owner linked this Discord account in the game
  const { results } = await env.DB.prepare(`SELECT p.id, p.name, p.discord_avatar, COALESCE(SUM(s.score), 0) AS total, COUNT(s.song_key) AS charts
    FROM players p LEFT JOIN (${BEST_PER_BOARD}) s ON s.player_id = p.id WHERE p.discord_id = ? GROUP BY p.id ORDER BY total DESC`).bind(u.id).all();
  return json({
    user: { id: u.id, username: u.username, globalName: u.global_name || null, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null },
    players: results.map((x) => ({ playerId: x.id, name: x.name, total: x.total, charts: x.charts })),
  });
}

/** The heavy summary reads (whole-table totals, the season, a chart that never changes) come from Cloudflare's edge
 *  cache while fresh, so a flood of them doesn't reach the database. Boards, chart lists, rooms and the challenge
 *  stay live: a player looking for the run they just finished sees it. */
const EDGE_CACHED = new Set(['/v1/players', '/v1/songs', '/v1/recent', '/v1/library', '/v1/season', '/v1/chart', '/v1/song-key', '/v1/health', '']);
async function cached(req, ctx, make) {
  const cache = globalThis.caches?.default;
  if (!cache) return make();
  const key = new Request(req.url, { method: 'GET' });
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200 && /public, max-age=[1-9]/.test(res.headers.get('Cache-Control') || '')) ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } });
    }
    try {
      const path = url.pathname.replace(/\/+$/, '');
      if (req.method === 'GET' && EDGE_CACHED.has(path)) return await cached(req, ctx, () => route(req, url, path, env, ctx));
      return await route(req, url, path, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('[stemstage-api]', req.method, url.pathname, e?.stack || e);
      return json({ error: 'server error' }, 500);
    }
  },
};

async function route(req, url, path, env, ctx) {
  if (req.method === 'POST' && path === '/v1/scores') return await submit(req, env, ctx);
  if (req.method === 'POST' && path === '/v1/profile') return await saveProfile(req, env);
  if (req.method === 'POST' && path === '/v1/charts') return await uploadChart(req, env);
  if (req.method === 'POST' && path === '/v1/charts/vote') return await vote(req, env);
  if (req.method === 'POST' && path === '/v1/rooms') return await announceRoom(req, env);
  if (req.method === 'POST' && path === '/v1/rooms/close') return await closeRoomListing(req, env);
  if (req.method === 'POST' && path === '/v1/match') return await match(req, env);
  if (req.method === 'POST' && path === '/v1/match/cancel') return await matchCancel(req, env);
  if (req.method === 'POST' && path === '/v1/bosses') return await bossKill(req, env);
  if (req.method === 'POST' && path === '/v1/link') return await link(req, env);
  if (req.method === 'GET') {
    if (path === '/v1/leaderboard') return await leaderboard(url, env);
    if (path === '/v1/players') return await players(url, env);
    if (path === '/v1/songs') return await songs(url, env);
    if (path === '/v1/recent') return await recent(url, env);
    if (path === '/v1/player') return await player(url, env);
    if (path === '/v1/me') return await me(req, env);
    if (path === '/v1/charts') return await listCharts(url, env);
    if (path === '/v1/chart') return await getChart(url, env);
    if (path === '/v1/rooms') return await rooms(url, env);
    if (path === '/v1/lobby') return await lobby(url, env);
    if (path === '/v1/bosses') return await bossBoard(url, env);
    if (path === '/v1/challenge') return await challenge(url, env);
    if (path === '/v1/library') return await library(url, env);
    if (path === '/v1/season') return await season(url, env);
    if (path === '/v1/song-key') return reply(url, { key: await songKey(url.searchParams.get('artist'), url.searchParams.get('title')) }, 3600);
    if (path === '/v1/health' || path === '') return reply(url, { ok: true, service: 'stemstage-leaderboard', version: 2 }, 5);
  }
  return json({ error: 'not found' }, 404);
}
