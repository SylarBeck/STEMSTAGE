# STEMSTAGE cloud: the world leaderboard API

A Cloudflare Worker (`src/index.js`) on a D1 database (`schema.sql`), served at `https://api.stemstage.varconstint.com`. API reference: the wiki page **Leaderboard API**.

## Deploy (once)

```bash
cd cloud
npx wrangler login                                   # opens Cloudflare in the browser
npx wrangler d1 create stemstage                     # copy the database_id it prints into wrangler.toml
npx wrangler d1 execute stemstage --remote --file schema.sql
npx wrangler deploy                                  # also creates api.stemstage.varconstint.com (DNS on Cloudflare)
```

Optional: announce new #1 scores in a Discord channel (Channel settings → Integrations → Webhooks → New Webhook → Copy URL):

```bash
npx wrangler secret put DISCORD_WEBHOOK
```

## Updating an existing database

New versions that change the database come with a file in `migrations/`. Run the ones you haven't run yet, in order, then deploy:

```bash
cd cloud
npx wrangler d1 execute stemstage --remote --file migrations/0002_profiles.sql       # 1.5.0: shared profile cards
npx wrangler d1 execute stemstage --remote --file migrations/0003_ranked_charts.sql  # 1.6.0: ranked charts + votes
npx wrangler d1 execute stemstage --remote --file migrations/0004_rooms.sql          # 1.7.0: public online rooms
npx wrangler d1 execute stemstage --remote --file migrations/0005_challenges.sql     # 1.8.0: weekly challenges
npx wrangler d1 execute stemstage --remote --file migrations/0006_security.sql       # 1.8.1: verified Discord links, vote + score checks
npx wrangler deploy
```

`0003_ranked_charts.sql` rebuilds the `scores` table (its key gains `chart_id`) and keeps every existing score as "unranked" (`chart_id = ''`). Run it once: a second run stops at its first line (*duplicate column name*) without changing anything.

Later changes: `npx wrangler deploy` from `cloud/` (or the **Cloud** GitHub workflow, with the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).

## Try it locally

```bash
npx wrangler d1 execute stemstage --local --file schema.sql
npx wrangler dev --local --port 8799
# the website against it: site/leaderboard/?api=http://127.0.0.1:8799/v1
```

## Moderation

Charts: a broken chart that became ranked can be replaced by players' votes, or by hand:

```bash
npx wrangler d1 execute stemstage --remote --command "SELECT c.id, c.song_key, c.instrument, p.name, c.notes, c.created FROM charts c JOIN players p ON p.id = c.player_id ORDER BY c.created DESC LIMIT 20"
npx wrangler d1 execute stemstage --remote --command "UPDATE ranked_charts SET chart_id = '<better chart id>' WHERE song_key = '<key>' AND instrument = 'guitar'"
```


Scores can't be verified (the game runs on the player's PC), so remove bad ones by hand:

```bash
npx wrangler d1 execute stemstage --remote --command "SELECT p.name, s.* FROM scores s JOIN players p ON p.id = s.player_id ORDER BY s.score DESC LIMIT 20"
npx wrangler d1 execute stemstage --remote --command "DELETE FROM scores WHERE player_id = 'p_…'"
npx wrangler d1 execute stemstage --remote --command "DELETE FROM players WHERE id = 'p_…'"
```
