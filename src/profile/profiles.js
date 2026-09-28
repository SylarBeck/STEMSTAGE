// Local player profiles: sign-in (optional PIN), XP + levels, achievements, play history,
// leaderboards and career stats. Stored in <project>/data (profiles.json, plays.json).
// PINs are salted SHA-256 hashes: a lock between people sharing this PC, not an online account.
import { loadProfiles, saveProfiles, loadPlays, addPlays } from '../storage/library.js';

const CURRENT_KEY = 'stemstage.profile.current';
export const PROFILE_COLORS = ['#e2432f', '#3f86e0', '#f0b429', '#6cbf46', '#9a6ad8', '#f2861c', '#2fb3a8', '#d9d0bc'];
const DIFF_XP = { easy: 0.6, medium: 0.8, hard: 1.0, expert: 1.3 };

export const RANKS = [
  [1, 'Garage Rookie'], [3, 'Basement Jammer'], [5, 'Bar Band'], [8, 'Club Regular'], [12, 'Opening Act'],
  [16, 'Headliner'], [21, 'Arena Act'], [27, 'Stadium Legend'], [35, 'Rock God'],
];

export const ACHIEVEMENTS = [
  { id: 'first_song', name: 'First Gig', desc: 'Finish your first song', icon: '🎤' },
  { id: 'five_stars', name: 'Five Star Show', desc: 'Earn 5 stars on a song', icon: '⭐' },
  { id: 'gold_stars', name: 'Solid Gold', desc: 'Earn gold stars', icon: '🏆' },
  { id: 'full_combo', name: 'Flawless', desc: 'Full combo a song', icon: '💎' },
  { id: 'fc_expert', name: 'Expert Perfection', desc: 'Full combo on Expert', icon: '👑' },
  { id: 'streak_100', name: 'Centurion', desc: '100-note streak', icon: '🔥' },
  { id: 'streak_500', name: 'Unstoppable', desc: '500-note streak', icon: '☄️' },
  { id: 'accuracy_99', name: 'Surgeon', desc: '99% accuracy (100+ notes)', icon: '🎯' },
  { id: 'overdrive_3', name: 'Overdrive Junkie', desc: 'Activate overdrive 3 times in one song', icon: '⚡' },
  { id: 'all_instruments', name: 'Multi-Instrumentalist', desc: 'Play guitar, bass, drums, keys and vocals', icon: '🎹' },
  { id: 'expert_drums', name: 'Thunder Feet', desc: 'Clear a song on Expert drums', icon: '🥁' },
  { id: 'band_play', name: 'Band Practice', desc: 'Play a song in Band mode', icon: '🎸' },
  { id: 'online_play', name: 'On Tour', desc: 'Play an online match', icon: '🌐' },
  { id: 'online_win', name: 'Battle of the Bands', desc: 'Top score in an online match', icon: '🥇' },
  { id: 'songs_10', name: 'Setlist Builder', desc: 'Play 10 different songs', icon: '📀' },
  { id: 'plays_50', name: 'Road Warrior', desc: 'Finish 50 songs', icon: '🚐' },
  { id: 'marathon', name: 'Marathon', desc: 'Play 30 minutes in total', icon: '⏱️' },
  { id: 'importer', name: 'Crate Digger', desc: 'Import a song', icon: '📥' },
  { id: 'youtube_import', name: 'Tube Rider', desc: 'Import a song from YouTube', icon: '📺' },
  { id: 'level_10', name: 'Rising Star', desc: 'Reach level 10', icon: '🌟' },
  { id: 'setlist_marathon', name: 'Marathon Man', desc: 'Finish a marathon of 3+ songs', icon: '🏃' },
  { id: 'tour_gig', name: 'First Headliner', desc: 'Finish a tour gig', icon: '🎟️' },
  { id: 'tour_arena', name: 'Arena Rock', desc: 'Unlock the Metro Arena', icon: '🏟️' },
  { id: 'tour_festival', name: 'Festival Bound', desc: 'Unlock the Main Stage Festival', icon: '🎪' },
  { id: 'tour_legend', name: 'Legend of the Stage', desc: '5 stars on every festival song in one gig', icon: '🌠' },
  { id: 'daily_1', name: 'Challenge Accepted', desc: 'Beat a daily challenge', icon: '📅' },
  { id: 'daily_7', name: 'Weekly Warrior', desc: 'Beat the daily challenge 7 days in a row', icon: '🗓️' },
  { id: 'ghost_beat', name: 'Ghostbuster', desc: 'Beat a ghost', icon: '👻' },
  { id: 'replay_watch', name: 'Film Study', desc: 'Watch a replay', icon: '🎬' },
  { id: 'fc_hard', name: 'Hard Rock', desc: 'Full combo on Hard or Expert', icon: '🪨' },
  { id: 'streak_1000', name: 'Thousand Club', desc: '1000-note streak', icon: '💯' },
  { id: 'stars_100', name: 'Star Collector', desc: 'Earn 100 stars in total', icon: '✨' },
  { id: 'band_4', name: 'Full House', desc: 'Play a song as a 4-player band', icon: '👨‍👩‍👧‍👦' },
  { id: 'night_owl', name: 'Night Owl', desc: 'Finish a song between midnight and 4 AM', icon: '🦉' },
];

