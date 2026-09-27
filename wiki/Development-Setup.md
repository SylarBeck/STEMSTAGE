# Development Setup

## Prerequisites

| | Windows | Linux (Ubuntu/Debian) |
|---|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) | NodeSource / nvm |
| Rust (desktop app only) | [rustup](https://rustup.rs) + Visual Studio Build Tools (C++) | rustup |
| System libraries (desktop app only) | WebView2 (preinstalled on Windows 11) | `sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf` |
| Python services (optional) | `npm run ai:setup` | `bash server/setup-ai.sh` |

## Clone and run in a browser (fastest loop)

```bash
git clone https://github.com/SylarBeck/STEMSTAGE
cd STEMSTAGE
npm install
npm run dev          # Vite with hot reload on http://127.0.0.1:5173
```

In other terminals, start the Python services if you need them. The desktop app does this for you.

```bash
npm run ai           # AI splitter on :8765       (Linux: server/start-ai.sh)
npm run bridge       # DualSense bridge on :8766  (Linux: server/start-bridge.sh)
```

The Vite dev server mounts the same local services as the production server (`vite.config.js` → `server/*.js`), so the song library, metadata, lyrics lookup, Discord and online rooms all work in dev.

> The dev server keeps its services on `globalThis` across config reloads (so a hot restart doesn't start a second room server). After adding a new service, **restart** `npm run dev`.

`window.stemstage` is the running `App` (see `src/main.js`), handy in the console: `stemstage.ui.songs`, `stemstage.game.players`, `stemstage.ui.play()`.

## Desktop app

```bash
npm run desktop:dev     # tauri dev
npm run desktop:build   # installer: NSIS on Windows; AppImage/deb/rpm on Linux
```

Output lands in `src-tauri/target/release/bundle/`. `desktop:build` signs update files if `%USERPROFILE%\.tauri\stemstage.key` (or `$TAURI_SIGNING_PRIVATE_KEY`) exists, and skips them otherwise.

Linux-only settings live in `src-tauri/tauri.linux.conf.json`, which Tauri merges automatically on Linux.

## Useful scripts

| Command | |
|---|---|
| `npm run build` / `npm start` | Build the game / serve the build with the production server (`server/app.js`) |
| `npm run screenshots` | README screenshots (see `tools/screenshots.mjs` for the empty-library setup) |
| `node tools/screenshots-real.mjs` | Real instrument screenshots (tab + keyboard) from a running game |
| `npm run art` / `npm run brand` | Re-render controller pictures / brand images |

## Testing changes

There's no unit test suite yet. Check changes in the running game, and keep pure logic in modules without DOM access so it can be run in Node. `src/audio/lyrics-align.js` and the fingering in `src/game/real-view.js` (`assignTab`) are examples:

```js
const { assignTab, TUNINGS } = await import('./src/game/real-view.js');
```

Next: [Architecture](Architecture)
