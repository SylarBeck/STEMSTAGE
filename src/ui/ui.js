// Menus, controller-first: spatial D-pad navigation (with per-panel focus memory), adaptive button
// prompts, top bar, contextual menu hero, option sheets, on-screen keyboard, and a band lobby where
// every player drives their own slot with their own controller.
import { settings } from '../settings.js';
import { listSongs, getSong, getAudio, deleteSong, getBest, storageEstimate, openSongsFolder, songsFolder, coverUrl, previewUrl, saveSongJson, coverFromUrl } from '../storage/library.js';
import { importFile, aiClient, importFromYouTube, ytSearch, ytStatus, rechartSong, ensurePreview, fetchLyrics, checkLyrics } from '../audio/pipeline.js';
import { discord } from '../net/discord.js';
import { lookupOnline } from '../audio/metadata.js';
import { profiles, levelInfo } from '../profile/profiles.js';
import { installSocial, avatarHtml } from './social.js';
import { installOnline } from './online-ui.js';
import { installControllers } from './controllers-ui.js';
import { installSetlists } from './setlists-ui.js';
import { installTour } from './tour-ui.js';
import { installChartLibrary } from './chartlib-ui.js';
import { installEditor } from './editor-ui.js';
import { installStream } from './stream-ui.js';
import { tourStars, TOUR_MAX, dailyDone, VENUES, unlocked } from '../profile/career.js';
import { Osk } from './osk.js';
import { controllerPicture, detectController, glyph } from './controller-art.js';
import { buildChartPack, download } from '../export/exporters.js';
import { Mic, requestMic } from '../audio/pitch.js';
import { checkForUpdates, autoCheck } from './updates.js';
import { padName, isDualSensePad, srcKey } from '../input/input.js';
import { bindings } from '../input/bindings.js';
import { PLAYER_COLORS } from '../game/player.js';
import { fa, instIcon, stars as starsHtml, starsOnly, achIcon } from './icons.js';
import { pickGhost, replaysFor, loadReplay, saveReplay } from '../game/replay.js';
import { worldCharts, partChart, prepareRankedCharts, ensureFingerprint, useWorldChart, useOwnChart, allowRanked, voteChart, shareChart } from '../net/charts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const VOCAL_PARTS = [[0, 'Lead'], [1, 'Harmony 2'], [2, 'Harmony 3']];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitar', ico: instIcon('guitar') },
  { id: 'bass', label: 'Bass', ico: instIcon('bass') },
  { id: 'drums', label: 'Drums', ico: instIcon('drums') },
  { id: 'keys', label: 'Keys', ico: instIcon('keys') },
  { id: 'vocals', label: 'Vocals', ico: instIcon('vocals') },
];
const SORTS = [['recent', 'Recent'], ['title', 'Title'], ['artist', 'Artist'], ['bpm', 'BPM'], ['length', 'Length']];
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
const SCREEN_LABEL = {
  menu: 'Main menu', library: 'Setlist', import: 'Import song', settings: 'Settings', band: 'Band', controller: 'Controllers', howto: 'How to play',
  profiles: 'Profiles', career: 'Career', leaderboard: 'Leaderboards', chartlib: 'Chart library', setlists: 'Setlists', marathon: 'Marathon', tour: 'Tour', editor: 'Chart editor', stream: 'Stream', online: 'Online', practice: 'Practice', songinfo: 'Song info', results: 'Results',
  calibrate: 'Calibration', pause: 'Paused',
};
const CHROME_OFF = new Set(['title', 'hud', 'calibrate']);

/** 1..7 difficulty rating from note density (peak notes/second over 4 s windows). */
function rating(notes) {
  if (!notes?.length) return 0;
  let peak = 0;
  for (let i = 0, j = 0; i < notes.length; i++) {
    while (notes[j].t < notes[i].t - 4) j++;
    peak = Math.max(peak, (i - j + 1) / 4);
  }
  return Math.max(1, Math.min(7, Math.round(Math.log2(peak + 1) * 2.1)));
}
// shown the Rock Band way: a tier name and five dots (Warmup has none, Impossible turns them red)
const TIERS = ['', 'Warmup', 'Apprentice', 'Solid', 'Moderate', 'Challenging', 'Nightmare', 'Impossible'];
const ratingHtml = (r) => (r ? `<span class="rating ${r >= 7 ? 'max' : ''}" title="${TIERS[r]}">${[1, 2, 3, 4, 5].map((k) => `<i class="${k < r ? 'on' : ''}"></i>`).join('')}</span>` : '');
const INST_ICON = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i.ico]));
const DIFFS = ['easy', 'medium', 'hard', 'expert'];

