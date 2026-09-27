// Real instrument mode: play the part on a real guitar / bass (audio input, monophonic pitch tracking) or a
// real keyboard (MIDI). The chart's transcribed pitches (note.m) are what you have to play: a note counts
// when you play its pitch inside the timing window — octave-free unless "strict" is on. Chords count when
// any of their notes is played on audio (one voice), and note by note on MIDI.
import { settings } from '../settings.js';
import { Mic } from '../audio/pitch.js';
import { Player, WINDOWS } from './player.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => (m ? `${NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}` : '—');
let sharedInput = null;

export class RealPlayer extends Player {
  constructor(session, index, cfg, highway, hud) {
    super(session, index, { ...cfg, strum: false }, highway, hud);
    this.real = cfg.real; // 'audio' | 'midi'
    this.strict = cfg.realStrict ?? settings.realStrict;
    this.held = new Map(); // MIDI note -> true while the key is down
    this.pitch = 0; this.level = 0;
    this.lastOnset = -1; this.prevPitch = 0; this.stable = 0; this.rmsHist = [];
    this.lag = Math.max(0.02, Math.min(0.2, settings.instrumentLatency ?? 0.07)); // input + analysis latency, learned from hits
  }

  setup(song, startTime = 0) {
    super.setup(song, startTime);
    this.strip = document.createElement('div');
    this.strip.className = 'real-strip';
    document.getElementById('hud').appendChild(this.strip);
    this.stripKey = '';
    if (this.replayer) return;
    if (this.real === 'midi') {
      this.offMidi = this.s.input.onMidiNote((ev) => {
        if (ev.on) this.held.set(ev.note, true); else this.held.delete(ev.note);
        if (ev.on && !this.s.paused && !this.s.finished) {
          const t = this.s.engine.timeAt(ev.t);
          this.recorder?.events.push([Math.round(t * 1e4) / 1e4, 'n', ev.note]);
          this.noteOn(ev.note, t);
        }
      });
    } else {
      sharedInput ||= new Mic(this.s.engine.ctx);
      sharedInput.start(settings.instrumentInput || '', { raw: true, lowHz: this.inst === 'bass' ? 38 : 70 })
        .catch((e) => { this.hud.callout('No instrument input — check Settings → Real instruments', '#ff3b3b'); console.warn(e); });
    }
  }

  dispose() {
    this.offMidi?.();
    this.strip?.remove();
    this.strip = null;
    if (this.real === 'audio' && !this.replayer) { sharedInput?.stop(); settings.instrumentLatency = Math.round(this.lag * 1000) / 1000; }
  }

  // controllers still pause and trigger overdrive; notes come from the instrument
  handle(ev, t) {
    if (ev.type === 'od') this.activateOD();
    else if (ev.type === 'realnote') this.noteOn(ev.note, t);
  }

  matches(target, played) {
    const d = played - target;
    if (this.strict) return Math.abs(d) <= 0.6;
    return Math.abs(((((d % 12) + 18) % 12) - 6)) <= 0.6;
  }

