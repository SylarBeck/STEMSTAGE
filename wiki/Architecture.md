# Architecture

```mermaid
flowchart LR
  subgraph Desktop app (Tauri)
    L[Launcher<br/>src-tauri/src/lib.rs] --> W[WebView<br/>WebView2 / WebKitGTK]
  end
  L -->|starts| G[Game server :5173<br/>server/app.js · Node]
  L -->|starts| AI[AI splitter :8765<br/>stem_server.py]
  L -->|starts| B[Controller bridge :8766<br/>controller_bridge.py]
  W -->|HTTP| G
  W -->|HTTP| AI
  W <-->|WebSocket| B
  G -->|LRCLIB · MusicBrainz · iTunes · Lanyard| NET((internet))
  G <-->|local IPC| D[Discord app]
  B <-->|hidapi| DS[DualSense]
```

## Processes

| Process | Port | Code | What |
|---|---|---|---|
| Launcher | — | `src-tauri/src/lib.rs` | Starts the services below, shows the splash (`desktop/splash`), creates the game window (grants mic + MIDI to the local page), updates from GitHub Releases, stops everything on exit |
| Game server | 5173 | `server/app.js` | Serves `dist/` and the local APIs below. In dev, `vite.config.js` mounts the same handlers |
| AI splitter | 8765 | `server/stem_server.py` | Demucs stems, basic-pitch transcription (`transcribe.py`), Whisper lyrics (`lyrics.py`) |
| Controller bridge | 8766 | `server/controller_bridge.py` | DualSense via pydualsense. See [Controller Bridge Protocol](Controller-Bridge-Protocol) |

### Game server APIs

| Mount | File | |
|---|---|---|
| `/api/library` | `server/library.js` | Songs on disk (WAV stems + `song.json`), scores |
| `/api/yt` | `server/extras.js` | yt-dlp search and download |
| `/api/meta` | `server/extras.js` | `/lookup`: MusicBrainz + iTunes metadata · `/lyrics`: LRCLIB lyrics |
| `/api/data` | `server/extras.js` | Profiles, plays, setlists, replays (JSON in the data folder) |
| `/api/online` | `server/online.js` + `tunnel.js` | Online rooms (port 5180), Cloudflare quick tunnel |
| `/api/stream` | `server/stream.js` | Twitch chat relay + OBS overlay |
| `/api/discord` | `server/discord.js` | Discord IPC (Rich Presence, signed-in user) and Lanyard presence proxy |

Every API answers only to requests from the local machine (`isLocal`).

## The game (`src/`)

| Folder | |
|---|---|
| `main.js` | `App`: engine, stage, renderer, HUD, session, UI; the frame loop |
| `game/` | `session.js` (a song being played: players, band, online, replays, Rich Presence), `player.js` (judging, scoring, overdrive), `highway.js` + `renderer.js` + `stage.js` (three.js), `vocals.js` (singing), `real.js` (real instrument scoring), **`real-view.js`** (tablature + keyboard views, fingering), `replay.js` |
| `audio/` | `engine.js` (Web Audio stems), `pipeline.js` (import → split → chart → save; lyrics), `charter.js`, `transcription.js`, `pitch.js` (YIN mic input), **`lyrics-align.js`** (Whisper ↔ LRCLIB alignment), `stretch.js` |
| `input/` | `input.js` (keyboard, gamepads, MIDI → game events), `bindings.js` (config profiles), `dualsense.js` (bridge client) |
| `net/` | `online.js` (rooms), **`discord.js`** (linking, presence, Rich Presence) |
| `profile/` | `profiles.js` (profiles, XP, achievements, Discord link), `career.js` |
| `ui/` | `ui.js` (screens, navigation, settings), `social.js` (profiles, career, leaderboards), `hud.js`, controllers hub, editor, tour, setlists, stream, updates |

## A song's life

1. **Import** (`pipeline.js`): decode → split (AI server or the in-browser DSP fallback in `splitter.js`/`worker.js`) → transcribe → `charter.js` builds four difficulties and overdrive phrases → saved as `songs/<Artist - Title [id]>/` (WAV stems + `song.json`).
2. **Lyrics**: Whisper on the vocal stem → `checkLyrics()` cross-checks with LRCLIB ([Lyrics Cross-Check](Lyrics-Cross-Check)) → `song.lyrics`.
3. **Play** (`session.js`): one `Player` per band member (`VocalPlayer` for singing, `RealPlayer` for real instruments), a `Highway` each, the stems mixed by `engine.js` (a part drops out of the mix while you miss).
4. **Results**: scores and replays go to the data folder, and XP and achievements to the profile.

## song.json (excerpt)

```jsonc
{
  "id": "mujd66l6f4p6", "title": "Hotel California", "artist": "Eagles", "duration": 391.2,
  "stemNames": ["drums", "bass", "guitar", "piano", "vocals", "other"],
  "beats": [0.52, 1.03, ...],
  "charts": { "guitar": { "available": true, "notes": { "expert": [{ "t": 12.3, "lane": 2, "len": 0.4, "m": 64 }] } } },
  "lyrics": {
    "words": [{ "t": 50.1, "e": 50.4, "w": "On", "br": true }],   // br: a new line starts here
    "ai": [...],                        // Whisper's original words (kept for re-checks)
    "source": "whisper+lrclib", "reference": { "source": "LRCLIB", "id": 123, "synced": true },
    "corrected": 12, "added": 27, "dropped": 1
  }
}
```

`n.m` is the MIDI pitch the note was transcribed from. Real instrument mode scores it, and `real-view.js` turns it into string/fret (`n.str`, `n.fret`) or a key.
