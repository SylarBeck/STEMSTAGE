// Runs screen (game/runs.js): start a run or today's daily run, climb the map node by node, the merch stand, the
// green room, backstage passes, a perk after every good gig, and the run's rewards at the end.
import { profiles } from '../profile/profiles.js';
import { addCash } from '../profile/economy.js';
import { cleanMods } from '../profile/rig.js';
import { WORLDS, worldUnlocked } from '../game/worlds/index.js';
import { playable } from '../storage/insights.js';
import {
  FLOORS, HEARTS, DIFFS, NODES, PERKS, CURSES, PRICES, newRun, dailySeed, choices, nodeAt, songFor, runMods, perkPool,
  rewardOptions, shopItems, mystery, visit, playResult, finalRewards,
} from '../game/runs.js';
import { fa, instIcon } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const INSTS = ['guitar', 'bass', 'drums', 'keys'];
const today = () => new Date().toISOString().slice(0, 10);
const perk = (id) => PERKS.find((p) => p.id === id);
const curse = (id) => CURSES.find((c) => c.id === id);

export function installRuns(ui) {
  const st = { inst: 'guitar', diff: 'medium', pending: null };
  const stats = (p) => (p.runs ||= { played: 0, won: 0, bestFloor: 0, daily: null });
  const save = () => profiles.saveSoon(true);

  // ---------------------------------------------------------------- render
  function render() {
    const p = profiles.current, el = $('#runs');
    if (!p) {
      el.innerHTML = `<div class="card tour-signin"><h3>Sign in to start a run</h3><p class="small-note">A run is saved on your profile, so you can stop and carry on later.</p><div class="btn-row"><button class="nav-btn primary" data-nav data-action="profiles">Sign in / create profile</button></div></div>`;
      bind(el); ui.applyFocus(false); return;
    }
    const run = p.run && !p.run.over ? p.run : null;
    el.innerHTML = `<div class="runs-col" data-nav-group="run-side">${run ? statusCard(p, run) : startCard(p)}</div>
      <div class="run-map panel" data-nav-group="run-map">${mapHtml(run || previewRun(), !run)}</div>`;
    bind(el);
    $$('[data-node]', el).forEach((b) => b.addEventListener('click', () => pickNode(b.dataset.node)));
    ui.applyFocus(false);
  }

  let preview = null;
  function previewRun() { return (preview ||= newRun({ seed: dailySeed() })); }

  function hearts(n) { return Array.from({ length: HEARTS }, (_, i) => fa('heart', i < n ? 'on' : 'off')).join(''); }

  function startCard(p) {
    const s = stats(p), d = s.daily?.date === today() ? s.daily : null;
    const songs = playable(ui.songs, st.inst).length;
    return `<div class="run-card panel">
      <div class="dl-k">ROGUELIKE SETLIST</div>
      <h2>A different night every time</h2>
      <p class="small-note">Climb eight floors of your own songs to the headliner. You have three hearts: a gig under three stars costs one. Good gigs pay run cash and a perk, encores pay double with a curse on them.</p>
      <div class="picker" data-nav data-picker="run-inst"><label>Instrument</label><div class="picker-options">${INSTS.map((i) => `<div class="opt ${st.inst === i ? 'sel' : ''}">${instIcon(i)} ${i}</div>`).join('')}</div></div>
      <div class="picker" data-nav data-picker="run-diff"><label>Difficulty</label><div class="picker-options">${DIFFS.map((d) => `<div class="opt ${st.diff === d ? 'sel' : ''}">${d}</div>`).join('')}</div></div>
      ${songs < 4 ? `<p class="small-note warn">${fa('triangle-exclamation')} You have ${songs} song${songs === 1 ? '' : 's'} with a ${st.inst} chart: runs repeat songs until you import more.</p>` : ''}
      <div class="btn-row">
        <button class="nav-btn primary" data-nav data-action="run-new" ${songs ? '' : 'disabled'}>${fa('dice')} New run</button>
        <button class="nav-btn" data-nav data-action="run-daily" ${songs && !d ? '' : 'disabled'}>${fa('calendar-day')} Daily run</button>
      </div>
      <div class="run-stats">
        <span>${fa('trophy')} <b>${s.won}</b> won</span><span>${fa('flag')} <b>${s.played}</b> played</span><span>${fa('stairs')} best floor <b>${s.bestFloor}</b></span>
        <span>${fa('calendar-day')} today: ${d ? `<b>${d.won ? 'won' : `floor ${d.floor}`}</b>` : 'not played'}</span>
      </div>
      <div class="small-note">Perks unlocked: ${perkPool(s.won).length} of ${PERKS.length} (one more for every run you win)</div>
    </div>`;
  }

  function statusCard(p, run) {
    const floor = run.at ? run.at.f + 1 : 0;
    return `<div class="run-card panel">
      <div class="dl-k">${run.daily ? 'DAILY RUN' : 'RUN'} · ${instIcon(run.inst)} ${run.inst} · ${run.diff}</div>
      <div class="run-status">
        <div class="run-hearts" title="Hearts">${hearts(run.hearts)}</div>
        <div><b>$${run.cash}</b><small>run cash</small></div>
        <div><b>${floor}/${FLOORS}</b><small>floor</small></div>
        <div><b>${Number(run.score).toLocaleString()}</b><small>score</small></div>
      </div>
      <div class="run-perks">${run.perks.length ? run.perks.map((id) => `<span class="run-perk" title="${esc(perk(id)?.desc)}">${fa('bolt')} ${esc(perk(id)?.name)}</span>`).join('') : '<span class="small-note">No perks yet: win a gig to pick one.</span>'}</div>
      <p class="small-note">${choices(run).length ? 'Pick where to go next on the map.' : ''}</p>
      <div class="btn-row"><button class="nav-btn" data-nav data-action="run-abandon">${fa('flag')} Abandon run</button></div>
    </div>`;
  }

  // the map, bottom floor to the headliner: nodes at fixed spots so the paths line up at any size
  function mapHtml(run, preview = false) {
    const open = new Set(preview ? [] : choices(run).map((n) => `${n.f}:${n.i}`));
    const pos = (n) => ({ x: run.floors[n.f].length === 1 ? 50 : 18 + n.i * 32, y: 94 - (n.f / (FLOORS - 1)) * 88 });
    const lines = [];
    for (const row of run.floors) for (const n of row) for (const i of n.next) {
      const m = run.floors[n.f + 1].find((x) => x.i === i), a = pos(n), b = pos(m);
      const done = run.at && ((run.at.f === n.f && run.at.i === n.i && open.has(`${m.f}:${m.i}`)) || visited(run, n) && visited(run, m));
      lines.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${done ? 'lit' : ''}"/>`);
    }
    const nodes = run.floors.flat().map((n) => {
      const key = `${n.f}:${n.i}`, p = pos(n), info = NODES[n.type];
      const here = run.at && run.at.f === n.f && run.at.i === n.i;
      const cls = [`t-${n.type}`, open.has(key) ? 'avail' : '', here ? 'here' : '', visited(run, n) && !here ? 'done' : ''].join(' ');
      return `<button class="rnode ${cls}" ${open.has(key) ? 'data-nav' : 'tabindex="-1"'} data-node="${key}" style="left:${p.x}%;top:${p.y}%" aria-label="${esc(info.name)}, floor ${n.f + 1}">${fa(info.icon)}<span>${esc(info.name)}</span></button>`;
    }).join('');
    return `<svg class="run-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>${nodes}`;
  }

  function visited(run, n) {
    if (!run.at) return false;
    return (run.trail || []).includes(`${n.f}:${n.i}`) || (run.at.f === n.f && run.at.i === n.i);
  }

  function bind(el) { $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); })); }

  // ---------------------------------------------------------------- moves
  function step(run, node) { (run.trail ||= []).push(`${node.f}:${node.i}`); }

  function pickNode(key) {
    const p = profiles.current, run = p?.run;
    if (!run || run.over) { ui.toast('Start a run first: New run or Daily run'); return; }
    const [f, i] = key.split(':').map(Number);
    const node = choices(run).find((n) => n.f === f && n.i === i);
    if (!node) return;
    const info = NODES[node.type];
    if (node.type === 'rest') {
      ui.openSheet({ title: info.name, sub: info.desc, items: [
        { label: `Rest (${run.hearts >= HEARTS ? 'hearts full' : '+1 heart'})`, icon: 'couch', run: () => { visit(run, node); step(run, node); save(); ui.toast(run.hearts >= HEARTS ? 'Rested up' : '+1 heart', 'ok', 'heart'); render(); } },
        { label: 'Back', icon: 'arrow-left', run: () => {} },
      ] });
      return;
    }
    if (node.type === 'shop') { visit(run, node); step(run, node); save(); render(); openShop(run); return; }
    if (node.type === 'mystery') {
      visit(run, node); step(run, node);
      const out = mystery(run, stats(p).won);
      save();
      ui.openSheet({ title: info.name, sub: out.text, items: [{ label: 'Carry on', icon: 'arrow-right', run: () => {} }] });
      render();
      return;
    }
    const n = songFor(run, node, ui.songs);
    if (!n) { ui.toast(`No songs with a ${run.inst} chart`, 'err'); return; }
    save();
    const s = ui.songs.find((x) => x.id === n.song);
    const curses = [...(n.curses || [])].map(curse).filter(Boolean);
    const sub = `${s.title} — ${s.artist} · ${n.diff}${curses.length ? ` · Curse: ${curses.map((c) => `${c.name} (${c.desc.toLowerCase()})`).join(', ')}` : ''}`;
    ui.openSheet({ title: `${info.name} · floor ${node.f + 1}`, sub, items: [
      { label: 'Play', icon: 'play', desc: node.type === 'headliner' ? 'Three stars or more wins the run' : node.type === 'encore' ? 'Pays double' : 'Three stars or more pays and lets you pick a perk', run: () => play(run, n) },
      { label: 'Back', icon: 'arrow-left', run: () => {} },
    ] });
  }

  function openShop(run) {
    const p = profiles.current;
    const items = shopItems(run, stats(p).won).map((pk) => ({
      label: `${pk.name} · $${PRICES.perk}`, icon: 'bolt', desc: pk.desc, disabled: run.cash < PRICES.perk,
      run: () => { run.cash -= PRICES.perk; run.perks.push(pk.id); save(); ui.toast(`${pk.name}!`, 'ok', 'bolt'); render(); openShop(run); },
    }));
    items.push({ label: `A heart · $${PRICES.heart}`, icon: 'heart', desc: run.hearts >= HEARTS ? 'Your hearts are full' : '+1 heart', disabled: run.cash < PRICES.heart || run.hearts >= HEARTS, run: () => { run.cash -= PRICES.heart; run.hearts++; save(); render(); openShop(run); } });
    items.push({ label: 'Leave', icon: 'arrow-right', run: () => {} });
    ui.openSheet({ title: `${NODES.shop.name} · $${run.cash} to spend`, sub: 'Perks last for the rest of this run', items });
  }

  function play(run, node) {
    const p = profiles.current;
    const s = ui.songs.find((x) => x.id === node.song);
    if (!s) return;
    // the headliner plays in a world you've opened, with its boss
    const worlds = Object.keys(WORLDS).filter((id) => worldUnlocked(p, id));
    const world = node.type === 'headliner' && worlds.length ? worlds[run.seed % worlds.length] : null;
    st.playing = { f: node.f, i: node.i, song: node.song };
    ui.runPlay = { mods: cleanMods(runMods(run)), curses: [...(node.curses || [])], venue: world, bosses: world ? 'always' : null };
    ui.selected = s;
    ui.instrument = run.inst;
    ui.difficulty = node.diff;
    ui.mode = 'solo';
    ui.play({ ghost: null });
  }

  // ---------------------------------------------------------------- results
  /** A song finished: if it was this run's node, the run moves on (the reward is picked on the runs screen). */
  function onResult(r) {
    const p = profiles.current, run = p?.run, at = st.playing;
    st.playing = null;
    if (!run || run.over || !at || r.song.id !== at.song || r.practice) return;
    const node = nodeAt(run, at);
    const me = r.players[0];
    const out = playResult(run, node, { stars: me.stars, failed: me.failed, score: me.score });
    step(run, node);
    st.pending = { out, node: { f: node.f, i: node.i, type: node.type } };
    if (run.over) finish(p, run);
    save();
    const msg = out.won ? 'You won the run!' : out.lost ? 'Out of hearts: the run is over' : out.heart ? 'Under three stars: -1 heart' : `+$${out.cash} run cash`;
    ui.toast(msg, out.heart || out.lost ? 'err' : 'ok', out.won ? 'trophy' : out.heart ? 'heart-crack' : 'coins');
  }

  async function finish(p, run) {
    const s = stats(p), reward = finalRewards(run);
    s.played++;
    if (run.over === 'won') s.won++;
    s.bestFloor = Math.max(s.bestFloor, run.at ? run.at.f + 1 : 0);
    if (run.daily) s.daily = { date: today(), won: run.over === 'won', floor: run.at ? run.at.f + 1 : 0, score: run.score };
    addCash(p, reward.cash);
    st.pending = { ...(st.pending || {}), final: { ...reward, won: run.over === 'won', floor: run.at ? run.at.f + 1 : 0, score: run.score } };
    await profiles.addXp(p.id, reward.xp);
  }

  /** "Continue run" on the results screen: back to the map, and the perk to pick or the run's summary. */
  function resume() {
    ui.show('runs');
    const p = profiles.current, run = p?.run, pend = st.pending;
    st.pending = null;
    if (!pend || !run) return;
    if (pend.final) {
      const f = pend.final;
      ui.openSheet({
        title: f.won ? 'Run won!' : 'Run over',
        sub: `Floor ${f.floor} of ${FLOORS} · ${Number(f.score).toLocaleString()} points · +$${f.cash} · +${f.xp} XP${f.won && perkPool(stats(p).won).length > perkPool(stats(p).won - 1).length ? ' · a new perk joins the pool' : ''}`,
        items: [{ label: 'Back to the map', icon: 'map', run: () => { p.run = null; save(); render(); } }],
      });
      return;
    }
    if (pend.out.reward) {
      const items = rewardOptions(run, stats(p).won).map((pk) => ({ label: pk.name, icon: 'bolt', desc: pk.desc, run: () => { run.perks.push(pk.id); save(); render(); } }));
      items.push({ label: 'Take $25 instead', icon: 'coins', run: () => { run.cash += 25; save(); render(); } });
      ui.openSheet({ title: 'Pick a perk', sub: `+$${pend.out.cash} run cash for that gig`, items });
    }
  }

  ui.screenHooks.runs = async () => { if (!ui.songs.length) await ui.reloadSongs(); render(); };
  Object.assign(ui.actionHooks, {
    runs: () => ui.show('runs'),
    'run-new': () => { const p = profiles.current; if (!p) return; p.run = newRun({ inst: st.inst, diff: st.diff }); save(); render(); },
    'run-daily': () => { const p = profiles.current; if (!p) return; p.run = newRun({ seed: dailySeed(), daily: true, inst: st.inst, diff: st.diff }); save(); render(); },
    'run-abandon': () => ui.openSheet({ title: 'Abandon this run?', sub: 'You keep nothing from it', items: [
      { label: 'Abandon', icon: 'flag', danger: true, run: () => { const p = profiles.current; if (p?.run) { stats(p).played++; p.run = null; save(); } render(); } },
      { label: 'Keep going', icon: 'arrow-left', run: () => {} },
    ] }),
    'run-continue': () => resume(),
  });
  ui.pickerHooks.push((which, d) => {
    if (which === 'run-inst') { st.inst = INSTS[(INSTS.indexOf(st.inst) + d + INSTS.length) % INSTS.length]; render(); return true; }
    if (which === 'run-diff') { st.diff = DIFFS[Math.max(0, Math.min(3, DIFFS.indexOf(st.diff) + d))]; render(); return true; }
    return false;
  });

  return { onResult, render, get pending() { return !!st.pending; } };
}
