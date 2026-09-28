# Installation

STEMSTAGE is a desktop app for **Windows 10/11** and **Linux** (x86-64), and it's **one click**: the app ships with its own Node.js, and the setup installs the controller bridge and (if you want it) the AI splitter for you. Every release is on the [Releases page](https://github.com/SylarBeck/STEMSTAGE/releases/latest).

## Windows

1. Download `STEMSTAGE_x.y.z_x64-setup.exe` and run it. It installs for your user, so no admin rights are needed.
2. The setup wizard then:
   - installs Python and the **DualSense controller bridge** (about 60 MB, under a minute), and
   - asks whether to install the **AI splitter** too (Demucs stems, Whisper lyrics, note transcription). It's a **3–5 GB download**, from a few minutes up to half an hour. With an NVIDIA GPU it gets the CUDA build.

   Progress shows in the wizard's details list.
3. Start **STEMSTAGE** from the Start menu. It updates itself when a new release comes out (Settings → Updates).

Said no to the AI splitter, or setup was offline? **Settings → AI splitter → Install AI splitter** installs it in the background while you play. Anything else missing is installed by the app on its next start.

## Linux

| Package | For | Install |
|---|---|---|
| `STEMSTAGE_x.y.z_amd64.AppImage` | any distro | `chmod +x STEMSTAGE_*.AppImage && ./STEMSTAGE_*.AppImage`, updates itself |
| `STEMSTAGE_x.y.z_amd64.deb` | Ubuntu, Debian, Mint, Pop!_OS | `sudo apt install ./STEMSTAGE_*.deb` |
| `STEMSTAGE-x.y.z-1.x86_64.rpm` | Fedora, openSUSE | `sudo dnf install ./STEMSTAGE-*.rpm` |

Linux has no setup wizard, so the **first start** installs the controller bridge and the AI splitter in the background (3–5 GB), while the game is already playable with the built-in splitter. Progress is logged to `~/.local/share/stemstage/logs/setup.log`. The splash screen and Settings → AI splitter show when it's ready.

### Linux: DualSense permissions
pydualsense talks to the controller over `hidraw`. Install hidapi and give your user access (once):

```bash
sudo apt install libhidapi-hidraw0          # Fedora: sudo dnf install hidapi
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="0ce6|0df2", MODE="0660", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/70-stemstage-dualsense.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

## What gets installed where

| | Windows | Linux |
|---|---|---|
| The app (with Node.js and uv) | `%LOCALAPPDATA%\Programs\STEMSTAGE` | AppImage file / `/usr/bin` |
| Python + controller bridge + AI splitter | `%LOCALAPPDATA%\stemstage\venv` | `~/.local/share/stemstage/venv` |
| Songs (a folder of WAV stems + `song.json` each) | `Documents\STEMSTAGE\songs` | `~/Documents/STEMSTAGE/songs` |
| Profiles, scores, replays | `Documents\STEMSTAGE\data` | `~/Documents/STEMSTAGE/data` |
| Logs (incl. `setup.log`) | `%LOCALAPPDATA%\stemstage\logs` | `~/.local/share/stemstage/logs` |

Uninstalling removes the app and keeps your songs, profiles and the Python environment. Delete the `stemstage` folder above to free the AI splitter's space.

## Playing in a browser instead (developers)

From a source checkout: `npm install`, `npm run dev`, and open <http://127.0.0.1:5173>. Node.js 20+ is needed for this, plus `npm run ai:setup` (Windows) or `bash server/setup-ai.sh` (Linux) for the Python parts. See [Development Setup](Development-Setup).

Next: [Getting Started](Getting-Started)
