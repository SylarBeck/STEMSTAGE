// STEMSTAGE online leaderboard: a Cloudflare Worker on D1 (SQLite), at https://api.stemstage.varconstint.com
//
//   POST /v1/scores                 the game submits a finished run (see submit() for the body)
//   GET  /v1/leaderboard?song=<key>&instrument=&difficulty=&limit=   best runs on one chart
//   GET  /v1/players?limit=         overall: every player's best scores added up
//   GET  /v1/songs?limit=&q=        songs with scores (key, title, artist, runs)
//   GET  /v1/recent?limit=          newest runs
//   GET  /v1/health
//
// Every GET answers JSON with CORS, or JSONP with ?callback=<function name>. Songs are matched across players by
// artist + title (normalised), so everyone who imported the same song shares its boards.
//
// Players are identified by an id the game makes per profile plus a secret only that game knows: the first run
// registers sha256(secret), later runs must present the same secret, so nobody can post under someone else's
// name. Scores can't be verified (the game runs on the player's PC), so the API rejects impossible values and
// rate-limits each address; moderators can delete rows with wrangler (see cloud/README.md).
//
// Optional callback: set the secret DISCORD_WEBHOOK (a Discord channel webhook URL) to announce every new #1.

const INSTRUMENTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
const MAX_SCORE = 20_000_000;
const RATE = { window: 600, max: 40 }; // runs per address per 10 minutes

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra },
});

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
  ...(r.title !== undefined ? { song: { key: r.song_key, title: r.title, artist: r.artist } } : {}),
});

