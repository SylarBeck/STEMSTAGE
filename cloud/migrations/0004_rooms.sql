-- Public rooms (1.7.0). npx wrangler d1 execute stemstage --remote --file migrations/0004_rooms.sql
-- Online rooms a host chose to list: the game re-announces its room every 30 s, and a room that stops
-- announcing drops off the list after 90 s (rows are pruned after 10 minutes).
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,          -- the room's invite code (the words of its Cloudflare tunnel)
  key_hash TEXT NOT NULL,         -- sha256 of the key only the hosting game knows (to update or close it)
  name TEXT NOT NULL, host TEXT, mode TEXT, song TEXT, artist TEXT,
  players INTEGER NOT NULL, max INTEGER NOT NULL, playing INTEGER NOT NULL DEFAULT 0, version TEXT,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_updated ON rooms (updated);
