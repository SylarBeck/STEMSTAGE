-- Weekly challenges (1.8.0). npx wrangler d1 execute stemstage --remote --file migrations/0005_challenges.sql
-- The song part of each week, picked the first time someone asks for that week and kept (so the pick can't
-- change mid-week when charts or play counts do). Scores come from runs on its chart during the week.
CREATE TABLE IF NOT EXISTS challenges (
  week INTEGER PRIMARY KEY,       -- weeks since Monday 28 September 2026 (UTC)
  song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL, chart_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_week ON runs (chart_id, difficulty, created);
