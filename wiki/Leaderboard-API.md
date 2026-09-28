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
| `GET /v1/songs?limit=100&q=hotel` | Songs with scores, most played first: `{ rows: [{ key, title, artist, entries, best, last, ranked }] }` (`entries` = players, `ranked` = parts with a ranked chart) |
| `GET /v1/leaderboard?song=<key>&instrument=guitar&difficulty=expert&chart=ranked&limit=50` | One board: `{ song, instrument, difficulty, mode, chart, rankedChart, otherCharts, rows: [{ player, playerId, avatar, score, stars, accuracy, fc, maxStreak, date, chart, ranked }] }`. `chart=ranked` (default) is the ranked chart's board (`mode: "ranked"`), or before the part has one, runs from before ranked charts (`mode: "unranked"`); `chart=all` is everyone's best on any chart (`mode: "all"`); `chart=<chart id>` is one chart's board (`mode: "chart"`) |
| `GET /v1/charts?song=<key>&instrument=guitar&player=<id>` | The charts players uploaded for a song part, ranked first: `{ rankedChart, voteMin, myVote, rows: [{ id, ranked, votes, runs, players, notes, duration, edited, method, version, uploader, date }] }` (`notes` = expert notes, `myVote` needs `player`) |
| `GET /v1/chart?id=<chart id>` | One chart in full: `{ id, song, instrument, duration, edited, method, version, uploader, date, chart, fp }` (see **Ranked charts**) |
| `GET /v1/rooms?limit=50` | Public online rooms, lobbies first, then fullest: `{ rows: [{ code, name, host, mode, song, artist, players, max, playing, version, created, updated }] }`. A room is listed while its host keeps announcing it (every 30 s; it drops off after 90 s) |
| `GET /v1/recent?limit=20` | Newest personal bests, with `song: { key, title, artist }` and `ranked` |
| `GET /v1/player?id=p_…` | A player's public profile: `{ id, name, avatar, since, updated, profile: { color, level, rank, xp, progress, favorite, stats, versus, instruments, achievements: [{ id, name, desc, icon, at }] }, world: { rank, total, charts, stars, fcs, records }, best: [...] }` (`records` = charts where they hold #1) |
| `GET /v1/song-key?artist=Eagles&title=Hotel%20California` | The board key for a song: `{ key }` |
| `GET /v1/me` + header `Authorization: Bearer <Discord OAuth token>` | The website's Discord login: `{ user: { id, username, globalName, avatar }, players: [{ playerId, name, total, charts }] }`. The token is checked with Discord (**401** if it's not valid) |
| `GET /v1/health` | `{ ok: true }` |

`instrument` is one of `guitar bass drums keys vocals`, and `difficulty` one of `easy medium hard expert`. Dates are Unix seconds. `avatar` is the player's linked Discord avatar URL, or `null`.

**Song keys:** a song's boards are shared by everyone who imported it, matched by artist and title with case, accents, punctuation, "(Remastered)", "[Live]" and "feat. …" ignored. The key is the first 16 hex digits of `sha256(normalised artist + "|" + normalised title)`, the same in the game (`src/net/leaderboard.js`) and the API (`cloud/src/index.js`).

## Ranked charts

Every import makes its own AI chart (another rip of the song, another split, another transcription), so two players' scores on "the same song" can be on quite different notes. So each **song part** (song + instrument) is ranked on one chart:

1. After a run, the game uploads the chart it was played on (`POST /v1/charts`): the notes of all four difficulties and the overdrive phrases, plus a **fingerprint** of the player's recording. No audio is uploaded.
2. The first chart uploaded for a song part becomes its **ranked chart**.
3. Before a song starts, the game downloads the ranked chart (`GET /v1/chart`) and slides its fingerprint over the player's own to find how far apart the two recordings start (a YouTube rip with a longer intro, a CD rip with silence first). The chart is moved by that much and played. A recording that doesn't line up (another version, edit or speed) is refused, and the player keeps their own chart.
4. Runs send the id of the chart they were played on. Runs on the ranked chart go on the ranked board; runs on any other chart go on that chart's own board.
5. Players can vote a better chart in (`POST /v1/charts/vote`): one vote per player per song part, for a chart they've finished a run on. A chart with at least **3** votes, and more votes than the ranked chart, becomes the ranked chart. That's how a chart fixed in the chart editor replaces a bad AI chart.

