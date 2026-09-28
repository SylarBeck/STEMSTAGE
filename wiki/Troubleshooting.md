# Troubleshooting

## Lag, stutter or missed notes

Since 1.5.0 STEMSTAGE runs at **High priority** on Windows: the game, its renderer and the controller bridge. The AI splitter runs at Below normal, so splitting in the background never takes time from a song. Controllers are read every ~2.5 ms on a high-priority task, so short taps aren't lost when the PC is busy. If it still stutters:

- Settings → Video → **Graphics quality** *low* (smaller crowd, no film grain) and **Bloom** off.
- Close other heavy apps. Don't import or split a song while playing.
- Plug laptops in: on battery Windows slows the GPU down.
- Hitting late or early is usually audio latency, not lag: **Settings → Audio → Calibrate audio offset** (Bluetooth headphones add 100–250 ms).

## Microphone

**The desktop app can't use the microphone (singing or a real guitar/bass).**
Since 1.4.0 the app grants the game page microphone access itself, so you won't see a prompt. If it still fails, the operating system is blocking it:

- **Windows:** Settings → Privacy & security → Microphone → turn on **Microphone access** *and* **Let desktop apps access your microphone**. Then pick the input in Settings → Singing → *Microphone* (or Real instruments → *Instrument input*) and use *Test*.
- **Linux:** check that the input works in your desktop's sound settings (PipeWire / PulseAudio). The .deb needs `gstreamer1.0-plugins-good` and `gstreamer1.0-pulseaudio`, which are installed with it. Flatpak/Snap sandboxes of other apps can hold the device exclusively.
- **Browser version:** allow the microphone for `127.0.0.1:5173` in the site permissions.

The game tells you which of these it is: "Microphone access is blocked", "No microphone found", or "The audio input is busy". If a saved input was unplugged, it falls back to the system default.

## DualSense

- **Not detected:** turn it on or plug it in, and close Steam or DS4Windows (or turn off their PlayStation support). Settings → Controllers → *Test controller bridge* lists what the bridge sees.
- **"Controller bridge offline":** run the AI setup once ([Installation](Installation#3-ai-splitter-and-dualsense-bridge-recommended)). The app starts the bridge after that.
- **Laggy:** update to 1.4.0 or newer. If you start the bridge yourself, restart it. See [Controllers and DualSense](Controllers-and-DualSense#input-lag-fixed-in-140).
- **Linux, "not available":** the udev rule is missing. See [Installation](Installation#linux-dualsense-permissions).

## The desktop app shows an error on start

It needs **Node.js 20+** on your PATH (`node --version`). The splash screen shows which service failed and where its log is:

- Windows: `%LOCALAPPDATA%\stemstage\logs`
- Linux: `~/.local/share/stemstage/logs`

"Port 5173 is already in use" means another STEMSTAGE (or `npm run dev`) is still running.

## Lyrics

- **"No lyrics found online":** fix the title and artist (Song options → Edit song info → look it up online) and try *Check lyrics online* again.
- **"The lyrics found online don't match this recording":** usually a live or alternate version, or another language. The AI lyrics are kept.

## Discord

- **"Discord is not running on this PC":** start the Discord desktop app (the browser version of Discord has no local connection).
- **The login page says "Invalid OAuth2 redirect_uri":** the game runs on an address not registered with the STEMSTAGE Discord application. Use the desktop app, or `npm run dev` on port 5173/5174 (see [Discord](Discord#for-developers-the-stemstage-discord-application)).
- **Status doesn't change while playing:** in Discord, turn on Settings → Activity Privacy → *Share your detected activities*.
- **Status says "status hidden":** join the Lanyard server, see [Discord](Discord#live-status-on-your-profile).

## Online

- **"No room found":** check the code with the host. A room only exists while the host is on the Online screen or in the match.
- **The invite code never appears:** the tunnel needs internet access to github.com (first time) and to Cloudflare. If a VPN or firewall blocks it, use *Local network*.

## Still stuck?

[Open an issue](https://github.com/SylarBeck/STEMSTAGE/issues) with your version (Settings → Updates) and the relevant log.