// ---------------------------------------------------------------- POST /v1/scores
/*
  {
    player: { id: "<uuid>", secret: "<random, kept by the game>", name: "Varconstint", discord?: { id, avatar } },
    song: { title, artist, duration },
    instrument: "guitar", difficulty: "expert",
    score: 123456, stars: 5, accuracy: 0.97, fc: false, maxStreak: 321, notes: 800, version: "1.5.0"
  }
*/
async function submit(req, env, ctx) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  const { results: [{ n }] } = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE ip = ? AND ts > ?').bind(ip, now - RATE.window).all();
  if (n >= RATE.max) return json({ error: 'too many runs from this address, try again later' }, 429);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'body must be JSON' }, 400); }
  const p = b?.player || {};
  const name = cleanName(p.name);
  if (!/^[\w-]{8,64}$/.test(p.id || '') || typeof p.secret !== 'string' || p.secret.length < 16 || p.secret.length > 200) return json({ error: 'bad player id/secret' }, 400);
  if (!name) return json({ error: 'player name required' }, 400);
  if (!INSTRUMENTS.includes(b.instrument) || !DIFFICULTIES.includes(b.difficulty)) return json({ error: 'bad instrument/difficulty' }, 400);
  const title = String(b.song?.title || '').trim().slice(0, 120), artist = String(b.song?.artist || '').trim().slice(0, 120);
  if (!norm(title)) return json({ error: 'song title required' }, 400);
  const score = clampInt(b.score, 0, MAX_SCORE), stars = clampInt(b.stars, 0, 6), notes = clampInt(b.notes, 1, 100000), streak = clampInt(b.maxStreak, 0, 100000);
  const accuracy = Number.isFinite(+b.accuracy) ? Math.max(0, Math.min(1, +b.accuracy)) : null;
  if (score === null || stars === null || accuracy === null || notes === null || streak === null) return json({ error: 'bad score fields' }, 400);
  if (streak > notes || score > notes * 2000) return json({ error: 'score out of range for this chart' }, 400);
  const fc = b.fc ? 1 : 0;
  const discordId = /^\d{15,21}$/.test(p.discord?.id || '') ? p.discord.id : null;
  const discordAvatar = discordId && /^(a_)?[0-9a-f]{32}$/.test(p.discord?.avatar || '') ? p.discord.avatar : null;

  // the player: first run registers the secret; afterwards it has to match
  const secretHash = await sha256(p.secret);
  const known = await env.DB.prepare('SELECT secret_hash FROM players WHERE id = ?').bind(p.id).first();
  if (known && known.secret_hash !== secretHash) return json({ error: 'this player id belongs to someone else' }, 403);
  const key = await songKey(artist, title);
  const prevTop = await env.DB.prepare('SELECT s.score, pl.name FROM scores s JOIN players pl ON pl.id = s.player_id WHERE s.song_key = ? AND s.instrument = ? AND s.difficulty = ? ORDER BY s.score DESC LIMIT 1')
    .bind(key, b.instrument, b.difficulty).first();
  const mine = await env.DB.prepare('SELECT score FROM scores WHERE player_id = ? AND song_key = ? AND instrument = ? AND difficulty = ?').bind(p.id, key, b.instrument, b.difficulty).first();

  const stmts = [
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    env.DB.prepare(`INSERT INTO players (id, secret_hash, name, discord_id, discord_avatar, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, discord_id = excluded.discord_id, discord_avatar = excluded.discord_avatar, updated = excluded.updated`)
      .bind(p.id, secretHash, name, discordId, discordAvatar, now, now),
    env.DB.prepare(`INSERT INTO songs (key, title, artist, duration, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`)
      .bind(key, title, artist, clampInt(b.song?.duration, 0, 7200), now),
    env.DB.prepare('INSERT INTO runs (player_id, song_key, instrument, difficulty, score, created) VALUES (?, ?, ?, ?, ?, ?)').bind(p.id, key, b.instrument, b.difficulty, score, now),
  ];
  const best = !mine || score > mine.score;
  if (best) {
    stmts.push(env.DB.prepare(`INSERT INTO scores (player_id, song_key, instrument, difficulty, score, stars, accuracy, fc, max_streak, notes, version, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id, song_key, instrument, difficulty) DO UPDATE SET score = excluded.score, stars = excluded.stars, accuracy = excluded.accuracy,
        fc = excluded.fc, max_streak = excluded.max_streak, notes = excluded.notes, version = excluded.version, created = excluded.created`)
      .bind(p.id, key, b.instrument, b.difficulty, score, stars, accuracy, fc, streak, notes, String(b.version || '').slice(0, 16), now));
  }
  // keep the rate-limit table small
  stmts.push(env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(now - 3600));
  await env.DB.batch(stmts);

  const { results: [{ rank }] } = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE song_key = ? AND instrument = ? AND difficulty = ? AND score > ?')
    .bind(key, b.instrument, b.difficulty, best ? score : mine.score).all();
  const newTop = best && (!prevTop || score > prevTop.score);
  if (newTop && env.DISCORD_WEBHOOK) ctx.waitUntil(announce(env.DISCORD_WEBHOOK, { name, title, artist, instrument: b.instrument, difficulty: b.difficulty, score, stars, fc, prev: prevTop, avatar: avatarOf({ discord_id: discordId, discord_avatar: discordAvatar }) }));
  return json({ ok: true, songKey: key, personalBest: best, rank, newTop });
}

/** The callback: a new #1 posted to a Discord channel webhook. */
async function announce(webhook, r) {
  const board = `https://stemstage.varconstint.com/leaderboard/`;
  await fetch(webhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'STEMSTAGE', allowed_mentions: { parse: [] },
      embeds: [{
        title: `🏆 New #1: ${r.title}${r.artist ? ` — ${r.artist}` : ''}`, url: board, color: 0xff2d7a,
        description: `**${r.name}** set **${r.score.toLocaleString('en-US')}** on ${r.instrument} · ${r.difficulty}${r.fc ? ' · full combo' : ''} (${'★'.repeat(Math.min(5, r.stars))})` +
          (r.prev ? `\nBeating ${r.prev.name}'s ${r.prev.score.toLocaleString('en-US')}` : '\nThe first score on this chart'),
        ...(r.avatar ? { thumbnail: { url: r.avatar } } : {}),
      }],
    }),
  }).catch(() => {});
}

