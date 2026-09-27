// Setlists (named playlists, stored in data/setlists.json) and marathons: a setlist played back to back
// with a combined score, a "next up" break between songs and a summary at the end.
import { loadDoc, saveDoc, coverUrl } from '../storage/library.js';
import { profiles } from '../profile/profiles.js';
import { saveReplay } from '../game/replay.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const INSTS = [['guitar', '🎸'], ['bass', '🎸'], ['drums', '🥁'], ['keys', '🎹'], ['vocals', '🎤']];
const DIFFS = ['easy', 'medium', 'hard', 'expert'];
const BREAK_SECONDS = 10;

export function installSetlists(ui) {
  const st = { lists: [], sel: 0, who: 'solo', loaded: false, countdown: null };
  const songById = (id) => ui.songs.find((s) => s.id === id);
  const current = () => st.lists[st.sel] || null;
  const save = () => saveDoc('setlists', st.lists).catch(() => ui.toast('Could not save setlists', 'err'));

  async function load() {
    if (st.loaded) return;
    st.lists = await loadDoc('setlists', []);
    st.loaded = true;
  }

  function create(name, songs = []) {
    const list = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name.slice(0, 40) || 'Setlist', songs, created: Date.now() };
    st.lists.push(list);
    st.sel = st.lists.length - 1;
    save();
    return list;
  }

  // ---------------------------------------------------------------- setlists screen
  async function render(keepFocus = false) {
    await load();
    if (!ui.songs.length) await ui.reloadSongs();
    st.sel = Math.min(st.sel, Math.max(0, st.lists.length - 1));
    $('#sl-lists').innerHTML = st.lists.length ? st.lists.map((l, i) => {
      const secs = l.songs.reduce((s, id) => s + (songById(id)?.duration || 0), 0);
      return `<button class="sl-item ${i === st.sel ? 'sel' : ''}" data-nav data-sl="${i}"><b>${esc(l.name)}</b><small>${l.songs.length} song${l.songs.length === 1 ? '' : 's'} · ${fmtTime(secs)}</small></button>`;
    }).join('') : '<div class="small-note">No setlists yet. Make one, or roll a random marathon.</div>';
    $$('#sl-lists [data-sl]').forEach((b) => b.addEventListener('click', () => { st.sel = +b.dataset.sl; render(true); }));
    renderDetail();
    if (!keepFocus) ui.applyFocus(false);
  }

  function chartOk(song, inst) { return !!song?.charts?.[inst]?.available; }

  function renderDetail() {
    const d = $('#sl-detail');
    const l = current();
    if (!l) { d.innerHTML = '<div class="sl-empty">Pick or create a setlist</div>'; return; }
    const band = st.who === 'band' && ui.party.length;
    const rows = l.songs.map((id, i) => {
      const s = songById(id);
      if (!s) return `<div class="sl-song missing" data-nav data-sl-song="${i}"><span class="n">${i + 1}</span><div><b>Missing song</b><small>Removed from the library</small></div></div>`;
      const cv = coverUrl(s);
      const ok = band ? ui.party.every((p) => chartOk(s, p.instrument)) : chartOk(s, ui.instrument);
      return `<div class="sl-song ${ok ? '' : 'nochart'}" data-nav data-sl-song="${i}">
        <span class="n">${i + 1}</span><i class="cv" style="background:${cv ? `url('${cv}') center/cover` : ui.art(s)}"></i>
        <div><b>${esc(s.title)}</b><small>${esc(s.artist)} · ${fmtTime(s.duration)}${ok ? '' : ' · skipped (no chart)'}</small></div></div>`;
    }).join('');
    const secs = l.songs.reduce((s, id) => s + (songById(id)?.duration || 0), 0);
    d.innerHTML = `
      <div class="sl-head"><div><h2>${esc(l.name)}</h2><div class="small-note">${l.songs.length} songs · ${fmtTime(secs)}</div></div>
        <div class="btn-row tight"><button class="nav-btn" data-nav data-action="sl-rename">Rename</button><button class="nav-btn danger" data-nav data-action="sl-delete">Delete</button></div></div>
      ${ui.party.length ? `<div class="picker" data-nav data-picker="sl-who"><label>Players</label><div class="picker-options">${[['solo', 'Solo'], ['band', `Band (${ui.party.length})`]].map(([v, t]) => `<div class="opt ${st.who === v ? 'sel' : ''}">${t}</div>`).join('')}</div></div>` : ''}
      ${band ? '' : `<div class="picker" data-nav data-picker="sl-inst"><label>Instrument</label><div class="picker-options">${INSTS.map(([v, ico]) => `<div class="opt ${ui.instrument === v ? 'sel' : ''}">${ico} ${v}</div>`).join('')}</div></div>
      <div class="picker" data-nav data-picker="sl-diff"><label>Difficulty</label><div class="picker-options">${DIFFS.map((v) => `<div class="opt ${ui.difficulty === v ? 'sel' : ''}">${v}</div>`).join('')}</div></div>`}
      <div class="sl-songs">${rows || '<div class="small-note">Empty — add songs from the setlist.</div>'}</div>
      <div class="btn-row"><button class="nav-btn primary" data-nav data-action="sl-play" ${l.songs.length ? '' : 'disabled'}>▶ Play marathon</button><button class="nav-btn" data-nav data-action="sl-add">+ Add songs</button></div>`;
    $$('[data-action]', d).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); }));
    $$('[data-sl-song]', d).forEach((r) => r.addEventListener('click', () => songMenu(+r.dataset.slSong)));
  }

  function songMenu(i) {
    const l = current();
    const s = songById(l.songs[i]);
    const move = (d) => { const j = i + d; if (j < 0 || j >= l.songs.length) return; [l.songs[i], l.songs[j]] = [l.songs[j], l.songs[i]]; save(); render(true); ui.applyFocus(false); };
    ui.openSheet({
      title: s ? s.title : 'Missing song', sub: s ? s.artist : '',
      items: [
        { label: 'Move up', disabled: i === 0, run: () => move(-1) },
        { label: 'Move down', disabled: i === l.songs.length - 1, run: () => move(1) },
        { label: 'Remove from setlist', danger: true, run: () => { l.songs.splice(i, 1); save(); render(true); } },
      ],
    });
  }

  /** Library in "add to setlist" mode: the Play button adds the selected song. */
  function addSong(song, list = current()) {
    if (!list) return;
    if (list.songs.includes(song.id)) { ui.toast(`Already in ${list.name}`); return; }
    list.songs.push(song.id);
    save();
    ui.toast(`Added "${song.title}" to ${list.name} (${list.songs.length})`, 'ok');
  }

  /** Song options → "Add to setlist…" */
  async function addToSheet(song) {
    await load();
    ui.openSheet({
      title: 'Add to setlist', sub: song.title,
      items: [
        ...st.lists.map((l, i) => ({ label: l.name, desc: `${l.songs.length} songs${l.songs.includes(song.id) ? ' · already in it' : ''}`, disabled: l.songs.includes(song.id), run: () => { st.sel = i; addSong(song, l); } })),
        { label: '+ New setlist', desc: 'Starts with this song', run: async () => { const name = await askName('New setlist'); if (name) { create(name, [song.id]); ui.toast(`Created ${name}`, 'ok'); } } },
      ],
    });
  }

  async function askName(title, value = '') {
    const v = await ui.osk.show({ title, value, type: 'text', max: 40 });
    return v == null ? null : v.trim() || null;
  }

  // ---------------------------------------------------------------- marathon
  /** list: { name, songs, backTo?, backLabel?, onDone?(marathon) → html }  opts: { band } */
  function startMarathon(list = current(), opts = {}) {
    const band = opts.band ?? (st.who === 'band' && ui.party.length);
    const songs = list.songs.map(songById).filter(Boolean);
    const playable = songs.filter((s) => (band ? ui.party.every((p) => chartOk(s, p.instrument)) : chartOk(s, ui.instrument)));
    if (!playable.length) { ui.toast(band ? 'No song in this setlist has charts for every player' : `No song in this setlist has a ${ui.instrument} chart`, 'err'); return; }
    if (playable.length < songs.length) ui.toast(`${songs.length - playable.length} song(s) skipped — no chart for the chosen instrument`);
    ui.marathon = { list, songs: playable, planned: songs.length, i: 0, results: [], band: !!band, inst: ui.instrument, diff: ui.difficulty, started: Date.now() };
    playCurrent();
  }

  function playCurrent() {
    const m = ui.marathon;
    if (!m || m.i >= m.songs.length) return;
    const song = m.songs[m.i];
    ui.selected = song;
    ui.mode = m.band ? 'band' : 'solo';
    ui.instrument = m.inst;
    ui.difficulty = m.diff;
    ui.play({ ghost: null });
  }

  /** Called with every song's result while a marathon runs. Returns true when the marathon handled it. */
  function onSongEnd(r) {
    const m = ui.marathon;
    if (!m || r.mode === 'replay' || r.practice || r.mode === 'online') return false;
    ui.social.recordResults(r);
    for (const rp of (r.replays || []).filter(Boolean)) saveReplay(rp).catch(() => {});
    m.results.push({ song: r.song, failed: r.failed, players: r.players.map((p) => ({ name: p.name, color: p.color, profileId: p.profileId, score: p.score, stars: p.stars, accuracy: p.accuracy, fc: !p.failed && p.miss === 0 && p.total > 0 })) });
    m.i++;
    ui.show('marathon');
    renderBreak();
    return true;
  }

  const total = (m) => m.results.reduce((s, x) => s + x.players.reduce((a, p) => a + p.score, 0), 0);

  function resultRows(m) {
    return m.results.map((x, i) => {
      const score = x.players.reduce((a, p) => a + p.score, 0);
      const stars = Math.round(x.players.reduce((a, p) => a + p.stars, 0) / x.players.length);
      return `<div class="mr-row ${x.failed ? 'failed' : ''}"><span class="n">${i + 1}</span><div><b>${esc(x.song.title)}</b><small>${esc(x.song.artist)}</small></div>
        <span class="st">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span><b class="sc">${score.toLocaleString()}</b></div>`;
    }).join('');
  }

  function renderBreak() {
    const m = ui.marathon;
    const el = $('#marathon');
    clearInterval(st.countdown);
    const done = m.i >= m.songs.length;
    if (done) return renderSummary(false);
    const next = m.songs[m.i];
    const cv = coverUrl(next);
    let left = BREAK_SECONDS;
    el.innerHTML = `
      <div class="mt-kicker">MARATHON · ${esc(m.list.name)}</div>
      <div class="mt-total"><small>Total</small>${total(m).toLocaleString()}</div>
      <div class="mt-progress">${m.songs.map((_, i) => `<i class="${i < m.i ? 'done' : i === m.i ? 'next' : ''}"></i>`).join('')}</div>
      <div class="mt-next"><i class="cv" style="background:${cv ? `url('${cv}') center/cover` : ui.art(next)}"></i>
        <div><small>Up next · song ${m.i + 1} of ${m.songs.length}</small><b>${esc(next.title)}</b><span>${esc(next.artist)} · ${fmtTime(next.duration)}</span></div>
        <div class="mt-count" id="mt-count">${left}</div></div>
      <div class="mt-rows">${resultRows(m)}</div>
      <div class="btn-row center"><button class="nav-btn primary" data-nav data-action="mt-next">Play next</button><button class="nav-btn danger" data-nav data-action="mt-end">End marathon</button></div>`;
    $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); }));
    ui.focus = 0;
    ui.applyFocus(false);
    st.countdown = setInterval(() => {
      left--;
      const c = $('#mt-count');
      if (c) c.textContent = left;
      if (left <= 0 && ui.screen === 'marathon' && !ui.sheet) { clearInterval(st.countdown); playCurrent(); }
    }, 1000);
  }

  async function renderSummary(early) {
    const m = ui.marathon;
    clearInterval(st.countdown);
    const el = $('#marathon');
    const played = m.results.length;
    const stars = m.results.reduce((s, x) => s + Math.round(x.players.reduce((a, p) => a + p.stars, 0) / x.players.length), 0);
    const acc = played ? m.results.reduce((s, x) => s + x.players.reduce((a, p) => a + p.accuracy, 0) / x.players.length, 0) / played : 0;
    const secs = Math.round((Date.now() - m.started) / 1000);
    ui.marathon = null;
    el.innerHTML = ''; // the break screen's buttons must not fire while the summary is prepared
    const extra = !early && m.list.onDone ? await m.list.onDone(m) : '';
    el.innerHTML = `
      <div class="mt-kicker">${early ? 'MARATHON ENDED' : 'MARATHON COMPLETE'} · ${esc(m.list.name)}</div>
      <div class="mt-total big"><small>Total score</small>${total(m).toLocaleString()}</div>
      ${extra}
      <div class="mt-stats"><span><b>${played}/${m.songs.length}</b>songs</span><span><b>${stars}</b>stars</span><span><b>${Math.round(acc * 100)}%</b>accuracy</span><span><b>${fmtTime(secs)}</b>time</span></div>
      <div class="mt-rows">${resultRows(m) || '<div class="small-note">No songs finished.</div>'}</div>
      <div class="btn-row center"><button class="nav-btn primary" data-nav data-action="mt-again">Play again</button><button class="nav-btn" data-nav data-action="${m.list.backTo || 'setlists'}">${m.list.backLabel || 'Setlists'}</button></div>`;
    $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); }));
    ui.focus = 0;
    ui.applyFocus(false);
    // a finished marathon of 3+ songs counts for the Marathon Man badge
    if (!early && played >= 3) {
      const ids = new Set(m.results.flatMap((x) => x.players.map((p) => p.profileId)).filter(Boolean));
      for (const id of ids) for (const a of await profiles.award(id, 'setlist_marathon')) ui.toast(`🏆 ${a.name} — ${a.desc}`, 'ok');
    }
    ui.marathonDone = m;
  }

  function endMarathon() {
    if (!ui.marathon) return;
    if (ui.app.game.running) ui.app.game.stop();
    ui.show('marathon');
    renderSummary(true);
  }

  function randomSetlist() {
    const pool = ui.songs.filter((s) => chartOk(s, ui.instrument));
    if (!pool.length) { ui.toast(`No songs with a ${ui.instrument} chart`, 'err'); return; }
    const pick = [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
    startMarathon({ id: 'random', name: 'Random 5', songs: pick.map((s) => s.id) });
  }

  // ---------------------------------------------------------------- wiring
  ui.screenHooks.setlists = () => { if (ui.mode === 'setlist-add') ui.mode = 'solo'; render(); };
  Object.assign(ui.actionHooks, {
    setlists: () => ui.show('setlists'),
    'sl-new': async () => { const name = await askName('New setlist', `Setlist ${st.lists.length + 1}`); if (name) { create(name); render(); } },
    'sl-random': () => randomSetlist(),
    'sl-rename': async () => { const l = current(); const name = l && await askName('Rename setlist', l.name); if (name) { l.name = name.slice(0, 40); save(); render(true); } },
    'sl-delete': async () => { const l = current(); if (l && await ui.confirmDialog('Delete setlist?', `"${l.name}" — the songs stay in your library`, 'Delete')) { st.lists.splice(st.sel, 1); save(); render(); } },
    'sl-add': () => { if (!current()) return; ui.mode = 'setlist-add'; ui.show('library'); ui.toast(`Adding to ${current().name} — press Play on a song to add it`); },
    'sl-play': () => startMarathon(),
    'mt-next': () => { clearInterval(st.countdown); playCurrent(); },
    'mt-end': () => endMarathon(),
    'mt-again': () => { const m = ui.marathonDone; if (m) { ui.instrument = m.inst; ui.difficulty = m.diff; startMarathon(m.list, { band: m.band }); } },
  });
  ui.pickerHooks.push((which, d) => {
    if (which === 'sl-who') { st.who = st.who === 'solo' ? 'band' : 'solo'; render(true); return true; }
    if (which === 'sl-inst') { const i = INSTS.findIndex(([v]) => v === ui.instrument); ui.instrument = INSTS[(i + d + INSTS.length) % INSTS.length][0]; render(true); return true; }
    if (which === 'sl-diff') { ui.difficulty = DIFFS[Math.max(0, Math.min(3, DIFFS.indexOf(ui.difficulty) + d))]; render(true); return true; }
    return false;
  });
  ui.navHooks.push((dir) => {
    if (ui.screen !== 'marathon' || dir !== 'back') return false;
    if (ui.marathon) endMarathon(); else ui.show(ui.marathonDone?.list.backTo || 'setlists');
    return true;
  });

  load();
  return { startMarathon, addSong: (s) => addSong(s), addToSheet, onSongEnd, endMarathon, create, load, lists: () => st.lists };
}
