# Band and Online

## Local band (up to 4 players)

Open **Play → Band**. Each player presses a button on their own controller to join a slot, then picks an instrument, difficulty and config profile. ✕ readies up, ◯ goes back, and the *Leave* row removes a player. Everyone gets their own highway. Overdrive revives failed bandmates. One singer can use the microphone and other vocalists play with buttons.

## Online

1. The host opens **Online → Host online**. After a few seconds an invite code appears, for example `POTTER-SIMON-FLORAL-EDGES`. Press **Copy invite** and send it to your friends.
2. Friends open **Online → Join**, type the code (spaces or dashes, any case) and press **Join**.
3. The host picks a song and a **match type**. Friends who don't have the song download it from the host automatically. Then everyone readies up and the host starts the match.

A room holds up to 8 players. Everyone has to run the same version (2.0.x plays with 2.0.x); a game on another version is told to update.

### Find match

**Online → Join → Find match** (or **Find match** on the website's [Play online](https://stemstage.varconstint.com/play/) page, which opens the game) picks a match type (any, versus, battle, band) and puts you in the best open room: the same version, room for one more, not mid-song, players near your **skill rating**, and on your continent when there's a choice. The search widens the longer it runs. If nobody is around after about 20 seconds, the game opens a public matchmaking room and the next players who search are sent to it.

Your **skill rating** starts at 1000 and goes up or down after every online versus or battle match (Elo, against the average of your opponents). It only steers matchmaking.

### Host controls

The host's lobby has:

| | |
|---|---|
| **Stage** | Any venue or world the host has opened. Everyone plays there, and in a world everyone meets its boss at the same moment ([Worlds and Bosses](Worlds-and-Bosses)). |
| **Bosses** | Random, always or off. |
| **Room size** | 2–8 players. |
| **Gear counts** | Whether instrument upgrades and pedals ([Backstage](Backstage)) apply in this room. Off by default, so versus matches are even. |
| **Lock room** | Nobody new can join (players who drop out can still come back). Locked rooms aren't listed publicly. |
| **Auto-start** | The match starts by itself 3 seconds after everyone has the song and is ready. |
| **Kick** | The ✕ next to a player removes them; they can't rejoin this room. |

Every player row shows their **ping** to the host and their skill rating. **Watch** lets a player spectate the next songs instead of playing.

### Dropped connections

The room pings every connection every few seconds and drops ones that stopped answering, so a closed laptop doesn't hold a slot. Your game notices a silent connection within about 10 seconds and reconnects by itself (up to 5 tries, waiting longer each time), back into your seat.

### Match types

| Match | How it plays |
|---|---|
| **Versus** | Everyone plays the same song and the highest score wins. Nobody can save you: if you fail, you're out. |
| **Battle** | Versus with attacks. Activating overdrive hits the player in the lead (or the runner-up, if that's you) with one of four attacks for 7 seconds: **Mirror** (the highway flips; your buttons don't), **Fog** (notes only show up on the near part of the highway), **Amp overload** (the camera shakes; players who turned camera shake off get Fog instead) or **Drain** (their overdrive meter empties). |
| **Band** | Play together. The scoreboard shows the line-up and one band score. A bandmate's overdrive brings back a player who failed. The results show the band total. |

### Win/loss record

Every versus or battle match counts toward your profile's **win/loss record**, overall and against each rival (by name). The results screen says who won and your record against them. The lobby shows it next to each player, the Career page has a **Versus** card, and your shared profile page on the website shows your W–L.

### Rematch and room history

After a match, anyone can press **Rematch** on the results screen or in the lobby. When everyone who has the song wants a rematch, the same song starts again. You don't need to ready up.

The **This room** panel in the lobby shows how many matches each player has won in this room, and the results of the last matches. For band matches it shows the band score.

### Public rooms

By default a room is private: only people with the invite code can join. The host can press **Private room** under the invite code to make it a **Public room**. It's then listed in **Online → Join → Public rooms** in every copy of the game, and on the website at <https://stemstage.varconstint.com/play/> with its stage, boss, skill level and region. Rooms from a different version of the game are shown but can't be joined. The listing updates every 30 seconds and disappears when the host stops hosting (or within 90 seconds if the game closes). Rooms on the local network can't be public.

**From Discord:** while you're in a room, friends can press **Join** on your Discord status instead of typing the code (see [Discord](Discord#join-from-discord)).

No router setup is needed. The room runs through a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/): the game downloads `cloudflared` once (~55 MB) and only makes outgoing connections. **Local network** hosts on your Wi-Fi/LAN only (port 5180). Friends type the address it shows instead of a code.

Songs are sent compressed (Opus or Ogg Vorbis): about 20 MB instead of 250 MB for a 4-minute song. A friend who already has the song from an earlier room gets the host's current chart again when it has changed (edited, re-charted, or swapped for the ranked chart): only `song.json`, never the audio.

## Setlists and marathons

Build setlists and play them back to back for one combined score. Drop a folder of songs or paste a YouTube playlist to import them all at once.

## Stream mode

Connect to your Twitch channel (read-only, no login). Chat votes for the next song (`!vote`), requests songs (`!sr`) and hypes the crowd (`!hype`). Add `public/overlay.html` as an OBS browser source to show the song, score, vote and requests.
