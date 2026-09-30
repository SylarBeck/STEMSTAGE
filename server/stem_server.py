"""
STEMSTAGE AI stem splitter.

Runs Meta's Demucs (Hybrid Transformer Demucs, 6-source `htdemucs_6s` by default)
behind a tiny local HTTP API so the browser game can split any song into
drums / bass / guitar / piano / vocals / other.

The browser decodes the audio itself and posts raw float32 PCM, so no ffmpeg is needed.

  GET    /health                    -> model + device info
  POST   /separate                  -> body: float32 LE planar PCM, headers X-Sample-Rate, X-Channels
                                       returns {"job": id}
  GET    /jobs/<id>                 -> {"status", "progress", "message", "sources"}
  GET    /jobs/<id>/stems/<source>  -> int16 LE planar PCM (channels x length)
  DELETE /jobs/<id>                 -> free the job
  POST   /lyrics                    -> body: float32 LE mono PCM @ 16 kHz (the vocal stem) -> {language, words}
  POST   /shutdown                  -> stop the local splitter (launcher control only)

If ../dist exists (after `npm run build`) it is also served at /, so this one
process can host the whole game.
"""
import json
import gc
import mimetypes
import os
import re
import sys
import threading
import time
import traceback
import types
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
import demucs.apply as demucs_apply
from demucs.apply import BagOfModels, apply_model
from demucs.pretrained import get_model

import transcribe
import lyrics

