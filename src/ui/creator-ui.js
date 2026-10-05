// Backstage: the character & instrument creator. A full screen of its own over the 3D dressing room
// (game/backstage.js): mode tabs, a category rail, item cards with live 3D photos of every option, try-on as you
// move over a card, equip / buy / upgrade with sparks, coins, sounds and a counting wallet, rig stats, pedals,
// randomize and "strike a pose". Controller-first like every other screen.
import { profiles, levelInfo } from '../profile/profiles.js';
import {
  PARTS, SKINS, HAIR_COLORS, OUTFITS, GLOWS as LOOK_GLOWS, HAIR_STYLES, FACIAL, EYEWEAR, HEADWEAR, TOPS, EXTRAS, BUILDS, HEIGHTS, MOVES, BODIES, FACES, LEGS, KICKS,
  LABEL, PRESETS, WARDROBE_REQ, wardrobeId, cleanLook, fromPreset, lockedPieces,
} from '../profile/looks.js';
import {
  SHAPES, SHAPE_LABEL, SHAPE_REQ, HARDWARE, HARDWARE_COLOR, HARDWARE_REQ, FINISHES, GUARDS, GLOWS as RIG_GLOWS, GLOW_REQ,
  COMPONENTS, MAX_LEVEL, LEVEL_COST, PER_LEVEL, MODS, PEDALS, pedalSlots, pedalDesc, rigPart, setRigPart, gearMods, equippedPedals, cosmetics,
} from '../profile/rig.js';
import { lockOf, buy, spend, fmtCash, requirementText, BOSS_INFO } from '../profile/economy.js';
import { ACHIEVEMENTS } from '../profile/profiles.js';
import { fa, instIcon } from './icons.js';
import { settings } from '../settings.js';
import { SLOTS, ITEMS, DEFAULT_LAYOUT, itemId, cleanLayout } from '../game/props.js';
import { slotView } from '../game/stagecraft.js';

const STAGE_MAX = 6;
const SLOT_BLURB = {
  base: 'How big the room is: the crowd, the stacks and how much pyro the venue allows.', backdrop: 'What plays on the giant LED wall behind the band.',
  floor: 'The floor under the band and the crowd.', rig: 'The light show: movers on a truss, lasers, a disco ball, or just house lights.',
  wingL: 'Stage left: something big to stand next to.', wingR: 'Stage right: the other side.', upstage: 'Behind the band, either side of the drum riser.',
  downstage: 'At the front edge of the stage: pyro, CO₂, lamps.', overhead: 'Hanging above the band.', fx: 'What floats in the air.',
  crowd: 'How many people came.', gels: 'The colours of the lights, the LED wall and the trim.',
};
const STAGE_CATS = SLOTS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, shot: s.id, blurb: SLOT_BLURB[s.id], sections: [{ kind: 'stage', slot: s.id }] }));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PART_LABEL = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', keys: 'Keys', vocals: 'Vocals' };
const COLOR_NAME = (c) => c || 'Off';
const names = { ach: (id) => ACHIEVEMENTS.find((a) => a.id === id)?.name || id, boss: (id) => BOSS_INFO[id]?.name || id };
const MOD_COLOR = { odGain: '#f0b429', odTime: '#ff8a1a', sustain: '#2fd3ff', crowd: '#3dff8a', boss: '#ff2d7a' };
const MOD_CAP = { odGain: 0.6, odTime: 0.6, sustain: 0.6, crowd: 0.5, boss: 1.2 };
const COMP_ICON = { odGain: 'bolt', odTime: 'hourglass-half', sustain: 'wave-square', crowd: 'users', boss: 'dragon' };

