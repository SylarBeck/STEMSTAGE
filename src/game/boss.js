// World bosses (v2). Each of the five worlds (game/worlds) has a boss that can show up in the middle of a song:
// a short warning, then a fight of ~25-45 s where every note you hit damages it (perfect hits, streaks and
// overdrive hit harder, gear's Boss damage too) and every miss lets it recover. While it lives it casts attacks on
// your highway (game/highway.js hazards). Beat it before the fight runs out and it drops cash, XP and loot; if
// time runs out it escapes.
// When it appears is planned from a seed, so everyone in an online room (same seed from the room) sees the same
// boss at the same moment. A boss never changes your score: boards stay fair, the reward is cash, XP and trophies.
import { BOSS_INFO } from '../profile/economy.js';

export { BOSS_INFO };
export const WORLD_BOSS = { aquarium: 'leviathan', nebula: 'conductor', forge: 'titan', aurora: 'wyrm', citadel: 'thunderbird' };
export const BOSS_ATTACKS = {
  leviathan: ['ink', 'bubbles', 'tide'],
  conductor: ['gravity', 'blackout', 'meteor'],
  titan: ['heat', 'quake', 'ash'],
  wyrm: ['frost', 'whiteout', 'shatter'],
  thunderbird: ['lightning', 'gust', 'static'],
};
export const ATTACK_NAME = {
  ink: 'INK CLOUD', bubbles: 'BUBBLE WALL', tide: 'RIPTIDE', gravity: 'GRAVITY WELL', blackout: 'BLACKOUT', meteor: 'METEOR SHOWER',
  heat: 'HEAT HAZE', quake: 'EARTHQUAKE', ash: 'ASH STORM', frost: 'FROSTBITE', whiteout: 'WHITEOUT', shatter: 'SHATTER',
  lightning: 'LIGHTNING STRIKE', gust: 'HURRICANE', static: 'STATIC STORM',
};
export const BOSS_REWARD = { cash: 450, xp: 600, firstCash: 600 };
const DAMAGE = { perfect: 3, great: 2.2, good: 1.4 };
const HP_PER_NOTE = 3.6 * 0.6; // ≈ 60% of a perfect run's damage

/** A small seeded random generator (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashString = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * Plan a boss for a song. notes: the note lists being played (one per player). mode: random | always | off.
 * → null (no boss this time) or { boss, start, end, attacks: [{ t, kind, dur }] } (song seconds)
 */
export function planBoss({ bossId, song, notes, seed, mode = 'random', chance = 0.62, startTime = 0 }) {
  if (!bossId || mode === 'off' || !BOSS_ATTACKS[bossId]) return null;
  const rnd = seededRandom((seed ^ hashString(song.id)) >>> 0);
  const roll = rnd();
  if (mode !== 'always' && roll > chance) return null;
  const all = notes.flat().map((n) => n.t).filter((t) => t >= startTime).sort((a, b) => a - b);
  if (all.length < 30) return null;
  const first = all[0], last = all[all.length - 1], span = last - first;
  if (span < 45) return null;
  const beats = song.beats || [];
  const beatLen = beats.length > 2 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  const measure = beatLen * 4;
  const snap = (t) => {
    if (!beats.length) return t;
    const k = Math.round(((t - (beats[song.downbeat || 0] || 0)) / measure));
    return (beats[song.downbeat || 0] || 0) + k * measure;
  };
  const start = snap(first + span * (0.22 + rnd() * 0.33));
  const len = Math.max(24, Math.min(45, span * 0.26));
  const end = Math.min(last - 2, snap(start + len));
  if (end - start < 18) return null;
  const inFight = all.filter((t) => t >= start && t <= end).length;
  if (inFight < 20) return null;
  const kinds = BOSS_ATTACKS[bossId];
  const gap = measure * (beatLen < 0.4 ? 3 : 2);
  const attacks = [];
  let prev = null;
  for (let t = start + measure * 1.5; t < end - measure; t += gap) {
    let kind = kinds[Math.floor(rnd() * kinds.length)];
    if (kind === prev) kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length];
    attacks.push({ t, kind, dur: Math.min(gap * 0.85, 7) });
    prev = kind;
  }
  return { boss: bossId, start, end, attacks };
}

/**
 * One boss fight in a session. The session calls update(t) every frame and the players call hit / miss / phrase.
 * shared (online band): everyone's damage counts against one health bar (remote damage arrives as live.bossDmg).
 */
