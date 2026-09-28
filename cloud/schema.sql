-- STEMSTAGE leaderboard (Cloudflare D1). A new database: npx wrangler d1 execute stemstage --remote --file cloud/schema.sql
-- (an existing one is upgraded with the files in migrations/, in order)
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,            -- made by the game, one per profile
  secret_hash TEXT NOT NULL,      -- sha256 of the secret only that game knows
  name TEXT NOT NULL,
  discord_id TEXT, discord_avatar TEXT,
  profile TEXT, profile_updated INTEGER, -- the shared profile card (JSON)
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS songs (
  key TEXT PRIMARY KEY,           -- sha256(normalised artist | title), first 16 hex
  title TEXT NOT NULL, artist TEXT, duration INTEGER,
  created INTEGER NOT NULL
);
-- charts players uploaded: the notes (no audio) + a fingerprint of the uploader's recording for lining it up
CREATE TABLE IF NOT EXISTS charts (
  id TEXT PRIMARY KEY,            -- sha256 of the canonical chart, first 16 hex
  song_key TEXT NOT NULL, instrument TEXT NOT NULL,
  data TEXT NOT NULL,             -- canonical chart JSON
  fp TEXT NOT NULL,               -- fingerprint JSON (onset + loudness curves, 50 fps, base64)
  duration REAL, notes INTEGER, edited INTEGER, method TEXT, version TEXT,
  player_id TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS charts_song ON charts (song_key, instrument);
-- the chart each song part is ranked on (the first upload; players can vote in a replacement)
CREATE TABLE IF NOT EXISTS ranked_charts (
  song_key TEXT NOT NULL, instrument TEXT NOT NULL, chart_id TEXT NOT NULL, since INTEGER NOT NULL,
  PRIMARY KEY (song_key, instrument)
);
-- one vote per player per song part, for a chart they've played
CREATE TABLE IF NOT EXISTS chart_votes (
  song_key TEXT NOT NULL, instrument TEXT NOT NULL, player_id TEXT NOT NULL, chart_id TEXT NOT NULL, created INTEGER NOT NULL,
  PRIMARY KEY (song_key, instrument, player_id)
);
-- each player's best run per chart ('' = played before ranked charts existed, or on an unknown chart)
CREATE TABLE IF NOT EXISTS scores (
  player_id TEXT NOT NULL, song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL, chart_id TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL, stars INTEGER, accuracy REAL, fc INTEGER, max_streak INTEGER, notes INTEGER, version TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (player_id, song_key, instrument, difficulty, chart_id)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (song_key, instrument, difficulty, chart_id, score DESC);
CREATE INDEX IF NOT EXISTS scores_recent ON scores (created DESC);
-- every submitted run (history / play counts; a vote needs a run on that chart)
CREATE TABLE IF NOT EXISTS runs (
  player_id TEXT NOT NULL, song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL,
  score INTEGER NOT NULL, created INTEGER NOT NULL, chart_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS runs_chart ON runs (chart_id, player_id);
-- public online rooms: re-announced by the host every 30 s, listed while fresh (90 s), pruned after 10 minutes
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,          -- the room's invite code (the words of its Cloudflare tunnel)
  key_hash TEXT NOT NULL,         -- sha256 of the key only the hosting game knows (to update or close it)
  name TEXT NOT NULL, host TEXT, mode TEXT, song TEXT, artist TEXT,
  players INTEGER NOT NULL, max INTEGER NOT NULL, playing INTEGER NOT NULL DEFAULT 0, version TEXT,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_updated ON rooms (updated);
-- weekly challenges: the song part of each week, picked once (see migrations/0005_challenges.sql)
CREATE TABLE IF NOT EXISTS challenges (
  week INTEGER PRIMARY KEY,       -- weeks since Monday 28 September 2026 (UTC)
  song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL, chart_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_week ON runs (chart_id, difficulty, created);
-- rate limiting (rows older than an hour are pruned)
CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hits_ip ON hits (ip, ts);
