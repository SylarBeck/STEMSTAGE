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

Later changes: `npx wrangler deploy` from `cloud/` (or the **Cloud** GitHub workflow, with the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).

## Try it locally

```bash
npx wrangler d1 execute stemstage --local --file schema.sql
npx wrangler dev --local --port 8799
# the website against it: site/leaderboard/?api=http://127.0.0.1:8799/v1
```

## Moderation

Scores can't be verified (the game runs on the player's PC), so remove bad ones by hand:

```bash
npx wrangler d1 execute stemstage --remote --command "SELECT p.name, s.* FROM scores s JOIN players p ON p.id = s.player_id ORDER BY s.score DESC LIMIT 20"
npx wrangler d1 execute stemstage --remote --command "DELETE FROM scores WHERE player_id = 'p_…'"
npx wrangler d1 execute stemstage --remote --command "DELETE FROM players WHERE id = 'p_…'"
```
