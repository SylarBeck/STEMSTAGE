# Discord

Nothing to set up for players: log in with Discord and your status follows what you play.

| | What it does | Needs |
|---|---|---|
| **Log in with Discord** | Links your STEMSTAGE profile to your Discord account: your Discord avatar and name show on your profile | A Discord account |
| **Automatic status** | While you play, your Discord status shows the song, artist, part, difficulty and time left, then your result | The Discord app running on this PC |
| **Invites** | While you're in an online room, your status gets a **Join room** button, and **Invite friends** gives you a link to paste in any chat. Both work for everyone, with or without STEMSTAGE | Nothing |
| **Live status on your profile** | Your career page shows your Discord status (online / idle / do not disturb), custom status, and what you're playing or listening to | Joining the [Lanyard](https://github.com/Phineas/lanyard) Discord server once (optional) |

## Log in with Discord

1. Sign in to your STEMSTAGE profile and open **Career**.
2. Press **Link Discord** → **Continue**. Discord's login page opens in the game window.
3. Sign in if needed and press **Authorize**. STEMSTAGE only asks for the `identify` permission: your username and avatar, not your email, servers or messages.
4. You're back on your Career page with Discord linked.

Discord's answer is used once to read your profile and isn't stored. The link (your Discord user ID, username, display name and avatar ID) is saved with your STEMSTAGE profile in `Documents/STEMSTAGE/data/profiles.json`. **Unlink Discord** on the same page removes it.

## Log in on the website

**Log in** (top right on stemstage.varconstint.com) also uses Discord. Once logged in, the menu lists your STEMSTAGE profiles (the ones linked to that Discord account in the game), the leaderboard highlights your rows, and your profile page says **This is you**. The login stays in that browser only; **Log out** in the same menu removes it.

## Automatic status (Rich Presence)

When the Discord desktop app is running on the same PC, STEMSTAGE updates your status automatically. Friends see:

- **In a song:** "Hotel California — Eagles", "Guitar · Expert", time left, the album cover, and a *Get STEMSTAGE* button
- **Band:** the band size (for example "3 of 4")
- **Paused**, **practicing**, **watching a replay**, **results** ("12,345 points · 5★") and **in the menus**

Turn it off with **Settings → Discord → Show what I play on Discord**. *Test Discord status* checks that the Discord app answers. The browser version of Discord can't show game status, and Discord's own setting *Activity Privacy → Share your detected activities* has to be on.

## Invites

In an online room (hosting or joined), press **Invite friends** in the lobby:

- **Copy invite link:** `https://stemstage.varconstint.com/join/?code=…`. Paste it in a Discord chat (or anywhere) and it shows as a card **anyone can click**. The page opens STEMSTAGE straight into your room, or offers the download to friends who don't have it yet, then the code.
- **Copy invite code:** the words friends type in Online → Join.

Your Discord status also shows the room, its size ("2 of 8") and a **Join room** button with the same link.

### Discord's own Join button (optional)

Discord's built-in Game Invitations (the card with a Join button, sent from a chat's **+ → Invite to STEMSTAGE**) only work for friends who **have STEMSTAGE installed**. For everyone else Discord shows the button greyed out, and no app can change that. Discord also doesn't allow the Join room link button at the same time. So it's a setting: **Settings → Discord → Discord invites**: *Join link* (default, works for everyone) or *Discord Join*.

With *Discord Join*, your status shows Discord's **Join** button, or **Ask to Join** for friends who aren't allowed to join directly.

- A friend presses **Join** → their STEMSTAGE opens the Online screen and connects to your room. If STEMSTAGE isn't running, Discord starts it first (the desktop app registers itself with Discord for this the first time it runs).
- **Ask to Join** requests are accepted automatically, since the room is open to anyone with the invite code anyway, and you see "*name* is joining through Discord".
- It works for internet rooms (invite codes). Local-network rooms have no code, so they don't get a Join button.
- In a song, your friend is asked to finish or quit first.

Under the hood the join secret is the room's invite code, so it's the same as typing it in Online → Join.

## Live status on your profile

Discord doesn't let other apps read your status directly. STEMSTAGE uses **[Lanyard](https://github.com/Phineas/lanyard)**, a free open-source service that exposes the status of people who have joined its Discord server. Join <https://discord.gg/lanyard> (you can mute it), and your career page shows your status, refreshed every 30 seconds. If you haven't joined, it says "status hidden" and everything else works.

## For developers: the STEMSTAGE Discord application

Login and Rich Presence use one Discord application owned by the project. Its **Application ID is public** (it's in every OAuth URL), and no client secret is used anywhere:

- Login is the OAuth2 **implicit grant** (`response_type=token`, scope `identify`). The redirect goes to `<game origin>/discord/callback`, and the game server calls `GET /users/@me` once with the token (`server/discord.js`, `POST /api/discord/me`).
- Rich Presence goes through the Discord app's local IPC socket (`discord-ipc-N`) with the same ID.

Setting up the application (maintainers, once):
1. <https://discord.com/developers/applications> → **New Application** → name it **STEMSTAGE** (Discord shows this name: "Playing STEMSTAGE").
2. **OAuth2 → Redirects**, add: `http://127.0.0.1:5173/discord/callback`, `http://localhost:5173/discord/callback`, `http://localhost:5174/discord/callback` (the game) and `https://stemstage.varconstint.com/login/` (the website)
3. **Rich Presence → Art Assets:** upload `brand/icon-1024.png` with the key **`stemstage`**.
4. The **Application ID** is `DISCORD_APP_ID` in `src/net/discord.js` (STEMSTAGE's is `1553872601603117127`). Forks build with `VITE_DISCORD_CLIENT_ID=<id>`, and the `discordClientId` setting overrides it.
