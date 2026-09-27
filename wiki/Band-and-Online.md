# Band and Online

## Local band (up to 4 players)

Open **Play → Band**. Each player presses a button on their own controller to join a slot, then picks an instrument, difficulty and config profile. ✕ readies up, ◯ goes back, and the *Leave* row removes a player. Everyone gets their own highway. Overdrive revives failed bandmates. One singer can use the microphone and other vocalists play with buttons.

## Online

1. The host opens **Online → Host online**. After a few seconds an invite code appears, for example `POTTER-SIMON-FLORAL-EDGES`. Press **Copy invite** and send it to your friends.
2. Friends open **Online → Join**, type the code (spaces or dashes, any case) and press **Join**.
3. The host picks a song. Friends who don't have it download it from the host automatically. Then everyone readies up and the host starts the match.

No router setup is needed. The room runs through a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/): the game downloads `cloudflared` once (~55 MB) and only makes outgoing connections. **Local network** hosts on your Wi-Fi/LAN only (port 5180). Friends type the address it shows instead of a code.

Songs are sent compressed (Opus or Ogg Vorbis): about 20 MB instead of 250 MB for a 4-minute song.

## Setlists and marathons

Build setlists and play them back to back for one combined score. Drop a folder of songs or paste a YouTube playlist to import them all at once.

## Stream mode

Connect to your Twitch channel (read-only, no login). Chat votes for the next song (`!vote`), requests songs (`!sr`) and hypes the crowd (`!hype`). Add `public/overlay.html` as an OBS browser source to show the song, score, vote and requests.