export class BossFight {
  constructor(session, plan, { shared = false, remoteNotes = 0 } = {}) {
    this.s = session;
    this.plan = plan;
    this.id = plan.boss;
    this.info = BOSS_INFO[this.id];
    this.state = 'waiting';
    this.shared = shared;
    this.damage = 0;        // ours
    this.heal = 0;
    this.remote = 0;        // bandmates' (online band)
    this.missed = false;
    this.next = 0;          // next attack
    // singers are rated per phrase (about four notes' worth each), everyone else per note
    const local = session.players.reduce((n, p) => n + (p.mic && p.phrases
      ? p.phrases.filter((ph) => ph.start >= plan.start && ph.start <= plan.end).length * 4
      : (p.notes || []).filter((x) => x.t >= plan.start && x.t <= plan.end).length), 0);
    this.hpMax = Math.max(40, (local + (shared ? remoteNotes : 0)) * HP_PER_NOTE);
    this.world = session.stage.world;
  }

  get hp() { return Math.max(0, this.hpMax - this.damage - this.remote + this.heal); }
  get fighting() { return this.state === 'fight'; }

  hit(player, judge) {
    if (!this.fighting) return;
    const mult = (1 + Math.min(0.5, (player.streak || 0) / 100)) * (player.odActive ? 2.5 : 1) * (1 + (player.gear?.boss || 0));
    this._damage((DAMAGE[judge] || 1) * mult, player.odActive);
  }

  /** Singing: a rated phrase counts like about four notes. */
  phrase(player, frac) {
    if (!this.fighting) return;
    if (frac < 0.15) { this.miss(player); return; }
    this._damage(frac * 12 * (player.odActive ? 2.5 : 1) * (1 + (player.gear?.boss || 0)), player.odActive);
  }

  miss() {
    if (!this.fighting) return;
    this.missed = true;
    this.heal = Math.min(this.heal + 1.6, this.damage + this.remote);
  }

  _damage(d, big) {
    this.damage += d;
    this.world?.boss?.hit(big);
    if (this.hp <= 0) this._defeat();
  }

  /** Online band: the bandmates' total damage so far. */
  setRemote(total) {
    if (!this.shared) return;
    this.remote = Math.max(this.remote, total);
    if (this.fighting && this.hp <= 0) this._defeat();
  }

  update(t) {
    const p = this.plan, s = this.s, hud = s.hud;
    if (this.state === 'waiting' && t >= p.start - 4) {
      this.state = 'intro';
      this.world?.boss?.enter();
      s.engine.sfxBossWarn?.();
      hud.bossWarn(this.info);
      if (!s.calm) s.stage.setShot('boss');
    }
    if (this.state === 'intro' && t >= p.start) {
      this.state = 'fight';
      this.t0 = t;
      s.engine.sfxBossRoar?.(0);
      hud.boss({ ...this.info, hp: 1, time: 1 });
    }
    if (this.state !== 'fight') return;
    while (this.next < p.attacks.length && t >= p.attacks[this.next].t) {
      const a = p.attacks[this.next++];
      s.bossAttack(a.kind, a.dur);
      this.world?.boss?.attack(a.kind);
      s.engine.sfxBossRoar?.(1);
      hud.callout(`${this.info.name.replace(/^The /, '').toUpperCase()}: ${ATTACK_NAME[a.kind]}!`, this.info.color);
    }
    hud.boss({ ...this.info, hp: this.hp / this.hpMax, time: Math.max(0, (p.end - t) / (p.end - p.start)) });
    if (t >= p.end) this._escape();
  }

  _defeat() {
    if (this.state !== 'fight') return;
    this.state = 'defeated';
    this.seconds = this.s.engine.songTime - this.t0;
    this.s.clearHazards();
    this.world?.boss?.defeat();
    this.s.engine.sfxBossDefeat?.();
    this.s.stage.pyro(1.4);
    this.s.stage.sparks();
    this.s.stage.confettiBurst();
    this.s.hud.boss({ ...this.info, hp: 0, time: 0 });
    this.s.hud.bossEnd(true, this.info);
    this.s.onBossOutcome?.(this);
  }

  _escape() {
    if (this.state !== 'fight') return;
    this.state = 'escaped';
    this.s.clearHazards();
    this.world?.boss?.escape();
    this.s.hud.bossEnd(false, this.info);
    this.s.onBossOutcome?.(this);
  }

  /** For the results: { id, outcome, seconds, damage, flawless } (outcome null when it never came to a fight). */
  result() {
    const outcome = this.state === 'defeated' ? 'defeated' : this.state === 'escaped' ? 'escaped' : this.state === 'fight' ? 'escaped' : null;
    return { id: this.id, outcome, seconds: this.seconds || 0, damage: Math.round(this.damage), flawless: outcome === 'defeated' && !this.missed };
  }
}
