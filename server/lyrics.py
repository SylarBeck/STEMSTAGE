"""
Lyrics for singing mode: faster-whisper (OpenAI Whisper, CTranslate2) on the isolated vocal stem,
with word timestamps. Optional — the AI server works without it.

  available()                 -> bool (faster-whisper importable)
  transcribe_array(mono16k)   -> {"language": "en", "words": [{"t": start, "e": end, "w": "word"}]}

Model: STEMSTAGE_WHISPER (default "small", multilingual). It is downloaded from Hugging Face on
first use (~480 MB for "small") and cached in the user's Hugging Face cache.
"""
import os
import threading

MODEL_NAME = os.environ.get("STEMSTAGE_WHISPER", "small")
_model = None
_error = None
_lock = threading.Lock()


def available():
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def load():
    global _model, _error
    with _lock:
        if _model is not None or not available():
            return _model
        try:
            from faster_whisper import WhisperModel
            try:
                import torch
                cuda = torch.cuda.is_available()
            except Exception:
                cuda = False
            _model = WhisperModel(MODEL_NAME, device="cuda" if cuda else "cpu", compute_type="float16" if cuda else "int8")
        except Exception as exc:  # e.g. CUDA libraries missing -> CPU
            try:
                from faster_whisper import WhisperModel
                _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
            except Exception as exc2:
                _error = f"{exc}; {exc2}"
    return _model


def transcribe_array(mono, language=None):
    """mono: float32 numpy array at 16 kHz."""
    model = load()
    if model is None:
        raise RuntimeError(_error or "faster-whisper is not installed")
    segments, info = model.transcribe(
        mono, language=language or None, word_timestamps=True, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400}, condition_on_previous_text=False, beam_size=5,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text or w.probability < 0.2:
                continue
            words.append({"t": round(float(w.start), 3), "e": round(float(w.end), 3), "w": text})
    return {"language": info.language, "words": words}