  /** A played note: hit the closest chart note with that pitch inside the window. */
  noteOn(midi, t) {
    if (this.failed) return;
    let best = null;
    for (let k = 0; k < this.notes.length; k++) {
      const n = this.notes[k];
      if (n.t - t > WINDOWS.good) break;
      if (n.judged || t - n.t > WINDOWS.good) continue;
      if (this.matches(n.m, midi) && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n;
    }
    if (best) {
      this.hit(best, t - best.t);
      if (this.real === 'audio' && !this.replayer) this.lag = Math.max(0.02, Math.min(0.2, this.lag + (t - best.t) * 0.15)); // drift toward on-time
      // one voice on audio: the rest of the chord counts with it
      if (this.real === 'audio') for (const n of best.group.notes) if (!n.judged) this.hit(n, t - n.t);
      return;
    }
    // a wrong note near an upcoming one breaks the streak (like a ghost tap)
    if (this.rules.ghostPenalty && this.notes.some((n) => !n.judged && Math.abs(n.t - t) < 0.2)) this._breakStreak(2);
  }

  /** Sustains: held while the key is down (MIDI) or the pitch keeps sounding (audio). */
  isHeld(lane) {
    if (this.rules.autoSustain) return true;
    for (const n of this.activeSus) {
      if (n.lane !== lane) continue;
      if (this.real === 'midi') return [...this.held.keys()].some((k) => this.matches(n.m, k));
      return this.pitch > 0 && this.matches(n.m, this.pitch);
    }
    return false;
  }

  update(t, dt, bl, frame) {
    const live = !frame.finished && !this.failed && !this.s.paused;
    if (this.replayer) { this.pitch = this.replayer.pitch || 0; }
    else if (this.real === 'audio' && sharedInput?.active) {
      const { midi, level, rms } = sharedInput.read();
      this.pitch = midi; this.level = level;
      // onsets: a pluck (level jump) or a new pitch that holds for two frames
      const te = t - this.lag;
      // A pluck (level jump) sets the note's time; its pitch is read once it holds for two frames after the
      // pluck (the analysis window still holds the previous note at the moment of the pluck). A new stable
      // pitch without a pluck is an onset too (legato, hammer-ons, slides).
      // pluck: clearly louder than the quietest of the last few frames (uncapped, so a re-pluck of a ringing string counts)
      const floor = this.rmsHist.length ? Math.min(...this.rmsHist) : rms;
      const jump = rms > floor * 1.6 + 0.008;
      this.rmsHist.push(rms);
      if (this.rmsHist.length > 4) this.rmsHist.shift();
      if (jump && te - this.lastOnset > 0.06) { this.pending = te; this.cand = 0; this.stable = 0; }
      if (!midi) { this.cand = 0; this.stable = 0; }
      else if (this.cand && Math.abs(midi - this.cand) <= 0.7) this.stable++;
      else { this.cand = midi; this.stable = 1; }
      if (this.stable === 2) {
        const pluck = this.pending != null && te - this.pending < 0.25;
        const legato = !pluck && Math.abs(this.cand - this.prevPitch) > 0.7;
        if (live && (pluck || legato)) {
          const at = pluck ? this.pending : te - 0.035;
          this.lastOnset = at;
          this.recorder?.events.push([Math.round(at * 1e4) / 1e4, 'n', Math.round(this.cand * 10) / 10]);
          this.noteOn(this.cand, at);
        }
        this.pending = null;
        this.prevPitch = this.cand;
      }
      if (!midi && this.pending == null) this.prevPitch = 0; // silence: the same note plucked again is new
      const v = midi ? Math.round(midi * 10) / 10 : 0;
      if (this.recorder && live && v !== this.lastRecV) { this.recorder.events.push([Math.round(t * 1e4) / 1e4, 'v', v]); this.lastRecV = v; }
    } else if (this.real === 'midi') {
      const keys = [...this.held.keys()];
      this.pitch = keys.length ? Math.max(...keys) : 0;
    }
    super.update(t, dt, bl, frame);
    this._strip(t);
  }

  /** "NEXT  E2  G2  A2 · YOU  A2" under the judgement text. */
  _strip(t) {
    if (!this.strip) return;
    const next = [];
    for (const n of this.notes) {
      if (n.judged || n.t < t - 0.05) continue;
      if (next.length && Math.abs(next[next.length - 1].t - n.t) < 1e-3) continue; // one name per chord
      next.push(n);
      if (next.length >= 4) break;
    }
    const key = next.map((n) => n.m).join(',') + '|' + (this.pitch ? Math.round(this.pitch) : 0);
    if (key === this.stripKey) return;
    this.stripKey = key;
    const you = this.pitch ? noteName(this.pitch) : '—';
    const ok = next[0] && this.pitch && this.matches(next[0].m, this.pitch);
    this.strip.innerHTML = `<span class="rs-k">NEXT</span>${next.map((n, i) => `<b class="${i === 0 ? 'first' : ''}">${noteName(n.m)}</b>`).join('')}<span class="rs-k">YOU</span><b class="you ${ok ? 'ok' : ''}">${you}</b>`;
  }

  result() { return { ...super.result(), real: this.real }; }
}
