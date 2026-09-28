-- shared profile cards (1.5.0). npx wrangler d1 execute stemstage --remote --file migrations/0002_profiles.sql
ALTER TABLE players ADD COLUMN profile TEXT;
ALTER TABLE players ADD COLUMN profile_updated INTEGER;