HOST = os.environ.get("STEMSTAGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("STEMSTAGE_PORT", "8765"))
# web pages allowed to call the splitter: the game on this PC (any port) and the desktop app
APP_ORIGIN = re.compile(r"^(https?://(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?|tauri://localhost|https?://tauri\.localhost)$", re.I)
LOOPBACK_HOST = re.compile(r"^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$", re.I)
MAX_AUDIO_BYTES = 20 * 60 * 48000 * 2 * 4  # 20 minutes of 48 kHz stereo float32
MODEL_NAME = os.environ.get("STEMSTAGE_MODEL", "htdemucs_6s")
SHIFTS = int(os.environ.get("STEMSTAGE_SHIFTS", "1"))
DIST_DIR = (Path(__file__).resolve().parent.parent / "dist")
JOB_TTL_SECONDS = 15 * 60
MODEL_IDLE_SECONDS = max(30, int(os.environ.get("STEMSTAGE_MODEL_IDLE_SECONDS", "180")))

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
GPU_NAME = torch.cuda.get_device_name(0) if DEVICE == "cuda" else None

_model = None
_model_used_at = None
_model_lock = threading.Lock()
_work_lock = threading.Lock()
_jobs = {}
_jobs_lock = threading.Lock()


def log(*args):
    print(time.strftime("[%H:%M:%S]"), *args, flush=True)


def load_model():
    global _model, _model_used_at
    with _model_lock:
        if _model is None:
            log(f"Loading {MODEL_NAME} on {DEVICE}...")
            m = get_model(MODEL_NAME)
            m.eval()
            _model = m
            log(f"Model ready. Sources: {list(m.sources)}")
        _model_used_at = time.monotonic()
    return _model


class _ProgressHook:
    """Stands in for the `tqdm` module inside demucs.apply so we can report progress."""

    job = None
    passes_total = 1
    pass_index = 0

    @classmethod
    def tqdm(cls, iterable, **_kwargs):
        items = list(iterable)
        n = max(1, len(items))
        this_pass = cls.pass_index
        cls.pass_index += 1
        for i, item in enumerate(items):
            yield item
            job = cls.job
            if job is not None:
                frac = (this_pass + (i + 1) / n) / cls.passes_total
                job["progress"] = min(0.9, frac * 0.9)


demucs_apply.tqdm = types.SimpleNamespace(tqdm=_ProgressHook.tqdm)


def run_job(job_id, audio, sample_rate):
    global _model_used_at
    job = _jobs[job_id]
    try:
        with _work_lock:
            job["status"] = "loading"
            job["message"] = f"Loading {MODEL_NAME}"
            model = load_model()
            if sample_rate != model.samplerate:
                raise ValueError(f"Expected {model.samplerate} Hz audio, got {sample_rate}")

            wav = torch.from_numpy(audio)
            if wav.shape[0] == 1:
                wav = wav.repeat(2, 1)
            wav = wav[:2]

            ref = wav.mean(0)
            mean, std = ref.mean(), ref.std() + 1e-8
            wav = (wav - mean) / std

            job["status"] = "running"
            job["message"] = f"Separating with {MODEL_NAME} on {GPU_NAME or 'CPU'}"
            _ProgressHook.job = job
            _ProgressHook.pass_index = 0
            n_models = len(model.models) if isinstance(model, BagOfModels) else 1
            _ProgressHook.passes_total = n_models * max(1, SHIFTS)

            t0 = time.time()
            with torch.inference_mode():
                out = apply_model(model, wav[None], device=DEVICE, shifts=SHIFTS,
                                  split=True, overlap=0.25, progress=True, num_workers=0)[0]
            out = out * std + mean
            elapsed = time.time() - t0
            _ProgressHook.job = None

            stems = {}
            floats = {}
            for idx, name in enumerate(model.sources):
                src = out[idx].clamp(-1, 1)
                pcm = src.mul(32767).round().to(torch.int16).cpu().numpy()
                stems[name] = np.ascontiguousarray(pcm).tobytes()
                floats[name] = src.float().cpu().numpy()

            if DEVICE == "cuda":
                torch.cuda.empty_cache()

            # neural note transcription of the melodic stems (basic-pitch)
            notes = {}
            if transcribe.available():
                t1 = time.time()
                job["message"] = "Transcribing notes (basic-pitch)"

                def tp(frac, name):
                    job["progress"] = min(0.995, 0.9 + 0.09 * frac)
                    job["message"] = f"Transcribed {name}"

                job["progress"] = 0.9
                try:
                    notes = transcribe.transcribe_stems(floats, sample_rate, tp)
                    log(f"Job {job_id[:8]} transcribed {sum(len(v) for v in notes.values())} notes in {time.time() - t1:.1f}s")
                except Exception:
                    traceback.print_exc()
            del floats

            job["stems"] = stems
            job["notes"] = notes
            job["sources"] = list(model.sources)
            job["channels"] = int(out.shape[1])
            job["length"] = int(out.shape[2])
            job["progress"] = 1.0
            job["status"] = "done"
            job["message"] = f"Separated in {elapsed:.1f}s" + (" + transcribed" if notes else "")
            log(f"Job {job_id[:8]} done in {elapsed:.1f}s ({audio.shape[1] / sample_rate:.0f}s of audio)")
            _model_used_at = time.monotonic()
    except Exception as exc:  # report to client instead of dying
        traceback.print_exc()
        job["status"] = "error"
        job["message"] = str(exc)
        _ProgressHook.job = None
        _model_used_at = time.monotonic()


def reap_jobs():
    global _model, _model_used_at
    while True:
        time.sleep(30)
        now = time.time()
        with _jobs_lock:
            for jid in [j for j, v in _jobs.items() if now - v["created"] > JOB_TTL_SECONDS]:
                del _jobs[jid]
        models_loaded = _model is not None or transcribe._model is not None or lyrics._model is not None
        if models_loaded and _model_used_at is not None and time.monotonic() - _model_used_at >= MODEL_IDLE_SECONDS:
            if _work_lock.acquire(blocking=False):
                try:
                    with _model_lock:
                        if time.monotonic() - _model_used_at >= MODEL_IDLE_SECONDS:
                            _model = None
                            with transcribe._lock:
                                transcribe._model = None
                            with lyrics._lock:
                                lyrics._model = None
                            gc.collect()
                            if DEVICE == "cuda":
                                torch.cuda.empty_cache()
                            log("Idle AI models unloaded")
                finally:
                    _work_lock.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "StemstageAI/1.0"

    def log_message(self, fmt, *args):
        if "/jobs/" in self.path and self.command == "GET" and "/stems/" not in self.path:
            return  # progress polling is noisy
        log(self.address_string(), fmt % args)

    def _cors(self):
        # the game (http://127.0.0.1:5173 or the desktop app) is the only web page that may use the splitter
        origin = self.headers.get("Origin")
        if origin and APP_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sample-Rate, X-Channels")

    def _refused(self):
        """Why a request can't use the splitter ('' = it can): a page from another site, or a DNS-rebinding
        host name while the splitter only listens on this PC. Programs that aren't browsers send no Origin."""
        origin = self.headers.get("Origin")
        if origin is not None:
            if not APP_ORIGIN.match(origin):
                return "cross-site request"
        elif self.headers.get("Sec-Fetch-Site") == "cross-site":
            return "cross-site request"  # an <img>/<script>/link from another site
        if HOST in ("127.0.0.1", "localhost", "::1") and not LOOPBACK_HOST.match(self.headers.get("Host", "")):
            return "unexpected Host"
        return ""

    def _body(self, limit):
        n = int(self.headers.get("Content-Length", "0"))
        if n < 0 or n > limit:
            raise ValueError(f"body too large ({n} bytes)")
        return self.rfile.read(n)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        why = self._refused()
        if why and parts != ["health"]:
            return self._json({"error": why}, 403)
        if parts == ["health"]:
            return self._json({
                "ok": True,
                "service": "stemstage-ai",
                "model": MODEL_NAME,
                "device": DEVICE,
                "gpu": GPU_NAME,
                "loaded": _model is not None,
                "sources": list(_model.sources) if _model is not None else None,
                "transcriber": "basic-pitch" if transcribe.available() else None,
                "transcriberReady": transcribe._model is not None,
                "lyrics": ("faster-whisper " + lyrics.MODEL_NAME) if lyrics.available() else None,
            })
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "notes":
            job = _jobs.get(parts[1])
            if not job or job.get("status") != "done":
                return self._json({"error": "not ready"}, 404)
            return self._json({"notes": job.get("notes") or {}})
        if len(parts) == 2 and parts[0] == "jobs":
            job = _jobs.get(parts[1])
            if not job:
                return self._json({"error": "unknown job"}, 404)
            return self._json({k: job.get(k) for k in
                               ("status", "progress", "message", "sources", "channels", "length")})
        if len(parts) == 4 and parts[0] == "jobs" and parts[2] == "stems":
            job = _jobs.get(parts[1])
            if not job or job.get("status") != "done":
                return self._json({"error": "stem not ready"}, 404)
            data = job["stems"].get(parts[3])
            if data is None:
                return self._json({"error": "unknown stem"}, 404)
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return self._static(parts)

    def _static(self, parts):
        if not DIST_DIR.exists():
            return self._json({"error": "not found"}, 404)
        target = (DIST_DIR / "/".join(parts)).resolve() if parts else DIST_DIR / "index.html"
        if DIST_DIR not in target.parents and target != DIST_DIR / "index.html":
            return self._json({"error": "not found"}, 404)
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            target = DIST_DIR / "index.html"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        route = self.path.split("?")[0].rstrip("/")
        why = self._refused()
        if why:
            return self._json({"error": why}, 403)
        if route == "/shutdown":
            # Browser pages cannot stop the service. The desktop launcher checks /health first.
            if self.headers.get("Origin") is not None or self.headers.get("X-STEMSTAGE-Control") != "shutdown":
                return self._json({"error": "launcher request required"}, 403)
            self._json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if route == "/transcribe":
            return self._transcribe()
        if route == "/lyrics":
            return self._lyrics()
        if route != "/separate":
            return self._json({"error": "not found"}, 404)
        try:
            sr = int(self.headers.get("X-Sample-Rate", "44100"))
            ch = int(self.headers.get("X-Channels", "2"))
            if not (8000 <= sr <= 192000 and 1 <= ch <= 8):
                raise ValueError("bad sample rate / channels")
            raw = self._body(MAX_AUDIO_BYTES)
            audio = np.frombuffer(raw, dtype="<f4").reshape(ch, -1).copy()
        except Exception as exc:
            return self._json({"error": f"bad audio payload: {exc}"}, 400)

        job_id = uuid.uuid4().hex
        with _jobs_lock:
            _jobs[job_id] = {"status": "queued", "progress": 0.0, "message": "Queued",
                             "created": time.time()}
        threading.Thread(target=run_job, args=(job_id, audio, sr), daemon=True).start()
        log(f"Job {job_id[:8]} queued: {audio.shape[1] / sr:.1f}s, {ch}ch @ {sr}Hz")
        return self._json({"job": job_id})

    def _transcribe(self):
        """POST /transcribe?stem=<name>  body: float32 LE mono PCM, header X-Sample-Rate -> {notes}"""
        global _model_used_at
        if not transcribe.available():
            return self._json({"error": "basic-pitch is not installed"}, 501)
        try:
            query = dict(p.split("=", 1) for p in self.path.split("?", 1)[1].split("&") if "=" in p) if "?" in self.path else {}
            stem = query.get("stem", "other")
            sr = int(self.headers.get("X-Sample-Rate", "22050"))
            if not 8000 <= sr <= 192000:
                raise ValueError("bad sample rate")
            mono = np.frombuffer(self._body(MAX_AUDIO_BYTES), dtype="<f4").copy()
        except Exception as exc:
            return self._json({"error": f"bad payload: {exc}"}, 400)
        try:
            with _work_lock:
                _model_used_at = time.monotonic()
                transcribe.load()
                t0 = time.time()
                notes = transcribe.transcribe_array(mono, sr, stem)
                _model_used_at = time.monotonic()
            log(f"Transcribed {stem}: {len(notes)} notes from {mono.size / sr:.0f}s in {time.time() - t0:.1f}s")
            return self._json({"notes": notes})
        except Exception as exc:
            traceback.print_exc()
            return self._json({"error": str(exc)}, 500)

    def _lyrics(self):
        """POST /lyrics  body: float32 LE mono PCM at 16 kHz -> {language, words: [{t, e, w}]}"""
        global _model_used_at
        if not lyrics.available():
            return self._json({"error": "faster-whisper is not installed (npm run ai:setup)"}, 501)
        try:
            mono = np.frombuffer(self._body(MAX_AUDIO_BYTES), dtype="<f4").copy()
        except Exception as exc:
            return self._json({"error": f"bad payload: {exc}"}, 400)
        try:
            with _work_lock:
                _model_used_at = time.monotonic()
                t0 = time.time()
                out = lyrics.transcribe_array(mono)
                _model_used_at = time.monotonic()
            log(f"Lyrics: {len(out['words'])} words ({out['language']}) from {mono.size / 16000:.0f}s in {time.time() - t0:.1f}s")
            return self._json(out)
        except Exception as exc:
            traceback.print_exc()
            return self._json({"error": str(exc)}, 500)

    def do_DELETE(self):
        parts = [p for p in self.path.split("/") if p]
        why = self._refused()
        if why:
            return self._json({"error": why}, 403)
        if len(parts) == 2 and parts[0] == "jobs":
            with _jobs_lock:
                _jobs.pop(parts[1], None)
        return self._json({"ok": True})


def main():
    log(f"STEMSTAGE AI splitter on http://{HOST}:{PORT}  (model={MODEL_NAME}, device={DEVICE}"
        + (f", gpu={GPU_NAME}" if GPU_NAME else "") + ")")
    class Server(ThreadingHTTPServer):
        # On Windows SO_REUSEADDR lets a second process bind the same port; we want "already running" instead.
        allow_reuse_address = sys.platform != "win32"
        daemon_threads = True

    try:
        httpd = Server((HOST, PORT), Handler)
    except OSError:
        log(f"Port {PORT} is already in use - the AI splitter is probably already running. Nothing to do.")
        return
    threading.Thread(target=reap_jobs, daemon=True).start()
    # Loading at app startup can keep gigabytes in RAM before the player imports a song.
    # Setup downloads the weights; load them on the first job unless explicitly asked to warm.
    if "--warm" in sys.argv:
        def warm():
            load_model()
            if transcribe.available():
                log("Loading basic-pitch note transcriber...")
                transcribe.load()
                log("Transcriber ready" if transcribe._model is not None else f"Transcriber unavailable: {transcribe._error}")
        threading.Thread(target=warm, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
