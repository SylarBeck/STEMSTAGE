// Runs: a roguelike night built from your own library. A run climbs a map of eight floors — gigs, encores (a harder
// song with a curse, double pay), the merch stand, the green room, backstage passes — to the headliner. You have three
// hearts: a gig under three stars (or a fail) costs one. Gigs pay run cash and a choice of perks: run-only gear
// (profile/rig.js modifiers) that stack. Win the headliner and the run is yours. Pure logic: ui/runs-ui.js shows it.
import { seededRandom } from './boss.js';
import { partRating, playable } from '../storage/insights.js';

export const FLOORS = 8; // the top floor is the headliner
export const HEARTS = 3;
export const DIFFS = ['easy', 'medium', 'hard', 'expert'];

export const NODES = {
  gig: { name: 'Gig', icon: 'music', desc: 'Play a song. Three stars or more pays and lets you pick a reward' },
  encore: { name: 'Encore', icon: 'fire', desc: 'A harder song with a curse on it. Pays double' },
  shop: { name: 'Merch stand', icon: 'store', desc: 'Spend run cash on perks, or a heart' },
  rest: { name: 'Green room', icon: 'couch', desc: 'Get a heart back' },
  mystery: { name: 'Backstage pass', icon: 'question', desc: 'Something happens. Usually good' },
  headliner: { name: 'Headliner', icon: 'crown', desc: 'The hardest song of the night. Win it and the run is yours' },
};

// perks: run-only gear (profile/rig.js keys; the rig's caps still apply). The first five are always in the pool, one
// more joins it for every run won.
export const PERKS = [
  { id: 'pick', name: 'Lucky Pick', desc: 'A streak shield: one miss keeps your streak', mod: { shield: 1 } },
  { id: 'neck', name: 'Wide Neck', desc: '+10 ms to hit each note', mod: { window: 0.01 } },
  { id: 'burn', name: 'Afterburner', desc: 'Overdrive lasts 30% longer', mod: { odTime: 0.3 } },
  { id: 'hype', name: 'Hype Man', desc: 'The crowd minds misses 30% less', mod: { crowd: 0.3 } },
  { id: 'fuzz', name: 'Fuzz', desc: 'Overdrive phrases fill 25% more', mod: { odGain: 0.25 } },
  { id: 'hands', name: 'Fast Hands', desc: 'The multiplier climbs every 8 notes', mod: { multStep: 8 } },
  { id: 'sustain', name: 'Sustainer', desc: 'Sustains score 30% more', mod: { sustain: 0.3 } },
  { id: 'merch', name: 'Merch Deal', desc: 'Gigs pay 25% more run cash', mod: { cash: 0.25 } },
];
export const CURSES = [
  { id: 'mirror', name: 'Mirror', desc: 'The highway is flipped' },
  { id: 'fog', name: 'Fog', desc: 'The far half of the highway is hidden' },
  { id: 'speed', name: 'Breakneck', desc: 'Notes come much faster' },
  { id: 'sudden', name: 'Sudden death', desc: 'No no-fail, and misses cost three times the crowd' },
  { id: 'nood', name: 'Unplugged', desc: 'No overdrive' },
];
export const PRICES = { perk: 60, heart: 50 };

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const dailySeed = (date = new Date()) => hash(`stemstage-run-${date.toISOString().slice(0, 10)}`);
const rngFor = (run, ...key) => seededRandom(hash(`${run.seed}:${key.join(':')}`));

/** The map: FLOORS rows of three nodes (the headliner alone on top); each node leads up to one or two above it. */
export function makeMap(seed) {
  const rnd = seededRandom(seed >>> 0);
  const floors = [];
  for (let f = 0; f < FLOORS; f++) {
    if (f === FLOORS - 1) { floors.push([{ f, i: 1, type: 'headliner', next: [] }]); continue; }
    const row = [];
    for (let i = 0; i < 3; i++) {
      let type = 'gig';
      if (f === FLOORS - 2) type = i === 1 ? 'rest' : 'shop'; // get ready for the headliner
      else if (f > 0) { const r = rnd(); type = r < 0.42 ? 'gig' : r < 0.6 ? 'encore' : r < 0.72 ? 'shop' : r < 0.86 ? 'mystery' : 'rest'; }
      row.push({ f, i, type, next: [] });
    }
    floors.push(row);
  }
  for (let f = 0; f < FLOORS - 1; f++) {
    for (const node of floors[f]) {
      if (floors[f + 1].length === 1) { node.next = [1]; continue; }
      const side = Math.max(0, Math.min(2, node.i + (rnd() < 0.5 ? -1 : 1)));
      node.next = [...new Set([node.i, side])].sort();
    }
  }
  return floors;
}

export function newRun({ seed = (Math.random() * 2 ** 32) >>> 0, daily = false, inst = 'guitar', diff = 'medium' } = {}) {
  return { v: 1, seed, daily, inst, diff, floors: makeMap(seed), at: null, hearts: HEARTS, cash: 0, perks: [], score: 0, played: [], cleared: 0, over: null, started: Date.now() };
}

export const nodeAt = (run, at) => (at ? run.floors[at.f]?.find((n) => n.i === at.i) : null);

/** Where the run can go next. */
export function choices(run) {
  if (run.over) return [];
  const here = nodeAt(run, run.at);
  if (!here) return run.floors[0];
  if (here.type === 'headliner') return [here]; // lost a heart on it: try again
  return here.next.map((i) => run.floors[here.f + 1].find((n) => n.i === i)).filter(Boolean);
}