const SETTINGS_SCHEMA = [
  { group: 'Gameplay' },
  { key: 'noteSpeed', label: 'Note speed', desc: 'How fast the highway scrolls', type: 'range', min: 1, max: 10, step: 1 },
  { key: 'proMode', label: 'Pro mode', desc: 'Tighter timing (±80 ms to hit, ±25 ms for Perfect), overstrums and wrong frets break your streak, and no assists or no-fail. +25% XP and PRO on your results', type: 'toggle' },
  { key: 'noFail', label: 'No fail', desc: 'Keep playing when the crowd meter empties (not in Pro mode)', type: 'toggle' },
  { key: 'ghostPenalty', label: 'Ghost-tap penalty', desc: 'Wrong-lane presses / overstrums near notes break your streak (not on drums)', type: 'toggle' },
  { key: 'strumMode', label: 'Strum mode', desc: 'Auto = each controller profile decides (on for guitars). On / Off override every profile', type: 'choice', options: ['auto', 'on', 'off'] },
  { key: 'ghost', label: 'Ghost race', desc: 'Race an earlier run in solo play: your own best, or the top run on this PC', type: 'choice', options: ['off', 'best', 'top'] },
  { key: 'leftyFlip', label: 'Lefty flip', desc: 'Mirror the highway (profiles can override this per controller)', type: 'toggle' },
  { group: 'Audio' },
  { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct' },
  { key: 'playerVolume', label: 'Played instruments', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: 'pct' },
  { key: 'bandVolume', label: 'Band', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: 'pct' },
  { key: 'sfxVolume', label: 'Sound effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct' },
  { key: 'crowdVolume', label: 'Crowd', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct' },
  { key: 'menuMusic', label: 'Background music', desc: 'Music in the menus: off, the demo track, or a random song from your setlist', type: 'choice', options: ['off', 'demo', 'shuffle'] },
  { key: 'menuMusicVolume', label: 'Background music volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct' },
  { key: 'audioOffset', label: 'Audio offset', desc: 'Raise it if you hit late (e.g. Bluetooth audio)', type: 'range', min: -150, max: 350, step: 5, fmt: 'ms' },
  { action: 'calibrate', label: 'Calibrate audio offset', desc: 'Tap along to a click track to measure your latency' },
  { group: 'Video' },
  { key: 'fullscreen', label: 'Fullscreen', desc: 'Start in fullscreen (F11 / Alt+Enter toggles it in the desktop app)', type: 'toggle' },
  { key: 'quality', label: 'Graphics quality', desc: 'Resolution, crowd size, bloom, film grain', type: 'choice', options: ['low', 'high', 'ultra'] },
  { key: 'bloom', label: 'Bloom', type: 'toggle' },
  { key: 'cameraShake', label: 'Camera shake', type: 'toggle' },
  { key: 'venue', label: 'Venue', desc: 'The stage you play on. Auto: the arena, and every tour gig in its own venue. Venues open up as you earn tour stars (the arena is always open)', type: 'choice', options: ['auto', 'garage', 'club', 'bar', 'theater', 'arena', 'stadium', 'festival'], labels: { auto: 'Auto', garage: 'Garage', club: 'Club', bar: 'Dive bar', theater: 'Theater', arena: 'Arena', stadium: 'Stadium', festival: 'Festival' } },
  { group: 'Debug' },
  { key: 'showFps', label: 'Show FPS', desc: 'Show how smoothly the game is running', type: 'toggle' },
  { key: 'showPing', label: 'Show ping', desc: 'Show delay to your online room; says Offline when you are not in one', type: 'toggle' },
  { group: 'Controllers' },
  { key: 'triggerIntensity', label: 'Adaptive trigger strength', desc: 'DualSense trigger effects. 0% turns them off everywhere', type: 'range', min: 0, max: 1.5, step: 0.1, fmt: 'pct' },
  { key: 'rumbleIntensity', label: 'Haptic strength', desc: 'DualSense haptics and gamepad rumble', type: 'range', min: 0, max: 1.5, step: 0.1, fmt: 'pct' },
  { key: 'lightbar', label: 'Lightbar effects', type: 'toggle' },
  { action: 'openControllers', label: 'Controller profiles & bindings', desc: 'Per-controller config profiles, rebinding and tests' },
  { key: 'bridgeUrl', label: 'Controller bridge URL', desc: 'The pydualsense bridge that drives DualSense triggers, haptics and lights (npm run bridge)', type: 'text' },
  { action: 'testBridge', label: 'Test controller bridge', desc: 'Show which DualSense controllers the bridge sees' },
  { group: 'Accessibility' },
  { key: 'palette', label: 'Lane colours', desc: 'Colour-blind friendly note colours (applies from the next song)', type: 'choice', options: ['default', 'redgreen', 'tritan', 'contrast'], labels: { default: 'Classic', redgreen: 'Red-green safe', tritan: 'Blue-yellow safe', contrast: 'High contrast' } },
  { key: 'calmVisuals', label: 'Calm visuals', desc: 'No strobes, shockwaves, colour fringing, camera shake or camera cuts; smaller pyro', type: 'toggle' },
  { key: 'laneAssist', label: 'Lane assist', desc: 'Wide: 3 wide lanes (outer buttons merged). Any: any button hits the next note — playable with one hand. Assisted runs earn XP but stay off leaderboards', type: 'choice', options: ['off', 'wide', 'any'], labels: { off: 'Off', wide: '3 wide lanes', any: 'Any button' } },
  { key: 'autoSustain', label: 'Auto sustain', desc: 'Long notes hold themselves after you hit them', type: 'toggle' },
  { key: 'hudSize', label: 'HUD size', desc: 'Bigger score, meters and judgements', type: 'choice', options: ['normal', 'large', 'huge'], labels: { normal: 'Normal', large: 'Large', huge: 'Huge' } },
  { group: 'Real instruments' },
  { key: 'realInstrument', label: 'Play real instruments', desc: 'Guitar, bass and keys: play the real instrument (audio input or MIDI keyboard) instead of a controller', type: 'toggle' },
  { action: 'chooseInstrumentInput', label: 'Instrument input', desc: 'The audio input your guitar or bass is plugged into (an audio interface works best)' },
  { key: 'realStrict', label: 'Exact octave', desc: 'Off: any octave counts (recommended — the AI charts can be an octave off)', type: 'toggle' },
  { action: 'testInstrument', label: 'Test instrument', desc: 'Play and see which note the game hears' },
  { group: 'Singing' },
  { key: 'vocalMode', label: 'Vocals', desc: 'Sing into a microphone, or play the vocal part with buttons', type: 'choice', options: ['mic', 'buttons'] },
  { key: 'guideVocals', label: 'Guide vocals', desc: 'Keep the original singer in the mix while you sing (off = karaoke)', type: 'toggle' },
  { key: 'lyrics', label: 'Lyrics', desc: 'Show lyrics under the vocal track (Song options → Get lyrics)', type: 'toggle' },
  { action: 'chooseMic', label: 'Microphone', desc: 'Pick the input you sing into' },
  { action: 'testMic', label: 'Test microphone', desc: 'Sing and see the note you hit' },
  { group: 'World leaderboard' },
  { key: 'worldLeaderboard', label: 'Send my runs to the world leaderboard', desc: 'Signed-in profiles: your score, stars and accuracy (with your profile name and Discord avatar) go to stemstage.varconstint.com/leaderboard. Practice, replays and assisted runs are never sent', type: 'toggle' },
  { key: 'rankedCharts', label: 'Play the ranked chart of each song', desc: 'Every import makes its own AI chart, so each song has one ranked chart everyone is scored on. It is downloaded and lined up with your recording when you play; runs on your own chart go on that chart\u2019s own board. Pick a chart per song in Song options \u2192 World charts', type: 'toggle' },
  { group: 'Discord' },
  { key: 'discordPresence', label: 'Show what I play on Discord', desc: 'Your Discord status shows the song, part and time left, automatically (needs the Discord app running on this PC)', type: 'toggle' },
  { key: 'discordInvites', label: 'Discord invites', desc: 'Link: your status gets a "Join room" button anyone can use (installs STEMSTAGE if needed). Discord: Discord\u2019s own Join button, which only works for friends who have STEMSTAGE', type: 'choice', options: ['link', 'discord'], labels: { link: 'Join link', discord: 'Discord Join' } },
  { action: 'testDiscord', label: 'Test Discord status', desc: 'Check that the Discord app answers. Link your account on the Career page (Log in with Discord)' },
  { group: 'Updates' },
  { key: 'autoUpdate', label: 'Check for updates at start-up', desc: 'Desktop app: offers new versions from GitHub Releases (signed)', type: 'toggle' },
  { key: 'updateFeed', label: 'Update source', desc: 'GitHub repository as owner/name — empty uses SylarBeck/STEMSTAGE', type: 'text' },
  { action: 'checkUpdate', label: 'Check for updates now', desc: 'See if a newer STEMSTAGE is available' },
  { group: 'AI splitter' },
  { key: 'aiEnabled', label: 'AI server', desc: 'Desktop app: stop or start the AI splitter and remember this choice. Off uses quick DSP for imports.', type: 'toggle' },
  { key: 'aiServer', label: 'Server URL', desc: 'Where the Demucs splitter runs (npm run ai)', type: 'text' },
  { action: 'installAi', label: 'Install AI splitter', desc: 'NVIDIA GPU and working driver required. Downloads Demucs, Whisper lyrics and note transcription (3-5 GB)' },
  { action: 'testServer', label: 'Test AI connection', desc: 'Check the splitter and show which model/GPU it uses' },
  { group: 'Library' },
  { action: 'clearCache', label: 'Songs folder', desc: 'Every song is a folder of WAV stems + song.json in Documents\\STEMSTAGE\\songs' },
  { action: 'openFolder', label: 'Open songs folder', desc: 'Show the song folders in File Explorer' },
];
const SETTINGS_GROUPS = SETTINGS_SCHEMA.filter((x) => x.group).map((x) => x.group);

const MENU_TIPS = [
  'Hold a note and wiggle the right stick (or whammy bar) to bend it — whammying overdrive phrases refills overdrive.',
  'Miss a note and your instrument drops out of the mix until you hit again.',
  'Overdrive doubles your multiplier and revives failed bandmates.',
  'Each controller keeps its own config profile — make a lefty or drums layout in Controllers.',
  'Link a DualSense for adaptive triggers that click like frets and buzz on sustains.',
];

export class UI {
  constructor(app) {
    this.app = app;
    this.screen = null;
    this.focus = 0;
    this.songs = [];
    this.selected = null;
    this.instrument = settings.lastInstrument;
    this.difficulty = settings.lastDifficulty;
    this.splitter = settings.splitter;
    this.busy = false;
    this.aiStatus = null;
    this.mode = 'solo';
    this.party = [];
    this.screenHooks = {};
    this.actionHooks = {};
    this.pickerHooks = [];
    this.navHooks = [];
    this.focusHooks = {};
    this.legendHooks = {};
    this.search = '';
    this.sort = localStorage.getItem('stemstage.sort') || 'recent';
    this.importTab = 'file';
    this.settingsTab = SETTINGS_GROUPS[0];
    this.practice = { speed: 0.8, startPct: 0 };
    this.previewAudio = new Audio();
    this.previewAudio.loop = true;
    this.family = 'keyboard';
    this.sheet = null;
    this.osk = new Osk(this);

    app.input.onNav((dir, dev) => this.nav(dir, dev));
    app.input.onAny((dev, key) => this.anyInput(dev, key));
    app.input.onUnknownPad = (pad) => this.toast(`"${padName(pad.id)}" uses a non-standard layout — map it on the Controllers screen`);
    document.addEventListener('pointerdown', () => { app.engine.unlock(); if (this.screen === 'title') this.leaveTitle(); });
    document.addEventListener('keydown', () => app.engine.unlock());
    document.addEventListener('pointermove', (e) => { if (e.movementX || e.movementY) { this._pointerAt = performance.now(); this._setFamily('keyboard'); } }, { passive: true });
    document.addEventListener('mouseover', (e) => this._hover(e));
    window.addEventListener('gamepadconnected', () => { this.refreshPad(); this._titleDevices(); });
    window.addEventListener('gamepaddisconnected', () => { this.refreshPad(); this._titleDevices(); });

    $$('[data-action]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); this.action(el.dataset.action, el); }));
    this._setupImport();
    this._buildSettings();
    this._browserWarning();
    app.ds.onChange(() => { this.refreshPad(); this._titleDevices(); });
    this.social = installSocial(this);
    this.onlineUi = installOnline(this);
    this.controllers = installControllers(this);
    this.setlists = installSetlists(this);
    this.tour = installTour(this);
    installChartLibrary(this);
    this.editor = installEditor(this);
    this.stream = installStream(this);
    autoCheck(this);
    this._setupLibraryTools();
    this._setupInputs();
    profiles.onChange(() => this.refreshStatus());
    setInterval(() => this.pollAI(), 5000);
    setInterval(() => this._clock(), 15000);
    this._clock();
    this.pollAI();
  }

  _setupLibraryTools() {
    const search = $('#lib-search');
    search.addEventListener('input', () => { this.search = search.value; this.renderLibrary(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); search.blur(); } });
    $('#yt-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.action('yt-search'); } });
    $('#pr-start-range').addEventListener('input', (e) => { this.practice.startPct = +e.target.value; this._renderPracticeStart(); });
  }

  /** Text fields: typing with a keyboard, on-screen keyboard with a controller. */
  _setupInputs() {
    for (const el of $$('input[type=text], input[type=password]')) {
      if (el.closest('.set-row')) continue;
      if (!el.hasAttribute('data-nav')) el.setAttribute('data-nav', '');
      el.addEventListener('focus', () => { const i = this.navItems().indexOf(el); if (i >= 0) { this.focus = i; this.applyFocus(false); } });
    }
  }

  async editText(el) {
    if (this.family === 'keyboard') { el.focus(); el.select?.(); return; }
    const value = await this.osk.show({
      title: el.dataset.osk || el.placeholder || 'Enter text', value: el.value, password: el.type === 'password',
      type: el.dataset.oskType || (el.inputMode === 'numeric' ? 'number' : 'text'), max: +(el.maxLength > 0 ? el.maxLength : 80),
    });
    if (value == null) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.dataset.oskSubmit) this.action(el.dataset.oskSubmit);
  }

  _browserWarning() {
    const midi = 'requestMIDIAccess' in navigator;
    if (midi) return;
    const ff = /firefox/i.test(navigator.userAgent);
    const html = `${ff ? "You're in <b>Firefox</b>" : "This browser doesn't support Web MIDI"}: <b>MIDI drums and keyboards</b> need the STEMSTAGE desktop app, Chrome or Edge. Everything else works here, including the DualSense (through the controller bridge).`;
    for (const id of ['browser-warn', 'browser-warn-2']) { const el = $(`#${id}`); if (el) { el.innerHTML = html; el.hidden = false; } }
  }

  // ---------------------------------------------------------------- screens
  _focusKey(el) { return el ? el.dataset.action || el.dataset.picker || el.dataset.setting || el.dataset.song || el.dataset.dev || el.id || null : null; }

  show(name) {
    if (this.sheet) this.closeSheet(null, false);
    if (this.screen && !this.osk.open) (this._memo ||= {})[this.screen] = this._focusKey(this.navItems()[this.focus]);
    $$('.screen').forEach((s) => s.classList.remove('active'));
    const el = $(`#screen-${name}`) || $(`#${name}`);
    el?.classList.add('active');
    const prev = this.screen;
    this.screen = name;
    this.focus = 0;
    document.body.classList.toggle('chrome', !CHROME_OFF.has(name));
    document.body.classList.toggle('in-game', name === 'hud' || name === 'pause');
    document.body.dataset.screen = name;
    // the menus show your venue; a song (and its results) keeps the one it was played in; the tour previews its own
    if (!['hud', 'pause', 'results', 'marathon', 'tour'].includes(name) && !this.app.game?.running) { this.applyVenue(false); if (name !== 'career') this.applyLooks(); }
    if (name !== 'career') this.app.stage.preview(null);
    $('#tb-crumb').textContent = SCREEN_LABEL[name] || '';
    if (name !== 'controller' && prev === 'controller') this.controllers.stopCapture();
    if (name !== 'library' && name !== 'practice' && name !== 'songinfo') this.stopPreview();
    if (name === 'menu') { this.refreshStatus(); this.app.menuMusic(true); if (this.mode === 'online-pick') this.mode = 'solo'; }
    if (name === 'title') this._titleDevices();
    if (name === 'library') this.renderLibrary();
    if (name === 'import') { this.renderSplitter(); this.renderImportTab(); }
    this.screenHooks[name]?.();
    if (name === 'settings') { this._syncSettings(); this._renderSettingsTabs(); }
    if (name === 'band') this.renderBand();
    // come back to where you were on this screen
    const memo = this._memo?.[name];
    if (memo && name !== 'library' && name !== 'controller') {
      const i = this.navItems().findIndex((el) => this._focusKey(el) === memo);
      if (i >= 0) this.focus = i;
    }
    this.applyFocus();
    this.refreshLegend();
  }

  leaveTitle() {
    if (this.screen !== 'title') return;
    this.navLock = performance.now() + 300;
    this.app.engine.unlock();
    this.app.engine.sfxUi('confirm');
    if (!profiles.current && profiles.list.length) { this.actionHooks.profiles?.(); return; }
    this.show('menu');
    if (!profiles.list.length && !this.profileHintShown) {
      this.profileHintShown = true;
      this.toast('Tip: create a profile (Career → Sign in) to save scores, XP and achievements');
    }
  }

  // ---------------------------------------------------------------- focus + spatial navigation
  navRoot() {
    if (this.osk.open) return this.osk.el;
    if (this.sheet) return $('#sheet');
    return $('.screen.active');
  }

  navItems() {
    const root = this.navRoot();
    if (!root) return [];
    return $$('[data-nav]', root).filter((el) => el.offsetParent !== null && !el.disabled && !el.classList.contains('disabled'));
  }

  applyFocus(scroll = true) {
    const items = this.navItems();
    $$('.focus').forEach((el) => el.classList.remove('focus'));
    if (!items.length) return;
    this.focus = Math.max(0, Math.min(items.length - 1, this.focus));
    const el = items[this.focus];
    el.classList.add('focus');
    const g = el.closest('[data-nav-group]');
    if (g) g._navLast = el;
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    if (!this.osk.open && !this.sheet) this.focusHooks[this.screen]?.(el);
    if (this.screen === 'menu' && el.dataset.hero && !this.sheet) this.renderHero(el.dataset.hero);
    this.refreshLegend();
  }

  restoreFocus() {
    if (this._saved && this._saved.screen === this.screen) {
      const items = this.navItems();
      const i = items.indexOf(this._saved.el);
      this.focus = i >= 0 ? i : Math.min(this._saved.index, items.length - 1);
      this._saved = null;
    }
    this.applyFocus(false);
  }

  _hover(e) {
    // only real mouse movement moves focus (not content re-rendering under a resting cursor)
    if (this.family !== 'keyboard' || !(performance.now() - (this._pointerAt || 0) < 120)) return;
    const el = e.target.closest?.('[data-nav]');
    if (!el) return;
    const items = this.navItems();
    const i = items.indexOf(el);
    if (i >= 0 && i !== this.focus) { this.focus = i; this.applyFocus(false); }
  }

  /** Move focus to the nearest element in a direction. Returns false if nothing is there. */
  moveFocus(dir) {
    const items = this.navItems();
    if (!items.length) return false;
    const cur = items[this.focus];
    if (!cur) { this.focus = 0; this.applyFocus(); return true; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const cg = cur.closest('[data-nav-group]');
    const vertical = dir === 'up' || dir === 'down';
    // vertical moves prefer the current panel; only leave it when it has nothing in that direction and can't wrap
    const sameGroup = vertical && cg ? items.filter((el) => el !== cur && el.closest('[data-nav-group]') === cg) : null;
    let best = -1, bestScore = Infinity;
    items.forEach((el, i) => {
      if (el === cur) return;
      if (sameGroup && sameGroup.length && !sameGroup.includes(el)) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      let primary, gap, off;
      if (dir === 'down' || dir === 'up') {
        if (dir === 'down' ? (ey <= cy + 2 || r.top < r0.top + 4) : (ey >= cy - 2 || r.bottom > r0.bottom - 4)) return;
        primary = dir === 'down' ? Math.max(0, r.top - r0.bottom) : Math.max(0, r0.top - r.bottom);
        gap = Math.max(0, r.left - r0.right, r0.left - r.right);
        // under a wide element prefer the one aligned with its left edge (reading order), not its centre
        off = Math.abs(ex - Math.max(r0.left, Math.min(r0.right, ex))) + Math.abs(r.left - r0.left) * 0.25;
      } else {
        if (dir === 'right' ? (ex <= cx + 2 || r.left < r0.left + 4) : (ex >= cx - 2 || r.right > r0.right - 4)) return;
        primary = dir === 'right' ? Math.max(0, r.left - r0.right) : Math.max(0, r0.left - r.right);
        gap = Math.max(0, r.top - r0.bottom, r0.top - r.bottom);
        off = Math.abs(ey - Math.max(r0.top, Math.min(r0.bottom, ey))) + Math.abs(r.top - r0.top) * 0.25;
      }
      const score = primary + gap * 4 + off * 0.3;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) {
      // entering another panel: go back to where you were in it
      const tg = items[best].closest('[data-nav-group]'), cg = cur.closest('[data-nav-group]');
      if (tg && tg !== cg && tg._navLast?.isConnected && items.includes(tg._navLast)) best = items.indexOf(tg._navLast);
    } else if (vertical) {
      // wrap around inside the current column
      const col = items.filter((el) => el !== cur && el.closest('[data-nav-group]') === cg).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > r0.left + 4 && r.left < r0.right - 4;
      }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      if (col.length) best = items.indexOf(dir === 'down' ? col[0] : col[col.length - 1]);
    }
    if (best < 0) return false;
    this.focus = best;
    this.applyFocus();
    return true;
  }

  anyInput(dev, key) {
    this._setFamilyFromDevice(dev);
    if (this.screen === 'title') { this.leaveTitle(); return; }
    if (this.screen === 'band' && dev) {
      const member = this.party.some((p) => p.device === dev);
      if (member && dev === 'kb2' && !(this.joinLock?.dev === dev && performance.now() < this.joinLock.until)) {
        // menu keys only exist on layout A, so layout B drives its slot with its lane keys
        const prof = bindings.profile(this.app.input.profileFor('kb2'));
        const lane = ['lane0', 'lane1', 'lane2', 'lane3', 'lane4'].findIndex((l) => (prof?.five?.[l] || []).some((s) => srcKey(s) === key));
        if (lane >= 0) this._bandNav(['up', 'down', 'left', 'right', 'confirm'][lane], dev);
        return;
      }
      this._tryJoin(dev, key);
    }
  }

  nav(dir, dev) {
    if (dev) this._setFamilyFromDevice(dev);
    if (this.screen === 'title') { this.leaveTitle(); return; }
    if (this.navLock && performance.now() < this.navLock) return;
    if (this.joinLock && this.joinLock.dev === dev && performance.now() < this.joinLock.until) return;
    const eng = this.app.engine;
    if (this.osk.open) {
      if (this.osk.nav(dir)) return;
    } else if (this.sheet) {
      if (dir === 'back') { eng.sfxUi('back'); this.closeSheet(null); return; }
    } else {
      if (this.padMapping) { if (dir === 'back') this.navHooks.some((h) => h(dir, dev)); return; }
      if (this.capturing) return;
      if (this.screen === 'band' && this._bandNav(dir, dev)) return;
      if (this.navHooks.some((h) => h(dir, dev))) { this.refreshLegend(); return; }
      if (this.screen === 'calibrate') { if (dir === 'back') this.stopCalibration(true); return; }
    }
    const items = this.navItems();
    const el = items[this.focus];
    if (dir === 'up' || dir === 'down') {
      if (this.moveFocus(dir)) {
        eng.sfxUi('move');
        if (this.screen === 'library' && !this.sheet && !this.osk.open) { const card = this.navItems()[this.focus]; if (card?.dataset.song) this.selectSong(card.dataset.song, false); }
      }
      return;
    }
    if (dir === 'left' || dir === 'right') {
      const d = dir === 'right' ? 1 : -1;
      if (!this.osk.open && !this.sheet) {
        if (el?.dataset.picker) { this.cyclePicker(el.dataset.picker, d); eng.sfxUi('move'); return; }
        if (el?.dataset.setting) { this.adjustSetting(el.dataset.setting, d); eng.sfxUi('move'); return; }
        if (this.screen === 'library' && el?.dataset.song && d > 0) { this.focusAction('play'); eng.sfxUi('move'); return; }
      }
      if (this.moveFocus(dir)) eng.sfxUi('move');
      return;
    }
    if (this.osk.open || this.sheet) {
      if ((dir === 'confirm' || dir === 'start') && el) { eng.sfxUi('confirm'); el.click(); }
      return;
    }
    if (dir === 'prev' || dir === 'next') { this._shoulder(dir === 'next' ? 1 : -1); return; }
    if (dir === 'pgup' || dir === 'pgdn') { this._page(dir === 'pgdn' ? 1 : -1); return; }
    if (dir === 'alt' || dir === 'alt2' || dir === 'select') { this._altAction(dir, el); return; }
    if (dir === 'start' && this.screen === 'library' && this.selected) { eng.sfxUi('confirm'); this.play(); return; }
    if (dir === 'confirm' || dir === 'start') {
      if (!el) return;
      eng.sfxUi('confirm');
      if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password')) { this.editText(el); return; }
      if (el.dataset.song) { this.selectSong(el.dataset.song, true); this.focusAction('play'); return; }
      if (el.dataset.setting) { this.adjustSetting(el.dataset.setting, 1, true); return; }
      if (el.dataset.picker) { this.cyclePicker(el.dataset.picker, 1); return; }
      el.click();
      return;
    }
    if (dir === 'back') {
      eng.sfxUi('back');
      const back = {
        library: this.mode === 'band' ? 'band' : this.mode === 'online-pick' ? 'online' : this.mode === 'setlist-add' ? 'setlists' : 'menu', import: 'menu', setlists: 'menu', tour: 'menu', stream: 'menu', settings: 'menu', controller: 'menu',
        howto: 'menu', band: 'menu', results: this.lastPlay?.online ? 'online' : 'library', menu: 'title', profiles: 'menu',
        career: 'menu', leaderboard: 'menu', chartlib: 'menu', online: 'menu', practice: 'library', songinfo: 'library',
      };
      if (this.screen === 'library' && this.mode === 'online-pick') this.mode = 'solo';
      if (this.screen === 'pause') { this.action('resume'); return; }
      if (this.screen === 'library') {
        const idx = items.findIndex((x) => x.dataset.song === this.selected?.id);
        if (items[this.focus] && !items[this.focus].dataset.song && idx >= 0) { this.focus = idx; this.applyFocus(); return; }
      }
      if (this.screen === 'import' && this.busy) { this.toast('Import in progress...'); return; }
      if (back[this.screen]) this.show(back[this.screen]);
    }
  }

  /** L1 / R1 */
  _shoulder(d) {
    const eng = this.app.engine;
    if (this.screen === 'library' && this.selected && this.mode !== 'band') { this.cyclePicker('instrument', d); eng.sfxUi('move'); return; }
    if (this.screen === 'settings') { const i = SETTINGS_GROUPS.indexOf(this.settingsTab); this.settingsTab = SETTINGS_GROUPS[(i + d + SETTINGS_GROUPS.length) % SETTINGS_GROUPS.length]; this._renderSettingsTabs(true); eng.sfxUi('move'); return; }
    if (this.screen === 'import') { this.cyclePicker('import-tab', d); eng.sfxUi('move'); return; }
    if (this.screen === 'leaderboard') { this.cyclePicker('lb-tab', d); eng.sfxUi('move'); }
  }

  /** L2 / R2 */
  _page(d) {
    const eng = this.app.engine;
    if (this.screen === 'library' && this.selected && this.mode !== 'band') { this.cyclePicker('difficulty', d); eng.sfxUi('move'); return; }
    // page through long lists
    const items = this.navItems();
    const cur = items[this.focus];
    const g = cur?.closest('[data-nav-group]') || cur?.parentElement;
    const peers = items.filter((x) => (x.closest('[data-nav-group]') || x.parentElement) === g);
    const i = peers.indexOf(cur);
    const n = peers[Math.max(0, Math.min(peers.length - 1, i + d * 8))];
    if (n && n !== cur) { this.focus = items.indexOf(n); this.applyFocus(); eng.sfxUi('move'); if (this.screen === 'library' && n.dataset.song) this.selectSong(n.dataset.song, false); return; }
    // nothing to page through: scroll the page itself (career, leaderboards...) — scrollbars are hidden
    const scroller = $$('.screen.active *').find((el) => el.scrollHeight > el.clientHeight + 16 && /auto|scroll/.test(getComputedStyle(el).overflowY));
    if (scroller) scroller.scrollBy({ top: d * scroller.clientHeight * 0.7, behavior: 'smooth' });
  }

  /** △ / ▢ / Create */
  _altAction(dir, el) {
    const eng = this.app.engine;
    if (this.screen === 'library') {
      if (dir === 'alt' && this.selected) { eng.sfxUi('confirm'); this.songOptions(); return; }
      if (dir === 'alt2') { eng.sfxUi('confirm'); this.editText($('#lib-search')); return; }
    }
    if (this.screen === 'menu' && dir === 'alt') { this.actionHooks.profiles?.(); return; }
    if (this.screen === 'band' && dir === 'alt' && this.party.length) { this.action('band-go'); }
  }

  focusAction(action) {
    const items = this.navItems();
    const idx = items.findIndex((x) => x.dataset.action === action);
    if (idx >= 0) { this.focus = idx; this.applyFocus(); }
  }

  // ---------------------------------------------------------------- input family, legend, top bar
  _setFamilyFromDevice(dev) {
    if (!dev || dev.startsWith('kb') || dev.startsWith('midi')) { this._setFamily('keyboard'); return; }
    const d = this.app.input.listDevices().find((x) => x.id === dev);
    if (!d) return;
    const det = detectController(d, bindings.baseOf(d.profileKey));
    this._setFamily(det.family === 'midi' ? 'keyboard' : det.family, d);
  }

  _setFamily(family, device = null) {
    if (device) this.lastPadDevice = device;
    if (family === this.family) return;
    this.family = family;
    document.body.dataset.family = family;
    this.refreshLegend();
    this.refreshPad();
    for (const el of $$('[data-glyph]')) el.innerHTML = glyph(el.dataset.glyph, family);
  }

  legendFor(screen) {
    const el = this.navItems()[this.focus];
    if (this.osk.open) return this.osk.opts?.type === 'text' ? [['confirm', 'Type'], ['back', 'Delete'], ['alt', 'Space'], ['alt2', 'Shift'], ['start', 'Done']] : [['confirm', 'Type'], ['back', 'Delete'], ['start', 'Done']];
    if (this.sheet) return [['confirm', 'Select'], ['back', 'Close']];
    if (this.legendHooks[screen]) return this.legendHooks[screen](el);
    if (el?.tagName === 'INPUT' && screen !== 'band') return [['confirm', this.family === 'keyboard' ? 'Type' : 'Edit text'], ['ud', 'Move'], ['back', 'Back']];
    const pick = el?.dataset.picker || el?.dataset.setting ? [['lr', 'Change']] : [];
    switch (screen) {
      case 'title': return [['confirm', 'Start']];
      case 'menu': return [['confirm', 'Select'], ['alt', 'Profiles'], ['back', 'Title']];
      case 'library':
        if (el?.dataset.song) return [['confirm', 'Choose'], ['alt', 'Options'], ['alt2', 'Search'], ...(this.mode === 'band' ? [] : [['prevnext', 'Instrument']]), ['back', 'Back']];
        return [...pick, ['confirm', 'Select'], ['alt', 'Options'], ['back', 'Songs']];
      case 'settings': return [...pick, ['prevnext', 'Tabs'], ['back', 'Back']];
      case 'import': return [['confirm', 'Select'], ...pick, ['prevnext', 'Source'], ['back', 'Back']];
      case 'band': return this.party.length ? [['confirm', 'Join / Ready'], ['ud', 'Pick row'], ['lr', 'Change'], ['alt', 'Choose song'], ['back', 'Menu']] : [['confirm', 'Join'], ['back', 'Menu']];
      case 'controller': return this.controllers.legend();
      case 'results': return [['confirm', 'Select'], ['back', 'Continue']];
      case 'hud': return [];
      case 'pause': return [['confirm', 'Select'], ['back', 'Resume']];
      case 'leaderboard': return [...pick, ['prevnext', 'Board'], ['back', 'Back']];
      default: return [...pick, ['confirm', 'Select'], ['back', 'Back']];
    }
  }

  refreshLegend() {
    const el = $('#legend');
    if (!el) return;
    const items = this.legendFor(this.screen) || [];
    const fam = this.family;
    const key = `${fam}|${items.map((x) => x.join(':')).join(',')}`;
    if (key === this._legendKey) return;
    this._legendKey = key;
    el.innerHTML = items.map(([a, label]) => `<span class="lg"><span class="lg-g">${glyph(a, fam)}</span>${esc(label)}</span>`).join('');
  }

  _clock() {
    const el = $('#tb-clock');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  _titleDevices() {
    const el = $('#title-devices');
    if (!el) return;
    const devs = this.app.input.listDevices().filter((d) => d.kind !== 'key');
    el.innerHTML = devs.slice(0, 5).map((d) => {
      const det = detectController(d, bindings.baseOf(d.profileKey));
      return `<div class="td"><div class="ctl-art">${controllerPicture(det.kind)}</div><span>${esc(det.name)}</span></div>`;
    }).join('');
  }

  toast(msg, kind = '', icon = null) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    if (icon) t.innerHTML = fa(icon, 'toast-ico');
    t.append(msg);
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3800);
  }

  // ---------------------------------------------------------------- sheets (option menus / confirmations)
  /** items: [{ label, desc, danger, disabled, run }] → resolves with the chosen item (or null) */
  openSheet({ title, sub = '', items }) {
    if (this.sheet) this.closeSheet(null, false);
    this._saved = { screen: this.screen, index: this.focus, el: this.navItems()[this.focus] };
    const el = $('#sheet');
    el.innerHTML = `<div class="sheet-card"><div class="sheet-title">${esc(title)}</div>${sub ? `<div class="sheet-sub">${esc(sub)}</div>` : ''}
      <div class="sheet-items">${items.map((it, i) => `<button class="sheet-item ${it.danger ? 'danger' : ''}" data-nav data-i="${i}" ${it.disabled ? 'disabled' : ''}><b>${it.icon ? fa(it.icon, 'sheet-ico') : ''}${esc(it.label)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</button>`).join('')}</div></div>`;
    el.hidden = false;
    return new Promise((resolve) => {
      this.sheet = { items, resolve };
      $$('[data-i]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.closeSheet(items[+b.dataset.i]); }));
      el.onclick = (e) => { if (e.target === el) this.closeSheet(null); };
      this.focus = 0;
      this.applyFocus(false);
    });
  }

  closeSheet(item, restore = true) {
    const s = this.sheet;
    if (!s) return;
    this.sheet = null;
    const el = $('#sheet');
    el.hidden = true;
    el.innerHTML = '';
    this.navLock = performance.now() + 150;
    if (restore) this.restoreFocus();
    this.refreshLegend();
    s.resolve(item);
    if (item?.run) item.run();
  }

  /** Main menu → Exit: ask first, then close the app (the desktop app also stops its services). */
  async exitProgram() {
    if (!(await this.confirmDialog('Exit STEMSTAGE?', 'Are you sure you want to quit? Your songs, scores and profiles are saved.', 'Exit'))) return;
    const invoke = window.__TAURI__?.core?.invoke;
    try { this.app.game.running && this.app.game.stop(); } catch { /* quitting anyway */ }
    if (invoke) { try { await invoke('exit_app'); return; } catch (e) { console.warn(e); } }
    window.close(); // browser version: only works for windows the game opened itself
    setTimeout(() => this.toast('Close this browser tab to exit STEMSTAGE', 'ok'), 300);
  }

  async confirmDialog(title, text, yes = 'OK') {
    const r = await this.openSheet({ title, sub: text, items: [{ label: yes, danger: true, id: 'yes' }, { label: 'Cancel', id: 'no' }] });
    return r?.id === 'yes';
  }

  // ---------------------------------------------------------------- actions
  async action(name, el) {
    const app = this.app;
    switch (name) {
      case 'solo': this.mode = 'solo'; this.show('library'); break;
      case 'band': this.show('band'); break;
      case 'library': case 'import': case 'settings': case 'controller': case 'howto': this.show(name); break;
      case 'controls': this.show('controller'); break;
      case 'exit-app': this.exitProgram(); break;
      case 'play': this.play(); break;
      case 'song-options': this.songOptions(); break;
      case 'retry':
        if (this.lastPlay?.online) { this.show('online'); break; }
        if (this.lastPlay?.replay) { this.watchReplay(this.lastPlay.replay); break; }
        if (this.lastPlay?.ghost) { this.play({ ghost: this.lastPlay.ghost }); break; }
        if (this.lastPlay?.practice) { this.startPractice(); break; }
        this.play();
        break;
      case 'pr-go': this.startPractice(); break;
      case 'watch-replay': {
        const list = this.lastReplays || [];
        if (list.length === 1) this.watchReplay(list[0]);
        else if (list.length) this.openSheet({ title: 'Watch replay', items: list.map((rp) => ({ label: rp.name, desc: `${rp.instrument} · ${rp.difficulty} · ${rp.score.toLocaleString()}`, run: () => this.watchReplay(rp) })) });
        break;
      }
      case 'pr-cancel': this.show('library'); break;
      case 'si-lookup': this.lookupSongInfo(); break;
      case 'si-save': this.saveSongInfo(); break;
      case 'si-cancel': this.show('library'); break;
      case 'yt-search': this.youtubeSearch(); break;
      case 'yt-import-all': {
        const list = (this.ytResults || []).filter((x) => !x.duration || x.duration <= 20 * 60).slice(0, 50);
        if (!list.length) break;
        if (!(await this.confirmDialog(`Import ${list.length} songs?`, `"${this.ytResults.playlist}" — each one is split and charted in turn. This can take a while.`, 'Import all'))) break;
        this.importBatch = { name: this.ytResults.playlist, ids: [] };
        for (const item of list) this.runImport(null, item);
        break;
      }
      case 'resume': this.show('hud'); app.game.resume(); break;
      case 'restart': this.show('hud'); app.game.restart(); break;
      case 'quit':
        if (this.marathon) { this.setlists.endMarathon(); break; }
        app.game.stop(); this.show(this.lastPlay?.online ? 'online' : 'library'); break;
      case 'band-add-kb1': this._join('kb1'); break;
      case 'band-add-kb2': this._join('kb2'); break;
      case 'band-go':
        if (!this.party.length) { this.toast('Add at least one player first', 'err'); return; }
        this.mode = 'band';
        this.show('library');
        break;
      case 'midi-enable':
        try {
          const n = await app.input.enableMidi();
          this.toast(n ? `MIDI enabled: ${n} input${n === 1 ? '' : 's'}` : 'MIDI enabled — no devices found yet (plug one in)', 'ok');
          if (this.screen === 'controller') this.controllers.render(true);
        } catch (e) { this.toast(e.message || 'MIDI permission denied', 'err'); }
        break;
      default:
        if (name.startsWith('band-remove-')) { this.party.splice(+name.slice(12), 1); this.renderBand(); return; }
        this.actionHooks[name]?.(el);
        break;
    }
  }

  // ---------------------------------------------------------------- status (top bar + hero)
  async pollAI() {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke && !this._aiTogglePending) {
      const st = await invoke('launcher_status').catch(() => null);
      if (st?.logs && typeof st.ai_enabled === 'boolean' && settings.aiEnabled !== st.ai_enabled) {
        settings.aiEnabled = st.ai_enabled;
        this._syncSettings();
      }
    }
    const h = await aiClient().health();
    this.aiStatus = h;
    this.refreshStatus();
    if (this.screen === 'import') this.renderSplitter();
  }

  refreshStatus() {
    const p = profiles.current;
    const chip = $('#tb-profile');
    if (chip) {
      const lv = p ? levelInfo(p.xp) : null;
      chip.innerHTML = `${avatarHtml(p || { name: 'Guest', color: '#555' }, 34)}<span class="tb-txt"><b>${esc(p ? p.name : 'Guest')}</b><small>${p ? `Level ${lv.level} · ${esc(lv.rank)}` : 'Sign in to save progress'}</small></span>`;
    }
    this.refreshPad();
    if (this.screen === 'menu') this.renderHero(this.navItems()[this.focus]?.dataset.hero || 'play');
  }

  refreshPad() {
    const chip = $('#tb-pad');
    if (!chip) return;
    const input = this.app.input, ds = this.app.ds;
    let d = this.family === 'keyboard' ? null : this.lastPadDevice && input.listDevices().find((x) => x.id === this.lastPadDevice.id);
    if (!d && this.family !== 'keyboard') d = input.listDevices().find((x) => x.kind === 'pad') || null;
    if (!d && this.family !== 'keyboard') { this._setFamily('keyboard'); return; } // controller gone: back to keyboard prompts
    const det = d ? detectController(d, bindings.baseOf(d.profileKey)) : detectController({ id: 'kb1' });
    const pads = input.getPads().length;
    let sub = d ? (d.pad?.hid ? `Triggers + haptics${d.pad.battery ? ` · ${d.pad.battery.level}%` : ''}` : isDualSensePad(d.pad) ? (ds.online ? 'Find it in Controllers for triggers' : 'Controller bridge offline')  : d.profileKey ? bindings.shortLabel(d.profileKey, padName) : 'Needs mapping') : `${pads ? `${pads} controller${pads === 1 ? '' : 's'} · ` : ''}mouse & keyboard`;
    if (input.midiInputs.size) sub += ` · ${input.midiInputs.size} MIDI`;
    const sig = `${det.kind}|${det.name}|${sub}`;
    if (sig === this._padSig) return;
    this._padSig = sig;
    chip.innerHTML = `<span class="tb-art ctl-art">${controllerPicture(det.kind)}</span><span class="tb-txt"><b>${esc(det.name)}</b><small>${esc(sub)}</small></span>`;
  }

  renderHero(key) {
    const el = $('#menu-hero');
    if (!el) return;
    const input = this.app.input;
    const h = this.aiStatus;
    const p = profiles.current;
    const songs = this.songs;
    const withCover = songs.filter((s) => coverUrl(s));
    const pick = withCover[Math.floor((Date.now() / 60000) % Math.max(1, withCover.length))] || songs[0];
    const devs = input.listDevices().filter((d) => d.kind !== 'key');
    const devArt = (list) => list.slice(0, 4).map((d) => { const det = detectController(d, bindings.baseOf(d.profileKey)); return `<div class="hero-dev"><div class="ctl-art">${controllerPicture(det.kind)}</div><span>${esc(det.name)}</span></div>`; }).join('');
    const status = `<div class="hero-status">
      <span class="${h ? 'ok' : 'warn'}"><i></i>${h ? `AI · Demucs ${esc(h.model)} · ${esc(h.gpu || 'CPU')}` : settings.aiEnabled ? 'AI splitter offline — DSP fallback' : 'AI server off — DSP fallback'}</span>
      <span class="ok"><i></i>${songs.length} song${songs.length === 1 ? '' : 's'}</span>
      <span class="${devs.length ? 'ok' : ''}"><i></i>${devs.length ? `${devs.length} controller${devs.length === 1 ? '' : 's'}` : 'Keyboard'}</span></div>`;
    let body = '';
    const cover = (s) => { const cv = s && coverUrl(s); return `<div class="hero-cover" style="background:${cv ? `url('${cv}') center/cover` : this.art(s || { hue: 320 })}">${cv || !s ? '' : `<span class="cover-type">${esc(s.title)}</span>`}</div>`; };
    switch (key) {
      case 'play': body = `${cover(pick)}<div class="hero-k">Quickplay</div><h2>${pick ? esc(pick.title) : 'Your setlist'}</h2><p>${pick ? `${esc(pick.artist)} · ${Math.round(pick.bpm)} BPM · ${fmtTime(pick.duration)}` : 'Import a song to get started.'}</p>`; break;
      case 'band': body = `<div class="hero-k">Local multiplayer</div><h2>Up to 4 players</h2><p>Everyone brings a controller and gets their own highway.</p><div class="hero-devs">${devArt(devs) || '<p class="dim">Or share one keyboard.</p>'}</div>`; break;
      case 'online': body = `<div class="hero-k">Online multiplayer</div><h2>Play with friends</h2><p>Host and share an invite code. No port forwarding.</p>`; break;
      case 'import': body = `<div class="hero-k">Any song</div><h2>Import &amp; split by AI</h2><p>Drop a file or search YouTube — AI splits it into parts.</p>`; break;
      case 'tour': {
        if (!p) { body = '<div class="hero-k">Tour</div><h2>Hit the road</h2><p>Sign in to play gigs from the Garage to the Festival main stage.</p>'; break; }
        const ch = this.tour.daily();
        const stars = tourStars(p);
        body = `<div class="hero-k">Tour</div><h2>${fa('star')} ${stars} <small>/ ${TOUR_MAX}</small></h2><div class="xpbar"><div style="width:${Math.round((stars / TOUR_MAX) * 100)}%"></div></div>${ch ? `<p><b>Daily challenge${dailyDone(p) ? ' ✓' : ''}</b><br>${esc(ch.title)} · ${ch.instrument} · ${esc(ch.text)}</p>` : ''}`;
        break;
      }
      case 'stream': body = `<div class="hero-k">Stream mode</div><h2>Let chat play along</h2><p>Twitch chat votes for songs, requests with !sr and hypes the crowd. OBS overlay included.</p>${settings.twitchChannel ? `<p class="dim">Channel: #${esc(settings.twitchChannel)}</p>` : ''}`; break;
      case 'setlists': {
        const lists = this.setlists.lists();
        body = `<div class="hero-k">Setlists</div><h2>Marathon mode</h2><p>Build setlists and play them back to back for one big score.</p>${lists.length ? lists.slice(0, 3).map((l) => `<div class="hero-row"><b>${fa('list-ol')}</b><span>${esc(l.name)}</span><em>${l.songs.length} songs</em></div>`).join('') : ''}`;
        break;
      }
      case 'career': {
        if (!p) { body = '<div class="hero-k">Career</div><h2>Sign in</h2><p>Earn XP, levels and achievements.</p>'; break; }
        const lv = levelInfo(p.xp);
        body = `<div class="hero-k">Career</div><div class="hero-prof">${avatarHtml(p, 72)}<div><h2>${esc(p.name)}</h2><p>Level ${lv.level} · ${esc(lv.rank)}</p></div></div><div class="xpbar"><div style="width:${Math.round(lv.progress * 100)}%"></div></div><p class="dim">${lv.into.toLocaleString()} / ${lv.span.toLocaleString()} XP to level ${lv.level + 1}</p>`;
        break;
      }
      case 'chartlib': body = '<div class="hero-k">Chart library</div><h2>Every charted song</h2><p>Songs players have charted, with their ranked parts. Get one you don\u2019t have from YouTube and play its ranked chart.</p>'; break;
      case 'leaderboard': {
        const rows = profiles.globalBoard().slice(0, 3);
        body = `<div class="hero-k">Leaderboards</div><h2>Top players</h2>${rows.length ? rows.map((r, i) => `<div class="hero-row"><b>${i + 1}</b>${avatarHtml(r.profile, 28)}<span>${esc(r.profile.name)}</span><em>${r.totalScore.toLocaleString()}</em></div>`).join('') : '<p class="dim">No scores yet.</p>'}`;
        break;
      }
      case 'controller': body = `<div class="hero-k">Controllers</div><h2>${devs.length ? `${devs.length} connected` : 'Keyboard ready'}</h2><p>Profiles, bindings and live tests.</p><div class="hero-devs">${devArt(devs)}</div>`; break;
      case 'settings': body = `<div class="hero-k">Settings</div><h2>Tune the show</h2><p>Note speed ${settings.noteSpeed} · ${settings.quality} graphics · audio offset ${settings.audioOffset > 0 ? '+' : ''}${settings.audioOffset} ms</p>`; break;
      case 'exit': body = `<div class="hero-k">Exit</div><h2>Done for today?</h2><p>Closes STEMSTAGE and everything it started (game server, controller bridge, AI splitter). Your songs, scores and profiles are saved.</p>`; break;
      case 'howto': body = `<div class="hero-k">How to play</div><h2>Tip</h2><p>${esc(MENU_TIPS[Math.floor(Date.now() / 8000) % MENU_TIPS.length])}</p>`; break;
      default: body = '';
    }
    el.innerHTML = `<div class="hero-body">${body}</div>${status}`;
  }

  // ---------------------------------------------------------------- library
  async reloadSongs() {
    this.songs = await listSongs();
    this.songs.sort((a, b) => (a.method === 'demo') - (b.method === 'demo') || b.createdAt - a.createdAt);
    this.refreshStatus();
    return this.songs;
  }

  filteredSongs() {
    const q = this.search.trim().toLowerCase();
    let list = this.songs.filter((s) => !q || [s.title, s.artist, s.album, s.genre, s.year].some((v) => String(v || '').toLowerCase().includes(q)));
    const by = {
      recent: (x, y) => (x.method === 'demo') - (y.method === 'demo') || y.createdAt - x.createdAt,
      title: (x, y) => String(x.title).localeCompare(String(y.title)),
      artist: (x, y) => String(x.artist).localeCompare(String(y.artist)) || String(x.title).localeCompare(String(y.title)),
      bpm: (x, y) => x.bpm - y.bpm,
      length: (x, y) => x.duration - y.duration,
    }[this.sort] || (() => 0);
    list = list.slice().sort(by);
    return list;
  }

  async renderLibrary(selectId) {
    await this.reloadSongs();
    const list = $('#song-list');
    $('#pick-sort').innerHTML = SORTS.map(([v, l]) => `<div class="opt ${v === this.sort ? 'sel' : ''}" data-v="${v}">${l}</div>`).join('');
    $$('#pick-sort .opt').forEach((o) => o.addEventListener('click', () => { this.sort = o.dataset.v; localStorage.setItem('stemstage.sort', this.sort); this.renderLibrary(); }));
    const songs = this.filteredSongs();
    $('#lib-count').textContent = `${songs.length} of ${this.songs.length} song${this.songs.length === 1 ? '' : 's'}${this.mode === 'band' ? ` · band of ${this.party.length}` : this.mode === 'online-pick' ? ' · choose a song for the room' : ''}`;
    if (!this.songs.length) {
      list.innerHTML = '<div class="empty-list">Your setlist is empty.<br/>Import a song to get started — the demo track is being prepared.</div>';
    } else if (!songs.length) {
      list.innerHTML = `<div class="empty-list">No songs match "${esc(this.search)}".</div>`;
    } else {
      list.innerHTML = songs.map((s) => {
        const badge = s.method === 'ai' ? '<span class="badge ai">AI</span>' : s.method === 'demo' ? '<span class="badge demo">Demo</span>' : '<span class="badge dsp">DSP</span>';
        const cv = coverUrl(s);
        const bg = cv ? `url('${cv}') center/cover` : this.art(s);
        const sub = [s.album, s.year, s.genre].filter(Boolean).join(' · ');
        const insts = INSTRUMENTS.filter((i) => s.charts[i.id]?.available).map((i) => i.ico).join('');
        return `<div class="song-card" data-nav data-song="${s.id}">
          <div class="thumb" style="background:${bg}"></div>
          <div class="sc-txt"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)} · ${fmtTime(s.duration)} · ${Math.round(s.bpm)} BPM</div>${sub ? `<div class="g">${esc(sub)}</div>` : ''}</div>
          <div class="sc-side"><span class="insts">${insts}</span>${badge}</div></div>`;
      }).join('');
      $$('.song-card', list).forEach((c) => c.addEventListener('click', () => this.selectSong(c.dataset.song, true)));
    }
    const pick = selectId || (songs.some((x) => x.id === this.selected?.id) ? this.selected.id : songs[0]?.id);
    if (pick) this.selectSong(pick, false);
    else this.renderDetail(null);
    const items = this.navItems();
    this.focus = Math.max(0, items.findIndex((x) => x.dataset.song === pick));
    this.applyFocus(false);
  }

  /** Sleeve for a song without cover art: two screen-printed blocks of the song's colour under a halftone. */
  art(s) {
    const h = s?.hue ?? 20;
    return `radial-gradient(circle, rgba(12,10,8,0.4) 1.1px, transparent 1.6px) 0 0 / 6px 6px, linear-gradient(162deg, hsl(${h} 38% 43%) 0 52%, hsl(${(h + 12) % 360} 45% 24%) 52%)`;
  }

  selectSong(id, focusDetail) {
    const s = this.songs.find((x) => x.id === id);
    if (!s) return;
    this.selected = s;
    $$('.song-card').forEach((c) => c.classList.toggle('selected', c.dataset.song === id));
    if (!s.charts[this.instrument]?.available) {
      const firstOk = INSTRUMENTS.find((i) => s.charts[i.id]?.available);
      if (firstOk) this.instrument = firstOk.id;
    }
    this.renderDetail(s);
    if (focusDetail) this.focusAction('play');
    this.queuePreview(s);
  }

  // ---------------------------------------------------------------- song previews
  queuePreview(song) {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(async () => {
      if (this.screen !== 'library' || this.selected?.id !== song.id) return;
      let s = song;
      if (!s.preview && s.method !== undefined) {
        s = await ensurePreview(song).catch(() => song);
        if (s !== song) { const i = this.songs.findIndex((x) => x.id === s.id); if (i >= 0) this.songs[i] = s; if (this.selected?.id === s.id) this.selected = s; }
      }
      const url = previewUrl(s);
      if (!url || this.screen !== 'library' || this.selected?.id !== s.id) return;
      this.app.menuMusic(false);
      const a = this.previewAudio;
      if (a.dataset.song !== s.id) { a.src = url; a.dataset.song = s.id; a.currentTime = 0; }
      a.volume = 0;
      a.play().catch(() => {});
      const target = Math.min(1, settings.menuMusicVolume * 1.6 * settings.masterVolume);
      const t0 = performance.now();
      const fade = () => { const k = Math.min(1, (performance.now() - t0) / 600); a.volume = target * k; if (k < 1 && !a.paused) requestAnimationFrame(fade); };
      fade();
      const dot = $('#detail-title .preview-dot');
      if (!dot) $('#detail-title').insertAdjacentHTML('beforeend', '<span class="preview-dot" title="Preview playing"></span>');
    }, 450);
  }

  stopPreview() {
    clearTimeout(this.previewTimer);
    const a = this.previewAudio;
    if (a && !a.paused) a.pause();
    $('#detail-title .preview-dot')?.remove();
  }

  renderDetail(s) {
    const d = $('#song-detail');
    d.style.visibility = s ? 'visible' : 'hidden';
    if (!s) return;
    const band = this.mode === 'band';
    const pickForRoom = this.mode === 'online-pick';
    const cv = coverUrl(s);
    const art = $('#detail-art');
    art.classList.toggle('has-cover', !!cv);
    art.style.background = cv ? '#000' : this.art(s);
    art.innerHTML = (cv ? `<img src="${cv}" alt="" />` : `<span class="cover-type">${esc(s.title)}</span>`) + `<div class="bpm">${Math.round(s.bpm)}<small> BPM</small></div>`;
    $('#detail-title').textContent = s.title;
    $('#detail-artist').textContent = s.artist;
    const tr = s.analysis?.transcriber || {};
    const neural = Object.values(tr).includes('basic-pitch');
    $('#detail-meta').innerHTML = [
      `<span class="badge ${s.method}">${esc(s.model || s.method)}</span>`,
      `<span class="badge">${fmtTime(s.duration)}</span>`,
      `<span class="badge">${(s.stemNames || []).length} stems</span>`,
      neural ? '<span class="badge ai">neural notes</span>' : '',
      (s.remarks || []).length ? `<span class="badge" title="${esc(s.remarks.join('\n'))}">${s.remarks.length} note${s.remarks.length === 1 ? '' : 's'}</span>` : '',
    ].join('');
    const extra = [s.album && `${fa('compact-disc')} ${esc(s.album)}`, s.year && esc(s.year), s.genre && esc(s.genre)].filter(Boolean);
    if (s.source?.type === 'youtube' && s.source.url) extra.push(`<a href="${esc(s.source.url)}" target="_blank" rel="noopener">${fa('play')} YouTube</a>`);
    
    $('#detail-extra').innerHTML = extra.map((x) => `<span>${x}</span>`).join('');
    $$('#song-detail .picker').forEach((p) => { p.style.display = band ? 'none' : ''; });
    const bb = $('#detail-band');
    if (band) {
      bb.innerHTML = '<div class="small-note">Band — click a player to change their instrument</div>' + this.party.map((p, i) => {
        const ok = s.charts[p.instrument]?.available;
        const n = s.charts[p.instrument]?.notes?.[p.difficulty]?.length ?? 0;
        const prof = profiles.byId(p.profileId);
        return `<div class="band-row ${ok ? '' : 'bad'}" data-player="${i}" style="--pc:${prof?.color || PLAYER_COLORS[i]}">${esc(prof?.name || p.name)} ${INST_ICON[p.instrument]} ${p.instrument} · ${p.difficulty}${p.strum ? ' · strum' : ''}<small>${ok ? `${n} notes` : 'no chart — click to change'}</small></div>`;
      }).join('') + '<button class="nav-btn" data-nav data-action="band">Edit band</button>';
      $$('.band-row', bb).forEach((r) => r.addEventListener('click', () => {
        const p = this.party[+r.dataset.player];
        const ok = INSTRUMENTS.filter((x) => s.charts[x.id]?.available).map((x) => x.id);
        if (ok.length) { p.instrument = ok[(ok.indexOf(p.instrument) + 1) % ok.length]; if (p.instrument === 'drums') p.strum = false; }
        this.renderDetail(s);
      }));
      $('[data-action="band"]', bb).addEventListener('click', () => this.show('band'));
    } else {
      bb.innerHTML = '';
      $('#pick-instrument').innerHTML = INSTRUMENTS.map((i) => {
        const ch = s.charts[i.id];
        const ok = ch?.available;
        const count = ok ? ch.notes[this.difficulty]?.length : 0;
        return `<div class="opt inst ${i.id === this.instrument ? 'sel' : ''} ${ok ? '' : 'disabled'}" data-val="${i.id}" title="${ok ? `${count} notes` : esc(ch?.reason || '')}"><span class="ico">${i.ico}</span><span>${i.label}</span>${ok ? ratingHtml(rating(ch.notes[this.difficulty])) : ''}</div>`;
      }).join('');
      const tier = s.charts[this.instrument]?.available ? rating(s.charts[this.instrument].notes[this.difficulty]) : 0;
      $('#pick-tier').textContent = `${tier ? `— ${TIERS[tier]}` : ''}${settings.proMode ? ' · PRO' : ''}`;
      $('#pick-tier').classList.toggle('max', tier >= 7);
      $('#pick-difficulty').innerHTML = DIFFS.map((df) => {
        const n = s.charts[this.instrument]?.notes?.[df]?.length ?? 0;
        return `<div class="opt ${df === this.difficulty ? 'sel' : ''}" data-val="${df}">${df}<small>${n}</small></div>`;
      }).join('');
      $$('#pick-instrument .opt').forEach((o) => o.addEventListener('click', () => { this.instrument = o.dataset.val; settings.lastInstrument = this.instrument; this.renderDetail(s); }));
      const rw = $('#pick-real-wrap');
      rw.hidden = !['guitar', 'bass', 'keys'].includes(this.instrument);
      $('#pick-real').innerHTML = [[false, `${fa('gamepad')} Controller`], [true, this.instrument === 'keys' ? `${instIcon('keys')} Real keyboard` : `${instIcon(this.instrument)} Real ${this.instrument}`]].map(([v, l]) => `<div class="opt ${!!settings.realInstrument === v ? 'sel' : ''}" data-val="${v}">${l}</div>`).join('');
      $$('#pick-real .opt').forEach((o) => o.addEventListener('click', () => { settings.realInstrument = o.dataset.val === 'true'; this.renderDetail(s); }));
      const vw = $('#pick-vocal-wrap');
      vw.hidden = this.instrument !== 'vocals';
      $('#pick-vocal').innerHTML = [['mic', `${fa('microphone')} Sing`], ['buttons', `${fa('gamepad')} Buttons`]].map(([v, l]) => `<div class="opt ${settings.vocalMode === v ? 'sel' : ''}" data-val="${v}">${l}${v === 'mic' && !s.lyrics?.words?.length ? '<small>no lyrics yet</small>' : ''}</div>`).join('');
      $$('#pick-vocal .opt').forEach((o) => o.addEventListener('click', () => { settings.vocalMode = o.dataset.val; this.renderDetail(s); }));
      // vocal harmonies (AI-charted songs): sing the lead or one of the harmony parts
      const harm = s.charts?.vocals?.harmonies || [];
      const pw = $('#pick-vpart-wrap');
      pw.hidden = this.instrument !== 'vocals' || settings.vocalMode !== 'mic' || !harm.some((x) => x?.length);
      $('#pick-vpart').innerHTML = VOCAL_PARTS.map(([v, l]) => `<div class="opt ${(settings.vocalPart || 0) === v ? 'sel' : ''} ${v && !harm[v - 1]?.length ? 'disabled' : ''}" data-val="${v}">${l}</div>`).join('');
      $$('#pick-vpart .opt:not(.disabled)').forEach((o) => o.addEventListener('click', () => { settings.vocalPart = +o.dataset.val; this.renderDetail(s); }));
      $$('#pick-difficulty .opt').forEach((o) => o.addEventListener('click', () => { this.difficulty = o.dataset.val; settings.lastDifficulty = this.difficulty; this.renderDetail(s); }));
    }
    const lb = band || pickForRoom ? [] : profiles.leaderboard(s.id, this.instrument, this.difficulty, 3);
    const meId = profiles.current?.id;
    $('#detail-lb').innerHTML = band || pickForRoom ? '' : `<h4>Leaderboard · ${this.instrument} · ${this.difficulty}</h4>` + (lb.length
      ? lb.map((r, i) => `<div class="lb-row ${r.profileId === meId ? 'me' : ''}"><span class="pos">${i + 1}</span><span>${avatarHtml(r.profile, 20)} ${esc(r.profileName)}</span><b>${r.score.toLocaleString()}</b><small>${starsOnly(r.stars)}${r.fc ? ` ${fa('gem')}` : ''}</small></div>`).join('')
      : '<div class="small-note">No scores yet — be the first.</div>');
    this.renderWorldLine(s);
    const best = band || pickForRoom ? null : getBest(s.id, this.instrument, this.difficulty);
    $('#detail-best').innerHTML = best && !lb.length ? `Best (guest): <b>${best.score.toLocaleString()}</b> · ${starsOnly(best.stars)}` : '';
    $('[data-action="play"]').innerHTML = pickForRoom ? `${fa('check')} Select for match` : this.mode === 'setlist-add' ? `${fa('plus')} Add to setlist` : `${fa('play')} Play`;
    $('[data-action="song-options"]').style.display = pickForRoom ? 'none' : '';
    this.applyFocus(false);
  }

  songOptions() {
    const s = this.selected;
    if (!s || this.mode === 'online-pick') return;
    const band = this.mode === 'band';
    this.openSheet({
      title: s.title, sub: `${s.artist} · ${fmtTime(s.duration)}`,
      items: [
        { label: 'Play', icon: 'play', desc: band ? `${this.party.length}-player band` : `${this.instrument} · ${this.difficulty}`, run: () => this.play() },
        ...(band ? [] : [{ label: 'Practice', desc: 'Slow it down (pitch preserved) and start anywhere', run: () => this.openPractice() }]),
        { label: 'Replays & ghosts', desc: 'Watch a recorded run, or race it as a ghost', run: () => this.replaysSheet(s) },
        { label: 'Add to setlist…', desc: 'Put it in a setlist for a marathon', run: () => this.setlists.addToSheet(s) },
        ...(band ? [] : [{ label: 'World charts', icon: 'earth-americas', desc: `The ranked ${this.instrument} chart and the others players uploaded: play one or vote`, disabled: !s.charts[this.instrument]?.available || settings.worldLeaderboard === false, run: () => this.worldChartsSheet(s) }]),
        ...(band ? [] : [{ label: 'Edit chart', desc: `Fix the ${this.instrument} · ${this.difficulty} notes by hand`, disabled: !s.charts[this.instrument]?.available, run: () => this.editor.open(s.id, this.instrument, this.difficulty) }]),
        { label: s.lyrics?.words?.length ? 'Redo lyrics (AI)' : 'Get lyrics (AI)', desc: this.aiStatus?.lyrics ? `Whisper listens to the vocal stem${s.lyrics?.words?.length ? ` · ${s.lyrics.words.length} words now` : ''}` : 'Needs the AI splitter with Whisper (npm run ai:setup)', disabled: !this.aiStatus?.lyrics || !(s.stemNames || []).includes('vocals'), run: () => this.getLyrics(s) },
        { label: 'Check lyrics online', desc: s.lyrics?.reference ? `Checked against ${s.lyrics.reference.source}${s.lyrics.corrected ? ` · ${s.lyrics.corrected} words fixed` : ''}` : s.lyrics?.words?.length ? 'Fix misheard words with a lyrics database (LRCLIB), keeping the AI timing' : 'Time-synced lyrics from LRCLIB (no AI needed)', disabled: !s.charts?.vocals?.available && !s.lyrics?.words?.length, run: () => this.checkSongLyrics(s) },
        { label: 'Re-chart with AI', desc: 'Run note transcription again for every part', run: () => this.rechart() },
        { label: 'Edit song info', desc: 'Title, artist, album, cover — or look it up online', run: () => this.openSongInfo() },
        { label: 'Export chart pack', desc: 'MIDI + song.ini + WAV stems (Clone Hero / YARG layout)', run: () => this.exportSong() },
        { label: 'Delete song', desc: s.method === 'demo' ? 'The demo track stays' : 'Removes its folder from the songs folder', danger: true, disabled: s.method === 'demo', run: () => this.removeSong() },
      ],
    });
  }

  cyclePicker(which, d) {
    let m;
    if (this.pickerHooks.some((h) => h(which, d))) return;
    if (which === 'real-mode' && this.selected) { settings.realInstrument = !settings.realInstrument; this.renderDetail(this.selected); return; }
    if (which === 'vocal-mode' && this.selected) { settings.vocalMode = settings.vocalMode === 'mic' ? 'buttons' : 'mic'; this.renderDetail(this.selected); return; }
    if (which === 'vocal-part' && this.selected) {
      const harm = this.selected.charts?.vocals?.harmonies || [];
      const ok = VOCAL_PARTS.map(([v]) => v).filter((v) => !v || harm[v - 1]?.length);
      settings.vocalPart = ok[(ok.indexOf(settings.vocalPart || 0) + d + ok.length) % ok.length];
      this.renderDetail(this.selected);
      return;
    }
    if (which === 'lib-sort') {
      const i = SORTS.findIndex(([v]) => v === this.sort);
      this.sort = SORTS[(i + d + SORTS.length) % SORTS.length][0];
      localStorage.setItem('stemstage.sort', this.sort);
      this.renderLibrary();
      return;
    }
    if (which === 'import-tab') { this.importTab = this.importTab === 'file' ? 'youtube' : 'file'; this.renderImportTab(); return; }
    if (which === 'pr-speed') { const i = SPEEDS.indexOf(this.practice.speed); this.practice.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))]; this._renderPractice(); return; }
    if (which === 'pr-start') { this.practice.startPct = Math.max(0, Math.min(95, this.practice.startPct + d * 5)); $('#pr-start-range').value = this.practice.startPct; this._renderPracticeStart(); return; }
    if ((m = /^slot-(\w+)-(\d)$/.exec(which))) { this._slotCycle(this.party[+m[2]], m[1], d); return; }
    if (which === 'instrument' && this.selected) {
      const ok = INSTRUMENTS.filter((i) => this.selected.charts[i.id]?.available).map((i) => i.id);
      if (!ok.length) return;
      this.instrument = ok[(ok.indexOf(this.instrument) + d + ok.length) % ok.length];
      settings.lastInstrument = this.instrument;
      this.renderDetail(this.selected);
    } else if (which === 'difficulty' && this.selected) {
      this.difficulty = DIFFS[Math.max(0, Math.min(3, DIFFS.indexOf(this.difficulty) + d))];
      settings.lastDifficulty = this.difficulty;
      this.renderDetail(this.selected);
    } else if (which === 'splitter') {
      const opts = ['auto', 'ai', 'dsp'];
      this.splitter = opts[(opts.indexOf(this.splitter) + d + 3) % 3];
      settings.splitter = this.splitter;
      this.renderSplitter();
    }
  }

  /** Strum mode for a device: global override, else the device's config profile. */
  strumFor(deviceId) {
    if (settings.strumMode === 'on') return true;
    if (settings.strumMode === 'off') return false;
    const input = this.app.input;
    const opt = input.optionsFor(deviceId).strum;
    if (opt === 'on') return true;
    if (opt === 'off') return false;
    const keys = deviceId === 'any' ? input.listDevices().filter((d) => d.kind === 'pad').map((d) => d.profileKey) : [input.profileFor(deviceId)];
    return keys.some((k) => k && (bindings.baseOf(k) === 'guitar' || bindings.profile(k)?.five?.strum?.length));
  }

  /** Real instrument mode for a part: 'midi' (keys with a MIDI keyboard), 'audio' (guitar / bass / keys by ear) or null. */
  realMode(inst) {
    if (!settings.realInstrument || !['guitar', 'bass', 'keys'].includes(inst)) return null;
    return inst === 'keys' && this.app.input.midiInputs?.size ? 'midi' : 'audio';
  }

  /** Per-player options from the controller's config profile. */
  deviceCfg(deviceId) {
    const o = this.app.input.optionsFor(deviceId);
    return { lefty: o.lefty === 'global' ? settings.leftyFlip : o.lefty === 'on', rumble: o.rumble !== 'off', triggers: o.triggers !== 'off' };
  }

  async play(opts = {}) {
    const s = this.selected;
    if (!s) return;
    if (this.mode === 'online-pick') { this.onlineUi.selectForRoom(s); return; }
    if (this.mode === 'setlist-add') { this.setlists.addSong(s); return; }
    let cfgs;
    if (this.mode === 'band' && this.party.length) {
      const bad = this.party.find((p) => !s.charts[p.instrument]?.available);
      if (bad) { this.toast(`${bad.name}: this song has no ${bad.instrument} chart — pick another instrument`, 'err'); return; }
      let micTaken = false; // one singer on the microphone; other vocalists use buttons
      cfgs = this.party.map((p) => {
        const mic = p.instrument === 'vocals' && settings.vocalMode === 'mic' && !micTaken;
        micTaken ||= mic;
        return { ...p, ...this.deviceCfg(p.device), color: profiles.byId(p.profileId)?.color, mic };
      });
    } else {
      if (!s.charts[this.instrument]?.available) { this.toast('That instrument has no chart for this song', 'err'); return; }
      const p = profiles.current;
      cfgs = [{ name: p?.name || 'P1', color: p?.color, profileId: p?.id || null, device: 'any', instrument: this.instrument, difficulty: this.difficulty, strum: this.instrument !== 'drums' && this.strumFor('any'), ...this.deviceCfg('any'), mic: this.instrument === 'vocals' && settings.vocalMode === 'mic', part: this.instrument === 'vocals' && settings.vocalMode === 'mic' ? settings.vocalPart || 0 : 0, real: this.realMode(this.instrument) }];
    }
    this.app.engine.unlock();
    this.toast(`Loading ${s.title}...`);
    const [song, audio] = await Promise.all([getSong(s.id), getAudio(s.id)]);
    if (!audio) { this.toast('Audio for this song is missing — re-import it', 'err'); return; }
    await this.prepareWorld(song, audio, cfgs.map((c) => c.instrument));
    this.applyVenue(true);
    this.applyLooks(cfgs);
    this.app.menuMusic(false);
    this.stopPreview();
    const ghost = opts.ghost !== undefined ? opts.ghost
      : cfgs.length === 1 ? await pickGhost(settings.ghost, s.id, cfgs[0].instrument, cfgs[0].difficulty, cfgs[0].profileId) : null;
    this.lastPlay = { mode: this.mode, ghost };
    this.show('hud');
    await this.app.game.start(song, audio, cfgs, { ghost });
  }

  // ---------------------------------------------------------------- venues
  /** The venue the stage shows: a tour gig plays in its own venue; otherwise Settings → Venue, once the tour has opened it. */
  venueId(forGame = false) {
    const gig = forGame && /^tour-(.+)$/.exec(this.marathon?.list?.id || '')?.[1];
    if (gig) return gig;
    const want = settings.venue;
    if (!want || want === 'auto' || want === 'arena') return 'arena';
    const v = VENUES.find((x) => x.id === want);
    return v && unlocked(profiles.current, v) ? want : 'arena';
  }

  applyVenue(forGame = false) { this.app.stage.setVenue(this.venueId(forGame)); }

  /** Import a song the world has charts for: search YouTube for it; it keeps the world's title and artist. */
  findOnYouTube(artist, title) {
    this.worldWant = { artist, title };
    this.show('import');
    this.importTab = 'youtube';
    this.renderImportTab();
    $('#yt-q').value = artist ? `${artist} - ${title}` : title;
    this.action('yt-search');
  }

  /**
   * The band on stage: each player's character at their part (cfgs: [{ instrument, profileId?, look? }]);
   * in the menus, the signed-in profile's at the part it picked.
   */
  applyLooks(cfgs = null) {
    const stage = this.app.stage;
    stage.resetLooks();
    if (cfgs) {
      for (const c of cfgs) { const look = (c.profileId && profiles.byId(c.profileId)?.look) || c.look; if (look) stage.setLook(c.instrument, look); }
      return;
    }
    const p = profiles.current;
    if (p?.look) stage.setLook(p.look.part || 'guitar', p.look);
  }

  // ---------------------------------------------------------------- ranked charts (see net/charts.js)
  /** Before a song starts: fingerprint the recording once, and put the ranked chart on the parts being played. */
  async prepareWorld(song, audio, insts) {
    if (settings.worldLeaderboard === false) return;
    try { await ensureFingerprint(song, audio); } catch (e) { console.warn('fingerprint:', e.message); return; }
    const res = await prepareRankedCharts(song, audio, insts, (msg) => this.toast(msg));
    for (const r of res) {
      if (r.status === 'swapped') this.toast(`Playing the ranked ${r.inst} chart, lined up with your recording (${r.offset >= 0 ? '+' : '−'}${Math.abs(r.offset).toFixed(2)} s)`, 'ok', 'earth-americas');
      else if (r.status === 'refused' && r.fresh) this.toast(`The ranked ${r.inst} chart doesn't fit your recording: ${r.reason}. You play your own chart (it has its own board)`, 'err');
    }
    if (res.some((r) => r.status === 'swapped' || r.fresh)) this.reloadSongs().catch(() => {});
  }

  /** The ranked-chart status of the picked part, under the pickers (the chart list is fetched in the background). */
  renderWorldLine(s) {
    const el = $('#detail-world');
    if (!el) return;
    const inst = this.instrument, part = s.charts[inst];
    const ticket = (this._worldTicket = (this._worldTicket || 0) + 1);
    el.innerHTML = '';
    if (this.mode === 'band' || this.mode === 'online-pick' || settings.worldLeaderboard === false || !part?.available) return;
    const set = (cls, stamp, text) => {
      if (ticket !== this._worldTicket) return;
      el.className = `world-line ${cls}`;
      el.innerHTML = `${fa('earth-americas')}<span class="stamp">${stamp}</span><span class="txt">${text}</span>`;
    };
    if (part.pin && !part.world) { set('own', 'Your chart', 'You picked your own chart: its runs have their own board'); return; }
    if (settings.rankedCharts === false && !part.world) { set('own', 'Your chart', 'Ranked charts are off (Settings): runs go on this chart\u2019s own board'); return; }
    setTimeout(() => {
      if (ticket !== this._worldTicket) return;
      Promise.all([worldCharts(s, inst), partChart(inst, part)]).then(([list, cur]) => {
        const r = list.rows.find((x) => x.ranked);
        const by = r?.uploader ? `Chart by ${esc(r.uploader)}` : 'The ranked chart';
        const players = r ? ` · ${r.players} player${r.players === 1 ? '' : 's'}` : '';
        if (!list.rankedChart) set('soon', 'No ranked chart yet', 'Finish a run: your chart becomes the one everyone plays');
        else if (cur.id === list.rankedChart) set('ranked', 'Ranked', `${by}${players}`);
        else if (part.pin) set('own', 'Picked chart', `${part.world?.uploader ? `By ${esc(part.world.uploader)} · ` : ''}not the ranked one, so its runs have their own board`);
        else if (part.refused?.id === list.rankedChart) set('own', 'Your chart', `The ranked chart doesn\u2019t fit your recording (${esc(part.refused.reason)})`);
        else set('soon', 'Ranked chart', `${by}${players} · swapped in when you play`);
      }).catch(() => { if (ticket === this._worldTicket) el.innerHTML = ''; });
    }, 250);
  }

  /** Song options → World charts: every chart uploaded for this part, ranked first; play one or vote. */
  async worldChartsSheet(s) {
    const inst = this.instrument;
    const part = s.charts[inst];
    if (!part?.available) { this.toast(`This song has no ${inst} chart`, 'err'); return; }
    let list, cur;
    try { [list, cur] = await Promise.all([worldCharts(s, inst, { fresh: true }), partChart(inst, part)]); } catch (e) { this.toast(`World charts can't be reached right now (${e.message})`, 'err'); return; }
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const items = list.rows.map((r) => ({
      label: `${r.ranked ? 'Ranked · ' : ''}Chart by ${r.uploader || 'a player'}${r.id === cur.id ? ' · playing' : ''}`, icon: r.ranked ? 'crown' : r.id === cur.id ? 'circle-play' : 'file-lines',
      desc: `${plural(r.votes, 'vote')} · ${plural(r.players, 'player')} · ${r.notes} expert notes${r.edited ? ' · hand-edited' : ''}${list.myVote === r.id ? ' · your vote' : ''}`,
      run: () => setTimeout(() => this.worldChartSheet(s, inst, r, list, cur), 0),
    }));
    if (!items.length) items.push({ label: 'No charts uploaded yet', desc: 'Finish a run on this part and yours becomes the ranked chart', disabled: true });
    const mineOn = !part.world && !list.rows.some((r) => r.id === cur.id && r.ranked);
    if (part.world || !part.pin) items.push({ label: 'Play my own chart', icon: 'user', desc: mineOn && !part.pin ? 'You play it now (the ranked one is lined up when you play, unless you pick this)' : 'The chart your import made (or your edits): its runs have their own board', run: () => this.ownWorldChart(s, inst) });
    if (part.pin || part.refused) items.push({ label: 'Play the ranked chart again', icon: 'rotate', desc: 'Swap the ranked chart back in the next time you play', run: () => this.rankedWorldChart(s, inst) });
    if (!list.rows.some((r) => r.id === cur.id)) items.push({ label: 'Share my chart', icon: 'share-nodes', desc: profiles.current ? 'Put your chart in the chart library now (a chart you fixed in the editor, say), for others to play and vote for' : 'Sign in to share charts', disabled: !profiles.current, run: () => this.shareWorldChart(s, inst) });
    this.openSheet({ title: `World charts · ${inst}`, sub: `${s.title} · a chart needs ${list.voteMin} votes, and more than the ranked one has, to replace it`, items });
  }

  worldChartSheet(s, inst, r, list, cur) {
    const playing = r.id === cur.id;
    this.openSheet({
      title: `Chart by ${r.uploader || 'a player'}`, sub: `${r.ranked ? 'Ranked · ' : ''}${r.votes} vote${r.votes === 1 ? '' : 's'} · ${r.runs} run${r.runs === 1 ? '' : 's'} · uploaded ${new Date(r.date * 1000).toLocaleDateString()}`,
      items: [
        { label: playing ? 'You play this chart' : 'Play this chart', icon: 'download', desc: playing ? 'It is on this part now' : 'Download it and line it up with your recording', disabled: playing, run: () => this.pickWorldChart(s, inst, r) },
        { label: list.myVote === r.id ? 'You voted for this chart' : r.ranked ? 'Vote to keep it ranked' : 'Vote for this chart', icon: 'check-to-slot', desc: profiles.current ? 'One vote per song part, for a chart you have finished a run on' : 'Sign in to vote', disabled: list.myVote === r.id || !profiles.current, run: () => this.voteWorldChart(s, inst, r) },
      ],
    });
  }

  async pickWorldChart(s, inst, r) {
    this.toast('Downloading the chart and lining it up with your recording…');
    try {
      const song = await getSong(s.id);
      const res = await useWorldChart(song, () => getAudio(s.id), inst, r.id, { pin: !r.ranked });
      if (!res.ok) { this.toast(`That chart doesn't fit your recording: ${res.reason}`, 'err'); return; }
      if (r.ranked) await allowRanked(song, inst);
      await this.reloadSongs();
      this.toast(`${inst}: now playing the chart by ${r.uploader || 'a player'} (${res.offset >= 0 ? '+' : '−'}${Math.abs(res.offset).toFixed(2)} s)`, 'ok', 'earth-americas');
    } catch (e) { this.toast(`Couldn't get that chart: ${e.message}`, 'err'); }
    this._refreshDetail(s.id);
  }

  async ownWorldChart(s, inst) {
    const song = await getSong(s.id);
    await useOwnChart(song, inst);
    await this.reloadSongs();
    this.toast(`${inst}: playing your own chart (its runs have their own board)`, 'ok');
    this._refreshDetail(s.id);
  }

  async rankedWorldChart(s, inst) {
    const song = await getSong(s.id);
    await allowRanked(song, inst);
    await this.reloadSongs();
    this.toast(`${inst}: the ranked chart goes on the next time you play`, 'ok');
    this._refreshDetail(s.id);
  }

  async shareWorldChart(s, inst) {
    const p = profiles.current;
    if (!p) return;
    this.toast('Uploading your chart…');
    try {
      const song = await getSong(s.id);
      const res = await shareChart(song, inst, p, () => getAudio(s.id));
      this.toast(res.downloaded ? 'You play a world chart on this part: nothing new to share' : res.known ? 'That chart is in the library already' : res.ranked ? `Shared: your ${inst} chart is the first one, so it\u2019s the ranked chart` : `Shared: players can play your ${inst} chart and vote for it`, 'ok', 'share-nodes');
    } catch (e) { this.toast(`Couldn\u2019t share the chart: ${e.message}`, 'err'); }
    this._refreshDetail(s.id);
  }

  async voteWorldChart(s, inst, r) {
    const p = profiles.current;
    if (!p) { this.toast('Sign in to vote', 'err'); return; }
    try {
      const j = await voteChart(p, r.id);
      if (j.promoted) this.toast('Your vote made it the ranked chart!', 'ok', 'crown');
      else if (j.rankedChart === r.id) this.toast(`Voted to keep this chart ranked (${j.votes} vote${j.votes === 1 ? '' : 's'})`, 'ok', 'check-to-slot');
      else this.toast(`Voted · ${j.votes} of ${Math.max(j.voteMin, j.rankedVotes + 1)} votes it needs to become the ranked chart`, 'ok', 'check-to-slot');
    } catch (e) {
      this.toast(/before voting/.test(e.message) ? 'Finish a run on this chart first (Play this chart), then vote for it' : `Vote failed: ${e.message}`, 'err');
    }
    this._refreshDetail(s.id);
  }

  _refreshDetail(id) {
    if (this.screen === 'library' && this.selected?.id === id) this.renderDetail(this.songs.find((x) => x.id === id) || this.selected);
  }

  /** Song options → Get lyrics: Whisper on the vocal stem (runs in the background). */
  async getLyrics(s, quiet = false) {
    if (this._lyricsBusy?.has(s.id)) return;
    (this._lyricsBusy ||= new Set()).add(s.id);
    if (!quiet) this.toast(`Getting lyrics for "${s.title}"…`);
    try {
      const song = await getSong(s.id);
      const out = await fetchLyrics(song);
      await this.reloadSongs();
      const checked = out.reference ? ` · checked with ${out.reference.source}${out.corrected ? `, ${out.corrected} words fixed` : ''}` : '';
      this.toast(out.words.length ? `Lyrics ready for "${s.title}" · ${out.words.length} words (${out.language})${checked}` : `No sung words found in "${s.title}"`, out.words.length ? 'ok' : '');
      if (this.screen === 'library' && this.selected?.id === s.id) this.renderDetail(this.songs.find((x) => x.id === s.id));
    } catch (e) { if (!quiet) this.toast(`Lyrics failed: ${e.message}`, 'err'); }
    this._lyricsBusy.delete(s.id);
  }

  /** Song options → Check lyrics online: LRCLIB words on the AI's timing (or synced lines when there is no AI). */
  async checkSongLyrics(s) {
    if (this._lyricsBusy?.has(s.id)) return;
    (this._lyricsBusy ||= new Set()).add(s.id);
    this.toast(`Looking up lyrics for "${s.title}"…`);
    try {
      const song = await getSong(s.id);
      const r = await checkLyrics(song);
      if (r.changed) {
        await this.reloadSongs();
        const st = r.stats;
        this.toast(st.ai ? `Lyrics checked · ${st.fixed} misheard words fixed, ${st.added} missing added, ${st.dropped} extra removed` : `Lyrics added from LRCLIB · ${song.lyrics.words.length} words`, 'ok');
        if (this.screen === 'library' && this.selected?.id === s.id) this.renderDetail(this.songs.find((x) => x.id === s.id));
      } else {
        this.toast({ 'not found': `No lyrics found online for "${s.title}" — check the title and artist (Edit song info)`, instrumental: 'The lyrics database lists this song as instrumental', 'did not match the recording': 'The lyrics found online don’t match this recording — kept the AI lyrics', 'no timed lines': 'Only untimed lyrics online — get AI lyrics first, then check them' }[r.reason] || 'Lyrics unchanged', 'err');
      }
    } catch (e) { this.toast(`Lyrics check failed: ${e.message}`, 'err'); }
    this._lyricsBusy.delete(s.id);
  }

  // ---------------------------------------------------------------- replays + ghosts
  async replaysSheet(s) {
    const list = await replaysFor(s.id);
    if (!list.length) { this.toast('No replays for this song yet — every run you finish is recorded'); return; }
    const who = (r) => `${r.name} · ${r.instrument} · ${r.difficulty}`; // plain text: sheet titles are escaped
    this.openSheet({
      title: 'Replays & ghosts', sub: s.title,
      items: list.slice(0, 14).map((r) => ({
        label: `${r.score.toLocaleString()} · ${r.stars} star${r.stars === 1 ? '' : 's'}${r.fc ? ' · full combo' : ''}${r.failed ? ' · failed' : ''}`, icon: r.fc ? 'gem' : 'film',
        desc: `${who(r)} · ${new Date(r.date).toLocaleDateString()}`,
        run: () => setTimeout(() => this.openSheet({
          title: who(r), sub: `${r.score.toLocaleString()} · ${Math.round(r.accuracy * 100)}%`,
          items: [
            { label: 'Watch replay', icon: 'play', desc: 'See the run played back exactly', run: () => this.watchReplay(r.id) },
            { label: 'Race this ghost', icon: 'ghost', desc: r.failed ? 'Failed runs can not be raced' : `Play ${r.instrument} · ${r.difficulty} against this score`, disabled: r.failed, run: () => this.raceGhost(r.id) },
          ],
        }), 0),
      })),
    });
  }

  async raceGhost(id) {
    const ghost = await loadReplay(id);
    if (!ghost) { this.toast('That replay is gone', 'err'); return; }
    this.selected = this.songs.find((x) => x.id === ghost.songId) || this.selected;
    this.instrument = ghost.instrument;
    this.difficulty = ghost.difficulty;
    this.mode = 'solo';
    await this.play({ ghost });
  }

  async watchReplay(idOrData) {
    const replay = typeof idOrData === 'string' ? await loadReplay(idOrData) : idOrData;
    if (!replay?.events) { this.toast('That replay is not saved', 'err'); return; }
    const [song, audio] = await Promise.all([getSong(replay.songId), getAudio(replay.songId)]);
    if (!song || !audio) { this.toast('The song for this replay is missing', 'err'); return; }
    const now = song.charts[replay.instrument]?.available ? song.charts[replay.instrument].notes[replay.difficulty] || [] : null;
    if (!now || (replay.chart && (replay.chart.n !== now.length || Math.abs((now[0]?.t ?? 0) - replay.chart.t0) > 0.005))) { this.toast('The chart changed since this replay was recorded', 'err'); return; }
    this.app.engine.unlock();
    this.app.menuMusic(false);
    this.stopPreview();
    this.lastPlay = { mode: 'replay', replay };
    this.applyVenue(true);
    if (profiles.current) profiles.award(profiles.current.id, 'replay_watch').then((f) => f.forEach((a) => this.toast(`${a.name} — ${a.desc}`, 'ok', 'trophy')));
    this.show('hud');
    const cfg = {
      name: replay.name, color: replay.color, profileId: replay.profileId, device: 'any', instrument: replay.instrument, difficulty: replay.difficulty,
      strum: replay.strum, lefty: replay.lefty, rumble: false, triggers: false, mic: !!replay.mic,
    };
    await this.app.game.start(song, audio, [cfg], { replay });
  }

  // ---------------------------------------------------------------- practice
  openPractice() {
    if (!this.selected) return;
    if (!this.selected.charts[this.instrument]?.available) { this.toast('Pick an instrument with a chart first', 'err'); return; }
    this.show('practice');
    this._renderPractice();
  }

  _renderPractice() {
    const s = this.selected;
    $('#pr-song').textContent = `${s.title} — ${s.artist} · ${this.instrument} · ${this.difficulty}`;
    $('#pr-speed').innerHTML = SPEEDS.map((v) => `<div class="opt ${v === this.practice.speed ? 'sel' : ''}" data-v="${v}">${Math.round(v * 100)}%</div>`).join('');
    $$('#pr-speed .opt').forEach((o) => o.addEventListener('click', () => { this.practice.speed = +o.dataset.v; this._renderPractice(); }));
    $('#pr-start-range').value = this.practice.startPct;
    this._renderPracticeStart();
    this.applyFocus(false);
  }

  _practiceStartTime() {
    const s = this.selected;
    const t = (this.practice.startPct / 100) * s.duration;
    const beats = s.beats || [];
    let best = t;
    for (let i = s.downbeat || 0; i < beats.length; i += 4) { if (Math.abs(beats[i] - t) < Math.abs(best - t) || best === t) best = beats[i]; if (beats[i] > t + 4) break; }
    return Math.max(0, best);
  }

  _renderPracticeStart() {
    const t = this._practiceStartTime();
    $('#pr-start-label').textContent = `${fmtTime(t)} (${this.practice.startPct}%)`;
  }

  async startPractice() {
    const s = this.selected;
    if (!s) return;
    const p = profiles.current;
    const cfgs = [{ name: p?.name || 'P1', color: p?.color, profileId: null, device: 'any', instrument: this.instrument, difficulty: this.difficulty, strum: this.instrument !== 'drums' && this.strumFor('any'), ...this.deviceCfg('any') }];
    this.app.engine.unlock();
    const [song, audio] = await Promise.all([getSong(s.id), getAudio(s.id)]);
    if (!audio) { this.toast('Audio for this song is missing', 'err'); return; }
    this.app.menuMusic(false);
    this.stopPreview();
    this.lastPlay = { mode: 'practice', practice: true };
    this.applyVenue(true);
    const speed = this.practice.speed;
    let lastToast = 0;
    const status = (msg) => { const now = performance.now(); if (now - lastToast > 1500) { lastToast = now; this.toast(msg); } };
    if (speed < 1) this.toast(`Preparing ${Math.round(speed * 100)}% speed audio (pitch preserved)...`);
    await this.app.game.start(song, audio, cfgs, { practice: { speed, startAt: this._practiceStartTime() }, onStatus: status });
    this.show('hud');
  }

  // ---------------------------------------------------------------- re-chart + song info
  async rechart() {
    const s = this.selected;
    if (!s || this.busy) return;
    this.busy = true;
    let last = 0;
    try {
      this.toast(`Re-charting "${s.title}"...`);
      const updated = await rechartSong(s, (stage, p, msg) => { const now = performance.now(); if (msg && now - last > 1200) { last = now; this.toast(msg); } });
      this.toast(updated.model?.includes('basic-pitch') ? 'Re-charted with neural transcription (basic-pitch)' : 'Re-charted', 'ok');
      await this.renderLibrary(s.id);
    } catch (e) { this.toast(`Re-chart failed: ${e.message}`, 'err'); }
    this.busy = false;
  }

  openSongInfo() {
    const s = this.selected;
    if (!s) return;
    this.songInfo = { cover: null };
    for (const k of ['title', 'artist', 'album', 'year', 'genre']) $(`#si-${k}`).value = s[k] || '';
    const cv = coverUrl(s);
    $('#si-cover').style.backgroundImage = cv ? `url('${cv}')` : 'none';
    $('#si-note').textContent = s.metaSources?.length ? `Current info from: ${s.metaSources.join(', ')}` : '';
    this.show('songinfo');
  }

  async lookupSongInfo() {
    const s = this.selected;
    $('#si-note').textContent = 'Looking up MusicBrainz + iTunes...';
    const m = await lookupOnline($('#si-artist').value.trim(), $('#si-title').value.trim(), s.duration);
    if (!m) { $('#si-note').textContent = 'No confident match found online. Check the title and artist spelling.'; return; }
    for (const k of ['title', 'artist', 'album', 'year', 'genre']) if (m[k]) $(`#si-${k}`).value = m[k];
    if (m.cover) { this.songInfo.cover = m.cover; $('#si-cover').style.backgroundImage = `url('${m.cover}')`; }
    $('#si-note').textContent = `Found via ${(m.sources || []).join(' + ')}. Save to keep it.`;
  }

  async saveSongInfo() {
    const s = this.selected;
    const updated = { ...s };
    for (const k of ['title', 'artist', 'album', 'year', 'genre']) updated[k] = $(`#si-${k}`).value.trim() || (k === 'title' || k === 'artist' ? s[k] : null);
    if (this.songInfo?.cover) {
      const file = await coverFromUrl(updated, this.songInfo.cover);
      if (file) { updated.cover = file; updated.coverRev = (s.coverRev || 0) + 1; }
    }
    updated.metaSources = [...new Set([...(s.metaSources || []), 'edited'])];
    await saveSongJson(updated);
    this.toast('Song info saved', 'ok');
    this.show('library');
    this.renderLibrary(s.id);
  }

  async exportSong() {
    const s = this.selected;
    if (!s) return;
    this.toast('Building chart pack (MIDI + WAV stems)...');
    const audio = await getAudio(s.id);
    await new Promise((r) => setTimeout(r, 30));
    const { blob, filename } = buildChartPack(s, audio);
    download(blob, filename);
    this.toast(`Exported ${filename} (${(blob.size / 1048576).toFixed(0)} MB)`, 'ok');
  }

  async removeSong() {
    const s = this.selected;
    if (!s || s.method === 'demo') return;
    if (!(await this.confirmDialog(`Delete "${s.title}"?`, 'Its folder (stems, chart, cover) is removed from the songs folder.', 'Delete'))) return;
    await deleteSong(s.id);
    this.selected = null;
    this.toast('Song deleted');
    this.renderLibrary();
  }

  // ---------------------------------------------------------------- band lobby (each player drives their own slot)
  _tryJoin(dev, key) {
    if (this.party.some((p) => p.device === dev)) return;
    if (dev.startsWith('kb')) {
      // keyboards join with one of their lane keys, so arrow/enter navigation doesn't add players
      const prof = bindings.profile(this.app.input.profileFor(dev));
      const lanes = ['lane0', 'lane1', 'lane2', 'lane3', 'lane4'];
      const isLane = key && ['five', 'drums'].some((m) => lanes.some((l) => (prof?.[m]?.[l] || []).some((s) => srcKey(s) === key)));
      if (!isLane || KEY_NAV_KEYS.has(key)) return;
    }
    if (dev.startsWith('pad:') && key && !key.startsWith('b')) return;
    this._join(dev);
    this.joinLock = { dev, until: performance.now() + 350 };
  }

  _join(dev) {
    if (this.party.some((p) => p.device === dev)) { this.toast('That device is already in the band'); return; }
    if (this.party.length >= 4) { this.toast('The band is full (4 players)'); return; }
    const taken = new Set(this.party.map((p) => p.instrument));
    const dv = this.app.input.listDevices().find((d) => d.id === dev);
    const base = bindings.baseOf(dv?.profileKey);
    const pref = base === 'drumkit' ? 'drums' : base === 'guitar' ? 'guitar' : dev.startsWith('midi') ? 'drums' : null;
    const instrument = (pref && !taken.has(pref) && pref) || ['guitar', 'bass', 'drums', 'keys'].find((i) => !taken.has(i)) || 'guitar';
    const used = new Set(this.party.map((p) => p.profileId).filter(Boolean));
    const profileId = profiles.current && !used.has(profiles.current.id) ? profiles.current.id : null;
    this.party.push({ name: `P${this.party.length + 1}`, device: dev, instrument, difficulty: settings.lastDifficulty || 'medium', strum: instrument !== 'drums' && this.strumFor(dev), profileId, row: 0, ready: false });
    this.party.forEach((p, i) => { p.name = profiles.byId(p.profileId)?.name || `P${i + 1}`; });
    this.app.engine.sfxUi('confirm');
    this.toast(`${this.party[this.party.length - 1].name} joined on ${this.app.input.deviceLabel(dev)}`, 'ok');
    if (this.screen === 'band') this.renderBand(true);
  }

  _slotRows(p) { return ['prof', 'cfg', 'inst', 'diff', ...(p.instrument !== 'drums' ? ['strum'] : []), 'ready', 'leave']; }

  _slotCycle(p, what, d) {
    if (!p) return;
    const input = this.app.input;
    if (what === 'prof') {
      const used = new Set(this.party.filter((x) => x !== p).map((x) => x.profileId).filter(Boolean));
      const opts = [null, ...profiles.list.map((x) => x.id).filter((id) => !used.has(id))];
      p.profileId = opts[(opts.indexOf(p.profileId || null) + d + opts.length) % opts.length];
      p.name = profiles.byId(p.profileId)?.name || `P${this.party.indexOf(p) + 1}`;
    } else if (what === 'cfg') {
      const dv = input.listDevices().find((x) => x.id === p.device);
      if (dv?.family) {
        const list = bindings.list(dv.family, dv.pad?.id || null);
        const next = list[(list.indexOf(dv.profileKey) + d + list.length) % list.length];
        if (next) { bindings.assign(input.deviceKeys(p.device, dv.pad), next); if (p.instrument !== 'drums') p.strum = this.strumFor(p.device); }
      }
    } else if (what === 'inst') {
      const ids = INSTRUMENTS.map((i) => i.id);
      p.instrument = ids[(ids.indexOf(p.instrument) + d + ids.length) % ids.length];
      if (p.instrument === 'drums') p.strum = false;
    } else if (what === 'diff') p.difficulty = DIFFS[Math.max(0, Math.min(3, DIFFS.indexOf(p.difficulty) + d))];
    else if (what === 'strum' && p.instrument !== 'drums') p.strum = !p.strum;
    else if (what === 'ready') p.ready = !p.ready;
    this.renderBand(true);
  }

  /** Navigation from a device that belongs to a band member drives that member's slot. */
  _bandNav(dir, dev) {
    const p = this.party.find((x) => x.device === dev);
    if (!p) return false;
    const rows = this._slotRows(p);
    p.row = Math.max(0, Math.min(rows.length - 1, p.row || 0));
    const row = rows[p.row];
    const eng = this.app.engine;
    if (dir === 'up' || dir === 'down') { p.row = (p.row + (dir === 'down' ? 1 : -1) + rows.length) % rows.length; eng.sfxUi('move'); this.renderBand(true); return true; }
    if (dir === 'left' || dir === 'right') { if (!p.ready || row === 'ready') { this._slotCycle(p, row, dir === 'right' ? 1 : -1); eng.sfxUi('move'); } return true; }
    if (dir === 'confirm') {
      eng.sfxUi('confirm');
      if (row === 'leave') { this._leaveSlot(p); return true; }
      if (row === 'ready') this._slotCycle(p, 'ready', 1);
      else { p.row = rows.indexOf('ready'); this.renderBand(true); }
      this._bandMaybeGo();
      return true;
    }
    if (dir === 'start' || dir === 'alt') { eng.sfxUi('confirm'); p.ready = true; this.renderBand(true); if (dir === 'alt' || this.party.every((x) => x.ready)) this._bandMaybeGo(dir === 'alt'); return true; }
    if (dir === 'back') {
      eng.sfxUi('back');
      // ready → not ready; otherwise back out to the main menu (the band stays set up)
      if (p.ready) { p.ready = false; this.renderBand(true); return true; }
      this.show('menu');
      return true;
    }
    if (dir === 'select') { this._leaveSlot(p); return true; }
    return true;
  }

  _leaveSlot(p) {
    this.party.splice(this.party.indexOf(p), 1);
    this.party.forEach((x, i) => { x.name = profiles.byId(x.profileId)?.name || `P${i + 1}`; });
    this.toast('Player left the band');
    this.renderBand(true);
  }

  _bandMaybeGo(force = false) {
    if (!this.party.length) return;
    if (force || this.party.every((x) => x.ready)) {
      clearTimeout(this._bandGoTimer);
      this._bandGoTimer = setTimeout(() => { if (this.screen === 'band' && (force || this.party.every((x) => x.ready))) this.action('band-go'); }, force ? 0 : 500);
    }
  }

  renderBand(keepFocus = false) {
    const root = $('#band-slots');
    const input = this.app.input;
    const html = [];
    for (let i = 0; i < 4; i++) {
      const p = this.party[i];
      if (!p) {
        html.push(`<div class="slot empty" style="--pc:${PLAYER_COLORS[i]}"><div class="slot-num">P${i + 1}</div><div class="join"><span data-glyph="confirm">${glyph('confirm', this.family)}</span> Press a button to join</div><small>Controller · lane key · MIDI pad</small></div>`);
        continue;
      }
      const dv = input.listDevices().find((x) => x.id === p.device);
      const det = detectController(dv || { id: p.device }, bindings.baseOf(dv?.profileKey));
      const rows = this._slotRows(p);
      const focusRow = rows[Math.max(0, Math.min(rows.length - 1, p.row || 0))];
      const five = p.instrument !== 'drums';
      const prof = profiles.byId(p.profileId);
      const row = (key, label, value) => `<div class="slot-row ${focusRow === key && !p.ready ? 'focus-row' : ''}" data-slot="${i}" data-row="${key}"><label>${label}</label><div class="sv"><i class="arr">‹</i><span>${value}</span><i class="arr">›</i></div></div>`;
      html.push(`<div class="slot filled ${p.ready ? 'ready' : ''}" style="--pc:${prof?.color || PLAYER_COLORS[i]}">
        <div class="slot-head"><span class="slot-num">P${i + 1}</span><b>${esc(prof?.name || `Player ${i + 1}`)}</b><button class="slot-x" data-remove="${i}" title="Leave">✕</button></div>
        <div class="slot-art ctl-art">${controllerPicture(det.kind)}</div>
        <div class="slot-dev">${esc(det.name)}${p.device === 'kb2' ? '<small class="slot-keys">U up · I down · O left · P right · [ ready</small>' : ''}</div>
        ${row('prof', 'Profile', prof ? `${avatarHtml(prof, 22)} ${esc(prof.name)}` : 'Guest')}
        ${row('cfg', 'Controls', esc(dv?.profileKey ? bindings.shortLabel(dv.profileKey, padName) : 'Needs mapping'))}
        ${row('inst', 'Instrument', `${INST_ICON[p.instrument]} ${p.instrument}`)}
        ${row('diff', 'Difficulty', p.difficulty)}
        ${five ? row('strum', 'Frets', p.strum ? 'Strum' : 'Tap') : ''}
        <div class="slot-ready ${focusRow === 'ready' ? 'focus-row' : ''}" data-slot="${i}" data-row="ready">${p.ready ? `${fa('check')} READY` : 'Ready up'}</div>
        <div class="slot-leave ${focusRow === 'leave' ? 'focus-row' : ''}" data-slot="${i}" data-row="leave">Leave</div>
      </div>`);
    }
    root.innerHTML = html.join('');
    $$('[data-row]', root).forEach((r) => r.addEventListener('click', (e) => {
      const p = this.party[+r.dataset.slot];
      if (!p) return;
      p.row = this._slotRows(p).indexOf(r.dataset.row);
      if (r.dataset.row === 'leave') { this._leaveSlot(p); return; }
      const right = !e.target.classList.contains('arr') || e.target.textContent === '›';
      this._slotCycle(p, r.dataset.row, right ? 1 : -1);
      if (r.dataset.row === 'ready') this._bandMaybeGo();
    }));
    $$('[data-remove]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.action(`band-remove-${b.dataset.remove}`); }));
    const go = $('[data-action="band-go"]');
    if (go) go.disabled = !this.party.length;
    if (!keepFocus) this.focus = 0;
    this.applyFocus(false);
  }

  // ---------------------------------------------------------------- import
  _setupImport() {
    const drop = $('#drop'), input = $('#file-input');
    drop.addEventListener('click', (e) => { if (e.target !== input) { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { this.importFiles([...input.files]); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
    document.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => /^audio\//.test(f.type) || /\.(mp3|wav|flac|ogg|m4a|opus|aac)$/i.test(f.name));
      if (files.length) { if (this.screen !== 'import') this.show('import'); this.importFiles(files); }
    });
    this._pipeSteps();
  }

  _pipeSteps(active = null, done = new Set(), info = {}, youtube = this.importTab === 'youtube') {
    const steps = [
      ...(youtube ? [['download', 'Download audio (yt-dlp)']] : []),
      ['decode', 'Decode + gather metadata'], ['split', 'Separate stems + transcribe notes'], ['chart', 'Beat-track, attribute & chart'], ['save', 'Save WAV stems, cover art + preview'],
    ];
    $('#pipeline-steps').innerHTML = steps.map(([id, label]) => {
      const cls = done.has(id) ? 'done' : id === active ? 'run' : '';
      return `<li class="${cls}"><i></i>${label}<small>${esc(info[id] || '')}</small></li>`;
    }).join('');
  }

  renderSplitter() {
    const h = this.aiStatus;
    const opts = [['auto', `Auto${h ? ' (AI)' : ' (DSP)'}`], ['ai', 'AI · Demucs'], ['dsp', 'Quick DSP']];
    $('#pick-splitter').innerHTML = opts.map(([v, l]) => `<div class="opt ${v === this.splitter ? 'sel' : ''}" data-val="${v}">${l}</div>`).join('');
    $$('#pick-splitter .opt').forEach((o) => o.addEventListener('click', () => { this.splitter = o.dataset.val; settings.splitter = this.splitter; this.renderSplitter(); }));
    $('#splitter-note').innerHTML = h
      ? `Demucs ${esc(h.model)} · ${esc(h.gpu || 'CPU')}`
      : settings.aiEnabled ? 'AI splitter offline — using the quick DSP splitter' : 'AI server off — imports use the quick DSP splitter';
  }

  renderImportTab() {
    const yt = this.importTab === 'youtube';
    $('#pick-import-tab').innerHTML = [['file', `${fa('file-audio')} Audio file`], ['youtube', `${fa('play')} YouTube search`]].map(([v, l]) => `<div class="opt ${v === this.importTab ? 'sel' : ''}" data-v="${v}">${l}</div>`).join('');
    $$('#pick-import-tab .opt').forEach((o) => o.addEventListener('click', () => { this.importTab = o.dataset.v; this.renderImportTab(); }));
    $('#import-yt').hidden = !yt;
    $('#drop').style.display = yt ? 'none' : '';
    if (!this.busy) this._pipeSteps(null, new Set(), {}, yt);
    if (yt && !this.ytChecked) {
      this.ytChecked = true;
      ytStatus().then((s) => {
        this.ytAvailable = s.available;
        $('#yt-note').innerHTML = s.available
          ? 'Only import music you have the rights to use.'
          : 'yt-dlp not found — run npm run ai:setup';
      });
    }
    this.applyFocus(false);
  }

  async youtubeSearch() {
    const q = $('#yt-q').value.trim();
    if (!q) { this.editText($('#yt-q')); return; }
    const box = $('#yt-results');
    box.innerHTML = '<div class="small-note">Searching YouTube...</div>';
    try {
      const results = await ytSearch(q);
      this.ytResults = results;
      const pl = results.playlist && results.length > 1
        ? `<div class="yt-playlist"><div><b>${esc(results.playlist)}</b><small>Playlist · ${results.length} videos · becomes a setlist</small></div><button class="nav-btn primary" data-nav data-action="yt-import-all">Import all (${Math.min(results.length, 50)})</button></div>` : '';
      box.innerHTML = pl + (results.length ? results.map((r, i) => `
        <div class="yt-item" data-nav data-yt="${i}">
          <img src="${esc(r.thumbnail || '')}" alt="" loading="lazy" />
          <div><div class="t">${esc(r.title)}</div><div class="c">${esc(r.channel)} · ${r.duration ? fmtTime(r.duration) : 'live/unknown'}${r.views ? ` · ${Number(r.views).toLocaleString()} views` : ''}</div></div>
          <span class="yt-go">Import</span>
        </div>`).join('') : '<div class="small-note">No results.</div>');
      $$('.yt-item', box).forEach((el) => el.addEventListener('click', () => this.importYouTube(this.ytResults[+el.dataset.yt])));
      $('[data-action="yt-import-all"]', box)?.addEventListener('click', (e) => { e.stopPropagation(); this.action('yt-import-all'); });
      this.focus = Math.max(0, this.navItems().findIndex((x) => x.dataset.yt === '0'));
      this.applyFocus(false);
    } catch (e) {
      box.innerHTML = `<div class="small-note">Search failed: ${esc(e.message)}</div>`;
    }
  }

  importYouTube(item) {
    if (!item) return;
    if (item.duration > 20 * 60) { this.toast('That video is over 20 minutes — pick a single song', 'err'); return; }
    this.runImport(null, item);
  }

  /** Several files at once: they go through the queue one by one (a folder's worth becomes a setlist). */
  importFiles(files) {
    if (!files.length) return;
    if (files.length > 1) this.importBatch = { name: `Imported ${new Date().toLocaleDateString()}`, ids: [] };
    for (const f of files) this.runImport(f);
  }

  _renderQueue() {
    const q = this.importQueue || [];
    $('#import-queue').innerHTML = q.length ? `<h4>Up next · ${q.length}</h4>${q.slice(0, 8).map((j) => `<div>${esc(j.yt ? j.yt.title : j.file.name)}</div>`).join('')}${q.length > 8 ? `<div class="small-note">+${q.length - 8} more</div>` : ''}` : '';
  }

  async runImport(file, ytItem = null) {
    if (this.busy) {
      (this.importQueue ||= []).push({ file, yt: ytItem });
      this._renderQueue();
      this.toast(`Queued "${ytItem ? ytItem.title : file.name}" (${this.importQueue.length} waiting)`);
      return;
    }
    this.busy = true;
    const done = new Set(), info = {};
    const youtube = !!ytItem;
    let active = youtube ? 'download' : 'decode';
    const fill = $('#pipe-fill'), msg = $('#pipe-msg');
    const weights = youtube
      ? { download: [0, 0.12], decode: [0.12, 0.18], split: [0.18, 0.72], chart: [0.72, 0.95], save: [0.95, 1] }
      : { decode: [0, 0.08], split: [0.08, 0.7], chart: [0.7, 0.95], save: [0.95, 1] };
    const report = (stage, p, m) => {
      if (stage !== active) { done.add(active); active = stage; }
      if (p >= 1) done.add(stage);
      if (m) { info[stage] = p >= 1 ? m : `${Math.round(p * 100)}%`; msg.textContent = m; }
      const [a, b] = weights[stage] || [0, 1];
      fill.style.width = `${(a + (b - a) * Math.min(1, p)) * 100}%`;
      this._pipeSteps(active, done, info, youtube);
    };
    try {
      this.app.engine.unlock();
      const song = youtube
        ? await importFromYouTube(ytItem, this.splitter, this.app.engine, report)
        : await importFile(file, this.splitter, this.app.engine, report);
      // imported for a world chart (weekly challenge, chart library): keep the world's title and artist so the boards match
      if (youtube && this.worldWant) {
        const want = this.worldWant;
        this.worldWant = null;
        if (song.title !== want.title || song.artist !== want.artist) {
          const saved = await getSong(song.id);
          if (saved) { Object.assign(saved, { title: want.title, artist: want.artist }); Object.assign(song, { title: want.title, artist: want.artist }); await saveSongJson(saved).catch(() => {}); }
        }
      }
      const bits = [song.method === 'ai' ? 'AI split' : 'DSP split', `${song.bpm} BPM`, song.album && `album ${song.album}`].filter(Boolean);
      this.toast(`"${song.title}" by ${song.artist} is ready — ${bits.join(' · ')}`, 'ok');
      const fresh = await profiles.count(youtube ? 'youtube_import' : 'import');
      for (const a of fresh) this.toast(`${a.name} — ${a.desc}`, 'ok', 'trophy');
      this.busy = false;
      this.importBatch?.ids.push(song.id);
      if (this.aiStatus?.lyrics && (song.stemNames || []).includes('vocals') && song.charts?.vocals?.available) this.getLyrics(song, true);
      if (this._nextImport()) return;
      if (this.screen === 'import') { this.show('library'); this.renderLibrary(song.id); }
    } catch (e) {
      console.error(e);
      msg.textContent = `Failed: ${e.message || e}`;
      this.toast(e.message || 'Import failed', 'err');
      $$('#pipeline-steps li.run').forEach((li) => { li.className = 'err'; });
      this.busy = false;
      this._nextImport();
    }
  }

  /** Start the next queued import. Returns true while the queue keeps going. */
  _nextImport() {
    const next = (this.importQueue || []).shift();
    this._renderQueue();
    if (next) { setTimeout(() => this.runImport(next.file, next.yt), 300); return true; }
    const b = this.importBatch;
    this.importBatch = null;
    if (b && b.ids.length > 1) {
      this.setlists.create(b.name, b.ids);
      this.toast(`Setlist "${b.name}" made with ${b.ids.length} songs`, 'ok');
    }
    return false;
  }

  // ---------------------------------------------------------------- settings (tabs: L1 / R1)
  _buildSettings() {
    const root = $('#settings-list');
    let group = '';
    root.innerHTML = SETTINGS_SCHEMA.map((it) => {
      if (it.group) { group = it.group; return ''; }
      const lbl = `<div class="lbl"><b>${it.label}</b>${it.desc ? `<span>${it.desc}</span>` : ''}</div>`;
      if (it.action) return `<div class="set-row" data-nav data-group="${group}" data-setting="@${it.action}">${lbl}<div class="set-ctl"><span class="set-go">${it.action === 'clearCache' ? 'Show' : it.action === 'openFolder' || it.action === 'openControllers' ? 'Open' : 'Run'} ›</span></div></div>`;
      let ctl = '';
      if (it.type === 'range') ctl = `<input type="range" min="${it.min}" max="${it.max}" step="${it.step}" tabindex="-1"/><span class="val"></span>`;
      if (it.type === 'toggle') ctl = '<div class="opt" data-t="off">Off</div><div class="opt" data-t="on">On</div>';
      if (it.type === 'choice') ctl = it.options.map((o) => `<div class="opt" data-c="${o}">${it.labels?.[o] || o}</div>`).join('');
      if (it.type === 'text') ctl = `<input type="text" spellcheck="false" data-osk="${it.label}" data-osk-type="address"/>`;
      return `<div class="set-row" data-nav data-group="${group}" data-setting="${it.key}">${lbl}<div class="set-ctl">${ctl}</div></div>`;
    }).join('');
    $$('.set-row', root).forEach((row) => {
      const key = row.dataset.setting;
      if (key.startsWith('@')) { row.addEventListener('click', () => this.settingAction(key.slice(1))); return; }
      const it = SETTINGS_SCHEMA.find((x) => x.key === key);
      const range = row.querySelector('input[type=range]');
      range?.addEventListener('input', () => { settings[key] = parseFloat(range.value); this._syncSettings(); });
      row.querySelectorAll('[data-t]').forEach((o) => o.addEventListener('click', () => {
        if (key === 'aiEnabled') this.setAiEnabled(o.dataset.t === 'on');
        else { settings[key] = o.dataset.t === 'on'; this._syncSettings(); }
      }));
      row.querySelectorAll('[data-c]').forEach((o) => o.addEventListener('click', () => { settings[key] = o.dataset.c; this._syncSettings(); }));
      const text = row.querySelector('input[type=text]');
      text?.addEventListener('change', () => {
        settings[key] = text.value.trim();
        if (key === 'bridgeUrl') { this.app.ds.ws?.close(); this.app.ds._connect(); } else this.pollAI();
      });
      row._it = it;
    });
    $('#settings-tabs').innerHTML = SETTINGS_GROUPS.map((g) => `<button class="tab" data-tab="${g}">${g}</button>`).join('');
    $$('#settings-tabs .tab').forEach((t) => t.addEventListener('click', () => { this.settingsTab = t.dataset.tab; this._renderSettingsTabs(true); }));
    this._renderSettingsTabs();
    this._syncSettings();
  }

  _renderSettingsTabs(refocus = false) {
    $$('#settings-tabs .tab').forEach((t) => t.classList.toggle('sel', t.dataset.tab === this.settingsTab));
    $$('#settings-list .set-row').forEach((r) => { r.hidden = r.dataset.group !== this.settingsTab; });
    if (refocus && this.screen === 'settings') { this.focus = 0; this.applyFocus(); }
  }

  _syncSettings() {
    $$('#settings-list .set-row').forEach((row) => {
      const key = row.dataset.setting, it = row._it;
      if (!it) return;
      const v = settings[key];
      if (it.type === 'range') {
        row.querySelector('input').value = v;
        row.querySelector('.val').textContent = it.fmt === 'pct' ? `${Math.round(v * 100)}%` : it.fmt === 'ms' ? `${v > 0 ? '+' : ''}${v} ms` : v;
      }
      if (it.type === 'toggle') row.querySelectorAll('[data-t]').forEach((o) => o.classList.toggle('sel', (o.dataset.t === 'on') === !!v));
      if (it.type === 'choice') row.querySelectorAll('[data-c]').forEach((o) => o.classList.toggle('sel', o.dataset.c === v));
      if (it.type === 'text') { const inp = row.querySelector('input'); if (document.activeElement !== inp) inp.value = v; }
    });
  }

  adjustSetting(key, d, confirm = false) {
    if (key.startsWith('@')) { if (confirm) this.settingAction(key.slice(1)); return; }
    const it = SETTINGS_SCHEMA.find((x) => x.key === key);
    if (!it) return;
    if (it.type === 'range') settings[key] = +Math.max(it.min, Math.min(it.max, settings[key] + d * it.step)).toFixed(3);
    if (it.type === 'toggle') {
      if (key === 'aiEnabled') this.setAiEnabled(!settings.aiEnabled);
      else settings[key] = !settings[key];
    }
    if (it.type === 'choice') { const i = it.options.indexOf(settings[key]); settings[key] = it.options[(i + d + it.options.length) % it.options.length]; }
    if (it.type === 'text' && confirm) this.editText($(`[data-setting="${key}"] input`));
    this._syncSettings();
  }

  async setAiEnabled(enabled) {
    // Clicking Off again should retry shutdown if an older server survived a previous toggle.
    if (this._aiTogglePending || (enabled && settings.aiEnabled === enabled)) return;
    this._aiTogglePending = true;
    try {
      const invoke = window.__TAURI__?.core?.invoke;
      const status = invoke ? await invoke('set_ai_enabled', { enabled }) : null;
      settings.aiEnabled = enabled;
      this.aiStatus = null;
      this._syncSettings();
      this.refreshStatus();
      if (this.screen === 'import') this.renderSplitter();
      if (status?.startsWith('error:') || /NVIDIA|GPU check/.test(status || '')) this.toast(`AI server: ${status}`, 'err');
      else this.toast(enabled ? (status?.startsWith('not installed') ? 'AI server enabled; install the AI splitter to use it' : invoke ? 'AI server starting' : 'AI use enabled; start npm run ai to run the server') : invoke ? 'AI server off; imports use quick DSP' : 'AI use off; stop npm run ai separately', 'ok');
      if (enabled) this.pollAI();
    } catch (e) {
      this.toast(`Could not change AI server: ${e?.message || e}`, 'err');
    } finally {
      this._aiTogglePending = false;
    }
  }

  /** Settings → Test microphone: a sheet that shows the note you sing, live. */
  async testMic({ instrument = false } = {}) {
    const mic = new Mic(this.app.engine.ctx);
    try { this.app.engine.unlock(); await mic.start(instrument ? settings.instrumentInput || '' : settings.micDevice || '', { raw: instrument, lowHz: instrument ? 38 : 70 }); } catch (e) { this.toast(`Input unavailable: ${e.message}`, 'err'); return; }
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const done = this.openSheet({ title: instrument ? 'Test instrument' : 'Test microphone', sub: instrument ? 'Play a note…' : 'Sing a note…', items: [{ label: 'Done' }] });
    const timer = setInterval(() => {
      const { midi, level } = mic.read();
      const sub = $('#sheet .sheet-sub');
      if (!sub) return;
      const bars = '▮'.repeat(Math.round(level * 12)).padEnd(12, '▯');
      sub.textContent = midi ? `${NAMES[Math.round(midi) % 12]}${Math.floor(Math.round(midi) / 12) - 1}  ·  ${bars}` : `…  ·  ${bars}`;
    }, 60);
    await done;
    clearInterval(timer);
    mic.stop();
  }

  async settingAction(a) {
    if (a === 'calibrate') this.startCalibration();
    if (a === 'chooseMic') {
      try { await requestMic({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop())); } catch { /* labels stay hidden */ }
      const devs = await Mic.devices();
      this.openSheet({
        title: 'Microphone', sub: 'The input you sing into',
        items: [{ label: 'System default', icon: !settings.micDevice ? 'check' : 'microphone', run: () => { settings.micDevice = ''; } },
          ...devs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => ({ label: d.label || 'Microphone', icon: settings.micDevice === d.deviceId ? 'check' : 'microphone', run: () => { settings.micDevice = d.deviceId; this.toast(`Singing into ${d.label || 'that microphone'}`, 'ok'); } }))],
      });
    }
    if (a === 'testMic') this.testMic();
    if (a === 'installAi') {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) { this.toast('In the browser version, run npm run ai:setup (Linux: server/setup-ai.sh)', 'err'); return; }
      try {
        await invoke('install_ai');
        this.toast('Installing the AI splitter in the background (large download). It starts by itself when it\u2019s ready', 'ok');
        clearInterval(this._aiPoll);
        this._aiPoll = setInterval(async () => {
          const st = await invoke('launcher_status').catch(() => null);
          if (!st || /installing/.test(st.ai)) return;
          clearInterval(this._aiPoll);
          if (/error/.test(st.ai)) this.toast(`AI splitter setup failed: ${st.ai.replace(/^error: /, '')}`, 'err');
          else { this.toast('AI splitter installed', 'ok'); this.refreshStatus?.(); }
        }, 5000);
      } catch (e) { this.toast(String(e?.message || e), 'err'); }
    }
    if (a === 'testDiscord') {
      try {
        const u = await discord.currentUser();
        this.toast(`Discord connected · signed in as ${u.globalName || u.username}${settings.discordPresence ? ' · your status will show what you play' : ''}`, 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    }
    if (a === 'testInstrument') this.testMic({ instrument: true });
    if (a === 'chooseInstrumentInput') {
      try { await requestMic({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop())); } catch { /* labels stay hidden */ }
      const devs = await Mic.devices();
      this.openSheet({
        title: 'Instrument input', sub: 'Where your guitar or bass comes in',
        items: [{ label: 'System default', icon: !settings.instrumentInput ? 'check' : 'guitar', run: () => { settings.instrumentInput = ''; } },
          ...devs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => ({ label: d.label || 'Audio input', icon: settings.instrumentInput === d.deviceId ? 'check' : 'guitar', run: () => { settings.instrumentInput = d.deviceId; this.toast(`Instrument input: ${d.label || 'that input'}`, 'ok'); } }))],
      });
    }
    if (a === 'checkUpdate') checkForUpdates(this);
    if (a === 'openControllers') this.show('controller');
    if (a === 'testBridge') {
      const ds = this.app.ds;
      if (!ds.online) { await ds.autoConnect(); }
      this.toast(!ds.online ? `No controller bridge at ${ds.url}. Start it with npm run bridge (the desktop app and play.bat start it for you)`
        : ds.devices.length ? `Controller bridge OK · ${ds.devices.map((d) => `${d.label}${d.pad.battery ? ` ${d.pad.battery.level}%` : ''}`).join(', ')}` : 'Controller bridge OK · no DualSense connected (turn it on or plug it in)', ds.online ? 'ok' : 'err');
    }
    if (a === 'testServer') {
      if (!settings.aiEnabled) { this.toast('AI server is off in Settings', 'err'); return; }
      const h = await aiClient().health();
      this.aiStatus = h;
      this.refreshStatus();
      this.toast(h ? `Connected: Demucs ${h.model} on ${h.gpu || 'CPU'} (${h.device})` : `No AI splitter at ${settings.aiServer}. Run: npm run ai`, h ? 'ok' : 'err');
    }
    if (a === 'clearCache') {
      const e = await storageEstimate();
      if (!e) this.toast('Storage info unavailable');
      else if (e.mode === 'folder') this.toast(`${e.count} song${e.count === 1 ? '' : 's'} · ${(e.usage / 1048576).toFixed(0)} MB in ${e.root}`);
      else this.toast(`Browser storage: ${(e.usage / 1048576).toFixed(0)} MB of ${(e.quota / 1073741824).toFixed(1)} GB (start the game with play.bat to use the songs folder)`);
    }
    if (a === 'openFolder') {
      const ok = await openSongsFolder();
      this.toast(ok ? `Opened ${songsFolder()}` : 'The songs folder is only available when the game runs through play.bat / npm run dev', ok ? 'ok' : 'err');
    }
  }

  // ---------------------------------------------------------------- per-frame (controllers screen live input)
  frame() {
    this.controllers.frame();
  }

  // ---------------------------------------------------------------- calibration
  startCalibration() {
    const eng = this.app.engine;
    eng.unlock();
    this.show('calibrate');
    const period = 0.5, count = 20;
    const t0 = eng.ctx.currentTime + 1.0;
    this.calib = { t0, period, count, taps: [] };
    for (let i = 0; i < count; i++) eng.sfxTick(t0 + i * period, i % 4 === 0);
    $('#calib-result').textContent = 'Listen... then tap on every click';
    this.app.input.setGame([{ device: 'any', mode: 'five' }]);
    this.calibOff = this.app.input.onGame((ev) => {
      if (ev.type === 'pause') { this.stopCalibration(true); return; }
      if (ev.type !== 'press' && ev.type !== 'strum') return;
      const ctx = eng.ctx;
      const ts = ctx.getOutputTimestamp?.();
      const heard = ts && ts.contextTime > 0 ? ts.contextTime + (ev.t - ts.performanceTime) / 1000 : ctx.currentTime - (ctx.outputLatency || 0);
      const k = Math.round((heard - t0) / period);
      if (k < 3 || k >= count) return;
      this.calib.taps.push(heard - (t0 + k * period));
      $('#calib-result').textContent = `${this.calib.taps.length} / ${count - 3} taps`;
    });
    this.calibTimer = setInterval(() => {
      const now = eng.ctx.currentTime;
      const k = Math.round((now - t0) / period);
      const beatEl = $('#calib-beat');
      if (k >= 0 && k < count && Math.abs(now - (t0 + k * period)) < 0.06) beatEl.classList.add('flash'); else beatEl.classList.remove('flash');
      if (now > t0 + count * period + 0.6) this.stopCalibration(false);
    }, 16);
  }

  stopCalibration(cancel) {
    clearInterval(this.calibTimer);
    this.calibOff?.();
    this.app.input.setMenu();
    const taps = this.calib?.taps || [];
    if (!cancel && taps.length >= 6) {
      const sorted = taps.slice().sort((a, b) => a - b);
      const trimmed = sorted.slice(Math.floor(sorted.length * 0.2), Math.ceil(sorted.length * 0.8));
      const mean = trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
      settings.audioOffset = Math.max(-150, Math.min(350, Math.round((mean * 1000) / 5) * 5));
      this.toast(`Audio offset set to ${settings.audioOffset > 0 ? '+' : ''}${settings.audioOffset} ms`, 'ok');
    } else if (!cancel) this.toast('Not enough taps — try again', 'err');
    this.show('settings');
  }

  // ---------------------------------------------------------------- results
  showResults(r, opts = {}) {
    if (!opts.rerender && this.setlists.onSongEnd(r)) return; // marathon: next-up break instead
    this.show('results');
    this.lastResultRaw = r;
    this.lastPlay = { ...(this.lastPlay || {}), online: r.mode === 'online', practice: !!r.practice };
    const everyone = [...r.players, ...(r.remotePlayers || [])];
    const band = everyone.length > 1;
    const solo = r.players[0];
    $('#res-title').textContent = r.song.title;
    $('#res-sub').textContent = r.practice
      ? `PRACTICE · ${Math.round(r.practice.speed * 100)}% speed · ${solo.instrument} · ${solo.difficulty}`
      : r.mode === 'online' ? `${r.song.artist} · online ${r.matchMode === 'band' ? 'band' : r.matchMode === 'battle' ? 'battle' : 'versus'} · ${everyone.length} players`
        : band ? `${r.song.artist} · ${r.players.length}-player band${r.failed ? ' · FAILED' : ''}`
          : `${r.song.artist} · ${solo.instrument}${solo.part ? ` (harmony ${solo.part + 1})` : ''} · ${solo.difficulty}${solo.pro ? ' · PRO' : ''}${solo.strum ? ' · strum' : ''}${solo.real ? ` · real ${solo.instrument}` : ''}${solo.assist ? ' · assists on (not on leaderboards)' : ''}${r.failed ? ' · FAILED' : ''}`;
    const cv = coverUrl(r.song);
    $('#res-cover').style.background = cv ? `url('${cv}') center/cover` : this.art(r.song);
    $('[data-action="retry"]').textContent = r.mode === 'online' ? 'Back to lobby' : r.mode === 'replay' ? 'Watch again' : r.practice ? 'Practice again' : 'Play again';
    if (!opts.rerender && r.mode !== 'replay') { this.social.recordResults(r); this.tour.onResult(r); }
    if (!opts.rerender) this.stream.onResults(r);
    if (r.mode === 'replay') $('#res-progress').innerHTML = '<div class="small-note">Replay — nothing saved.</div>';
    // keep every finished run as a replay (the store prunes to recent runs + bests)
    this.lastReplays = (r.replays || []).filter(Boolean);
    if (!opts.rerender) for (const rp of this.lastReplays) saveReplay(rp).catch(() => {});
    $('[data-action="watch-replay"]').hidden = !this.lastReplays.length;
    if (r.mode === 'online') {
      r = { ...r, players: everyone.map((p) => ({ ...p, stars: p.stars || 0, accuracy: p.accuracy || 0, hits: p.hits || 0, total: p.total || 0, maxStreak: p.maxStreak || 0, score: p.score || 0, instrument: p.instrument || 'guitar', difficulty: p.difficulty || '' })) };
      if (r.matchMode !== 'band') r.players.sort((a, b) => b.score - a.score);
    }
    // an online versus / battle is scored per player: the big number is yours; a band's is the band's
    const versus = r.mode === 'online' && r.matchMode !== 'band';
    const stars = versus ? solo.stars : band ? Math.round(r.players.reduce((s, p) => s + p.stars, 0) / r.players.length) : solo.stars;
    const gold = versus ? solo.gold : band ? r.players.every((p) => p.gold) : solo.gold;
    const starsEl = $('#res-stars');
    starsEl.className = `stars ${gold ? 'gold' : ''}`;
    starsEl.innerHTML = [0, 1, 2, 3, 4].map((i) => `<span class="s ${i < stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.18}s">${fa('star')}</span>`).join('');
    const target = versus ? solo.score : band ? r.bandScore : solo.score;
    const scoreEl = $('#res-score');
    const start = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / 1200);
      scoreEl.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
    $('#res-new').classList.toggle('show', !band && !!solo.newBest && !!solo.prevBest);
    const gh = $('#res-ghost');
    if (r.ghost && !band) {
      const d = solo.score - r.ghost.score;
      gh.innerHTML = d >= 0 ? `${fa('ghost')} Beat ${esc(r.ghost.name)}'s ghost by <b>${d.toLocaleString()}</b>` : `${fa('ghost')} ${esc(r.ghost.name)}'s ghost won by <b>${(-d).toLocaleString()}</b>`;
      gh.className = `res-ghost ${d >= 0 ? 'won' : 'lost'}`;
      gh.hidden = false;
    } else gh.hidden = true;
    $('#res-grid').style.display = band ? 'none' : '';
    if (!band) {
      const cells = [
        ['Accuracy', `${Math.round(solo.accuracy * 100)}%`], ['Notes hit', `${solo.hits}/${solo.total}`], ['Best streak', solo.maxStreak], ['Overdrives', solo.odActivations],
        ['Perfect', solo.perfect], ['Great', solo.great], ['Good', solo.good], ['Miss', solo.miss],
      ];
      $('#res-grid').innerHTML = cells.map(([l, v]) => `<div class="res-cell"><b>${v}</b><span>${l}</span></div>`).join('');
    }
    $('#res-players').innerHTML = band ? r.players.map((p, i) => `
      <div class="res-player" style="--pc:${p.color}">
        <b>${r.mode === 'online' && r.matchMode !== 'band' ? `#${i + 1} ` : ''}${esc(p.name)}</b> <small>${INST_ICON[p.instrument] || ''} ${p.instrument} · ${p.difficulty}${p.remote ? ' · online' : ''}</small>
        <div class="rp-score">${p.score.toLocaleString()}</div>
        <div class="rp-stars">${starsHtml(p.stars)}${p.newBest && p.prevBest ? ' · NEW BEST' : ''}</div>
        <div class="rp-line">${Math.round(p.accuracy * 100)}% · ${p.hits}/${p.total} notes · streak ${p.maxStreak}${p.failed ? ' · failed' : ''}</div>
      </div>`).join('') : '';
    this.onlineUi.decorateResults(this.lastResultRaw); // the result as the game reported it (r above may be re-sorted)
    this.focus = 0;
    this.applyFocus(false);
  }
}

const KEY_NAV_KEYS = new Set(['k:ArrowUp', 'k:ArrowDown', 'k:ArrowLeft', 'k:ArrowRight', 'k:Enter', 'k:NumpadEnter', 'k:Escape', 'k:Backspace', 'k:Tab', 'k:KeyQ', 'k:KeyE', 'k:PageUp', 'k:PageDown']);