// ---------------------------------------------------------------- reads
async function leaderboard(url, env) {
  const key = url.searchParams.get('song') || '';
  const instrument = url.searchParams.get('instrument') || 'guitar', difficulty = url.searchParams.get('difficulty') || 'expert';
  if (!/^[0-9a-f]{16}$/.test(key)) return json({ error: 'song=<key> required (from /v1/songs, or computed from artist + title)' }, 400);
  if (!INSTRUMENTS.includes(instrument) || !DIFFICULTIES.includes(difficulty)) return json({ error: 'bad instrument/difficulty' }, 400);
  const song = await env.DB.prepare('SELECT key, title, artist, duration FROM songs WHERE key = ?').bind(key).first();
  const { results } = await env.DB.prepare(`SELECT s.*, p.name, p.discord_id, p.discord_avatar FROM scores s JOIN players p ON p.id = s.player_id
    WHERE s.song_key = ? AND s.instrument = ? AND s.difficulty = ? ORDER BY s.score DESC, s.created ASC LIMIT ?`).bind(key, instrument, difficulty, limitOf(url, 50, 200)).all();
  return reply(url, { song, instrument, difficulty, rows: results.map(publicRow) });
}

async function players(url, env) {
  const { results } = await env.DB.prepare(`SELECT p.id, p.name, p.discord_id, p.discord_avatar, SUM(s.score) AS total, SUM(s.stars) AS stars,
      SUM(s.fc) AS fcs, COUNT(*) AS charts, MAX(s.created) AS last
    FROM scores s JOIN players p ON p.id = s.player_id GROUP BY p.id ORDER BY total DESC LIMIT ?`).bind(limitOf(url, 50, 200)).all();
  return reply(url, { rows: results.map((r) => ({ player: r.name, playerId: r.id, avatar: avatarOf(r), total: r.total, stars: r.stars, fcs: r.fcs, charts: r.charts, last: r.last })) });
}

async function songs(url, env) {
  const q = norm(url.searchParams.get('q') || '');
  const { results } = await env.DB.prepare(`SELECT g.key, g.title, g.artist, COUNT(s.player_id) AS entries, MAX(s.score) AS best, MAX(s.created) AS last
    FROM songs g JOIN scores s ON s.song_key = g.key ${q ? 'WHERE lower(g.title || \' \' || g.artist) LIKE ?' : ''}
    GROUP BY g.key ORDER BY entries DESC, last DESC LIMIT ?`).bind(...(q ? [`%${q}%`] : []), limitOf(url, 100, 500)).all();
  return reply(url, { rows: results }, 60);
}

async function recent(url, env) {
  const { results } = await env.DB.prepare(`SELECT s.*, p.name, p.discord_id, p.discord_avatar, g.title, g.artist FROM scores s
    JOIN players p ON p.id = s.player_id JOIN songs g ON g.key = s.song_key ORDER BY s.created DESC LIMIT ?`).bind(limitOf(url, 20, 100)).all();
  return reply(url, { rows: results.map(publicRow) });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    try {
      const path = url.pathname.replace(/\/+$/, '');
      if (req.method === 'POST' && path === '/v1/scores') return await submit(req, env, ctx);
      if (req.method === 'GET') {
        if (path === '/v1/leaderboard') return await leaderboard(url, env);
        if (path === '/v1/players') return await players(url, env);
        if (path === '/v1/songs') return await songs(url, env);
        if (path === '/v1/recent') return await recent(url, env);
        if (path === '/v1/song-key') return reply(url, { key: await songKey(url.searchParams.get('artist'), url.searchParams.get('title')) }, 3600);
        if (path === '/v1/health' || path === '') return reply(url, { ok: true, service: 'stemstage-leaderboard', version: 1 }, 5);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error', detail: String(e?.message || e) }, 500);
    }
  },
};
