// Instruments (v2): every part has a rig on the profile, p.rig[instrument] = { shape, finish, hardware, glow, guard,
// comps: { <component>: level } }, plus one pedalboard for all parts, p.rig.pedals = [pedal ids].
//   Cosmetics (shape, finish, hardware, LED glow, pickguard) change the instrument the band plays on stage.
//   Components level up with cash (1-5) and each raises one gameplay modifier for that part.
//   Pedals are bought or won from bosses; slots open with your level. They add modifiers to every part.
// The modifiers (gearMods) are applied by game/player.js. Runs played with gear that changes the game stay off the
// world leaderboard, like assists; Settings → Gameplay → Gear modifiers turns them off for ranked play.
import { fmtCash } from './economy.js';

export const RIG_PARTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
export const SHAPES = {
  guitar: ['classic', 'vee', 'star', 'offset', 'hollow'],
  bass: ['classic', 'vee', 'thunder', 'offset'],
  drums: ['standard', 'double', 'fusion'],
  keys: ['stage', 'synth', 'keytar'],
  vocals: ['classic', 'vintage', 'wireless'],
};
export const SHAPE_LABEL = {
  classic: 'Classic', vee: 'Flying Vee', star: 'Star', offset: 'Offset', hollow: 'Hollow body', thunder: 'Thunderbolt',
  standard: 'Standard kit', double: 'Double kick', fusion: 'Fusion kit', stage: 'Stage piano', synth: 'Synth workstation', keytar: 'Keytar',
  vintage: 'Vintage ribbon', wireless: 'Wireless',
};
export const SHAPE_REQ = {
  'shape.guitar.star': { level: 4, cash: 800 }, 'shape.guitar.hollow': { cash: 600 }, 'shape.guitar.offset': { cash: 400 },
  'shape.bass.thunder': { level: 6, cash: 900 }, 'shape.bass.offset': { cash: 400 },
  'shape.drums.double': { level: 5, cash: 900 }, 'shape.drums.fusion': { cash: 500 },
  'shape.keys.synth': { cash: 600 }, 'shape.keys.keytar': { level: 7, cash: 1100 },
  'shape.vocals.vintage': { cash: 400 }, 'shape.vocals.wireless': { level: 4, cash: 600 },
};
export const HARDWARE = ['chrome', 'gold', 'black', 'copper'];
export const HARDWARE_COLOR = { chrome: '#c9ccd6', gold: '#e6b84a', black: '#25242a', copper: '#c27a4a' };
export const HARDWARE_REQ = { 'hw.gold': { cash: 500 }, 'hw.copper': { cash: 300 } };
export const FINISHES = ['#d81b3a', '#1b5ed8', '#f0b429', '#ece5d3', '#15120e', '#b86a1b', '#2ed24f', '#b14cff', '#2fb3a8', '#ff7ab8', '#5a5a5a', '#7a0f22'];
export const GUARDS = ['#ece5d3', '#15120e', '#7a5a3a', '#c9ccd6', '#d81b3a'];
export const GLOWS = ['', '#2fd3ff', '#ff2d7a', '#3dff8a', '#ffcf3a', '#b36bff', '#ff6a1a'];
export const GLOW_REQ = { level: 3, cash: 350 };

/** Components per part: each raises one modifier. */
export const COMPONENTS = {
  guitar: [['pickups', 'Pickups', 'odGain'], ['amp', 'Tube amp', 'odTime'], ['strings', 'Strings', 'sustain'], ['tonewood', 'Tone woods', 'crowd']],
  bass: [['pickups', 'Pickups', 'odGain'], ['amp', 'Bass stack', 'odTime'], ['strings', 'Flatwounds', 'sustain'], ['bridge', 'Heavy bridge', 'crowd']],
  drums: [['shells', 'Shells', 'odGain'], ['cymbals', 'Cymbals', 'odTime'], ['pedal', 'Kick pedal', 'boss'], ['heads', 'Drum heads', 'crowd']],
  keys: [['engine', 'Sound engine', 'odGain'], ['rotary', 'Rotary speaker', 'odTime'], ['action', 'Key action', 'sustain'], ['patches', 'Patch bank', 'crowd']],
  vocals: [['capsule', 'Mic capsule', 'odGain'], ['monitors', 'In-ear monitors', 'odTime'], ['breath', 'Breath control', 'sustain'], ['presence', 'Stage presence', 'crowd']],
};
export const MAX_LEVEL = 5;
/** Cash for the next level (index = the level you're buying). */
export const LEVEL_COST = [0, 300, 650, 1200, 2100, 3600];
export const PER_LEVEL = { odGain: 0.05, odTime: 0.06, sustain: 0.08, crowd: 0.06, boss: 0.08 };