// Character categories. A section edits one look field: 'thumb' cards get a 3D photo, 'swatch' cards a colour.
const CHAR_CATS = [
  { id: 'presets', name: 'Presets', icon: 'wand-magic-sparkles', shot: 'full', blurb: 'Start from a famous look, then make it yours.', sections: [{ kind: 'presets' }] },
  { id: 'part', name: 'Position', icon: 'guitar', shot: 'full', blurb: 'Where you stand when the band plays.', sections: [{ field: 'part', label: 'On stage at', values: PARTS, kind: 'part' }] },
  { id: 'body', name: 'Body', icon: 'person', shot: 'full', blurb: 'Body type, build, height and skin tone.', sections: [{ field: 'body', label: 'Body', values: BODIES, kind: 'thumb' }, { field: 'skin', label: 'Skin tone', values: SKINS, kind: 'swatch' }, { field: 'build', label: 'Build', values: BUILDS, kind: 'thumb' }, { field: 'height', label: 'Height', values: HEIGHTS, kind: 'thumb' }] },
  { id: 'hair', name: 'Hair', icon: 'scissors', shot: 'head', blurb: 'Ten cuts, ten colours.', sections: [{ field: 'hair', label: 'Style', values: HAIR_STYLES, kind: 'thumb' }, { field: 'hairColor', label: 'Colour', values: HAIR_COLORS, kind: 'swatch' }] },
  { id: 'face', name: 'Face', icon: 'face-smile', shot: 'head', blurb: 'Face shape, facial hair and eyewear.', sections: [{ field: 'face', label: 'Face', values: FACES, kind: 'thumb' }, { field: 'facial', label: 'Facial hair', values: FACIAL, kind: 'thumb' }, { field: 'eyes', label: 'Eyewear', values: EYEWEAR, kind: 'thumb' }] },
  { id: 'head', name: 'Headwear', icon: 'hat-cowboy', shot: 'head', blurb: 'Hats, crowns, horns and halos.', sections: [{ field: 'head', label: 'Headwear', values: HEADWEAR, kind: 'thumb' }] },
  { id: 'top', name: 'Tops', icon: 'shirt', shot: 'torso', blurb: 'Tees, shirts, blouses and jackets. The second colour is for hats and accessories.', sections: [{ field: 'topStyle', label: 'Style', values: TOPS, kind: 'thumb' }, { field: 'top', label: 'Main colour', values: OUTFITS, kind: 'swatch' }, { field: 'accent', label: 'Second colour', values: OUTFITS, kind: 'swatch' }] },
  { id: 'legs', name: 'Legs & shoes', icon: 'shoe-prints', shot: 'legs', blurb: 'Jeans, skirts, overalls, boots and sneakers.', sections: [{ field: 'legs', label: 'Bottoms', values: LEGS, kind: 'thumb' }, { field: 'pants', label: 'Colour', values: OUTFITS, kind: 'swatch' }, { field: 'kicks', label: 'Shoes', values: KICKS, kind: 'thumb' }, { field: 'shoes', label: 'Shoe colour', values: OUTFITS, kind: 'swatch' }] },
  { id: 'extras', name: 'Extras', icon: 'gem', shot: 'torso', blurb: 'Accessories and LED trim that glows on stage.', sections: [{ field: 'extra', label: 'Accessory', values: EXTRAS, kind: 'thumb' }, { field: 'glow', label: 'LED trim', values: LOOK_GLOWS, kind: 'swatch' }] },
  { id: 'moves', name: 'Stage moves', icon: 'person-running', shot: 'full', blurb: 'How you move when the music hits.', sections: [{ field: 'move', label: 'Move', values: MOVES, kind: 'move' }] },
];
const MOVE_ICON = { headbang: 'head-side-virus', sway: 'water', bounce: 'arrows-up-down', power: 'person-burst', spin: 'arrows-spin' };
const FIELD_SHOT = { hair: 'head', facial: 'head', eyes: 'head', head: 'head', face: 'head', topStyle: 'torso', extra: 'torso', build: 'full', height: 'full', body: 'full', legs: 'legs', kicks: 'feet' };

const instCats = (part) => [
  { id: 'model', name: 'Model', icon: part === 'drums' ? 'drum' : part === 'keys' ? 'music' : part === 'vocals' ? 'microphone' : 'guitar', shot: 'instrument', blurb: 'The instrument itself.', sections: [{ rig: 'shape', label: 'Model', values: SHAPES[part], kind: 'thumb' }] },
  { id: 'paint', name: 'Paint', icon: 'palette', shot: 'instrument', blurb: 'A clear-coated finish in any colour.', sections: [{ rig: 'finish', label: 'Finish', values: FINISHES, kind: 'swatch' }, ...(part === 'guitar' || part === 'bass' ? [{ rig: 'guard', label: 'Pickguard', values: GUARDS, kind: 'swatch' }] : [])] },
  { id: 'hardware', name: 'Hardware', icon: 'screwdriver-wrench', shot: 'instrument', blurb: 'Metal parts and LED strings, inlays and rings.', sections: [{ rig: 'hardware', label: 'Hardware', values: HARDWARE, kind: 'metal' }, { rig: 'glow', label: 'LED glow', values: RIG_GLOWS, kind: 'swatch' }] },
  { id: 'upgrades', name: 'Upgrades', icon: 'arrow-up-right-dots', shot: 'instrument', blurb: 'Spend cash to level up parts. Each level boosts your playing.', sections: [{ kind: 'components' }] },
  { id: 'pedals', name: 'Pedalboard', icon: 'sliders', shot: 'full', blurb: 'Stomp boxes for every part. More slots open at level 8 and 16.', sections: [{ kind: 'pedals' }] },
];

