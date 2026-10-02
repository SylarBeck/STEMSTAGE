// v2 progression: cash, unlockable items and boss trophies. Wardrobe items (looks.js), instrument upgrades and
// pedals (rig.js), stage-creator props (game/props.js) and the worlds (game/worlds) all describe what they need with
// the same requirement object, checked here:
//   { level: 8 }            reach a profile level
//   { stars: 20 }           earn tour stars
//   { ach: 'fc_expert' }    unlock an achievement
//   { boss: 'leviathan' }   defeat a world boss
//   { cash: 900 }           buy it (after meeting the rest)
// Everything lives on the profile: p.cash, p.owned { itemId: date bought }, p.bosses { id: { kills, best, first } }.
import { profiles, levelInfo } from './profiles.js';
import { tourStars } from './career.js';

export const CASH = '$';
const DIFF_CASH = { easy: 0.6, medium: 0.8, hard: 1, expert: 1.25 };

/** Cash for a finished run (before pedal bonuses). Practice and replays earn nothing. */
export function cashForRun(r) {
  if (!r || r.failed) return r?.failed ? 5 : 0;
  const fc = !r.failed && r.miss === 0 && r.total > 0;
  const base = r.score / 1600 + r.stars * 12 + (fc ? 60 : 0) + (r.gold ? 40 : 0);
  return Math.max(5, Math.round(base * (DIFF_CASH[r.difficulty] || 1)));
}

export const fmtCash = (n) => `${CASH}${Math.round(n || 0).toLocaleString()}`;

/** A requirement in words: "Level 8 · $900". */
export function requirementText(req = {}, names = {}) {
  const bits = [];
  if (req.level) bits.push(`Level ${req.level}`);
  if (req.stars) bits.push(`${req.stars} tour stars`);
  if (req.ach) bits.push(`Achievement: ${names.ach?.(req.ach) || req.ach}`);
  if (req.boss) bits.push(`Defeat ${names.boss?.(req.boss) || req.boss}`);
  if (req.cash) bits.push(fmtCash(req.cash));
  return bits.join(' · ') || 'Free';
}

export const owns = (p, id) => !!p?.owned?.[id];
export const bossKills = (p, id) => p?.bosses?.[id]?.kills || 0;

/** What still stands between a profile and an item: null when it can be used, else { text, price, canBuy, missing }. */
export function lockOf(p, id, req) {
  if (!req || !Object.keys(req).length) return null;
  if (owns(p, id)) return null;
  const missing = [];
  if (!p) missing.push('a profile');
  else {
    if (req.level && levelInfo(p.xp).level < req.level) missing.push(`level ${req.level}`);
    if (req.stars && tourStars(p) < req.stars) missing.push(`${req.stars} tour stars`);
    if (req.ach && !p.achievements?.[req.ach]) missing.push('an achievement');
    if (req.boss && !bossKills(p, req.boss)) missing.push('a boss trophy');
  }
  if (!missing.length && !req.cash) return null; // earned: nothing to buy
  const price = req.cash || 0;
  return { price, canBuy: !missing.length && !!price && (p?.cash || 0) >= price, needsCash: !missing.length && !!price, missing };
}

export const unlocked = (p, id, req) => !lockOf(p, id, req);

/** Buy an item. Throws with a message the menus can show. */
export async function buy(p, id, req) {
  const lock = lockOf(p, id, req);
  if (!lock) return false;
  if (lock.missing.length) throw new Error(`Needs ${lock.missing.join(', ')}`);
  if ((p.cash || 0) < lock.price) throw new Error(`Needs ${fmtCash(lock.price - (p.cash || 0))} more`);
  p.cash -= lock.price;
  (p.owned ||= {})[id] = Date.now();
  await profiles.saveSoon(true);
  return true;
}

/** Spend cash on something that isn't an item (an instrument upgrade level). */
export async function spend(p, amount) {
  if (!p) throw new Error('Sign in first');
  if ((p.cash || 0) < amount) throw new Error(`Needs ${fmtCash(amount - (p.cash || 0))} more`);
  p.cash -= amount;
  await profiles.saveSoon(true);
}

export function addCash(p, n) {
  if (!p || !(n > 0)) return 0;
  p.cash = Math.round((p.cash || 0) + n);
  return n;
}

/**
 * Record a boss fight for a profile. outcome: 'defeated' | 'escaped'. Returns { first, kills } for a win.
 * best = the fastest kill in seconds.
 */
export function recordBoss(p, bossId, { outcome, seconds = 0, flawless = false }) {
  if (!p || outcome !== 'defeated') return null;
  const b = ((p.bosses ||= {})[bossId] ||= { kills: 0, best: 0, first: 0, flawless: 0 });
  const first = !b.kills;
  b.kills++;
  if (!b.first) b.first = Date.now();
  if (seconds > 0 && (!b.best || seconds < b.best)) b.best = +seconds.toFixed(2);
  if (flawless) b.flawless = (b.flawless || 0) + 1;
  return { first, kills: b.kills };
}