export const MODS = {
  odGain: { name: 'Overdrive charge', fmt: (v) => `+${Math.round(v * 100)}% overdrive from phrases` },
  odTime: { name: 'Overdrive length', fmt: (v) => `overdrive lasts +${Math.round(v * 100)}%` },
  sustain: { name: 'Sustain', fmt: (v) => `+${Math.round(v * 100)}% sustain points` },
  crowd: { name: 'Crowd', fmt: (v) => `crowd meter drops ${Math.round(v * 100)}% slower` },
  boss: { name: 'Boss damage', fmt: (v) => `+${Math.round(v * 100)}% damage to bosses` },
  shield: { name: 'Streak shield', fmt: (v) => `${v} miss${v === 1 ? '' : 'es'} per song keep${v === 1 ? 's' : ''} your streak` },
  window: { name: 'Timing', fmt: (v) => `+${Math.round(v * 1000)} ms to hit a note` },
  multStep: { name: 'Multiplier', fmt: (v) => `multiplier goes up every ${v} notes` },
  cash: { name: 'Merch', fmt: (v) => `+${Math.round(v * 100)}% cash (no effect on play)` },
};
const CAPS = { odGain: 0.6, odTime: 0.6, sustain: 0.6, crowd: 0.5, boss: 1.2, shield: 3, window: 0.012, cash: 0.5 };

export const PEDALS = [
  { id: 'merch', name: 'Merch Table', color: '#f0b429', mod: { cash: 0.25 }, req: { cash: 500 } },
  { id: 'fuzz', name: 'Fuzz Face', color: '#df3a2c', mod: { odGain: 0.15 }, req: { cash: 900 } },
  { id: 'delay', name: 'Tape Delay', color: '#2fb3a8', mod: { odTime: 0.2 }, req: { cash: 900 } },
  { id: 'comp', name: 'Compressor', color: '#2447d8', mod: { crowd: 0.25 }, req: { cash: 1000 } },
  { id: 'gate', name: 'Noise Gate', color: '#5a5a5a', mod: { shield: 2 }, req: { level: 4, cash: 1300 } },
  { id: 'wah', name: 'Auto-Wah', color: '#ff7ab8', mod: { window: 0.01 }, req: { level: 6, cash: 1600 } },
  { id: 'octave', name: 'Octaver', color: '#b36bff', mod: { multStep: 8 }, req: { level: 10, cash: 2400 } },
  { id: 'abyss', name: 'Abyssal Chorus', color: '#2fd3ff', mod: { boss: 0.3, sustain: 0.1 }, req: { boss: 'leviathan' } },
  { id: 'void', name: 'Void Reverb', color: '#8a5cff', mod: { odGain: 0.12, odTime: 0.12 }, req: { boss: 'conductor' } },
  { id: 'magma', name: 'Magma Drive', color: '#ff6a1a', mod: { boss: 0.2, crowd: 0.15 }, req: { boss: 'titan' } },
  { id: 'cryo', name: 'Cryo Sustainer', color: '#9fe8ff', mod: { sustain: 0.3, shield: 1 }, req: { boss: 'wyrm' } },
  { id: 'storm', name: 'Thunder Box', color: '#ffe14d', mod: { multStep: 8, odGain: 0.1 }, req: { boss: 'thunderbird' } },
];
export const pedalSlots = (level) => 1 + (level >= 8 ? 1 : 0) + (level >= 16 ? 1 : 0);
export const pedalDesc = (pd) => Object.entries(pd.mod).map(([k, v]) => MODS[k].fmt(v)).join(', ');

const hex = (v, list, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) && (!list || list.includes(v.toLowerCase())) ? v.toLowerCase() : fallback);
const DEFAULT_FINISH = { guitar: '#d81b3a', bass: '#1b5ed8', drums: '#b86a1b', keys: '#15120e', vocals: '#5a5a5a' };

