-- STEMSTAGE leaderboard (Cloudflare D1). Apply with: npx wrangler d1 execute stemstage --remote --file cloud/schema.sql
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,            -- made by the game, one per profile
  secret_hash TEXT NOT NULL,      -- sha256 of the secret only that game knows
  name TEXT NOT NULL,
  discord_id TEXT, discord_avatar TEXT,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS songs (
  key TEXT PRIMARY KEY,           -- sha256(normalised artist | title), first 16 hex
  title TEXT NOT NULL, artist TEXT, duration INTEGER,
  created INTEGER NOT NULL
);
-- each player's best run per chart
CREATE TABLE IF NOT EXISTS scores (
  player_id TEXT NOT NULL, song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL,
  score INTEGER NOT NULL, stars INTEGER, accuracy REAL, fc INTEGER, max_streak INTEGER, notes INTEGER, version TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (player_id, song_key, instrument, difficulty)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (song_key, instrument, difficulty, score DESC);
CREATE INDEX IF NOT EXISTS scores_recent ON scores (created DESC);
-- every submitted run (history / play counts)
CREATE TABLE IF NOT EXISTS runs (
  player_id TEXT NOT NULL, song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL,
  score INTEGER NOT NULL, created INTEGER NOT NULL
);
-- rate limiting (rows older than an hour are pruned)
CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hits_ip ON hits (ip, ts);
