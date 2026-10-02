// The five worlds (v2): out-of-this-world stages, each with its own boss (game/boss.js).
// A world opens at a profile level, or as soon as you beat the previous world's boss.
import { levelInfo } from '../../profile/profiles.js';
import { bossKills } from '../../profile/economy.js';
import { buildAquarium } from './aquarium.js';
import { buildNebula } from './nebula.js';
import { buildForge } from './forge.js';
import { buildAurora } from './aurora.js';
import { buildCitadel } from './citadel.js';

export const WORLDS = {
  aquarium: { name: 'Abyssal Aquarium', boss: 'leviathan', level: 1, prev: null, icon: 'fish', blurb: 'A glass stage on the ocean floor. Something huge circles in the dark water.' },
  nebula: { name: 'Orbital Nebula', boss: 'conductor', level: 5, prev: 'leviathan', icon: 'user-astronaut', blurb: 'A holo-deck in orbit, ringed by asteroids. An eye opens between the stars.' },
  forge: { name: 'Volcanic Forge', boss: 'titan', level: 9, prev: 'conductor', icon: 'volcano', blurb: 'Obsidian over a lava lake, under an erupting volcano. The mountain stands up.' },
  aurora: { name: 'Crystal Aurora', boss: 'wyrm', level: 13, prev: 'titan', icon: 'snowflake', blurb: 'An ice cathedral under the northern lights. Wings on the wind.' },
  citadel: { name: 'Storm Citadel', boss: 'thunderbird', level: 17, prev: 'wyrm', icon: 'cloud-bolt', blurb: 'Floating ruins above a sea of clouds. The storm has a beak.' },
};
export const WORLD_IDS = Object.keys(WORLDS);
const BUILDERS = { aquarium: buildAquarium, nebula: buildNebula, forge: buildForge, aurora: buildAurora, citadel: buildCitadel };

/** Has this profile opened this world? (level, or the previous world's boss beaten). Guests get the first. */
export function worldUnlocked(p, id) {
  const w = WORLDS[id];
  if (!w) return false;
  if (w.level <= 1) return true;
  if (!p) return false;
  return levelInfo(p.xp || 0).level >= w.level || (w.prev && bossKills(p, w.prev) > 0);
}

export const worldLockText = (id) => { const w = WORLDS[id]; return `Level ${w.level}, or beat ${w.prev ? `the ${WORLDS[Object.keys(WORLDS).find((k) => WORLDS[k].boss === w.prev)].name} boss` : 'nothing'}`; };

/** Build a world into a stage (once; the stage keeps it and switches it on and off). */
export function buildWorld(id, stage) {
  const w = BUILDERS[id](stage);
  w.id = id;
  w.bossId = WORLDS[id].boss;
  w.group.visible = false;
  stage.scene.add(w.group);
  if (w.boss) stage.scene.add(w.boss.group);
  return w;
}
