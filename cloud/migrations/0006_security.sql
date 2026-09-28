-- Security hardening (1.8.1). npx wrangler d1 execute stemstage --remote --file migrations/0006_security.sql
-- Each ALTER fails on a second run ("duplicate column"), which stops the file harmlessly.
-- 1 = the Discord account was linked with a Discord login the API checked itself (POST /v1/link); the game's
-- own claim isn't trusted any more
ALTER TABLE players ADD COLUMN discord_verified INTEGER NOT NULL DEFAULT 0;
-- sha256 of the voter's address: a chart is voted in by different addresses, not by one person's many profiles
ALTER TABLE chart_votes ADD COLUMN voter TEXT;
-- per difficulty [notes, highest possible score], for rejecting impossible runs on the chart
ALTER TABLE charts ADD COLUMN limits TEXT;
