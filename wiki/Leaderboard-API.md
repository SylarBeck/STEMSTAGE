# Leaderboard API

The world leaderboard (on <https://stemstage.varconstint.com/leaderboard/> and in the game under **Leaderboards → World**) is a public API:

```
https://api.stemstage.varconstint.com/v1/
```

Every `GET` returns JSON with CORS (`Access-Control-Allow-Origin: *`), so any web page can call it. For pages that prefer script tags, add `?callback=myFunction` for **JSONP**: the answer is `myFunction({...});`. Callback names may use letters, digits, `_`, `$` and dots.

```html
<script>function showTop(data) { console.log(data.rows); }</script>
<script src="https://api.stemstage.varconstint.com/v1/players?limit=10&callback=showTop"></script>
```

## Reading

| Endpoint | Returns |
|---|---|
| `GET /v1/players?limit=25` | Top players: `{ rows: [{ player, playerId, avatar, total, stars, fcs, charts, last }] }` (total = best scores added up) |
| `GET /v1/songs?limit=100&q=hotel` | Songs with scores, most played first: `{ rows: [{ key, title, artist, entries, best, last }] }` |
| `GET /v1/leaderboard?song=<key>&instrument=guitar&difficulty=expert&limit=50` | One chart's board: `{ song, instrument, difficulty, rows: [{ player, playerId, avatar, score, stars, accuracy, fc, maxStreak, date }] }` |
| `GET /v1/recent?limit=20` | Newest personal bests, with `song: { key, title, artist }` |
| `GET /v1/song-key?artist=Eagles&title=Hotel%20California` | The board key for a song: `{ key }` |
| `GET /v1/health` | `{ ok: true }` |

`instrument` is one of `guitar bass drums keys vocals`, and `difficulty` one of `easy medium hard expert`. Dates are Unix seconds. `avatar` is the player's linked Discord avatar URL, or `null`.

**Song keys:** a song's board is shared by everyone who imported it, matched by artist and title with case, accents, punctuation, "(Remastered)", "[Live]" and "feat. …" ignored. The key is the first 16 hex digits of `sha256(normalised artist + "|" + normalised title)`, the same in the game (`src/net/leaderboard.js`) and the API (`cloud/src/index.js`).

## Submitting (the game does this)

`POST /v1/scores` with JSON:

```json
{
  "player": { "id": "p_…", "secret": "…", "name": "Varconstint", "discord": { "id": "…", "avatar": "…" } },
  "song": { "title": "Hotel California", "artist": "Eagles", "duration": 391 },
  "instrument": "guitar", "difficulty": "expert",
  "score": 123456, "stars": 5, "accuracy": 0.97, "fc": false, "maxStreak": 321, "notes": 800, "version": "1.5.0"
}
```

→ `{ ok, songKey, personalBest, rank, newTop }`

- A profile's `id` and `secret` are made on its first run and kept in `profiles.json`. The first run registers the secret, and later runs with the same id must match it (**403** otherwise), so nobody can post under your name.
- Only your best run per chart stays on the board. Every run is kept in history.
- Impossible values are refused (**400**), and each address can send 40 runs per 10 minutes (**429**).
- The game sends runs of signed-in profiles only. It never sends practice, replays, assisted or failed runs, and Settings → World leaderboard turns it off.

## Callback: Discord announcements

With the Worker secret `DISCORD_WEBHOOK` set to a Discord channel webhook URL, every **new #1** on a chart is posted to that channel as an embed: player, score, song, part, and who they beat.

## Running it

The code is in `cloud/`: a Cloudflare Worker (`src/index.js`) with a D1 database (`schema.sql`). See `cloud/README.md` for deploying and moderation.
