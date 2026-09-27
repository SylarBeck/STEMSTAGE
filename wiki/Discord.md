# Discord

STEMSTAGE works with Discord in two directions. None of it needs a bot, a Discord login inside the game, or a secret key.

| | What it does | Needs |
|---|---|---|
| **Profile linking** | Your STEMSTAGE profile shows your Discord avatar and name | The Discord app on this PC, or your Discord user ID |
| **Live status** | Your career page shows your Discord status (online / idle / do not disturb), custom status, and what you're playing or listening to | Joining the [Lanyard](https://github.com/Phineas/lanyard) Discord server once |
| **Rich Presence** | Your Discord status shows what you're playing in STEMSTAGE: song, artist, part, difficulty and time left | The Discord app on this PC + a Discord application ID |

## Link your profile

1. Sign in to your STEMSTAGE profile and open **Career**.
2. Press **Link Discord**. STEMSTAGE asks the Discord app on this PC who's signed in and asks you to confirm.
3. If the Discord app isn't running (or no application ID is set), you can type your **Discord user ID** instead. In Discord: Settings → Advanced → turn on *Developer Mode*, then right-click your name → *Copy User ID*.

*Unlink Discord* on the same page removes it. The link is stored with your profile in `Documents/STEMSTAGE/data/profiles.json`: your user ID, username, display name and avatar ID.

## Show your live status

Discord doesn't let other apps read your status directly. STEMSTAGE uses **[Lanyard](https://github.com/Phineas/lanyard)**, a free open-source service that exposes the status of anyone who has joined its Discord server:

1. Join the Lanyard server: <https://discord.gg/lanyard>. You can mute it.
2. Open your STEMSTAGE career page. It shows your status and refreshes every 30 seconds.

If you haven't joined, the career page says "status hidden" and everything else still works.

## Rich Presence ("Playing STEMSTAGE")

Rich Presence goes through the Discord desktop app's local connection, and Discord wants an **application ID** for it. That's a public number, not a secret. Setting it up takes two minutes:

1. Open <https://discord.com/developers/applications> and click **New Application**. Name it **STEMSTAGE**, because Discord shows this name ("Playing STEMSTAGE").
2. Copy the **Application ID** from *General Information*.
3. *Optional:* under **Rich Presence → Art Assets**, upload the STEMSTAGE icon (`brand/icon-1024.png`) with the key **`stemstage`**. Songs with online cover art show the cover instead.
4. In STEMSTAGE: **Settings → Discord → Discord application ID**, paste it, then **Test Discord connection**.

*Show what I play on Discord* turns Rich Presence on or off. Friends see:

- **In a song:** "Hotel California — Eagles", "Guitar · Expert", time left, the album cover, and a *Get STEMSTAGE* button
- **Band:** the band size (for example "3 of 4")
- **Paused**, **practicing**, **watching a replay**, **results** ("12,345 points · 5★") and **in the menus**

To bake an ID into your own builds, set `STEMSTAGE_DISCORD_CLIENT_ID` in the game server's environment.
