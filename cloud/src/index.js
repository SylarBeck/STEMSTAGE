// STEMSTAGE online leaderboard: a Cloudflare Worker on D1 (SQLite), at https://api.stemstage.varconstint.com
//
//   POST /v1/scores                 the game submits a finished run (see submit() for the body)
//   GET  /v1/leaderboard?song=<key>&instrument=&difficulty=&limit=   best runs on one chart
//   GET  /v1/players?limit=         overall: every player's best scores added up
//   GET  /v1/songs?limit=&q=        songs with scores (key, title, artist, runs)
//   GET  /v1/recent?limit=          newest runs
//   POST /v1/profile                the game shares a profile card (level, achievements, stats)
//   GET  /v1/player?id=             a shared profile + its world stats (the website's /player/ page)
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

// ---------------------------------------------------------------- players
/** Check a submitted player ({ id, secret, name, discord }): → { ok, id, name, secretHash, discordId, discordAvatar } or { error, status }. */
async function checkPlayer(env, p = {}) {
  const name = cleanName(p.name);
  if (!/^[\w-]{8,64}$/.test(p.id || '') || typeof p.secret !== 'string' || p.secret.length < 16 || p.secret.length > 200) return { error: 'bad player id/secret', status: 400 };
  if (!name) return { error: 'player name required', status: 400 };
  const secretHash = await sha256(p.secret);
  // the first request registers the secret; afterwards it has to match
  const known = await env.DB.prepare('SELECT secret_hash FROM players WHERE id = ?').bind(p.id).first();
  if (known && known.secret_hash !== secretHash) return { error: 'this player id belongs to someone else', status: 403 };
  const discordId = /^\d{15,21}$/.test(p.discord?.id || '') ? p.discord.id : null;
  const discordAvatar = discordId && /^(a_)?[0-9a-f]{32}$/.test(p.discord?.avatar || '') ? p.discord.avatar : null;
  return { ok: true, id: p.id, name, secretHash, discordId, discordAvatar };
}
const upsertPlayer = (env, pl, now) => env.DB.prepare(`INSERT INTO players (id, secret_hash, name, discord_id, discord_avatar, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, discord_id = excluded.discord_id, discord_avatar = excluded.discord_avatar, updated = excluded.updated`)
  .bind(pl.id, pl.secretHash, pl.name, pl.discordId, pl.discordAvatar, now, now);

async function rateLimited(env, ip, now) {
  const { results: [{ n }] } = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE ip = ? AND ts > ?').bind(ip, now - RATE.window).all();
  return n >= RATE.max;
}

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
  if (await rateLimited(env, ip, now)) return json({ error: 'too many runs from this address, try again later' }, 429);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'body must be JSON' }, 400); }
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
  const prevTop = await env.DB.prepare('SELECT s.score, pl.name FROM scores s JOIN players pl ON pl.id = s.player_id WHERE s.song_key = ? AND s.instrument = ? AND s.difficulty = ? ORDER BY s.score DESC LIMIT 1')
    .bind(key, b.instrument, b.difficulty).first();
  const mine = await env.DB.prepare('SELECT score FROM scores WHERE player_id = ? AND song_key = ? AND instrument = ? AND difficulty = ?').bind(p.id, key, b.instrument, b.difficulty).first();

  const stmts = [
    env.DB.prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)').bind(ip, now),
    upsertPlayer(env, pl, now),
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
  let b;
  try { b = await req.json(); } catch { return json({ error: 'body must be JSON' }, 400); }
  const pl = await checkPlayer(env, b?.player);
  if (pl.error) return json({ error: pl.error }, pl.status);
  const pr = b?.profile || {};
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
  const world = await env.DB.prepare('SELECT COALESCE(SUM(score), 0) AS total, COUNT(*) AS charts, COALESCE(SUM(stars), 0) AS stars, COALESCE(SUM(fc), 0) AS fcs FROM scores WHERE player_id = ?').bind(id).first();
  const { results: [{ rank }] } = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM (SELECT player_id, SUM(score) AS t FROM scores GROUP BY player_id) WHERE t > ?').bind(world.total).all();
  const { results: [{ records }] } = await env.DB.prepare(`SELECT COUNT(*) AS records FROM scores s WHERE s.player_id = ? AND s.score = (
      SELECT MAX(score) FROM scores t WHERE t.song_key = s.song_key AND t.instrument = s.instrument AND t.difficulty = s.difficulty)`).bind(id).all();
  const { results: best } = await env.DB.prepare(`SELECT s.*, g.title, g.artist, ? AS name FROM scores s JOIN songs g ON g.key = s.song_key WHERE s.player_id = ? ORDER BY s.score DESC LIMIT 12`).bind(p.name, id).all();
  let profile = null;
  try { profile = p.profile ? JSON.parse(p.profile) : null; } catch { /* ignore */ }
  return reply(url, {
    id: p.id, name: p.name, avatar: avatarOf(p), since: p.created, updated: p.profile_updated, profile,
    world: { rank: world.charts ? rank : null, total: world.total, charts: world.charts, stars: world.stars, fcs: world.fcs, records },
    best: best.map((r) => publicRow({ ...r, player_id: id })),
  }, 30);
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
      if (req.method === 'POST' && path === '/v1/profile') return await saveProfile(req, env);
      if (req.method === 'GET') {
        if (path === '/v1/leaderboard') return await leaderboard(url, env);
        if (path === '/v1/players') return await players(url, env);
        if (path === '/v1/songs') return await songs(url, env);
        if (path === '/v1/recent') return await recent(url, env);
        if (path === '/v1/player') return await player(url, env);
        if (path === '/v1/song-key') return reply(url, { key: await songKey(url.searchParams.get('artist'), url.searchParams.get('title')) }, 3600);
        if (path === '/v1/health' || path === '') return reply(url, { ok: true, service: 'stemstage-leaderboard', version: 1 }, 5);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error', detail: String(e?.message || e) }, 500);
    }
  },
};
