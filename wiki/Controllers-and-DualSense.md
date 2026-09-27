# Controllers and DualSense

## Supported devices

| Device | How it's read |
|---|---|
| **DualSense / DualSense Edge** | The controller bridge (pydualsense): adaptive triggers, haptics, lightbar, player LEDs, touchpad, battery. USB or Bluetooth, several at once |
| Xbox, DualShock 4, Switch Pro, Joy-Con, generic pads | Gamepad API (standard layout). Rumble where supported |
| Rock Band / Guitar Hero (Xbox 360) | **Guitar** or **Drum kit** profile: frets, strum bar, whammy, tilt, kick pedal |
| Non-standard pads (PS3 instruments, arcade sticks) | **Map buttons** once with the built-in wizard |
| MIDI e-drums and keyboards | General MIDI drum map. Keyboard C–G = lanes, or [real keys mode](Real-Instruments) |
| Keyboard | Two layouts so two people can share one: `D F Space J K` and `U I O P [` |

## Config profiles

Every device uses a profile. There are presets, and you can make your own named copies (rename, reset, delete). A profile holds bindings for 5-lane and drums, plus options: strum mode, lefty flip, trigger press point, whammy source (right stick, left stick or DualSense touchpad), haptics and adaptive triggers. Profiles are remembered per controller. Open them from **Settings → Controllers → Controller profiles & bindings**.

## DualSense

The DualSense is driven by the **controller bridge** (`server/controller_bridge.py`, port 8766), which the desktop app starts. Needs the Python environment from [Installation](Installation#3-ai-splitter-and-dualsense-bridge-recommended).

- **Adaptive triggers:** frets click like a real switch, sustains buzz, overdrive rumbles. Strength: Settings → Controllers → *Adaptive trigger strength*.
- **Haptics:** hits, misses and overdrive. *Haptic strength* sets how strong.
- **Lightbar:** follows your multiplier and overdrive. Player LEDs show your band slot.

### Input lag (fixed in 1.4.0)
Before 1.4.0, a Bluetooth DualSense could lag by 30–120 ms. pydualsense read one input report and then wrote one output report in lockstep, and a Bluetooth write takes longer than the gap between input reports, so reports queued up in the HID buffer. The bridge now reads on its own thread and writes from a second thread, only when the output changes. Button presses are also time-stamped when the bridge reads them, not when the game's render thread gets to them. Measured on a Bluetooth DualSense: median lag went from 34 ms to under 1 ms, and the worst case from 124 ms to 13 ms. See [Controller Bridge Protocol](Controller-Bridge-Protocol).

> If you run the bridge yourself (`npm run bridge` / `server/start-bridge.sh`), restart it after updating so the new version is used.

### DualSense not detected?
Turn it on (or plug it in). Then close Steam or DS4Windows, or turn off their PlayStation controller support, because they can take the controller over. **Settings → Controllers → Test controller bridge** shows what the bridge sees. On Linux, check the udev rule in [Installation](Installation#linux-dualsense-permissions).
