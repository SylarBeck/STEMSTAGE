"""STEMSTAGE controller bridge.

Talks to DualSense / DualSense Edge controllers natively through pydualsense (hidapi) and exposes
them to the game over a local WebSocket:

    ws://127.0.0.1:8766          JSON messages (see below)
    http://127.0.0.1:8766/health  {"ok": true, "controllers": [...]}

Bridge -> game
    {"t": "devices", "devices": [{"id", "name", "edge", "conn": "usb"|"bt", "battery": [level, state]}]}
    {"t": "s", "d": [{"id", "b": <button bitmask>, "a": [lx, ly, rx, ry], "tr": [l2, r2], "tp": [a0, x0, y0, a1, x1, y1]}]}
        buttons use the W3C "standard gamepad" order: 0 cross 1 circle 2 square 3 triangle 4 L1 5 R1 6 L2 7 R2
        8 create 9 options 10 L3 11 R3 12 up 13 down 14 left 15 right 16 PS 17 touchpad 18 mute
        19/20 Edge Fn L/R 21/22 Edge back paddles L/R; sticks -128..127, triggers 0..255, touch 0..1919 x 0..1079
Game -> bridge
    {"t": "out", "id", "l": [11 bytes], "r": [11 bytes], "rgb": [r, g, b], "leds": <player LED bits>, "motor": [strong, weak]}
        l / r are raw DualSense trigger effects: mode + 10 parameters (0x05 off, 0x21 feedback, 0x25 weapon, 0x26 vibration)
    {"t": "scan"}     look for newly connected controllers now
    {"t": "reset"}    turn every effect off

State messages also carry "ts" per controller: the bridge's clock (ms) when its newest button/trigger change
arrived; "hello" carries "now" on the same clock. The game uses them to time a press by when it happened rather
than by when its (busy, rendering) main thread got round to the message.

Why the bridge also reads input: once a Bluetooth DualSense gets full output reports it switches to its extended
input report, which browsers' Gamepad API can't parse, so the game reads buttons from here instead.

Latency: pydualsense's report thread reads one input report and then writes one output report, in lockstep. Over
Bluetooth a write takes longer than the controller's report interval, so input reports pile up in the HID buffer
and every press reaches the game late (up to ~250 ms once the buffer is full). Pad reads on its own thread and
writes from a second thread, through its own handle, and only when the output actually changed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import threading
import time

import pydualsense as _pds_pkg  # noqa: F401  (adds its bundled hidapi.dll to PATH on Windows)
import hidapi
from pydualsense import pydualsense
from pydualsense.enums import Brightness, ConnectionType, PlayerID, TriggerModes

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

SONY = 0x054C
PRODUCTS = {0x0CE6: "DualSense Wireless Controller", 0x0DF2: "DualSense Edge Wireless Controller"}
log = logging.getLogger("bridge")


class Pad(pydualsense):
    """pydualsense for one specific controller (pydualsense itself always opens the last one it finds)."""

    def __init__(self, info: hidapi.DeviceInfo, on_input=None) -> None:
        self._info = info
        self.path = info.path
        self.on_input = on_input
        self._key = None
        self.input_ts = 0.0  # perf_counter() in ms when the newest button/trigger change arrived
        self._out_wake = threading.Event()
        self._writer = None
        super().__init__()

    def readInput(self, inReport) -> None:  # noqa: N802  (pydualsense's name)
        super().readInput(inReport)
        # wake the WebSocket loop right away when a button or trigger changes, or a stick is pushed past
        # half-way (sticks can be mapped as buttons); not on stick jitter
        s = self.state
        half = lambda v: (v > 64) - (v < -64)  # noqa: E731
        key = (s.cross, s.circle, s.square, s.triangle, s.L1, s.R1, s.L2Btn, s.R2Btn, s.share, s.options, s.L3, s.R3,
               s.DpadUp, s.DpadDown, s.DpadLeft, s.DpadRight, s.ps, s.touchBtn, s.micBtn,
               getattr(s, "L4", 0), getattr(s, "R4", 0), getattr(s, "L5", 0), getattr(s, "R5", 0),
               s.L2_value >> 3, s.R2_value >> 3, half(s.LX), half(s.LY), half(s.RX), half(s.RY))
        if key != self._key:
            self._key = key
            self.input_ts = time.perf_counter() * 1000
            if self.on_input:
                self.on_input()

    # pydualsense.init() calls self.__find_device() -> name-mangled to this
    def _pydualsense__find_device(self):
        # non-blocking handle: every read passes its own timeout, so the report thread can always stop
        return hidapi.Device(path=self._info.path, blocking=False), self._info.product_id == 0x0DF2

    def determineConnectionType(self) -> ConnectionType:
        """Like pydualsense's, but tolerant: a Bluetooth controller in 'simple' mode sends short reports until it
        is asked for its calibration data, which switches it to full reports."""
        asked = False
        deadline = time.time() + 2.0
        while time.time() < deadline:
            r = self.device.read(100, timeout_ms=60)
            n = len(r) if r else 0
            if n == 64:
                self.input_report_length = self.output_report_length = 64
                return ConnectionType.USB
            if n == 78:
                self.input_report_length = self.output_report_length = 78
                return ConnectionType.BT
            if n and not asked:
                asked = True
                try:
                    self.device.get_feature_report(0x05, 41)
                except Exception:  # noqa: BLE001
                    pass
        return ConnectionType.ERROR

    def sendReport(self) -> None:  # noqa: N802  (pydualsense's report thread runs this)
        """Input thread: parse every report the moment it arrives. Output goes out from _write_loop."""
        try:
            self._writer = hidapi.Device(path=self._info.path, blocking=False)
        except Exception:  # noqa: BLE001  (no second handle allowed: share the reading one)
            self._writer = self.device
        threading.Thread(target=self._write_loop, daemon=True).start()
        try:
            while self.ds_thread:
                report = self.device.read(self.input_report_length, timeout_ms=100)
                if report:
                    self.readInput(report)
        except Exception as e:  # noqa: BLE001  (unplugged / out of range: never let the thread die silently)
            log.warning("report loop stopped: %s", e)
        self.connected = False
        self._out_wake.set()

    def _write_loop(self) -> None:
        """Output thread: send the output report when it changed, plus a keep-alive every 2 s. Changes made
        while a write is still in flight go out together in the next report."""
        last, last_at = None, 0.0
        while self.ds_thread and self.connected:
            self._out_wake.wait(0.5)
            self._out_wake.clear()
            if not (self.ds_thread and self.connected):
                break
            report = bytes(self.prepareReport())
            now = time.perf_counter()
            if report == last and now - last_at < 2.0:
                continue
            try:
                self._writer.write(report)
            except Exception as e:  # noqa: BLE001
                log.warning("output to controller failed: %s", e)
                self.connected = False
                break
            last, last_at = report, now
        if self._writer is not None and self._writer is not self.device:
            try:
                self._writer.close()
            except Exception:  # noqa: BLE001
                pass

    def kick(self) -> None:
        """The output state changed: wake the writer."""
        self._out_wake.set()

    # ---------------------------------------------------------------- output helpers
    def apply(self, msg: dict) -> None:
        for side, trig in (("l", self.triggerL), ("r", self.triggerR)):
            fx = msg.get(side)
            if isinstance(fx, list) and len(fx) >= 10:
                b = [max(0, min(255, int(v))) for v in fx[:11]] + [0] * max(0, 11 - len(fx))
                trig.mode = TriggerModes(b[0])
                # pydualsense sends parameters 1-6 and 9 of the 11-byte effect block (see prepareReport)
                trig.forces = [b[1], b[2], b[3], b[4], b[5], b[6], b[9]]
        rgb = msg.get("rgb")
        if isinstance(rgb, list) and len(rgb) == 3:
            self.light.TouchpadColor = tuple(max(0, min(255, int(v))) for v in rgb)
        if "leds" in msg:
            self.light.playerNumber = PlayerID(int(msg["leds"]) & 0x1F)
        motor = msg.get("motor")
        if isinstance(motor, list) and len(motor) == 2:
            self.leftMotor = max(0, min(255, int(motor[0])))
            self.rightMotor = max(0, min(255, int(motor[1])))
        self.kick()

    def reset(self) -> None:
        self.triggerL.mode = TriggerModes.Off
        self.triggerR.mode = TriggerModes.Off
        self.triggerL.forces = [0] * 7
        self.triggerR.forces = [0] * 7
        self.leftMotor = self.rightMotor = 0
        self.light.playerNumber = PlayerID(0)
        self.kick()

    # ---------------------------------------------------------------- input snapshot
    def snapshot(self) -> dict | None:
        s = self.state
        st = self.states
        if st is None:
            return None
        bits = 0
        for i, on in enumerate((
            s.cross, s.circle, s.square, s.triangle, s.L1, s.R1,
            s.L2Btn or s.L2_value > 30, s.R2Btn or s.R2_value > 30, s.share, s.options, s.L3, s.R3,
            s.DpadUp, s.DpadDown, s.DpadLeft, s.DpadRight, s.ps, s.touchBtn, s.micBtn,
            getattr(s, "L4", False), getattr(s, "R4", False), getattr(s, "L5", False), getattr(s, "R5", False),
        )):
            if on:
                bits |= 1 << i
        tp = [0, 0, 0, 0, 0, 0]
        if len(st) > 41:  # touch points at common report offset 32 (states[] starts one byte before it)
            for k in range(2):
                o = 33 + k * 4
                tp[k * 3] = 0 if st[o] & 0x80 else 1
                tp[k * 3 + 1] = st[o + 1] | ((st[o + 2] & 0x0F) << 8)
                tp[k * 3 + 2] = (st[o + 2] >> 4) | (st[o + 3] << 4)
        return {"id": self.path_id, "b": bits, "a": [s.LX, s.LY, s.RX, s.RY], "tr": [s.L2_value, s.R2_value], "tp": tp,
                "ts": round(self.input_ts, 2)}

    @property
    def path_id(self) -> str:
        return self._info.path.decode("utf-8", "replace") if isinstance(self._info.path, bytes) else str(self._info.path)

    def describe(self) -> dict:
        bat = getattr(self, "battery", None)
        return {
            "id": self.path_id,
            "name": PRODUCTS.get(self._info.product_id, "DualSense"),
            "edge": self._info.product_id == 0x0DF2,
            "conn": "bt" if self.conType == ConnectionType.BT else "usb",
            "battery": [getattr(bat, "Level", 0), int(getattr(bat, "State", 0))] if bat else None,
        }


class Bridge:
    def __init__(self) -> None:
        self.pads: dict[bytes, Pad] = {}
        self.failed: dict[bytes, float] = {}
        self.lock = threading.Lock()
        self.clients: set = set()
        self.devices_version = 0
        self.scan_now = threading.Event()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.wake: asyncio.Event | None = None

    def input_changed(self) -> None:
        """Called from a pad's report thread."""
        if self.loop and self.wake:
            self.loop.call_soon_threadsafe(self.wake.set)

    # ---------------------------------------------------------------- device discovery (thread)
    def scan_loop(self) -> None:
        while True:
            try:
                self.scan()
            except Exception as e:  # noqa: BLE001
                log.warning("scan failed: %s", e)
            self.scan_now.wait(2.0)
            self.scan_now.clear()

    def scan(self) -> None:
        now = time.time()
        infos = [d for d in hidapi.enumerate(vendor_id=SONY) if d.product_id in PRODUCTS]
        present = {d.path for d in infos}
        changed = False
        with self.lock:
            for path, pad in list(self.pads.items()):
                if not pad.connected or path not in present:
                    log.info("controller gone: %s", pad.describe()["name"])
                    try:
                        pad.ds_thread = False
                        pad.device.close()
                    except Exception:  # noqa: BLE001
                        pass
                    del self.pads[path]
                    self.failed[path] = now
                    changed = True
        for info in infos:
            if info.path in self.pads or now - self.failed.get(info.path, 0) < 4:
                continue
            pad = Pad(info, self.input_changed)
            try:
                pad.init()  # opens the device, detects USB/Bluetooth, starts pydualsense's report thread
            except Exception as e:  # noqa: BLE001  (paired but switched off, or in use elsewhere)
                self.failed[info.path] = now
                try:
                    pad.device.close()
                except Exception:  # noqa: BLE001
                    pass
                log.debug("not available: %s (%s)", info.path, e)
                continue
            pad.light.setBrightness(Brightness.high)
            pad.light.TouchpadColor = (255, 45, 122)
            pad.kick()
            with self.lock:
                self.pads[info.path] = pad
            d = pad.describe()
            log.info("controller connected: %s over %s", d["name"], d["conn"].upper())
            changed = True
        if changed:
            self.devices_version += 1

    def devices(self) -> list[dict]:
        with self.lock:
            return [p.describe() for p in self.pads.values() if p.connected]

    def find(self, pad_id: str) -> Pad | None:
        with self.lock:
            for p in self.pads.values():
                if p.path_id == pad_id:
                    return p
        return None

    def shutdown(self) -> None:
        with self.lock:
            for p in self.pads.values():
                try:
                    p.reset()
                    p.light.TouchpadColor = (0, 0, 64)
                    p.kick()
                    time.sleep(0.05)
                    p.close()
                except Exception:  # noqa: BLE001
                    pass

    # ---------------------------------------------------------------- websocket
    async def handler(self, ws) -> None:
        self.clients.add(ws)
        await ws.send(json.dumps({"t": "hello", "version": 2, "now": round(time.perf_counter() * 1000, 2), "devices": self.devices()}))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                t = msg.get("t")
                if t == "out":
                    pad = self.find(str(msg.get("id", "")))
                    if pad:
                        pad.apply(msg)
                elif t == "scan":
                    self.failed.clear()
                    self.scan_now.set()
                elif t == "reset":
                    with self.lock:
                        for p in self.pads.values():
                            p.reset()
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(ws)
            if not self.clients:  # the game went away: don't leave triggers stiff or motors running
                with self.lock:
                    for p in self.pads.values():
                        p.reset()

    async def broadcast_loop(self) -> None:
        last, last_sent, sent_version = None, 0.0, -1
        self.loop = asyncio.get_running_loop()
        self.wake = asyncio.Event()
        while True:
            # buttons/triggers push immediately (woken by the report thread); sticks/touch at ~60 Hz
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=0.016)
            except asyncio.TimeoutError:
                pass
            self.wake.clear()
            if not self.clients:
                continue
            if self.devices_version != sent_version:
                sent_version = self.devices_version
                await self._send_all(json.dumps({"t": "devices", "devices": self.devices()}))
            with self.lock:
                snaps = [s for s in (p.snapshot() for p in self.pads.values() if p.connected) if s]
            payload = json.dumps({"t": "s", "d": snaps}, separators=(",", ":"))
            now = time.time()
            if payload != last or now - last_sent > 0.25:
                last, last_sent = payload, now
                # "now": send time on the bridge clock, so the game can map "ts" onto its own clock
                await self._send_all(payload[:-1] + f',"now":{time.perf_counter() * 1000:.2f}}}')
            # battery / connection changes ride along with the device list every few seconds
            if int(now) % 5 == 0 and now - getattr(self, "_bat_at", 0) > 4.5:
                self._bat_at = now
                await self._send_all(json.dumps({"t": "devices", "devices": self.devices()}))

    async def _send_all(self, text: str) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(text)
            except ConnectionClosed:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def process_request(self, connection, request):
        if request.path.startswith("/health"):
            body = json.dumps({"ok": True, "service": "stemstage-controller-bridge", "controllers": self.devices()})
            resp = connection.respond(200, body)
            resp.headers["Content-Type"] = "application/json"
            resp.headers["Access-Control-Allow-Origin"] = "*"
            return resp
        return None


async def main_async(host: str, port: int) -> None:
    bridge = Bridge()
    threading.Thread(target=bridge.scan_loop, daemon=True).start()
    try:
        async with serve(bridge.handler, host, port, process_request=bridge.process_request, max_size=64 * 1024):
            log.info("STEMSTAGE controller bridge on ws://%s:%d (pydualsense)", host, port)
            await bridge.broadcast_loop()
    finally:
        bridge.shutdown()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(format="%(asctime)s %(message)s", level=logging.DEBUG if args.verbose else logging.INFO, force=True)
    if sys.platform == "win32":
        try:  # 1 ms timer resolution: asyncio timeouts otherwise round up to ~15.6 ms on Windows
            import ctypes
            ctypes.windll.winmm.timeBeginPeriod(1)
        except Exception:  # noqa: BLE001
            pass
    try:
        asyncio.run(main_async(args.host, args.port))
    except OSError as e:
        if getattr(e, "errno", None) in (10048, 98) or "address already in use" in str(e).lower():
            print(f"Port {args.port} is already in use - the controller bridge is probably already running.")
            sys.exit(0)
        raise
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
