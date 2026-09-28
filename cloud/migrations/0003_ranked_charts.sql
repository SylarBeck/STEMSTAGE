-- Ranked charts (1.6.0). npx wrangler d1 execute stemstage --remote --file migrations/0003_ranked_charts.sql
-- Every import makes its own AI chart, so boards now say which chart a run was played on. Runs from before
-- this have chart_id '' (unranked).

-- first, so running the file a second time stops here (duplicate column) before touching scores
ALTER TABLE runs ADD COLUMN chart_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS runs_chart ON runs (chart_id, player_id);

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

-- best run per player per chart (the primary key gains chart_id, so the table is rebuilt)
CREATE TABLE scores_new (
  player_id TEXT NOT NULL, song_key TEXT NOT NULL, instrument TEXT NOT NULL, difficulty TEXT NOT NULL, chart_id TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL, stars INTEGER, accuracy REAL, fc INTEGER, max_streak INTEGER, notes INTEGER, version TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (player_id, song_key, instrument, difficulty, chart_id)
);
INSERT INTO scores_new (player_id, song_key, instrument, difficulty, chart_id, score, stars, accuracy, fc, max_streak, notes, version, created)
  SELECT player_id, song_key, instrument, difficulty, '', score, stars, accuracy, fc, max_streak, notes, version, created FROM scores;
DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;
CREATE INDEX IF NOT EXISTS scores_board ON scores (song_key, instrument, difficulty, chart_id, score DESC);
CREATE INDEX IF NOT EXISTS scores_recent ON scores (created DESC);
