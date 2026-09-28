# Security

## Reporting a problem

Please report security problems privately: **GitHub → Security → Report a vulnerability** on this repository (or
contact the maintainer), not in a public issue. Say what's affected (game, website, leaderboard API, room server)
and how to reproduce it.

## What runs where

| Part | Where | Who can reach it |
| --- | --- | --- |
| Game server (`server/app.js`: the game page, `/api/*` services) | the player's PC, `127.0.0.1:5173` | the game page and local programs only |
| Room server (`server/online.js`) | the host's PC, port 5180 | everyone with the invite code (Cloudflare quick tunnel) or on the LAN |
| AI splitter (`server/stem_server.py`), controller bridge (`server/controller_bridge.py`) | the player's PC, `127.0.0.1:8765` / `8766` | the game page and local programs only |
| Leaderboard API (`cloud/`) | Cloudflare Worker + D1, `api.stemstage.varconstint.com` | everyone |
| Website (`site/`) | GitHub Pages, `stemstage.varconstint.com` | everyone |

## Audit: 1.8.1 (September 2026)

Each part was attacked on a local copy: the API on `wrangler dev`, the room server with scripted hostile clients, and
the game in a browser fed hostile room hosts, API answers and YouTube results. Every check was run against 1.8.0
first (to confirm the problem) and against 1.8.1 (to confirm the fix). The live API was not attacked.

### Fixed

| Severity | Problem | Fix |
| --- | --- | --- |
| High | **Any website could use the game's local API.** The API only checked that a request came from this PC, which every web page open in a browser on it does. A page could start a room server with a public tunnel, write play history, set your Discord status, and with DNS rebinding read your profiles (including the leaderboard secret) or delete songs. `/api/health` also told any page your folder paths. | `server/guard.js`: `/api/*` needs a loopback `Host` (no DNS rebinding) and, from a browser, the game's own origin (no cross-site requests). Health gives the folder paths only to the game and the launcher. |
| High | **A room host could overwrite a guest's files.** A song's file names (`stemNames`, `cover`) went into local API URLs unchecked, so `../../../data/profiles?` made the guest's game replace its own `profiles.json` / `setlists.json`, and a song.json with another song's `id` replaced that song's chart. Public rooms are listed for anyone to join. | `src/storage/library.js`: a song from a room keeps the id that was asked for, and only stem names and cover names the song folder uses. |
| High | **Script injection in the game** from other players and the world API: values the screens expected to be numbers or fixed words (the live multiplier, colours, instrument, difficulty, scores, counts, ranks) were put into the page as HTML. A room player, a room host or a crafted API answer could run script in your game (with the local API behind it). | Everything a room sends is cleaned on arrival (`cleanMessage` in `src/net/online.js`), every world API answer too (`src/net/api-clean.js`), and the game page has a Content-Security-Policy that doesn't run inline scripts or `on…=` handlers (`server/app.js`). |
| Medium | **Anyone could show someone else's Discord name and avatar** on leaderboard runs, and make their profile appear under that person's Discord login on the website. The API trusted the Discord id the game sent. | The API ignores it. A Discord account is linked with `POST /v1/link`, which checks the login token with Discord itself. |
| Medium | **One person could vote any chart onto the ranked board** with several profiles (3 votes). | Votes count once per address (`chart_votes.voter`). |
| Medium | **Impossible scores on ranked charts were accepted** (20 000 000 on a 3-note chart), including runs claiming a chart of another song. | A run on a known chart can't score more than every note at the top multiplier with overdrive on, or have a longer streak than the chart has notes (`charts.limits`). |
| Medium | **Room server trusted its players**: names, chat, song titles and live data were relayed as sent, a result could claim another player's id and name, one player could flood the room, idle connections were never dropped, and anyone with the invite code could download any song in the host's library. | Text is stripped of markup, instrument / difficulty / events come from known lists, live data and results are numbers only, 40 messages a second per player (flooders are dropped), 24 connections, 10 s to say hello, and only the songs picked in the room are served. |
| Medium | **The AI splitter and the controller bridge accepted any website** (`Access-Control-Allow-Origin: *` and Private Network Access; the bridge checked no `Origin`), so a page could queue GPU jobs or read the controllers and drive their rumble and lights. Request bodies had no size limit. | Only the game's origins; bodies up to 20 minutes of audio. |
| Low | API errors included internal messages; request bodies had no size limit; JSON had no `nosniff`; the Discord announcement rendered markdown from song titles and names (masked links); the OBS overlay event stream had `Access-Control-Allow-Origin: *`; the overlay and the website's room list put numbers from outside into the page unchecked; the website had no Content-Security-Policy; a malformed room URL raised an unhandled error. | All fixed. |

1.8.0 also had a bug (not a security problem) that stopped anyone joining an online room; it was fixed before release.

### How it was tested (1.8.0 → 1.8.1)

- Local API from a hostile website (cross-site POSTs, an `<img>` GET, a sandboxed `null` origin, DNS rebinding): all 7 hostile requests got through on 1.8.0 (and `/api/health` gave out the folder paths); all refused on 1.8.1, and the game page and local programs still work.
- Hostile room host + hostile API answers + hostile YouTube results, in the browser: 1.8.0 took HTML from 27 different fields (across two runs) and overwrote `profiles.json`, `setlists.json` and another song; 1.8.1: none, no files touched, no page errors.
- Room server attack suite (21 checks): 1.8.0 failed 7 of the first 10, then stopped on an unhandled error from a malformed URL (the desktop app catches it, but that request hangs); 1.8.1 passes all 21. The existing room suite (16 checks) still passes.
- Leaderboard API attack suite (25 checks): 12 pass on 1.8.0, all 25 on 1.8.1. The existing chart API suite passes on a fresh database.
- Website pages with hostile API answers and a logged-in visitor: clean, and no Content-Security-Policy violations in normal use.
- The game under its Content-Security-Policy: every screen and a song played with no violations; an injected `onerror` handler doesn't run.
- A full two-player online match (battle, rematch, band) still works.

### What's left (by design, or outside the code)

- **Scores are computed on the player's PC**, so a cheater can still post a plausible score up to a chart's maximum. Moderators can delete rows (`cloud/README.md`).
- **Rate limits for reads**: the heavy summary reads are served from Cloudflare's edge cache, and writes are limited per address. A Cloudflare rate-limiting rule on `api.stemstage.varconstint.com` (dashboard → Security → WAF) would also cap read floods.
- **Invite links join rooms directly** (the website's `/join` page and Discord's Join button), the same as a Discord invite. With 1.8.1 a room can't do anything to a guest beyond sending the song.
- **Older games** (1.8.0 and earlier) keep their problems until they update. The 1.8.1 room server cleans what it relays, which also protects older guests in a 1.8.1 host's room.
- The website keeps the Discord login token (scope `identify`: username and avatar) in the browser's local storage until it expires.

### Deploying the API part

```bash
cd cloud
npx wrangler d1 execute stemstage --remote --file migrations/0006_security.sql
npx wrangler deploy
```