/** The perks this profile can be offered (five, plus one per run won). */
export const perkPool = (won = 0) => PERKS.slice(0, Math.min(PERKS.length, 5 + won));

/** Every perk's modifiers added up (a gear modifier object for profile/rig.js cleanMods). */
export function runMods(run) {
  const m = { odGain: 0, odTime: 0, sustain: 0, crowd: 0, boss: 0, shield: 0, window: 0, multStep: 10, cash: 0 };
  for (const id of run.perks) {
    const p = PERKS.find((x) => x.id === id);
    if (!p) continue;
    for (const [k, v] of Object.entries(p.mod)) m[k] = k === 'multStep' ? Math.min(m[k], v) : m[k] + v;
  }
  return m;
}

/**
 * What a song node plays: { song, diff, curses } — a song from the library that's harder the higher the floor
 * (encores and the headliner harder still), not one already played this run when there's another.
 */
export function songFor(run, node, songs) {
  if (node.song && songs.some((s) => s.id === node.song)) return node;
  const base = DIFFS.indexOf(run.diff);
  const diff = DIFFS[Math.min(3, base + (node.type === 'encore' || node.type === 'headliner' ? 1 : 0))];
  const fresh = playable(songs, run.inst).filter((s) => !run.played.includes(s.id));
  const pool = (fresh.length ? fresh : playable(songs, run.inst)).map((s) => ({ s, r: partRating(s, run.inst, diff) }))
    .sort((a, b) => a.r - b.r || (a.s.id < b.s.id ? -1 : 1));
  if (!pool.length) return null;
  const rnd = rngFor(run, 'song', node.f, node.i);
  const climb = node.type === 'headliner' ? 1 : Math.min(1, node.f / (FLOORS - 1) + (node.type === 'encore' ? 0.25 : 0));
  const k = Math.max(0, Math.min(pool.length - 1, Math.round(climb * (pool.length - 1) + (rnd() - 0.5) * 2)));
  node.song = pool[k].s.id;
  node.diff = diff;
  node.curses = node.type === 'encore' ? [CURSES[Math.floor(rnd() * CURSES.length)].id] : [];
  return node;
}

/** Two perks you don't have yet (and run cash instead), offered after a good gig. */
export function rewardOptions(run, won = 0) {
  const rnd = rngFor(run, 'reward', run.cleared);
  const pool = perkPool(won).filter((p) => !run.perks.includes(p.id));
  const out = [];
  while (pool.length && out.length < 2) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

/** The merch stand: three perks for sale. */
export function shopItems(run, won = 0) {
  const rnd = rngFor(run, 'shop', run.at?.f, run.at?.i);
  const pool = perkPool(won).filter((p) => !run.perks.includes(p.id));
  const out = [];
  while (pool.length && out.length < 3) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

/** A backstage pass: a free perk, some cash, or a cursed bargain (a heart for cash). */
export function mystery(run, won = 0) {
  const rnd = rngFor(run, 'mystery', run.at?.f, run.at?.i);
  const r = rnd();
  const free = perkPool(won).filter((p) => !run.perks.includes(p.id));
  if (r < 0.45 && free.length) { const p = free[Math.floor(rnd() * free.length)]; run.perks.push(p.id); return { text: `A roadie hands you ${p.name}: ${p.desc.toLowerCase()}`, perk: p.id }; }
  if (r < 0.8 || run.hearts <= 1) { run.cash += 40; return { text: 'You find $40 in a guitar case', cash: 40 }; }
  run.hearts -= 1; run.cash += 90;
  return { text: 'A shady promoter pays $90 for a heart', cash: 90, heart: -1 };
}

/** Move onto a node that isn't a song (shop, rest, mystery). */
export function visit(run, node) {
  run.at = { f: node.f, i: node.i };
  if (node.type === 'rest') run.hearts = Math.min(HEARTS, run.hearts + 1);
}

/**
 * A song node was played. res: { stars, failed, score }. Moves the run on and returns
 * { cash, heart, reward (pick a perk next), won, lost }.
 */
export function playResult(run, node, res) {
  const ok = !res.failed && (res.stars || 0) >= 3;
  run.played.push(node.song);
  run.score += Math.max(0, res.score || 0);
  const out = { cash: 0, heart: 0, reward: false, won: false, lost: false };
  if (ok) {
    const mods = runMods(run);
    out.cash = Math.round((20 + (res.stars || 0) * 8) * (node.type === 'encore' ? 2 : node.type === 'headliner' ? 3 : 1) * (1 + mods.cash));
    run.cash += out.cash;
    run.cleared++;
    out.reward = node.type !== 'headliner';
  } else { run.hearts -= 1; out.heart = -1; }
  run.at = { f: node.f, i: node.i };
  if (node.type === 'headliner' && ok) { run.over = 'won'; out.won = true; }
  if (run.hearts <= 0) { run.over = 'lost'; out.lost = true; }
  return out;
}

/** What a finished run pays the profile: the run cash, plus a bonus and XP for every floor (more for a win). */
export function finalRewards(run) {
  const floor = run.at ? run.at.f + 1 : 0;
  return { cash: run.cash + (run.over === 'won' ? 150 : 0), xp: floor * 40 + (run.over === 'won' ? 250 : 0) };
}
