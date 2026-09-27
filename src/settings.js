const KEY = 'stemstage.settings.v1';

export const DEFAULTS = {
  noteSpeed: 6,          // 1..10
  noFail: true,
  ghostPenalty: true,
  leftyFlip: false,
  ghost: 'best',         // off | best (your best run) | top (best run on this PC) — solo ghost race
  audioOffset: 0,        // ms, positive = audio heard later
  masterVolume: 0.9,
  bandVolume: 0.85,
  playerVolume: 1.0,
  sfxVolume: 0.6,
  crowdVolume: 0.35,
  menuMusic: 'demo',     // off | demo | shuffle (random song from your setlist)
  menuMusicVolume: 0.35,
  quality: 'high',       // low | high | ultra
  bloom: true,
  cameraShake: true,
  fullscreen: true,      // start fullscreen (desktop app + browser)
  triggerIntensity: 1.0, // 0..1.5
  rumbleIntensity: 1.0,  // 0..1.5
  lightbar: true,
  aiServer: 'http://127.0.0.1:8765',
  bridgeUrl: 'ws://127.0.0.1:8766', // controller bridge (pydualsense)
  splitter: 'auto',      // auto | ai | dsp
  vocalMode: 'mic',      // mic (sing) | buttons (vocals as a 5-lane chart)
  micDevice: '',         // audio input for singing ('' = system default)
  guideVocals: false,    // keep the original singer in the mix while singing (off = karaoke)
  lyrics: true,          // show AI lyrics under the vocal track
  twitchChannel: '',     // stream mode: Twitch chat to read (read-only, no login)
  streamHype: true,      // chat !hype triggers pyro during songs
  streamAutoPlay: true,  // start the song chat voted for
  autoUpdate: true,      // desktop app: look for a new version at start-up
  updateFeed: '',        // GitHub "owner/repo" (or a latest.json URL); release builds know theirs
  realInstrument: false, // guitar / bass / keys: play a real instrument (audio input or MIDI) instead of a controller
  instrumentInput: '',   // audio input for a real guitar / bass ('' = system default)
  realStrict: false,     // real instruments: the octave has to match too
  instrumentLatency: 0.07, // seconds; learned while you play a real instrument
  palette: 'default',    // lane colours: default | redgreen | tritan | contrast
  calmVisuals: false,    // no strobes, shockwaves, colour fringing or camera cuts
  laneAssist: 'off',     // off | wide (3 wide lanes) | any (any button hits the next note)
  autoSustain: false,    // sustains hold themselves
  hudSize: 'normal',     // normal | large | huge (score, meters and judgements)
  lastInstrument: 'guitar',
  lastDifficulty: 'medium',
};

let current = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  current = { ...DEFAULTS, ...saved };
} catch { /* storage unavailable */ }

const listeners = new Set();

export const settings = new Proxy(current, {
  set(target, prop, value) {
    target[prop] = value;
    try { localStorage.setItem(KEY, JSON.stringify(target)); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(prop, value));
    return true;
  },
});

export const onSettingsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