export const xpForLevel = (lvl) => Math.round(350 * Math.pow(Math.max(0, lvl - 1), 1.55));
export function levelInfo(xp = 0) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  const base = xpForLevel(lvl), next = xpForLevel(lvl + 1);
  const rank = RANKS.filter(([l]) => lvl >= l).pop()[1];
  return { level: lvl, xp, into: xp - base, span: next - base, progress: (xp - base) / (next - base), rank };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class Profiles {
  constructor() {
    this.list = [];
    this.current = null;
    this.plays = [];
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this.current)); }

  async load() {
    this.list = await loadProfiles();
    this.plays = await loadPlays();
    const id = localStorage.getItem(CURRENT_KEY);
    const p = this.list.find((x) => x.id === id);
    // auto sign-in only for profiles without a PIN
    if (p && !p.pinHash) this.current = p;
    return this.list;
  }

  byId(id) { return this.list.find((p) => p.id === id) || null; }

  async create({ name, color, pin }) {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) throw new Error('Pick a name');
    if (this.list.some((p) => p.name.toLowerCase() === clean.toLowerCase())) throw new Error('That name is taken');
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
    const p = {
      id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: clean, color: color || PROFILE_COLORS[this.list.length % PROFILE_COLORS.length],
      salt, pinHash: pin ? await sha256(`${salt}:${pin}`) : null, created: Date.now(), xp: 0, achievements: {}, counters: {},
    };
    this.list.push(p);
    await saveProfiles(this.list);
    return p;
  }

  async signIn(id, pin) {
    const p = this.byId(id);
    if (!p) throw new Error('Unknown profile');
    if (p.pinHash && (await sha256(`${p.salt}:${pin || ''}`)) !== p.pinHash) throw new Error('Wrong PIN');
    this.current = p;
    localStorage.setItem(CURRENT_KEY, p.id);
    this.emit();
    return p;
  }

  signOut() { this.current = null; localStorage.removeItem(CURRENT_KEY); this.emit(); }

  async remove(id, pin) {
    const p = this.byId(id);
    if (!p) return;
    if (p.pinHash && (await sha256(`${p.salt}:${pin || ''}`)) !== p.pinHash) throw new Error('Wrong PIN');
    this.list = this.list.filter((x) => x.id !== id);
    if (this.current?.id === id) this.signOut();
    await saveProfiles(this.list);
  }

  /** The profile's world-leaderboard identity { id, secret }: made once by make(), kept in profiles.json. */
  async cloudIdentity(id, make) {
    const p = this.byId(id);
    if (!p.cloud) { p.cloud = make(); await saveProfiles(this.list); }
    return p.cloud;
  }

  /**
   * Head-to-head record of online versus / battle matches: p.versus = { w, l, d, streak, best, vs: { <opponent name>: { w, l, d } } }.
   * outcome: 'win' | 'loss' | 'draw'; a match is recorded once (by its id). → the profile's record, or null.
   */
  recordVersus(id, { matchId, outcome, opponents = [] }) {
    const p = this.byId(id);
    if (!p || !['win', 'loss', 'draw'].includes(outcome)) return null;
    const v = (p.versus ||= { w: 0, l: 0, d: 0, streak: 0, best: 0, vs: {}, last: null });
    if (matchId && v.last === matchId) return v;
    v.last = matchId || null;
    const k = outcome === 'win' ? 'w' : outcome === 'loss' ? 'l' : 'd';
    v[k]++;
    v.streak = outcome === 'win' ? v.streak + 1 : outcome === 'loss' ? 0 : v.streak;
    v.best = Math.max(v.best, v.streak);
    for (const name of opponents) {
      const o = (v.vs[String(name).slice(0, 24)] ||= { w: 0, l: 0, d: 0 });
      o[k]++;
    }
    saveProfiles(this.list).catch(() => {});
    return v;
  }

  /** A profile's record against one opponent (by name): { w, l, d } or null. */
  versusAgainst(id, name) { return this.byId(id)?.versus?.vs?.[name] || null; }

  /** Link (data: { id, username, globalName, avatar }) or unlink (null) a Discord account. */
  async setDiscord(id, data) {
    const p = this.byId(id);
    if (!p) return;
    if (data) p.discord = { id: data.id, username: data.username || null, globalName: data.globalName || null, avatar: data.avatar || null, linkedAt: Date.now() };
    else delete p.discord;
    await saveProfiles(this.list);
    this.emit();
  }

  async setPin(id, oldPin, newPin) {
    const p = this.byId(id);
    if (p.pinHash && (await sha256(`${p.salt}:${oldPin || ''}`)) !== p.pinHash) throw new Error('Wrong PIN');
    p.pinHash = newPin ? await sha256(`${p.salt}:${newPin}`) : null;
    await saveProfiles(this.list);
  }

  // ---------------------------------------------------------------- progress
  xpForPlay(r) {
    const base = r.score / 400 + r.stars * 40 + (r.fc ? 150 : 0) + r.accuracy * 60 + r.hits * 0.3;
    return Math.round(base * (DIFF_XP[r.difficulty] || 1) * (r.pro ? 1.25 : 1));
  }

  /** Unlock an achievement for a profile. Returns the achievement if newly unlocked. */
  _unlock(p, id, fresh) {
    if (p.achievements[id]) return;
    p.achievements[id] = Date.now();
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) fresh.push(a);
  }

  _checkCareer(p, fresh) {
    const mine = this.plays.filter((x) => x.profileId === p.id);
    if (mine.length) this._unlock(p, 'first_song', fresh);
    if (new Set(mine.map((x) => x.songId)).size >= 10) this._unlock(p, 'songs_10', fresh);
    if (mine.length >= 50) this._unlock(p, 'plays_50', fresh);
    if (mine.reduce((s, x) => s + (x.seconds || 0), 0) >= 1800) this._unlock(p, 'marathon', fresh);
    const insts = new Set(mine.map((x) => x.instrument));
    if (['guitar', 'bass', 'drums', 'keys', 'vocals'].every((i) => insts.has(i))) this._unlock(p, 'all_instruments', fresh);
    if (levelInfo(p.xp).level >= 10) this._unlock(p, 'level_10', fresh);
    if (mine.reduce((s, x) => s + (x.stars || 0), 0) >= 100) this._unlock(p, 'stars_100', fresh);
  }

  /** A profile's character (see looks.js): null takes it back to the default band member. */
  setLook(id, look) {
    const p = this.byId(id);
    if (!p) return;
    if (look) p.look = look; else delete p.look;
    this.saveSoon();
  }

  /** Save profiles, debounced (force: now). */
  saveSoon(force = false) {
    clearTimeout(this._saveTimer);
    if (force) return saveProfiles(this.list);
    this._saveTimer = setTimeout(() => saveProfiles(this.list), 400);
    return Promise.resolve();
  }

  async addXp(profileId, n) {
    const p = this.byId(profileId);
    if (!p) return;
    p.xp = (p.xp || 0) + n;
    await saveProfiles(this.list);
  }

  /**
   * Record finished plays. results: [{ profileId, ...player result }], ctx: { song, mode, onlineWinner }
   * Returns per-profile summaries { profileId, xpGained, levelBefore, levelAfter, achievements[] }.
   */
  async recordPlays(results, { song, mode, onlineWinnerId, bandSize = 1, ghost = null }) {
    const entries = [];
    const summaries = [];
    for (const r of results) {
      const p = this.byId(r.profileId);
      if (!p || r.failed === undefined) continue;
      const fc = !r.failed && r.miss === 0 && r.total > 0;
      const entry = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, profileId: p.id, profileName: p.name,
        songId: song.id, songTitle: song.title, songArtist: song.artist, instrument: r.instrument, difficulty: r.difficulty,
        score: r.score, stars: r.stars, gold: !!r.gold, accuracy: +r.accuracy.toFixed(4), maxStreak: r.maxStreak,
        hits: r.hits, total: r.total, miss: r.miss, fc, failed: !!r.failed, od: r.odActivations || 0, mode, assist: !!r.assist, real: r.real || null, pro: !!r.pro,
        seconds: Math.round(song.duration || 0), date: Date.now(),
      };
      entries.push(entry);
      const before = levelInfo(p.xp).level;
      const gained = r.failed ? Math.round(this.xpForPlay({ ...r, fc }) * 0.25) : this.xpForPlay({ ...r, fc });
      p.xp = (p.xp || 0) + gained;
      const fresh = [];
      if (!r.failed) {
        if (r.stars >= 5) this._unlock(p, 'five_stars', fresh);
        if (r.gold) this._unlock(p, 'gold_stars', fresh);
        if (fc) this._unlock(p, 'full_combo', fresh);
        if (fc && r.difficulty === 'expert') this._unlock(p, 'fc_expert', fresh);
        if (r.accuracy >= 0.99 && r.total >= 100) this._unlock(p, 'accuracy_99', fresh);
        if (r.instrument === 'drums' && r.difficulty === 'expert') this._unlock(p, 'expert_drums', fresh);
        if (mode === 'band') this._unlock(p, 'band_play', fresh);
        if (mode === 'band' && bandSize >= 4) this._unlock(p, 'band_4', fresh);
        if (fc && (r.difficulty === 'hard' || r.difficulty === 'expert')) this._unlock(p, 'fc_hard', fresh);
        if (ghost && r.score > ghost.score) this._unlock(p, 'ghost_beat', fresh);
        if (new Date().getHours() < 4) this._unlock(p, 'night_owl', fresh);
      }
      if (r.maxStreak >= 1000) this._unlock(p, 'streak_1000', fresh);
      if (r.maxStreak >= 100) this._unlock(p, 'streak_100', fresh);
      if (r.maxStreak >= 500) this._unlock(p, 'streak_500', fresh);
      if ((r.odActivations || 0) >= 3) this._unlock(p, 'overdrive_3', fresh);
      if (mode === 'online') this._unlock(p, 'online_play', fresh);
      if (mode === 'online' && onlineWinnerId && r.onlineId === onlineWinnerId) this._unlock(p, 'online_win', fresh);
      this.plays.push(entry);
      this._checkCareer(p, fresh);
      summaries.push({ profileId: p.id, name: p.name, xpGained: gained, levelBefore: before, levelAfter: levelInfo(p.xp).level, achievements: fresh });
    }
    if (entries.length) {
      await addPlays(entries);
      await saveProfiles(this.list);
    }
    return summaries;
  }

  /** Unlock one achievement for a profile (from outside a play: marathons, tour, challenges). */
  async award(profileId, achId) {
    const p = this.byId(profileId);
    if (!p) return [];
    p.achievements = p.achievements || {};
    const fresh = [];
    this._unlock(p, achId, fresh);
    if (fresh.length) await saveProfiles(this.list);
    return fresh;
  }

  /** Count an event (imports etc.) for the current profile; unlocks related achievements. */
  async count(event) {
    const p = this.current;
    if (!p) return [];
    p.counters = p.counters || {};
    p.counters[event] = (p.counters[event] || 0) + 1;
    const fresh = [];
    if (event === 'import') this._unlock(p, 'importer', fresh);
    if (event === 'youtube_import') { this._unlock(p, 'importer', fresh); this._unlock(p, 'youtube_import', fresh); }
    await saveProfiles(this.list);
    return fresh;
  }

  // ---------------------------------------------------------------- queries
  /** Top scores for one chart: best play per profile. */
  leaderboard(songId, instrument, difficulty, limit = 10) {
    const best = new Map();
    for (const x of this.plays) {
      if (x.songId !== songId || x.instrument !== instrument || x.difficulty !== difficulty || x.failed || x.assist) continue; // assisted runs stay off the boards
      const cur = best.get(x.profileId);
      if (!cur || x.score > cur.score) best.set(x.profileId, x);
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
      .map((x) => ({ ...x, profile: this.byId(x.profileId) }));
  }

  /** Overall ranking across all profiles. */
  globalBoard() {
    return this.list.map((p) => {
      const mine = this.plays.filter((x) => x.profileId === p.id);
      const bestPerChart = new Map();
      for (const x of mine) {
        if (x.failed || x.assist) continue;
        const k = `${x.songId}|${x.instrument}|${x.difficulty}`;
        const cur = bestPerChart.get(k);
        if (!cur || x.score > cur.score) bestPerChart.set(k, x);
      }
      const bests = [...bestPerChart.values()];
      return {
        profile: p, level: levelInfo(p.xp), plays: mine.length,
        totalScore: bests.reduce((s, x) => s + x.score, 0), stars: bests.reduce((s, x) => s + x.stars, 0),
        fcs: bests.filter((x) => x.fc).length, achievements: Object.keys(p.achievements || {}).length,
      };
    }).sort((a, b) => b.totalScore - a.totalScore);
  }

  career(id) {
    const p = this.byId(id);
    if (!p) return null;
    const mine = this.plays.filter((x) => x.profileId === id).sort((a, b) => b.date - a.date);
    const byInst = {};
    for (const x of mine) {
      const s = (byInst[x.instrument] = byInst[x.instrument] || { plays: 0, best: 0, acc: 0, fcs: 0, notes: 0 });
      s.plays++; s.best = Math.max(s.best, x.score); s.acc += x.accuracy; s.fcs += x.fc ? 1 : 0; s.notes += x.hits;
    }
    for (const s of Object.values(byInst)) s.acc /= s.plays;
    const fav = Object.entries(byInst).sort((a, b) => b[1].plays - a[1].plays)[0]?.[0] || null;
    const totals = {
      plays: mine.length, songs: new Set(mine.map((x) => x.songId)).size, score: mine.reduce((s, x) => s + x.score, 0),
      notes: mine.reduce((s, x) => s + x.hits, 0), seconds: mine.reduce((s, x) => s + (x.seconds || 0), 0),
      stars: mine.reduce((s, x) => s + x.stars, 0), fcs: mine.filter((x) => x.fc).length,
      bestStreak: mine.reduce((m, x) => Math.max(m, x.maxStreak || 0), 0),
      accuracy: mine.length ? mine.reduce((s, x) => s + x.accuracy, 0) / mine.length : 0,
    };
    const topScores = [...mine].sort((a, b) => b.score - a.score).slice(0, 8);
    const versus = p.versus ? { wins: p.versus.w, losses: p.versus.l, draws: p.versus.d, streak: p.versus.streak, best: p.versus.best,
      rivals: Object.entries(p.versus.vs || {}).map(([name, r]) => ({ name, ...r, games: r.w + r.l + r.d })).sort((a, b) => b.games - a.games).slice(0, 6) } : null;
    return { profile: p, level: levelInfo(p.xp), totals, byInst, favorite: fav, recent: mine.slice(0, 9), topScores, versus };
  }
}

export const profiles = new Profiles();
