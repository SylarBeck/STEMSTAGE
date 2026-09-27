# Controller Bridge Protocol

`server/controller_bridge.py` talks to DualSense / DualSense Edge controllers through [pydualsense](https://github.com/flok/pydualsense) (hidapi) and exposes them to the game over a local WebSocket. The game client is `src/input/dualsense.js`.

```
ws://127.0.0.1:8766           JSON messages
http://127.0.0.1:8766/health  {"ok": true, "controllers": [...]}
```

Why the bridge also reads input: once a Bluetooth DualSense receives full output reports (needed for triggers and haptics), it switches to an extended input report that browsers' Gamepad API can't parse. So the game reads buttons from the bridge, and every bridged controller appears as a virtual standard gamepad (index 16+).

## Messages

**Bridge → game**

| Message | |
|---|---|
| `{"t":"hello","version":2,"now":<ms>,"devices":[...]}` | On connect |
| `{"t":"devices","devices":[{"id","name","edge","conn":"usb"\|"bt","battery":[level,state]}]}` | When the list changes, and every ~5 s (battery) |
| `{"t":"s","d":[{"id","b","a","tr","tp","ts"}],"now":<ms>}` | State: on every button/trigger change, and at ~60 Hz for sticks/touch (≥ every 250 ms as a heartbeat) |

State fields: `b` is a button bitmask in W3C standard-gamepad order (0 ✕, 1 ◯, 2 ▢, 3 △, 4 L1, 5 R1, 6 L2, 7 R2, 8 create, 9 options, 10 L3, 11 R3, 12–15 d-pad, 16 PS, 17 touchpad, 18 mute, 19/20 Edge Fn, 21/22 Edge paddles). `a` is the sticks (−128..127), `tr` is L2/R2 travel (0..255), and `tp` is two touch points `[active, x, y]` (0..1919 × 0..1079).

**`ts` and `now`** are the bridge's clock (`time.perf_counter()` in ms). `ts` is when the newest button/trigger change (or a stick crossing half-way) was read, and `now` is when the message was sent. The game maps them onto `performance.now()`: the smallest `arrival − now` seen in a 4-second window is the clock offset (the quickest delivery waited least in the render thread's queue). A press is then time-stamped `ts + offset`, clamped to at most 100 ms in the past. So judging uses when you pressed, not when the busy main thread got to the message.

**Game → bridge**

| Message | |
|---|---|
| `{"t":"out","id","l":[11],"r":[11],"rgb":[r,g,b],"leds":<bits>,"motor":[strong,weak]}` | Trigger effects (raw DualSense effect blocks: mode + 10 parameters; `0x05` off, `0x21` feedback, `0x25` weapon, `0x26` vibration), lightbar, player LEDs, rumble |
| `{"t":"scan"}` | Look for new controllers now |
| `{"t":"reset"}` | Everything off (also done when the last client disconnects) |

The client sends `out` only when something changed, at most every 8 ms per controller.

## Latency design (1.4.0)

pydualsense's own report thread does `read input report → parse → write output report` in lockstep. Over Bluetooth, a HID write takes longer than the controller's report interval, so input reports pile up in the OS HID buffer (Windows keeps up to 64) and every press is read late. On a Bluetooth DualSense that was 34 ms median and up to 124 ms.

The bridge's `Pad` class replaces that loop:

1. **Input thread** (`sendReport`, the name pydualsense starts): non-blocking handle, `read(timeout=100ms)`, and each report is parsed the moment it arrives. It never waits on a write.
2. **Output thread** (`_write_loop`): its own HID handle. It sleeps until `kick()` is called (by `apply()`/`reset()`), builds the output report and writes it only if it differs from the last one, plus a keep-alive every 2 s. Changes made while a write is in flight go out together in the next report.
3. **Wake-up:** when a button, trigger or stick-half-way state changes, the input thread wakes the asyncio loop (`call_soon_threadsafe`), which sends a state message right away instead of on the next 16 ms tick.

Result on the same controller: 555 reports/s handled (was 157), median 0.5 ms and worst 13 ms behind the controller's own clock (was 34 / 124 ms). The benchmark reads the DualSense's sensor timestamp from the input report and compares it with arrival time.