/** One part's rig, made safe (also used for other players' rigs online: cosmetics only). */
export function cleanPart(inst, r = {}, finishFallback = null) {
  const o = r && typeof r === 'object' ? r : {};
  const comps = {};
  for (const [id] of COMPONENTS[inst] || []) comps[id] = Math.max(0, Math.min(MAX_LEVEL, Math.floor(+o.comps?.[id] || 0)));
  return {
    shape: SHAPES[inst].includes(o.shape) ? o.shape : SHAPES[inst][0],
    finish: hex(o.finish, null, finishFallback || DEFAULT_FINISH[inst]),
    hardware: HARDWARE.includes(o.hardware) ? o.hardware : 'chrome',
    glow: o.glow ? hex(o.glow, null, '') : '',
    guard: hex(o.guard, null, '#ece5d3'),
    comps,
  };
}

/** The cosmetic part of a rig (what other players see), for every part. */
export function cosmetics(p) {
  const out = {};
  for (const inst of RIG_PARTS) { const { comps, ...c } = rigPart(p, inst); out[inst] = c; }
  return out;
}

export function rigPart(p, inst) {
  return cleanPart(inst, p?.rig?.[inst], inst === (p?.look?.part || 'guitar') ? p?.look?.finish : null);
}

export function setRigPart(p, inst, fields) {
  const r = (p.rig ||= {});
  r[inst] = cleanPart(inst, { ...rigPart(p, inst), ...fields });
}

/** Pedals equipped (owned ones only, as many as the level allows). */
export function equippedPedals(p, level, owned = (id) => !!p?.owned?.[`pedal.${id}`]) {
  const ids = Array.isArray(p?.rig?.pedals) ? p.rig.pedals : [];
  return ids.filter((id, i) => ids.indexOf(id) === i && PEDALS.some((x) => x.id === id) && owned(id)).slice(0, pedalSlots(level));
}

/**
 * The modifiers one part plays with: its components plus the pedals. Capped, so stacking stays sane.
 * → { odGain, odTime, sustain, crowd, boss, shield, window, multStep, cash }
 */
export function gearMods(p, inst, level, ownedPedal) {
  const m = { odGain: 0, odTime: 0, sustain: 0, crowd: 0, boss: 0, shield: 0, window: 0, multStep: 10, cash: 0 };
  if (!p || !RIG_PARTS.includes(inst)) return m;
  const part = rigPart(p, inst);
  for (const [id, , mod] of COMPONENTS[inst]) m[mod] += (part.comps[id] || 0) * PER_LEVEL[mod];
  for (const id of equippedPedals(p, level, ownedPedal)) {
    const pd = PEDALS.find((x) => x.id === id);
    for (const [k, v] of Object.entries(pd.mod)) {
      if (k === 'multStep') m.multStep = Math.min(m.multStep, v);
      else m[k] += v;
    }
  }
  for (const [k, cap] of Object.entries(CAPS)) m[k] = Math.min(cap, +m[k].toFixed(4));
  return m;
}

/** True when the modifiers change how the game is played or scored (cash alone doesn't). */
export const changesPlay = (m) => !!m && (m.odGain > 0 || m.odTime > 0 || m.sustain > 0 || m.crowd > 0 || m.boss > 0 || m.shield > 0 || m.window > 0 || m.multStep < 10);

/** A modifier set as short lines for the menus. */
export function describeMods(m) {
  if (!m) return [];
  const out = [];
  for (const k of ['odGain', 'odTime', 'sustain', 'crowd', 'boss', 'shield', 'window', 'cash']) if (m[k] > 0) out.push(MODS[k].fmt(m[k]));
  if (m.multStep < 10) out.push(MODS.multStep.fmt(m.multStep));
  return out;
}

/** Make a modifier set from a replay / another game safe to apply. */
export function cleanMods(m) {
  if (!m || typeof m !== 'object') return null;
  const n = (v, cap) => Math.max(0, Math.min(cap, Number.isFinite(+v) ? +v : 0));
  return {
    odGain: n(m.odGain, CAPS.odGain), odTime: n(m.odTime, CAPS.odTime), sustain: n(m.sustain, CAPS.sustain), crowd: n(m.crowd, CAPS.crowd),
    boss: n(m.boss, CAPS.boss), shield: Math.floor(n(m.shield, CAPS.shield)), window: n(m.window, CAPS.window),
    multStep: Math.max(8, Math.min(10, Math.round(+m.multStep || 10))), cash: n(m.cash, CAPS.cash),
  };
}

export const upgradeCost = (level) => (level >= MAX_LEVEL ? null : LEVEL_COST[level + 1]);
export const upgradeText = (level) => (level >= MAX_LEVEL ? 'Maxed' : `Upgrade · ${fmtCash(LEVEL_COST[level + 1])}`);
