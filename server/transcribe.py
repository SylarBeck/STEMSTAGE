"""
Neural note transcription for separated stems, using Spotify's basic-pitch
(https://github.com/spotify/basic-pitch) through its bundled ONNX model.

Returns note events [start_s, end_s, midi_pitch, amplitude] per stem. The game's
charter turns them into playable notes, and uses every stem's events to work out
which instrument really played each note (so bleed between stems isn't charted).
"""
import logging
import os
import tempfile
import threading

import numpy as np

logging.getLogger().setLevel(logging.ERROR)  # basic-pitch warns about backends we don't use

# per-source settings: frequency range, thresholds, minimum note length (ms)
SETTINGS = {
    "bass":   dict(minimum_frequency=30, maximum_frequency=420, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=90),
    "guitar": dict(minimum_frequency=70, maximum_frequency=1500, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=80),
    "piano":  dict(minimum_frequency=27, maximum_frequency=4200, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=80),
    "vocals": dict(minimum_frequency=70, maximum_frequency=1100, onset_threshold=0.55, frame_threshold=0.35, minimum_note_length=110),
    "other":  dict(minimum_frequency=40, maximum_frequency=4000, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=90),
}
ALIASES = {"keys": "piano"}

_model = None
_lock = threading.Lock()
_error = None


def available():
    try:
        import basic_pitch  # noqa: F401
        import onnxruntime  # noqa: F401
        return True
    except Exception:
        return False


def load():
    """Load the basic-pitch model once (also warms up numba-compiled helpers)."""
    global _model, _error
    with _lock:
        if _model is None and _error is None:
            try:
                from basic_pitch import ICASSP_2022_MODEL_PATH
                from basic_pitch.inference import Model
                _model = Model(ICASSP_2022_MODEL_PATH)
                transcribe_array(np.zeros(22050, dtype=np.float32), 22050, "guitar")  # warm-up
            except Exception as exc:  # keep the splitter usable without transcription
                _error = str(exc)
    return _model


def transcribe_array(mono, sample_rate, source):
    """mono: float32 1-D array. Returns [[start, end, pitch, amplitude], ...] sorted by start."""
    from basic_pitch.inference import predict
    import soundfile as sf

    model = _model
    if model is None:
        raise RuntimeError(_error or "transcriber not loaded")
    cfg = SETTINGS.get(ALIASES.get(source, source), SETTINGS["other"])
    mono = np.asarray(mono, dtype=np.float32)
    if mono.size < sample_rate // 4 or float(np.sqrt(np.mean(mono ** 2))) < 1e-4:
        return []
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(path, mono, sample_rate, subtype="FLOAT")
        _, _, events = predict(path, model, melodia_trick=True, **cfg)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    out = [[round(float(s), 4), round(float(e), 4), int(p), round(float(a), 3)] for s, e, p, a, *_ in events]
    out.sort(key=lambda n: (n[0], n[2]))
    return out


def transcribe_stems(stems_float, sample_rate, on_progress=None):
    """stems_float: {name: (channels, n) float32}. Returns {name: events} for melodic sources."""
    if load() is None:
        return {}
    names = [n for n in stems_float if ALIASES.get(n, n) in SETTINGS]
    result = {}
    for i, name in enumerate(names):
        audio = stems_float[name]
        mono = audio.mean(axis=0) if audio.ndim == 2 else audio
        result[name] = transcribe_array(mono, sample_rate, name)
        if on_progress:
            on_progress((i + 1) / len(names), name)
    return result
