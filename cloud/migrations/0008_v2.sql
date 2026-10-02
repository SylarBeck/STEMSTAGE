-- STEMSTAGE 2.0.0: matchmaking + boss hall of fame. npx wrangler d1 execute stemstage --remote --file migrations/0008_v2.sql
-- Run it once: a second run stops at its first line (duplicate column name) without changing anything.
-- public rooms: where they are, how good their players are, their stage and whether gear counts; mm = a matchmaking room
ALTER TABLE rooms ADD COLUMN continent TEXT;
ALTER TABLE rooms ADD COLUMN rating INTEGER;
ALTER TABLE rooms ADD COLUMN stage TEXT;
ALTER TABLE rooms ADD COLUMN gear INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN mm INTEGER NOT NULL DEFAULT 0;
-- players looking for a match right now (a ticket is refreshed every few seconds while the game searches)
CREATE TABLE IF NOT EXISTS mm_tickets (
  ticket TEXT PRIMARY KEY, mode TEXT, rating INTEGER, continent TEXT, version TEXT, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mm_tickets_updated ON mm_tickets (updated);
-- every world boss beaten by a signed-in profile
CREATE TABLE IF NOT EXISTS boss_kills (
  player_id TEXT NOT NULL, boss TEXT NOT NULL, seconds REAL NOT NULL, damage INTEGER, flawless INTEGER NOT NULL DEFAULT 0,
  song TEXT, instrument TEXT, difficulty TEXT, mode TEXT, version TEXT, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boss_kills_boss ON boss_kills (boss, seconds);
CREATE INDEX IF NOT EXISTS boss_kills_player ON boss_kills (player_id, boss);