In the game: Settings → World leaderboard → **Play the ranked chart of each song**, and Song options → **World charts** to see a part's charts, play one, vote, or go back to your own.

**Chart format** (`cloud/src/chart.js`, shared by the game and the API): times in milliseconds on the uploader's recording.

```json
{ "v": 1, "instrument": "guitar",
  "phrases": [[12000, 19500], …],
  "notes": { "easy": [[timeMs, lane, sustainMs, midiNote, strength×100, phrase], …], "medium": […], "hard": […], "expert": […] } }
```

A chart's id is the first 16 hex digits of the sha256 of its canonical JSON (integers, notes sorted, keys in this order), so the same notes always get the same id.

**Fingerprint** (`src/audio/fingerprint.js`): `{ "v": 1, "fps": 50, "onset": "<base64>", "loud": "<base64>" }`, two curves sampled 50 times a second from the mixed-down stems: onset strength (spectral flux up to 5 kHz) and loudness, each one byte per frame. About 20 KB for a 4-minute song.

## Submitting (the game does this)

`POST /v1/scores` with JSON:

```json
{
  "player": { "id": "p_…", "secret": "…", "name": "Varconstint", "discord": { "id": "…", "avatar": "…" } },
  "song": { "title": "Hotel California", "artist": "Eagles", "duration": 391 },
  "instrument": "guitar", "difficulty": "expert", "chartId": "4252cfb760b3a4ae",
  "score": 123456, "stars": 5, "accuracy": 0.97, "fc": false, "maxStreak": 321, "notes": 800, "version": "1.5.0"
}
```

→ `{ ok, songKey, chartId, ranked, rankedChart, personalBest, rank, newTop }` (`rank` is on the chart the run was played on)

- A profile's `id` and `secret` are made on its first run and kept in `profiles.json`. The first run registers the secret, and later runs with the same id must match it (**403** otherwise), so nobody can post under your name.
- `chartId` is the chart the run was played on (see **Ranked charts**). Without it, the run goes on the unranked board.
- Only your best run per chart stays on the board. Every run is kept in history. Overall totals count your best run per song part, whichever chart it was on.
- Impossible values are refused (**400**), and each address can send 40 runs per 10 minutes (**429**).
- The game sends runs of signed-in profiles only. It never sends practice, replays, assisted or failed runs, and Settings → World leaderboard turns it off.

`POST /v1/charts` with the same `player` object plus `song: { title, artist, duration }`, `instrument`, `chart` (the format above), `fp` (the fingerprint) and `meta: { edited, method, version }` → `{ ok, chartId, songKey, known, ranked, rankedChart }`. The same chart uploaded again is `known`; the same notes under another song is refused (**409**). Up to 1.5 MB.

`POST /v1/charts/vote` with `{ player, chartId }` → `{ ok, chartId, votes, voteMin, rankedVotes, rankedChart, promoted }`. **403** until the player has a run on that chart.

## Public rooms (the game does this)

`POST /v1/rooms` with `{ code, key, name, host, mode, song, artist, players, max, playing, version }` lists a room or refreshes its listing → `{ ok, code, listedFor }`. `code` is the room's invite code (letters and dashes). `key` is a random string the hosting game makes; the first announce registers `sha256(key)`, and later announces need the same key (**403** otherwise). `mode` is `versus`, `battle` or `band`.

`POST /v1/rooms/close` with `{ code, key }` takes the listing down → `{ ok, closed }`.

## Profiles (the game does this)

`POST /v1/profile` with the same `player` object plus `profile: { color, level, rank, xp, progress, favorite, stats: { plays, songs, seconds, stars, fcs, bestStreak, accuracy, notes }, versus: { wins, losses, draws, best }, instruments: { guitar: { plays, best, accuracy, fcs }, … }, achievements: [{ id, name, desc, icon, at }] }` → `{ ok, url }`. The game sends it after every run it submits and when you press **Share profile**. The public page is `https://stemstage.varconstint.com/player/?id=<player id>`.

## Callback: Discord announcements

With the Worker secret `DISCORD_WEBHOOK` set to a Discord channel webhook URL, every **new #1** on a ranked board (or, for a song part without a ranked chart yet, the unranked board) is posted to that channel as an embed: player, score, song, part, and who they beat.

## Running it

The code is in `cloud/`: a Cloudflare Worker (`src/index.js`) with a D1 database (`schema.sql`). See `cloud/README.md` for deploying and moderation.
