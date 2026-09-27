# Installation

STEMSTAGE is a desktop app for **Windows 10/11** and **Linux** (x86-64). Every release is on the [Releases page](https://github.com/SylarBeck/STEMSTAGE/releases/latest).

## 1. Node.js (required)

The app runs a small local game server with Node.js. Install **Node.js 20 or newer**:

- Windows: the LTS installer from <https://nodejs.org>
- Ubuntu / Debian: `sudo apt install nodejs` (22.04 ships Node 12; use [NodeSource](https://github.com/nodesource/distributions) or `nvm` to get 20+)
- Fedora: `sudo dnf install nodejs`

## 2. The app

### Windows
Download `STEMSTAGE_x.y.z_x64-setup.exe` and run it. It installs for your user, so no admin rights are needed. Start **STEMSTAGE** from the Start menu. The app updates itself when a new release comes out (Settings → Updates).

### Linux
Pick one:

| Package | For | Install |
|---|---|---|
| `STEMSTAGE_x.y.z_amd64.AppImage` | any distro | `chmod +x STEMSTAGE_*.AppImage && ./STEMSTAGE_*.AppImage`, updates itself |
| `STEMSTAGE_x.y.z_amd64.deb` | Ubuntu, Debian, Mint, Pop!_OS | `sudo apt install ./STEMSTAGE_*.deb` |
| `STEMSTAGE-x.y.z-1.x86_64.rpm` | Fedora, openSUSE | `sudo dnf install ./STEMSTAGE-*.rpm` |

The Linux app uses WebKitGTK and GStreamer for audio. The .deb and .rpm pull them in, and the AppImage bundles them.

## 3. AI splitter and DualSense bridge (recommended)

Without these, STEMSTAGE splits songs with a built-in DSP splitter (rougher) and DualSense controllers work as plain gamepads. With them you get Demucs stems, neural note transcription, Whisper lyrics and full DualSense support (adaptive triggers, haptics, lightbar).

You need a copy of the source (`git clone https://github.com/SylarBeck/STEMSTAGE`, or the source zip from the release) for the setup script. It uses [uv](https://docs.astral.sh/uv/) to build a Python 3.11 environment:

| | Command | Environment goes to |
|---|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File server\setup-ai.ps1` (or `npm run ai:setup`) | `%LOCALAPPDATA%\stemstage\venv` |
| Linux | `bash server/setup-ai.sh` | `~/.local/share/stemstage/venv` |

It installs the CUDA build of PyTorch when an NVIDIA GPU is present, otherwise the CPU build. It's about 3–5 GB including the model weights. After that the desktop app starts the splitter and the bridge by itself.

### Linux: DualSense permissions
pydualsense talks to the controller over `hidraw`. Install hidapi and give your user access (once):

```bash
sudo apt install libhidapi-hidraw0          # Fedora: sudo dnf install hidapi
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="0ce6|0df2", MODE="0660", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/70-stemstage-dualsense.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

## Where things are stored

| | Windows | Linux |
|---|---|---|
| Songs (a folder of WAV stems + `song.json` each) | `Documents\STEMSTAGE\songs` | `~/Documents/STEMSTAGE/songs` |
| Profiles, scores, replays | `Documents\STEMSTAGE\data` | `~/Documents/STEMSTAGE/data` |
| Logs | `%LOCALAPPDATA%\stemstage\logs` | `~/.local/share/stemstage/logs` |

Next: [Getting Started](Getting-Started)