export function installCreator(ui) {
  const app = ui.app;
  const bs = app.backstage;
  const st = { mode: 'character', cat: 0, part: 'guitar', combo: 0, cash: null, shownCash: 0, tryKey: null };

  const prof = () => profiles.current;
  const level = () => levelInfo(prof()?.xp || 0).level;
  const look = () => cleanLook(prof()?.look) || fromPreset(PRESETS[0].id);
  const lockFor = (id, req) => (id && req ? lockOf(prof(), id, req) : null);
  const reqOf = (sec, v) => {
    if (sec.field) { const id = wardrobeId(sec.field, v); return id ? [id, WARDROBE_REQ[id]] : [null, null]; }
    if (sec.rig === 'shape') { const id = `shape.${st.part}.${v}`; return SHAPE_REQ[id] ? [id, SHAPE_REQ[id]] : [null, null]; }
    if (sec.rig === 'hardware') { const id = `hw.${v}`; return HARDWARE_REQ[id] ? [id, HARDWARE_REQ[id]] : [null, null]; }
    if (sec.rig === 'glow') return v ? ['rig.glow', GLOW_REQ] : [null, null];
    if (sec.slot) { const it = ITEMS[sec.slot].find(([id]) => id === v); return it && Object.keys(it[3]).length ? [itemId(sec.slot, v), it[3]] : [null, null]; }
    return [null, null];
  };
  const cats = () => (st.mode === 'character' ? CHAR_CATS : st.mode === 'stage' ? STAGE_CATS : instCats(st.part));
  const cat = () => cats()[Math.min(st.cat, cats().length - 1)];
  const shownPart = () => (st.mode === 'character' ? look().part : st.part);
  const rigFor = (part) => rigPart(prof(), part);

  // ---------------------------------------------------------------- the 3D model
  function showModel(lk = look(), rig = null) {
    const part = shownPart();
    bs.setPart(part, st.mode === 'instrument');
    bs.dress(lk, rig || rigFor(part));
  }
  function frame(shot) {
    if (st.mode === 'stage') { app.stage.designView(slotView(shot)); app.engine.sfxWhoosh(); return; }
    if (bs.focus(shot)) app.engine.sfxWhoosh();
  }

  // ---------------------------------------------------------------- stages (the stage designer)
  const stages = () => (prof().stages ||= []);
  function curStage() {
    let s = stages().find((x) => x.id === st.stageId) || stages()[0];
    if (!s) s = newStage();
    st.stageId = s.id;
    s.layout = cleanLayout(s.layout);
    return s;
  }
  function newStage() {
    const s = { id: Math.random().toString(36).slice(2, 8), name: `My Stage ${stages().length + 1}`, layout: { ...DEFAULT_LAYOUT } };
    stages().push(s);
    profiles.saveSoon();
    profiles.award(prof().id, 'stage_builder').then((fresh) => { for (const a of fresh) ui.toast(`${a.name} — ${a.desc}`, 'ok', 'trophy'); });
    return s;
  }
  const showStage = (layout = curStage().layout) => app.stage.setCustom(`custom:${curStage().id}`, layout);
  /** Into the stage designer: the real stage is on screen instead of the dressing room. */
  function stageView(on) {
    if (on) { bs.active = false; app.renderer.setView(null); showStage(); app.stage.designView(slotView(cat().shot)); }
    else { app.stage.designView(null); bs.active = true; app.renderer.setView(bs); }
  }
  function stageHeader() {
    const cur = curStage();
    return `<div class="cr-stages">${stages().map((s) => `<button class="cr-chip ${s.id === cur.id ? 'sel' : ''}" data-nav data-cr-stage="${s.id}">${fa('helmet-safety')} ${esc(s.name)}</button>`).join('')}
      ${stages().length < STAGE_MAX ? `<button class="cr-chip add" data-nav data-cr-stage="new">${fa('plus')} New stage</button>` : ''}</div>
      <div class="cr-stage-acts"><button class="nav-btn primary" data-nav data-cr-sact="play">${fa('play')} Play on this stage</button><button class="nav-btn" data-nav data-cr-sact="rename">${fa('pen')} Rename</button>${stages().length > 1 ? `<button class="nav-btn danger" data-nav data-cr-sact="delete">${fa('trash')}</button>` : ''}</div>`;
  }
  async function stageAction(a) {
    const cur = curStage();
    if (a === 'play') { settings.venue = `custom:${cur.id}`; app.engine.sfxPose(); app.stage.pyro(0.8); app.stage.confettiBurst(); ui.toast(`Songs now play on "${cur.name}"`, 'ok', 'helmet-safety'); return; }
    if (a === 'rename') {
      const name = await ui.osk.show({ title: 'Stage name', value: cur.name, type: 'text', max: 24 });
      if (name && name.trim()) { cur.name = name.trim().slice(0, 24); profiles.saveSoon(); render(); }
      return;
    }
    if (a === 'delete' && stages().length > 1 && await ui.confirmDialog(`Delete "${cur.name}"?`, 'The stage goes; everything you unlocked for it stays yours.', 'Delete')) {
      prof().stages = stages().filter((s) => s.id !== cur.id);
      if (settings.venue === `custom:${cur.id}`) settings.venue = 'auto';
      st.stageId = null; profiles.saveSoon(); showStage(); render();
    }
  }
  function pickStage(id) {
    if (id === 'new') { if (stages().length < STAGE_MAX) { st.stageId = newStage().id; app.engine.sfxEquip(2); } }
    else st.stageId = id;
    showStage();
    app.stage.pyro(0.5);
    render();
  }

  // ---------------------------------------------------------------- open / close
  function open() {
    if (!prof()) {
      ui.toast('Sign in to dress up your band member and their instruments', 'err');
      ui.actionHooks.profiles?.();
      return;
    }
    ui.show('creator');
  }
  function enter() {
    bs.active = st.mode !== 'stage';
    app.renderer.setView(bs.active ? bs : null);
    st.cash = prof()?.cash || 0;
    st.shownCash = st.cash;
    st.combo = 0;
    if (st.mode === 'stage') stageView(true);
    else { showModel(); bs.focus(cat().shot); }
    render(true);
  }
  function leave() {
    app.stage.designView(null);
    bs.active = false;
    bs.clearThumbQueue();
    app.renderer.setView(null);
    ui.applyLooks();
  }

  // ---------------------------------------------------------------- render
  function wallet(animate = true) {
    const el = $('#cr-cash');
    const target = prof()?.cash || 0;
    if (!animate) { st.shownCash = target; el.textContent = fmtCash(target); return; }
    const from = st.shownCash, t0 = performance.now();
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 650);
      st.shownCash = from + (target - from) * (1 - Math.pow(1 - k, 3));
      el.textContent = fmtCash(st.shownCash);
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  function render(resetFocus = false) {
    const p = prof();
    const root = $('#screen-creator');
    if (!p || !root) return;
    const lv = levelInfo(p.xp);
    root.dataset.mode = st.mode;
    $('#cr-modes').innerHTML = [['character', 'Character', 'user-astronaut'], ['instrument', 'Instruments', 'guitar'], ['stage', 'Stages', 'helmet-safety']]
      .map(([v, l, i]) => `<button class="cr-mode ${st.mode === v ? 'sel' : ''}" data-nav data-cr-mode="${v}">${fa(i)} ${l}</button>`).join('');
    $('#cr-parts').innerHTML = st.mode === 'instrument' ? PARTS.map((pt) => `<button class="cr-part ${st.part === pt ? 'sel' : ''}" data-nav data-cr-part="${pt}" title="${PART_LABEL[pt]}">${instIcon(pt)}<span>${PART_LABEL[pt]}</span></button>`).join('') : '';
    $('#cr-name').innerHTML = `<b>${esc(p.name)}</b><small>Level ${lv.level} · ${esc(lv.rank)}</small>`;
    $('#cr-rail').innerHTML = cats().map((c, i) => `<button class="cr-cat ${i === st.cat ? 'sel' : ''}" data-nav data-cr-cat="${i}">${fa(c.icon)}<span>${c.name}</span></button>`).join('');
    wallet(false);
    renderPanel();
    renderStats();
    $$('[data-cr-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.crMode));
    $$('[data-cr-part]').forEach((b) => b.onclick = () => setPart(b.dataset.crPart));
    $$('[data-cr-cat]').forEach((b) => b.onclick = () => setCat(+b.dataset.crCat));
    if (resetFocus) { ui.focus = Math.max(0, ui.navItems().findIndex((x) => x.dataset.crCat === String(st.cat))); }
    ui.applyFocus(false);
  }

  function card({ key, sel, lock, label, sub, thumb, swatch, icon, data }) {
    const badge = lock ? (lock.needsCash ? `<span class="cr-price ${lock.canBuy ? 'ok' : ''}">${fa('coins')} ${fmtCash(lock.price)}</span>` : `<span class="cr-lock">${fa('lock')}</span>`) : sel ? `<span class="cr-on">${fa('check')}</span>` : '';
    const face = thumb ? `<span class="cr-thumb"><img alt="" data-thumb="${esc(key)}" hidden><i class="cr-spin"></i></span>`
      : swatch !== undefined ? `<span class="cr-swatch ${swatch ? '' : 'off'}" style="--c:${swatch || 'transparent'}"></span>`
        : `<span class="cr-icon">${icon || ''}</span>`;
    return `<button class="cr-item ${sel ? 'sel' : ''} ${lock ? 'locked' : ''} ${swatch !== undefined ? 'small' : ''}" data-nav data-cr-item="${esc(key)}" ${data}>${face}<b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${badge}</button>`;
  }

  function renderPanel() {
    const c = cat();
    const p = prof();
    const lk = look();
    const rig = rigFor(st.part);
    let html = `<div class="cr-head"><h2>${fa(c.icon)} ${c.name}</h2><p>${esc(c.blurb)}</p></div>`;
    const thumbs = [];
    for (const sec of c.sections) {
      if (sec.kind === 'presets') {
        html += `<div class="cr-sec"><div class="cr-grid big">${PRESETS.map((pr) => {
          const l = fromPreset(pr.id, lk.part);
          const locked = lockedPieces(l, (id, req) => !lockFor(id, req));
          const key = `preset|${pr.id}|${lk.part}`;
          thumbs.push([key, l, rigFor(lk.part), 'full']);
          return card({ key, sel: lk.preset === pr.id, label: pr.name, sub: locked.length ? `${locked.length} locked piece${locked.length === 1 ? '' : 's'}` : '', thumb: true, data: `data-preset="${pr.id}"` });
        }).join('')}</div></div>`;
        continue;
      }
      if (sec.kind === 'components') { html += componentsHtml(rig); continue; }
      if (sec.kind === 'stage') {
        const layout = curStage().layout;
        html = stageHeader() + html;
        html += `<div class="cr-sec"><div class="cr-grid">${ITEMS[sec.slot].map(([v, name, icon]) => {
          const [id, req] = reqOf(sec, v);
          const lock = lockFor(id, req);
          return card({ key: `s|${sec.slot}|${v}`, sel: layout[sec.slot] === v, lock, label: name, sub: lock && !lock.needsCash ? requirementText(req, names) : '', icon: fa(icon), data: `data-slot="${sec.slot}" data-v="${v}"` });
        }).join('')}</div></div>`;
        continue;
      }
      if (sec.kind === 'pedals') { html += pedalsHtml(); continue; }
      const field = sec.field || sec.rig;
      const cur = sec.field ? lk[field] : rig[field];
      html += `<div class="cr-sec"><h4>${esc(sec.label)}<em>${esc(sec.kind === 'swatch' ? COLOR_NAME(cur) : sec.kind === 'metal' ? cur : (sec.rig === 'shape' ? SHAPE_LABEL[cur] : LABEL[cur] || cur))}</em></h4><div class="cr-grid ${sec.kind === 'swatch' || sec.kind === 'metal' ? 'swatches' : ''}">`;
      for (const v of sec.values) {
        const [id, req] = reqOf(sec, v);
        const lock = lockFor(id, req);
        const key = `${sec.field ? 'f' : 'r'}|${field}|${v}`;
        const data = `data-field="${field}" data-v="${esc(v)}" data-scope="${sec.field ? 'look' : 'rig'}"`;
        const sub = lock && !lock.needsCash ? requirementText(req, names) : '';
        if (sec.kind === 'swatch') html += card({ key, sel: cur === v, lock, label: v ? '' : 'Off', swatch: v, data });
        else if (sec.kind === 'metal') html += card({ key, sel: cur === v, lock, label: v[0].toUpperCase() + v.slice(1), swatch: HARDWARE_COLOR[v], data });
        else if (sec.kind === 'part') html += card({ key, sel: cur === v, lock, label: PART_LABEL[v], icon: instIcon(v), data });
        else if (sec.kind === 'move') html += card({ key, sel: cur === v, lock, label: LABEL[v], sub, icon: fa(MOVE_ICON[v] || 'music'), data });
        else {
          html += card({ key, sel: cur === v, lock, label: sec.rig === 'shape' ? SHAPE_LABEL[v] : LABEL[v] || v, sub, thumb: true, data });
          if (sec.field) thumbs.push([key + '|' + JSON.stringify(lk), { ...lk, [field]: v }, rig, FIELD_SHOT[field] || c.shot, key]);
          else thumbs.push([key + '|' + st.part + '|' + JSON.stringify(rig) + lk.skin, lk, { ...rig, [field]: v }, 'instrument', key]);
        }
      }
      html += '</div></div>';
    }
    const panel = $('#cr-panel');
    panel.innerHTML = html;
    panel.scrollTop = 0;
    // photos: the model wearing each option, taken by the backstage renderer
    bs.clearThumbQueue();
    for (const [cacheKey, l, rg, shot, cardKey = cacheKey] of thumbs) {
      bs.thumb(cacheKey, l, rg, shot, (url) => {
        const img = panel.querySelector(`img[data-thumb="${CSS.escape(cardKey)}"]`);
        if (img) { img.src = url; img.hidden = false; img.parentElement.classList.add('ready'); }
      });
    }
    $$('.cr-item', panel).forEach((b) => b.addEventListener('click', () => activate(b)));
    $$('[data-cr-comp]', panel).forEach((b) => b.addEventListener('click', () => upgrade(b.dataset.crComp)));
    $$('[data-cr-pedal]', panel).forEach((b) => b.addEventListener('click', () => pedal(b.dataset.crPedal)));
    $$('[data-cr-slot]', panel).forEach((b) => b.addEventListener('click', () => unequipSlot(+b.dataset.crSlot)));
    $$('[data-cr-stage]', panel).forEach((b) => b.addEventListener('click', () => pickStage(b.dataset.crStage)));
    $$('[data-cr-sact]', panel).forEach((b) => b.addEventListener('click', () => stageAction(b.dataset.crSact)));
  }

  function componentsHtml(rig) {
    return `<div class="cr-sec">${COMPONENTS[st.part].map(([id, name, mod]) => {
      const lvl = rig.comps[id] || 0;
      const cost = lvl >= MAX_LEVEL ? null : LEVEL_COST[lvl + 1];
      const can = cost != null && (prof()?.cash || 0) >= cost;
      return `<button class="cr-comp ${lvl >= MAX_LEVEL ? 'maxed' : ''}" data-nav data-cr-comp="${id}" style="--mc:${MOD_COLOR[mod]}">
        <span class="cc-ico">${fa(COMP_ICON[mod])}</span>
        <span class="cc-txt"><b>${esc(name)}</b><small>${esc(MODS[mod].name)} +${Math.round(PER_LEVEL[mod] * 100)}% per level</small></span>
        <span class="cc-pips">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>
        <span class="cc-cost ${can ? 'ok' : ''}">${cost == null ? `${fa('crown')} MAX` : `${fa('arrow-up')} ${fmtCash(cost)}`}</span></button>`;
    }).join('')}</div>`;
  }

  function pedalsHtml() {
    const p = prof();
    const slots = pedalSlots(level());
    const eq = equippedPedals(p, level());
    const owned = (id) => !!p?.owned?.[`pedal.${id}`];
    let html = `<div class="cr-sec"><h4>Your board<em>${eq.length}/${slots} slots</em></h4><div class="cr-board">`;
    for (let i = 0; i < 3; i++) {
      const id = eq[i], pd = PEDALS.find((x) => x.id === id);
      if (i >= slots) html += `<div class="cr-slot locked">${fa('lock')}<small>Level ${i === 1 ? 8 : 16}</small></div>`;
      else if (pd) html += `<button class="cr-slot on" data-nav data-cr-slot="${i}" style="--pc:${pd.color}"><span class="stomp"><i></i><i></i></span><b>${esc(pd.name)}</b><small>Remove</small></button>`;
      else html += '<div class="cr-slot empty"><small>Empty slot</small></div>';
    }
    html += '</div></div><div class="cr-sec"><h4>Pedal shop<em>Boss pedals drop when you beat a world boss</em></h4><div class="cr-grid pedals">';
    for (const pd of PEDALS) {
      const lock = owned(pd.id) ? null : lockFor(`pedal.${pd.id}`, pd.req);
      const on = eq.includes(pd.id);
      html += `<button class="cr-item pedal ${on ? 'sel' : ''} ${lock ? 'locked' : ''}" data-nav data-cr-pedal="${pd.id}" style="--pc:${pd.color}">
        <span class="stomp"><i></i><i></i></span><b>${esc(pd.name)}</b><small>${esc(pedalDesc(pd))}</small>
        ${lock ? (lock.needsCash ? `<span class="cr-price ${lock.canBuy ? 'ok' : ''}">${fa('coins')} ${fmtCash(lock.price)}</span>` : `<span class="cr-lock">${fa('lock')}<em>${esc(requirementText(pd.req, names))}</em></span>`) : on ? `<span class="cr-on">${fa('check')}</span>` : ''}</button>`;
    }
    return `${html}</div></div>`;
  }

  /** Rig stats on the right: what this part's upgrades and pedals do in a song. */
  function renderStats() {
    const el = $('#cr-stats');
    if (st.mode !== 'instrument') { el.hidden = true; return; }
    el.hidden = false;
    const m = gearMods(prof(), st.part, level());
    const prev = st.lastMods?.[st.part] || m;
    el.innerHTML = `<h4>${instIcon(st.part)} ${PART_LABEL[st.part]} rig</h4>` + ['odGain', 'odTime', 'sustain', 'crowd', 'boss'].map((k) => {
      const w = Math.min(100, (m[k] / MOD_CAP[k]) * 100), w0 = Math.min(100, (prev[k] / MOD_CAP[k]) * 100);
      const up = m[k] > prev[k] + 1e-6;
      return `<div class="cs-row ${up ? 'up' : ''}" style="--mc:${MOD_COLOR[k]}"><span>${fa(COMP_ICON[k])} ${MODS[k].name}</span><div class="cs-bar"><i style="--w0:${w0}%;--w:${w}%"></i></div><b>${m[k] ? `+${Math.round(m[k] * 100)}%` : '—'}</b>${up ? `<em class="cs-float">+${Math.round((m[k] - prev[k]) * 100)}%</em>` : ''}</div>`;
    }).join('') + [m.shield ? `${fa('shield-halved')} ${MODS.shield.fmt(m.shield)}` : '', m.window ? `${fa('stopwatch')} ${MODS.window.fmt(m.window)}` : '', m.multStep < 10 ? `${fa('xmark')} ${MODS.multStep.fmt(m.multStep)}` : '', m.cash ? `${fa('coins')} ${MODS.cash.fmt(m.cash)}` : '']
      .filter(Boolean).map((x) => `<div class="cs-line">${x}</div>`).join('')
      + `<p class="cs-note">${settings.gearMods === false ? 'Gear modifiers are off (Settings → Gameplay): you play pure, ranked runs.' : settings.proMode ? 'Pro mode plays without gear.' : 'Gear runs earn XP and cash but stay off the world leaderboard. Turn gear off in Settings for ranked play.'}</p>`;
    (st.lastMods ||= {})[st.part] = m;
  }

  // ---------------------------------------------------------------- try on (focus) and equip (confirm)
  function readItem(el) {
    if (el.dataset.preset) return { preset: el.dataset.preset };
    if (el.dataset.slot) return { slot: el.dataset.slot, v: el.dataset.v };
    if (!el.dataset.field) return null;
    return { scope: el.dataset.scope, field: el.dataset.field, v: el.dataset.v };
  }

  function preview(el) {
    const it = el && readItem(el);
    const key = el?.dataset.crItem || null;
    if (key === st.tryKey) return;
    st.tryKey = key;
    bs.moveDemo = false;
    if (st.mode === 'stage') { showStage(it?.slot ? { ...curStage().layout, [it.slot]: it.v } : undefined); return; }
    if (!it) { showModel(); return; }
    const lk = look(), rig = rigFor(shownPart());
    if (it.preset) showModel(fromPreset(it.preset, lk.part));
    else if (it.scope === 'look') {
      const nl = cleanLook({ ...lk, preset: null, [it.field]: it.v });
      if (it.field === 'part') { bs.setPart(nl.part); bs.dress(nl, rigFor(nl.part)); } else showModel(nl);
      if (it.field === 'move') bs.moveDemo = true;
    } else showModel(lk, { ...rig, [it.field]: it.v });
  }

  async function activate(el) {
    const it = readItem(el);
    const p = prof();
    if (!it || !p) return;
    let lock = null, id = null, req = null;
    if (it.preset) {
      const l = fromPreset(it.preset, look().part);
      const locked = lockedPieces(l, (i, r) => !lockFor(i, r));
      const defaults = { hair: 'short', facial: 'none', eyes: 'none', head: 'none', topStyle: 'tee', extra: 'none', glow: '', move: 'headbang', skin: SKINS[1] };
      for (const f of locked) l[f] = defaults[f];
      if (locked.length) ui.toast(`${locked.length} piece${locked.length === 1 ? ' is' : 's are'} still locked: swapped for free ones`);
      profiles.setLook(p.id, cleanLook(l));
      equipped(el, PRESETS.find((x) => x.id === it.preset)?.top || '#f0b429', 'full');
      return;
    }
    if (it.slot) {
      const it2 = ITEMS[it.slot].find(([id]) => id === it.v);
      const req2 = it2 && Object.keys(it2[3]).length ? it2[3] : null;
      const lock2 = req2 ? lockFor(itemId(it.slot, it.v), req2) : null;
      if (lock2 && !(await purchase(el, itemId(it.slot, it.v), req2, lock2, it2[1]))) return;
      curStage().layout[it.slot] = it.v;
      profiles.saveSoon();
      showStage();
      app.stage.pyro(0.45);
      if (it.slot === 'overhead' || it.slot === 'fx') app.stage.confettiBurst(); else app.stage.sparks();
      app.engine.sfxEquip(st.combo++);
      st.tryKey = null;
      render();
      const items = ui.navItems(); const i = items.findIndex((x) => x.dataset.crItem === el.dataset.crItem);
      if (i >= 0) { ui.focus = i; ui.applyFocus(false); items[i].classList.add('pop'); }
      return;
    }
    const sec = cat().sections.find((s) => (s.field || s.rig) === it.field);
    [id, req] = sec ? reqOf(sec, it.v) : [null, null];
    lock = lockFor(id, req);
    if (lock) {
      if (!(await purchase(el, id, req, lock, it.scope === 'rig' && it.field === 'shape' ? SHAPE_LABEL[it.v] : LABEL[it.v] || it.v))) return;
    }
    if (it.scope === 'look') profiles.setLook(p.id, cleanLook({ ...look(), preset: null, [it.field]: it.v }));
    else { setRigPart(p, st.part, { [it.field]: it.v }); profiles.saveSoon(); }
    const color = /^#/.test(it.v) ? it.v : it.field === 'hardware' ? HARDWARE_COLOR[it.v] : '#f0b429';
    equipped(el, color, it.scope === 'rig' ? 'instrument' : FIELD_SHOT[it.field] || cat().shot);
  }

  /** Buy something (or say what it needs). → true when it's now unlocked. */
  async function purchase(el, id, req, lock, name) {
    if (!lock.needsCash) {
      deny(el, `Locked: ${requirementText(req, names)}`);
      return false;
    }
    if (!lock.canBuy) { deny(el, `${name}: needs ${fmtCash(lock.price - (prof()?.cash || 0))} more cash. Play songs and beat bosses to earn it`); return false; }
    const ok = await ui.confirmDialog(`Buy ${name}?`, `${fmtCash(lock.price)} of your ${fmtCash(prof().cash)}. It's yours for good.`, `Buy for ${fmtCash(lock.price)}`);
    if (!ok) return false;
    try { await buy(prof(), id, req); } catch (e) { deny(el, e.message); return false; }
    cashJuice();
    return true;
  }

  function cashJuice() {
    app.engine.sfxCash();
    bs.burst('#f0b429', bs.shot, true);
    wallet(true);
    const w = $('#cr-wallet');
    w.classList.remove('spend'); void w.offsetWidth; w.classList.add('spend');
  }

  function deny(el, msg) {
    app.engine.sfxLocked();
    el?.classList.remove('shake'); void el?.offsetWidth; el?.classList.add('shake');
    ui.toast(msg, 'err', 'lock');
  }

  function equipped(el, color, shot) {
    app.engine.sfxEquip(st.combo++);
    clearTimeout(st.comboTimer); st.comboTimer = setTimeout(() => { st.combo = 0; }, 2500);
    bs.burst(color, shot);
    const key = el?.dataset.crItem;
    st.tryKey = null;
    showModel();
    const keep = ui.navItems()[ui.focus]?.dataset;
    render();
    const items = ui.navItems();
    const i = items.findIndex((x) => (key && x.dataset.crItem === key) || (keep?.crComp && x.dataset.crComp === keep.crComp) || (keep?.crPedal && x.dataset.crPedal === keep.crPedal));
    if (i >= 0) { ui.focus = i; ui.applyFocus(false); items[i].classList.add('pop'); }
  }

  // ---------------------------------------------------------------- upgrades + pedals
  async function upgrade(compId) {
    const p = prof();
    const rig = rigFor(st.part);
    const lvl = rig.comps[compId] || 0;
    const el = $(`[data-cr-comp="${compId}"]`);
    if (lvl >= MAX_LEVEL) { deny(el, 'Already maxed out'); return; }
    const cost = LEVEL_COST[lvl + 1];
    if ((p.cash || 0) < cost) { deny(el, `Needs ${fmtCash(cost - (p.cash || 0))} more cash`); return; }
    try { await spend(p, cost); } catch (e) { deny(el, e.message); return; }
    setRigPart(p, st.part, { comps: { ...rig.comps, [compId]: lvl + 1 } });
    await profiles.saveSoon(true);
    app.engine.sfxUpgrade(lvl + 1);
    bs.burst(MOD_COLOR[COMPONENTS[st.part].find(([id]) => id === compId)[2]], 'instrument', true);
    wallet(true);
    if (lvl + 1 >= MAX_LEVEL) { const fresh = await profiles.award(p.id, 'gear_max'); for (const a of fresh) ui.toast(`${a.name} — ${a.desc}`, 'ok', 'trophy'); }
    equipped(el, '#f0b429', 'instrument');
  }

  async function pedal(id) {
    const p = prof();
    const pd = PEDALS.find((x) => x.id === id);
    const el = $(`[data-cr-pedal="${id}"]`);
    if (!p.owned?.[`pedal.${id}`]) {
      const lock = lockFor(`pedal.${id}`, pd.req);
      if (lock) {
        if (!(await purchase(el, `pedal.${id}`, pd.req, lock, pd.name))) return;
      } else { (p.owned ||= {})[`pedal.${id}`] = Date.now(); } // earned (a boss pedal): claim it
    }
    const rig = (p.rig ||= {});
    const eq = equippedPedals(p, level());
    if (eq.includes(id)) rig.pedals = eq.filter((x) => x !== id);
    else if (eq.length >= pedalSlots(level())) { deny(el, `Every slot is full: remove a pedal from your board first${level() < 16 ? ' (more slots at level 8 and 16)' : ''}`); return; }
    else rig.pedals = [...eq, id];
    await profiles.saveSoon(true);
    equipped(el, pd.color, 'full');
  }

  function unequipSlot(i) {
    const p = prof();
    const eq = equippedPedals(p, level());
    if (!eq[i]) return;
    p.rig.pedals = eq.filter((_, k) => k !== i);
    profiles.saveSoon();
    app.engine.sfxUi('back');
    render();
  }

  // ---------------------------------------------------------------- navigation
  function setMode(mode) {
    if (mode === st.mode) return;
    if (st.mode === 'stage') stageView(false);
    st.mode = mode;
    st.cat = 0;
    if (mode === 'stage') { stageView(true); app.engine.sfxWhoosh(); render(true); return; }
    if (mode === 'instrument') st.part = look().part;
    st.tryKey = null;
    showModel();
    frame(cat().shot);
    render(true);
  }
  function setPart(part) {
    if (part === st.part) return;
    st.part = part;
    st.cat = Math.min(st.cat, cats().length - 1);
    st.tryKey = null;
    showModel();
    bs.burst('#ece5d3', 'full');
    app.engine.sfxWhoosh();
    bs.focus(cat().shot);
    render();
  }
  function setCat(i) {
    const n = cats().length;
    i = (i + n) % n;
    if (i === st.cat) return;
    st.cat = i;
    st.tryKey = null;
    if (st.mode === 'stage') showStage(); else showModel();
    frame(cat().shot);
    const focusRail = ui.navItems()[ui.focus]?.dataset.crCat !== undefined;
    render();
    if (focusRail) { ui.focus = Math.max(0, ui.navItems().findIndex((x) => x.dataset.crCat === String(st.cat))); ui.applyFocus(false); }
  }

  function randomize() {
    const p = prof();
    const pickFree = (field, list) => {
      const free = list.filter((v) => { const id = wardrobeId(field, v); return !id || !lockFor(id, WARDROBE_REQ[id]); });
      return free[Math.floor(Math.random() * free.length)];
    };
    const lk = look();
    const nl = cleanLook({
      ...lk, preset: null, body: pickFree('body', BODIES), face: pickFree('face', FACES), skin: pickFree('skin', SKINS.slice(0, 6)), build: pickFree('build', BUILDS), height: pickFree('height', HEIGHTS),
      hair: pickFree('hair', HAIR_STYLES), hairColor: pickFree('hairColor', HAIR_COLORS), facial: pickFree('facial', FACIAL), eyes: pickFree('eyes', EYEWEAR),
      head: Math.random() < 0.4 ? pickFree('head', HEADWEAR) : 'none', topStyle: pickFree('topStyle', TOPS), top: pickFree('top', OUTFITS), accent: pickFree('accent', OUTFITS),
      pants: pickFree('pants', OUTFITS), shoes: pickFree('shoes', OUTFITS), legs: pickFree('legs', LEGS), kicks: pickFree('kicks', KICKS), extra: Math.random() < 0.5 ? pickFree('extra', EXTRAS) : 'none', move: pickFree('move', MOVES),
    });
    profiles.setLook(p.id, nl);
    bs.pose();
    app.engine.sfxEquip(3);
    showModel();
    render();
  }

  // focus moves try things on; the rail switches categories as you move along it
  ui.focusHooks.creator = (el) => {
    if (el?.dataset.crCat !== undefined) { setCat(+el.dataset.crCat); preview(null); return; }
    preview(el?.dataset.crItem ? el : null);
  };
  ui.navHooks.push((dir) => {
    if (ui.screen !== 'creator' || ui.sheet || ui.osk.open) return false;
    if (dir === 'prev' || dir === 'next') { setCat(st.cat + (dir === 'next' ? 1 : -1)); return true; }
    if (dir === 'pgup' || dir === 'pgdn') { if (st.mode !== 'stage') bs.turn(dir === 'pgdn' ? 5 : -5); return true; }
    if (dir === 'alt') { if (st.mode === 'stage') { app.stage.pyro(1); app.stage.sparks(); app.engine.sfxPose(); } else { bs.pose(); app.engine.sfxPose(); } return true; }
    if (dir === 'alt2' && st.mode === 'character') { randomize(); return true; }
    if (dir === 'select') { setMode({ character: 'instrument', instrument: 'stage', stage: 'character' }[st.mode]); return true; }
    return false;
  });
  ui.legendHooks.creator = () => (st.mode === 'stage'
    ? [['confirm', 'Equip'], ['prevnext', 'Part'], ['alt', 'Pyro!'], ['select', 'Mode'], ['back', 'Done']]
    : [['confirm', 'Equip'], ['prevnext', 'Category'], ['pgupdn', 'Turn'], ['alt', 'Pose'], ...(st.mode === 'character' ? [['alt2', 'Randomize']] : []), ['back', 'Done']]);
  ui.screenHooks.creator = enter;

  // drag the 3D model to turn it
  const drag = $('#cr-drag');
  let dragX = null;
  drag.addEventListener('pointerdown', (e) => { dragX = e.clientX; drag.setPointerCapture(e.pointerId); });
  drag.addEventListener('pointermove', (e) => { if (dragX == null) return; bs.turn((e.clientX - dragX) * 0.35); dragX = e.clientX; });
  for (const ev of ['pointerup', 'pointercancel']) drag.addEventListener(ev, () => { dragX = null; });
  drag.addEventListener('wheel', (e) => { bs.turn(e.deltaY * 0.02); e.preventDefault(); }, { passive: false });

  Object.assign(ui.actionHooks, {
    creator: open,
    'cr-pose': () => { bs.pose(); app.engine.sfxPose(); },
    'cr-random': randomize,
    'cr-done': () => ui.show('menu'),
  });

  return { open, leave, isOpen: () => bs.active, cosmetics: () => cosmetics(prof()) };
}
