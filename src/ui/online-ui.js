// Online screen: host (invite code over the internet, or LAN) / join (a code, or a public room), lobby (players,
// instruments, ready, match type), song selection, chat, match start, the room's history and rematches.
import { online, hostInfo, startHosting, stopHosting, inviteCode, songRev } from '../net/online.js';
import { profiles, PROFILE_COLORS } from '../profile/profiles.js';
import { getSong, getAudio, coverUrl } from '../storage/library.js';
import { discord, inviteLink } from '../net/discord.js';
import { settings } from '../settings.js';
import { listRooms, announceRoom, closeRoom, newRoomKey, compatible } from '../net/rooms.js';
import { findMatch, cancelMatch, lobbyStats, nextRating, START_RATING } from '../net/matchmaking.js';
import { cosmetics } from '../profile/rig.js';
import { WORLDS, worldUnlocked } from '../game/worlds/index.js';
import { VENUES, unlocked as venueUnlocked } from '../profile/career.js';
import { BOSS_INFO } from '../profile/economy.js';

const MM_MODES = [['any', 'Any'], ['versus', 'Versus'], ['battle', 'Battle'], ['band', 'Band']];
const STAGE_NAME = { arena: 'Metro Arena', garage: 'The Garage', club: 'Basement Club', bar: 'Neon Dive Bar', theater: 'Grand Theater', stadium: 'Skyline Stadium', festival: 'Main Stage Festival', ...Object.fromEntries(Object.entries(WORLDS).map(([k, w]) => [k, w.name])) };
/** A ping as signal bars (and its colour). */
const pingBars = (ms) => { const n = !ms ? 4 : ms < 60 ? 4 : ms < 120 ? 3 : ms < 220 ? 2 : 1; return `<span class="ping p${n}" title="${ms ? `${Math.round(ms)} ms` : 'host'}">${[1, 2, 3, 4].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span>`; };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { instIcon, fa } from './icons.js';
const ICON = { guitar: instIcon('guitar'), bass: instIcon('bass'), drums: instIcon('drums'), keys: instIcon('keys'), vocals: instIcon('vocals') };
const INSTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const DIFFS = ['easy', 'medium', 'hard', 'expert'];
export const MATCH_MODES = [
  ['versus', 'Versus', 'Highest score wins'],
  ['battle', 'Battle', 'Highest score wins, and your overdrive attacks the leader: mirror, fog, amp overload or drain'],
  ['band', 'Band', 'Play together: one band score, and overdrive saves a bandmate who failed'],
];
const MODE_LABEL = Object.fromEntries(MATCH_MODES.map(([v, l]) => [v, l]));
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

// the async Clipboard API refuses without focus/permission; the old copy command still works then
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
  ta.remove();
  return ok;
}

export function installOnline(ui) {
  const st = {
    inst: localStorage.getItem('stemstage.online.inst') || 'guitar', diff: localStorage.getItem('stemstage.online.diff') || 'medium', hostInfo: null, songProgress: null,
    public: localStorage.getItem('stemstage.online.public') === '1', publicKey: null, listedCode: null, pubSent: '', pubAt: 0, rooms: null, roomsAt: 0,
    mmMode: localStorage.getItem('stemstage.online.mm') || 'any', mm: null, mmRoom: false, countdown: 0,
  };
  const app = ui.app;

  const me = () => online.me;
  const identity = () => {
    const p = profiles.current;
    return { name: p?.name || `Guest ${Math.floor(Math.random() * 900 + 100)}`, color: p?.color || PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)], profileId: p?.id || null, look: p?.look || null, rating: p?.rating || START_RATING, rig: p ? cosmetics(p) : null };
  };

  async function refreshHost() {
    const info = st.hostInfo = await hostInfo();
    const el = $('#ol-host-addr');
    clearTimeout(st.pollTimer);
    let html = '';
    if (info.hosting && info.internet) {
      const t = info.tunnel || {};
      if (t.status === 'ready' && t.url) {
        if (st.code !== inviteCode(t.url)) { st.code = inviteCode(t.url); presence(); }
        html = `<div class="invite-label">Invite code</div><div class="invite-code">${esc(st.code)}</div>
          <div class="btn-row tight"><button class="nav-btn primary" data-nav data-action="ol-copy">Copy invite</button>
            <button class="nav-btn ${st.public ? 'on' : ''}" data-nav data-action="ol-public">${fa(st.public ? 'earth-americas' : 'lock')} ${st.public ? 'Public room' : 'Private room'}</button></div>
          <small>${st.public ? 'Listed in Public rooms: anyone can find and join it.' : 'Friends choose Online → Join and type this code. No port forwarding needed.'}</small>`;
      } else if (t.status === 'error') {
        html = `<div class="invite-err">${esc(t.error || 'Could not open the room to the internet')}</div>
          <div class="btn-row tight"><button class="nav-btn" data-nav data-action="ol-host">Try again</button><button class="nav-btn" data-nav data-action="ol-host-lan">Use local network</button></div>`;
      } else {
        const what = t.status === 'downloading' ? `Getting Cloudflare's tunnel tool (one time)… ${Math.round((t.progress || 0) * 100)}%` : 'Opening your room to the internet…';
        html = `<div class="invite-wait"><i class="spin"></i>${esc(what)}</div>`;
      }
      if (t.status !== 'ready' && t.status !== 'error') st.pollTimer = setTimeout(refreshHost, 700);
    } else if (info.hosting) {
      const addrs = info.addresses.map((a) => `${a.address}:${info.port}`);
      html = addrs.length ? `<div class="invite-label">Local network address</div><div class="invite-code small">${addrs.map(esc).join('<br/>')}</div><small>Friends on the same Wi-Fi type this in Join.</small>` : 'Hosting, but no network address found';
    }
    // still hosting but not in the room (page reloaded, connection dropped): rejoin as host
    if (info.hosting && info.hostKey && !online.connected && !st.connecting && ui.screen === 'online') connect(`127.0.0.1:${info.port}`, info.hostKey);
    publicSync();
    $('[data-action="ol-stop"]').hidden = !info.hosting;
    $('[data-action="ol-host"]').hidden = info.hosting;
    $('[data-action="ol-host-lan"]').hidden = info.hosting;
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
      $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action); }));
      if (ui.screen !== 'online') return;
      // land on the new button (Copy invite / Try again) when focus was in the host panel
      const cur = ui.navItems()[ui.focus];
      const first = $('[data-action]', el);
      if (first && (!cur || cur.closest('#online-connect'))) ui.focusAction(first.dataset.action);
      else ui.applyFocus(false);
    }
  }

  /** Discord status while in a room: friends can press Join on it (internet rooms only: LAN has no invite code). */
  function presence() {
    const room = online.connected && online.room;
    const code = online.host ? st.code : inviteCode(online.baseUrl);
    if (room && code && !app.game.running) discord.room({ code, players: room.players.length, host: online.host, song: room.song });
  }

  /** An invite from outside the game (Discord's Join button, a stemstage://join/ link, ?join=): go to that room. */
  function joinFromInvite(code, via = 'an invite') {
    if (!/^[A-Za-z]+(-[A-Za-z]+){1,9}$/.test(code || '')) return;
    if (app.game.running) { ui.toast(`Finish or quit this song, then open ${via} again`, 'err'); return; }
    if (online.connected) { if (inviteCode(online.baseUrl) === code.toUpperCase()) { ui.show('online'); return; } online.close(); }
    ui.show('online');
    $('#ol-addr').value = code;
    localStorage.setItem('stemstage.online.last', code);
    ui.toast(`Joining your friend’s room from ${via}…`);
    connect(code);
  }
  window.__stemstageJoin = (code) => joinFromInvite(code, 'the invite link'); // called by the desktop app
  // Find match from the website (stemstage://match/<mode>, or ?match= in the browser)
  window.__stemstageMatch = (mode) => {
    if (app.game.running) { ui.toast('Finish or quit this song first, then press Find match on the website again', 'err'); return; }
    if (!MM_MODES.some(([v]) => v === mode)) return;
    if (online.connected) online.close();
    st.mmMode = mode;
    ui.show('online');
    if (!st.mm) matchmake();
  };
  {
    const q = new URLSearchParams(location.search).get('match');
    if (q) { history.replaceState(null, '', '/'); setTimeout(() => window.__stemstageMatch(q), 1500); }
  }
  {
    const q = new URLSearchParams(location.search).get('join');
    if (q) { history.replaceState(null, '', '/'); setTimeout(() => joinFromInvite(q, 'the invite link'), 1200); }
  }
  discord.onEvent((ev) => {
    if (ev.type === 'join' && ev.secret) joinFromInvite(ev.secret, 'Discord');
    else if (ev.type === 'join-request') ui.toast(`${ev.user.globalName || ev.user.username} is joining through Discord`, 'ok');
  });

  function render() {
    const connected = online.connected;
    $('#online-lobby').hidden = !connected;
    $('#online-connect').hidden = false;
    $('#ol-join-panel').hidden = connected;
    $('#ol-hist-panel').hidden = !connected;
    refreshHost();
    if (!connected) { renderBrowse(); renderMatchmaking(); renderStats(); ui.applyFocus(false); return; }
    const room = online.room;
    presence();
    $('#ol-room').textContent = `Room ${room.code}`;
    $('#ol-status').textContent = room.phase === 'playing' && online.me?.spectator ? 'Spectating until the next song' : online.host ? 'You are the host' : `Connected${inviteCode(online.baseUrl) ? ` to ${inviteCode(online.baseUrl)}` : ` to ${online.address}`}${online.rtt ? ` · ${Math.round(online.rtt)} ms` : ''}`;
    const song = room.song;
    if (st.songProgress?.id !== song?.id) st.songProgress = null;
    const local = song && ui.songs.find((s) => s.id === song.id);
    const cv = local && coverUrl(local);
    $('#ol-song').innerHTML = song
      ? `<div class="cv" style="background:${cv ? `url('${cv}') center/cover` : ui.art(local || song)}"></div><div><b>${esc(song.title)}</b><div class="small-note">${esc(song.artist)}${song.duration ? ` · ${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : ''}</div></div>`
      : `<div class="small-note">${online.host ? 'Choose a song for the match.' : 'Waiting for the host to choose a song...'}</div>`;
    const meInRoom = online.me;
    const progress = Math.max(meInRoom?.loading || 0, st.songProgress?.value || 0);
    const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
    const waiting = song && online.host ? room.players.filter((p) => !p.host && !p.hasSong).length : 0;
    const download = $('#ol-download');
    download.hidden = !song || (meInRoom?.hasSong && !waiting);
    download.innerHTML = !song ? '' : !meInRoom?.hasSong && !online.host
      ? `<div>Getting “${esc(song.title)}” from the host · ${percent}%</div><small>Keep this room open. You can ready up when the song arrives.</small><div class="ol-progress" role="progressbar" aria-label="Song download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="--progress:${percent}%"></i></div>`
      : waiting ? `<div>Waiting for ${waiting} player${waiting === 1 ? '' : 's'} to get the song</div><small>The match can start after everyone has the song and is ready.</small>` : '';
    const myProfile = profiles.current?.id;
    $('#ol-players').innerHTML = room.players.map((p) => {
      const status = p.spectator ? '<span class="rd">SPECTATING</span>' : !p.connected ? '<span class="rd">DISCONNECTED</span>' : room.phase === 'playing' ? `<span class="rd ok">${Math.round(p.score || 0).toLocaleString()}</span>` : !song ? '' : p.hasSong ? (p.ready ? '<span class="rd ok">READY</span>' : '<span class="rd">NOT READY</span>') : `<span class="rd">DOWNLOADING ${Math.round((p.loading || 0) * 100)}%</span>`;
      const rec = myProfile && p.id !== online.id ? profiles.versusAgainst(myProfile, p.name) : null;
      const vs = rec ? ` <small class="vs" title="Your versus record against ${esc(p.name)}">you ${rec.w}–${rec.l}${rec.d ? `–${rec.d}` : ''}</small>` : '';
      const kick = online.host && p.id !== online.id ? `<button class="ol-kick" data-nav data-kick="${esc(p.id)}" title="Remove ${esc(p.name)} from the room">${fa('user-xmark')}</button>` : '';
      return `<div class="ol-player" style="--pc:${p.color}"><i></i><span>${esc(p.name)}${p.host ? ` ${fa('crown', 'host')}` : ''}${p.id === online.id ? ' (you)' : ''}${vs} <small class="ol-rating" title="Skill rating">${Math.round(p.rating || START_RATING)}</small></span><span>${ICON[p.instrument] || ''} ${p.instrument}</span><span>${p.difficulty}</span>${status || '<span></span>'}${pingBars(p.host ? 0 : p.ping)}${kick}</div>`;
    }).join('');
    const mode = room.mode || 'versus';
    $('#ol-pick-mode').innerHTML = MATCH_MODES.map(([v, l]) => `<div class="opt ${v === mode ? 'sel' : ''} ${online.host || v === mode ? '' : 'disabled'}" data-m="${v}">${l}</div>`).join('');
    $('#ol-mode-note').textContent = `— ${MATCH_MODES.find(([v]) => v === mode)[2]}${online.host ? '' : ' (the host picks)'}`;
    $$('#ol-pick-mode [data-m]').forEach((o) => o.addEventListener('click', () => pickMode(o.dataset.m)));
    const avail = song?.instruments?.length ? song.instruments : INSTS;
    if (!avail.includes(st.inst)) st.inst = avail[0];
    $('#ol-pick-inst').innerHTML = INSTS.map((i) => `<div class="opt ${i === st.inst ? 'sel' : ''} ${avail.includes(i) ? '' : 'disabled'}" data-i="${i}">${ICON[i]} ${i}</div>`).join('');
    $('#ol-pick-diff').innerHTML = DIFFS.map((d) => `<div class="opt ${d === st.diff ? 'sel' : ''}" data-d="${d}">${d}</div>`).join('');
    $$('#ol-pick-inst [data-i]').forEach((o) => o.addEventListener('click', () => setMine({ instrument: o.dataset.i })));
    $$('#ol-pick-diff [data-d]').forEach((o) => o.addEventListener('click', () => setMine({ difficulty: o.dataset.d })));
    const m = me();
    $$('[data-kick]').forEach((b) => b.addEventListener('click', () => kickPlayer(b.dataset.kick)));
    renderHostControls(room);
    $('#ol-spectate').textContent = m?.spectator ? 'Play' : 'Watch';
    $('#ol-spectate').style.display = room.phase === 'playing' ? 'none' : '';
    $('#ol-ready').textContent = m?.ready ? 'Not ready' : 'Ready';
    $('#ol-ready').style.display = room.phase === 'playing' ? 'none' : '';
    $('#ol-choose').style.display = online.host ? '' : 'none';
    $('#ol-start').style.display = online.host ? '' : 'none';
    $('#ol-start').disabled = room.phase !== 'lobby' || !song || !room.players.every((p) => p.ready && p.hasSong);
    $('#ol-start').textContent = !song ? 'Choose a song' : room.players.every((p) => p.ready && p.hasSong) ? 'Start match' : `Waiting for ready (${room.players.filter((p) => p.ready && p.hasSong).length}/${room.players.length})`;
    rematchButtons();
    renderHistory(room);
    publicSync();
    ui.applyFocus(false);
  }

  function pickMode(m) {
    if (!online.host) { ui.toast('The host picks the match type', 'err'); return; }
    if (MODE_LABEL[m] && online.room?.mode !== m) online.setMode(m);
  }

  // ---------------------------------------------------------------- host controls (stage, gear, bosses, size, lock, auto-start)
  function hostStages() {
    const p = profiles.current;
    return ['arena', ...VENUES.filter((v) => v.id !== 'arena' && venueUnlocked(p, v)).map((v) => v.id), ...Object.keys(WORLDS).filter((id) => worldUnlocked(p, id))];
  }
  function renderHostControls(room) {
    const el = $('#ol-host-ctl');
    const o = room.opts;
    const boss = WORLDS[o.stage]?.boss;
    if (!online.host) {
      el.innerHTML = `<div class="ol-opts">${fa('location-dot')} <b>${esc(STAGE_NAME[o.stage] || o.stage)}</b>${boss ? ` · ${fa('dragon')} ${esc(BOSS_INFO[boss].name)} (${o.bosses})` : ''} · gear ${o.gear ? 'on' : 'off'} · ${room.players.length}/${o.max}${o.locked ? ` · ${fa('lock')} locked` : ''}${o.autoStart ? ' · auto-start' : ''}</div>`;
      return;
    }
    const tog = (k, on, label, icon) => `<button class="ol-tog ${on ? 'on' : ''}" data-nav data-opt="${k}">${fa(icon)} ${label}</button>`;
    el.innerHTML = `<div class="picker row" data-nav data-picker="ol-stage"><label>Stage${boss ? ` <small class="boss-tag" style="--bc:${BOSS_INFO[boss].color}">${fa('dragon')} ${esc(BOSS_INFO[boss].name)}</small>` : ''}</label><div class="picker-options"><div class="opt sel">${esc(STAGE_NAME[o.stage] || o.stage)}</div></div></div>
      <div class="picker row" data-nav data-picker="ol-bosses"><label>Bosses</label><div class="picker-options">${['random', 'always', 'off'].map((v) => `<div class="opt ${o.bosses === v ? 'sel' : ''}">${v}</div>`).join('')}</div></div>
      <div class="picker row" data-nav data-picker="ol-max"><label>Room size</label><div class="picker-options"><div class="opt sel">${o.max} players</div></div></div>
      <div class="ol-togs">${tog('gear', o.gear, 'Gear counts', 'sliders')}${tog('locked', o.locked, 'Lock room', 'lock')}${tog('autoStart', o.autoStart, 'Auto-start', 'forward-fast')}</div>`;
    $$('[data-opt]', el).forEach((b) => b.addEventListener('click', () => online.setOpts({ [b.dataset.opt]: !o[b.dataset.opt] })));
  }
  async function kickPlayer(id) {
    const p = online.room?.players.find((x) => x.id === id);
    if (!p || !(await ui.confirmDialog(`Remove ${p.name}?`, 'They leave the room and can\u2019t come back to it.', 'Remove'))) return;
    online.kick(id);
  }

  // ---------------------------------------------------------------- matchmaking
  function renderMatchmaking() {
    const pick = $('#ol-mm-mode');
    if (pick) pick.innerHTML = MM_MODES.map(([v, l]) => `<div class="opt ${st.mmMode === v ? 'sel' : ''}" data-mm="${v}">${l}</div>`).join('');
    $$('[data-mm]').forEach((o) => o.addEventListener('click', () => { st.mmMode = o.dataset.mm; localStorage.setItem('stemstage.online.mm', st.mmMode); renderMatchmaking(); }));
    $('#ol-find').innerHTML = st.mm ? `${fa('xmark')} Cancel search` : `${fa('magnifying-glass')} Find match`;
  }
  async function renderStats() {
    const s = await lobbyStats();
    const el = $('#ol-stats');
    if (!el) return;
    el.innerHTML = s ? `<span>${fa('door-open')} <b>${s.rooms}</b> open room${s.rooms === 1 ? '' : 's'}</span><span>${fa('users')} <b>${s.players}</b> playing</span><span>${fa('magnifying-glass')} <b>${s.searching}</b> searching</span>` : '';
  }
  async function matchmake() {
    if (st.mm) { st.mm.abort.abort(); return; }
    const p = profiles.current;
    const abort = new AbortController();
    st.mm = { abort, ticket: null };
    renderMatchmaking();
    const status = $('#ol-mm-status');
    status.hidden = false;
    status.innerHTML = `<i class="spin"></i> Looking for a ${st.mmMode === 'any' ? '' : `${st.mmMode} `}room near your skill (${p?.rating || START_RATING})…`;
    try {
      const res = await findMatch({ mode: st.mmMode, rating: p?.rating || START_RATING, signal: abort.signal,
        onStatus: (s) => { st.mm.ticket = s.ticket; status.innerHTML = `<i class="spin"></i> Searching · ${s.waited} s · ${s.searching} player${s.searching === 1 ? '' : 's'} looking${s.rooms ? ` · ${s.rooms} open room${s.rooms === 1 ? '' : 's'}` : ''}`; } });
      if (res.code) { status.innerHTML = `${fa('check')} Found a room · joining…`; app.engine.sfxUi('confirm'); joinCode(res.code); }
      else {
        // nobody around: open a public matchmaking room the next searchers are sent to
        status.innerHTML = `${fa('tower-broadcast')} No room yet: opening one for the next players who search…`;
        st.mmRoom = st.mmMode === 'any' ? 'versus' : st.mmMode;
        st.public = true;
        await host(true);
        if (online.host && st.mmRoom) online.setMode(st.mmRoom);
      }
    } catch (e) {
      if (e.message !== 'cancelled') ui.toast(`Matchmaking: ${e.message}`, 'err');
      status.hidden = true;
    } finally {
      cancelMatch(st.mm?.ticket);
      st.mm = null;
      renderMatchmaking();
      setTimeout(() => { if (!st.mm) status.hidden = true; }, 4000);
    }
  }

  /** Rematch: the lobby button and the one on the results screen show who's in. */
  function rematchButtons() {
    const room = online.connected ? online.room : null;
    const can = !!(room && room.phase === 'lobby' && room.song && room.history?.length);
    const want = room?.rematch || [];
    const total = room ? room.players.filter((p) => p.hasSong).length : 0;
    const mine = want.includes(online.id);
    const label = mine ? `Rematch: waiting (${want.length}/${total})` : want.length ? `Rematch (${want.length}/${total} in)` : 'Rematch';
    for (const b of [$('#ol-rematch'), $('#res-rematch')]) {
      if (!b) continue;
      b.hidden = !can || (b.id === 'res-rematch' && ui.lastResultRaw?.mode !== 'online');
      b.textContent = label;
      b.classList.toggle('on', mine);
    }
  }

  /** This room's matches: wins per player (versus, battle), band songs, and the last results. */
  function renderHistory(room) {
    const h = room.history || [];
    const wins = new Map();
    let draws = 0, bands = 0, bestBand = 0;
    for (const m of h) {
      if (m.mode === 'band') { bands++; bestBand = Math.max(bestBand, m.bandScore || 0); continue; }
      if (m.draw) { draws++; continue; }
      const w = m.results.find((r) => r.id === m.winnerId);
      if (w) wins.set(w.name, { n: (wins.get(w.name)?.n || 0) + 1, color: w.color });
    }
    const chips = [...wins].sort((a, b) => b[1].n - a[1].n).map(([name, w]) => `<span class="ol-chip" style="--pc:${esc(w.color)}"><i></i>${esc(name)} <b>${w.n}</b></span>`);
    if (draws) chips.push(`<span class="ol-chip">${draws} draw${draws === 1 ? '' : 's'}</span>`);
    if (bands) chips.push(`<span class="ol-chip">${fa('users')} ${bands} band song${bands === 1 ? '' : 's'} · best <b>${bestBand.toLocaleString()}</b></span>`);
    $('#ol-standings').innerHTML = chips.length ? chips.join('') : '<div class="small-note">No matches yet: results show up here, with wins per player.</div>';
    $('#ol-history').innerHTML = h.slice(0, 8).map((m) => {
      const rows = [...m.results].sort((a, b) => (m.mode === 'band' ? 0 : b.score - a.score));
      return `<div class="oh-match"><div class="oh-head"><span class="badge">${esc(MODE_LABEL[m.mode] || m.mode)}</span><b>${esc(m.song?.title || 'Song')}</b><small>${ago(m.date)}</small></div>
        <div class="oh-res">${m.mode === 'band' ? `<span class="oh-band">Band <b>${(m.bandScore || 0).toLocaleString()}</b></span>` : m.draw ? '<span class="oh-band">Draw</span>' : ''}${rows.map((r) => `<span class="${r.id === m.winnerId ? 'win' : ''}" style="--pc:${esc(r.color)}">${r.id === m.winnerId ? fa('crown') : '<i></i>'}${esc(r.name)} ${(r.score || 0).toLocaleString()}</span>`).join('')}</div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- public rooms
  /** Keep this room's public listing up to date (or take it down): on every room change, and every 30 s. */
  function publicSync(force = false) {
    const info = st.hostInfo;
    const room = online.connected && online.host ? online.room : null;
    const listed = st.public && room && info?.hosting && info.internet && st.code && !room.opts?.locked;
    if (!listed) {
      if (st.listedCode) { closeRoom(st.listedCode, st.publicKey); st.listedCode = null; st.pubSent = ''; }
      clearInterval(st.pubTimer); st.pubTimer = null;
      return;
    }
    st.publicKey ||= newRoomKey();
    const body = {
      code: st.code, key: st.publicKey, name: `${online.me?.name || 'STEMSTAGE'}'s room`, host: online.me?.name || '', mode: room.mode || 'versus',
      song: room.song?.title || '', artist: room.song?.artist || '', players: room.players.length, max: room.max || 8, playing: room.phase === 'playing',
      rating: Math.round(room.players.reduce((s, p) => s + (p.rating || START_RATING), 0) / Math.max(1, room.players.length)),
      stage: room.opts?.stage || 'arena', gear: !!room.opts?.gear, mm: !!st.mmRoom,
    };
    const sig = JSON.stringify(body);
    if (!force && sig === st.pubSent && Date.now() - st.pubAt < 25000) return;
    st.pubSent = sig; st.pubAt = Date.now();
    announceRoom(body).then(() => { st.listedCode = st.code; }).catch((e) => { st.pubSent = ''; console.warn('public room:', e.message); });
    if (!st.pubTimer) st.pubTimer = setInterval(() => publicSync(true), 30000);
  }
  window.addEventListener('pagehide', () => { if (st.listedCode) closeRoom(st.listedCode, st.publicKey); });

  /** Join → Public rooms: the open rooms, refreshed every 15 s while the Join panel is on screen. */
  async function renderBrowse(force = false) {
    const el = $('#ol-browse');
    clearTimeout(st.browseTimer);
    if (!el || online.connected || ui.screen !== 'online') return;
    if (force || Date.now() - st.roomsAt > 12000) {
      st.roomsAt = Date.now();
      try { st.rooms = await listRooms(); st.roomsErr = null; } catch (e) { st.roomsErr = e.message; }
    }
    if (online.connected) return;
    const rows = st.rooms || [];
    const html = st.roomsErr ? '<div class="small-note">Public rooms can\u2019t be reached right now.</div>'
      : rows.length ? rows.map((r) => {
        const ok = compatible(r.version) && r.players < r.max;
        return `<button class="ol-room" data-nav data-code="${esc(r.code)}" ${ok ? '' : 'disabled'}><b>${esc(r.name)}</b><span class="badge">${esc(MODE_LABEL[r.mode] || r.mode)}</span>
          <small>${r.players}/${r.max} players · ${r.playing ? 'playing' : 'in the lobby'}${r.song ? ` · ${esc(r.song)}` : ''}${compatible(r.version) ? '' : ` · needs STEMSTAGE ${esc(r.version)}`}</small></button>`;
      }).join('')
        : '<div class="small-note">No public rooms right now. Host one and make it public, or join with an invite code.</div>';
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
      $$('[data-code]', el).forEach((b) => b.addEventListener('click', () => joinCode(b.dataset.code)));
      ui.applyFocus(false);
    }
    st.browseTimer = setTimeout(() => renderBrowse(), 15000);
  }

  function joinCode(code) {
    if (st.connecting) return;
    $('#ol-addr').value = code;
    localStorage.setItem('stemstage.online.last', code);
    connect(code);
  }

  /** The results screen of an online match: who won, the head-to-head record, and the rematch button. */
  function decorateResults(r) {
    const el = $('#res-verdict');
    if (r.mode !== 'online') { el.hidden = true; rematchButtons(); return null; }
    const mode = r.matchMode || 'versus';
    const mine = r.players[0];
    const everyone = [...r.players.map((p) => ({ ...p, id: online.id })), ...(r.remotePlayers || [])];
    let html;
    if (mode === 'band') {
      const total = Math.max(1, everyone.reduce((s, p) => s + (p.score || 0), 0));
      const shares = everyone.map((p) => `${esc(p.name)} ${Math.round(((p.score || 0) / total) * 100)}%`).join(' · ');
      html = `<b>${fa('users')} Band of ${everyone.length}</b><span>${shares}${everyone.some((p) => p.failed) ? ' · someone fell and wasn\u2019t saved' : ''}</span>`;
    } else if (everyone.length < 2) {
      html = '<b>No opponent</b><span>The other players\u2019 results didn\u2019t arrive</span>';
    } else {
      const outcome = r.onlineDraw ? 'draw' : r.onlineWinnerId === online.id ? 'win' : 'loss';
      const winner = everyone.find((p) => p.id === r.onlineWinnerId);
      const opponents = everyone.filter((p) => p.id !== online.id).map((p) => p.name);
      const firstTime = mine?.profileId && profiles.byId(mine.profileId)?.versus?.last !== r.matchId;
      const rec = mine?.profileId ? profiles.recordVersus(mine.profileId, { matchId: r.matchId, outcome, opponents }) : null;
      let ratingLine = '';
      const prof = mine?.profileId && profiles.byId(mine.profileId);
      if (prof && firstTime) {
        const opp = (st.lastLineup || []).filter((x) => x.id !== online.id);
        const avg = opp.length ? opp.reduce((s, x) => s + x.rating, 0) / opp.length : START_RATING;
        const before = prof.rating || START_RATING;
        prof.rating = nextRating(before, avg, outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0);
        profiles.saveSoon();
        st.ratingLine = ` · rating ${prof.rating} (${prof.rating >= before ? '+' : ''}${prof.rating - before})`;
      }
      ratingLine = st.ratingLine || '';
      const vsOne = opponents.length === 1 && mine?.profileId ? profiles.versusAgainst(mine.profileId, opponents[0]) : null;
      const line = vsOne ? `You're ${vsOne.w}–${vsOne.l}${vsOne.d ? `–${vsOne.d}` : ''} against ${esc(opponents[0])}` : rec ? `Your record: ${rec.w}–${rec.l}${rec.d ? `–${rec.d}` : ''}` : 'Sign in to keep a win/loss record';
      html = `<b class="${outcome}">${outcome === 'win' ? 'YOU WIN' : outcome === 'draw' ? 'DRAW' : `${esc(winner?.name || 'They').toUpperCase()} WINS`}</b><span>${line}${rec && rec.streak > 1 && outcome === 'win' ? ` · ${rec.streak} wins in a row` : ''}${ratingLine}</span>`;
      el.className = `res-verdict ${outcome}`;
    }
    if (mode === 'band') el.className = 'res-verdict band';
    el.innerHTML = html;
    el.hidden = false;
    rematchButtons();
    return mode;
  }

  function setMine(fields) {
    if (fields.instrument) { st.inst = fields.instrument; localStorage.setItem('stemstage.online.inst', st.inst); }
    if (fields.difficulty) { st.diff = fields.difficulty; localStorage.setItem('stemstage.online.diff', st.diff); }
    online.set({ instrument: st.inst, difficulty: st.diff, ...(fields.ready !== undefined ? { ready: fields.ready } : {}) });
  }

  function log(html) {
    const el = $('#ol-log');
    el.insertAdjacentHTML('beforeend', `<div>${html}</div>`);
    el.scrollTop = el.scrollHeight;
  }

  async function connect(address, hostKey = null) {
    const status = $('#ol-join-status');
    st.connecting = true;
    try {
      if (!hostKey && status) status.textContent = 'Looking for the room…';
      await online.connect(address, { ...identity(), hostKey });
      setMine({});
      log(`<i>Connected to room ${esc(online.room.code)}</i>`);
      ui.toast(hostKey ? 'Room open — share the invite code with your friends' : 'Joined the room', 'ok');
      if (status) status.textContent = '';
      render();
    } catch (e) {
      if (status) status.textContent = '';
      ui.toast(e.message, 'err');
    } finally { st.connecting = false; }
  }

  // match start (everyone in the lineup gets this at the same moment)
  async function onStart(msg) {
    st.ratingLine = '';
    const mine = msg.lineup.find((p) => p.id === online.id);
    if (!mine) { if (online.me?.spectator) render(); else ui.toast('Match started without you (song still downloading?)', 'err'); return; }
    const [song, audio] = await Promise.all([getSong(msg.song.id), getAudio(msg.song.id)]);
    if (!song || !audio) { ui.toast('The song is missing locally', 'err'); return; }
    if (!song.charts[mine.instrument]?.available) { ui.toast(`No ${mine.instrument} chart in this song`, 'err'); return; }
    app.menuMusic(false);
    ui.stopPreview?.();
    ui.show('hud');
    ui.lastPlay = { online: true };
    app.stage.setVenue(msg.opts?.stage || 'arena'); // everyone plays on the host's stage (and meets its boss)
    ui.applyLooks(msg.lineup.map((r) => ({ instrument: r.instrument, look: r.look, rig: r.rig, profileId: r.id === online.id ? profiles.current?.id : null })));
    const mic = mine.instrument === 'vocals' && settings.vocalMode === 'mic';
    const cfg = { name: mine.name, color: mine.color, device: 'any', instrument: mine.instrument, difficulty: mine.difficulty, strum: mine.instrument !== 'drums' && ui.strumFor('any'), profileId: profiles.current?.id || null, mic, part: mic ? settings.vocalPart || 0 : 0, gear: ui.gearFor(profiles.current?.id, mine.instrument, !!msg.opts?.gear) };
    st.lastLineup = msg.lineup.map((r) => ({ id: r.id, rating: online.room?.players.find((p) => p.id === r.id)?.rating || START_RATING }));
    await app.game.start(song, audio, [cfg], { online: { client: online, lineup: msg.lineup, startAt: msg.startAt, matchId: msg.matchId, mode: msg.mode || 'versus', seed: msg.seed, bosses: msg.opts?.bosses || 'random' } });
  }

  online.on('room', () => {
    if (ui.screen === 'online') render();
    else { rematchButtons(); publicSync(); }
  });
  online.on('results', (list, msg) => {
    // a late finisher's result arrived after we already showed the results screen
    const r = ui.lastResultRaw;
    if (!msg?.update || ui.screen !== 'results' || r?.mode !== 'online') return;
    r.remotePlayers = list.filter((x) => x.id !== online.id).map((x) => ({ ...x, remote: true }));
    ui.showResults(r, { rerender: true });
  });
  online.on('start', onStart);
  online.on('live', () => {
    if (!online.me?.spectator || ui.screen !== 'online') return;
    const now = performance.now();
    if (now - (st.lastSpectatorRender || 0) > 250) { st.lastSpectatorRender = now; render(); }
  });
  online.on('chat', (m) => log(`<b style="--pc:${esc(m.color)}">${esc(m.from)}:</b> ${esc(m.text)}`));
  online.on('react', (m) => {
    log(`<b style="--pc:${esc(m.color)}">${esc(m.from)}</b> ${m.emoji}`);
    if (app.game.running) ui.toast(`${m.from} ${m.emoji}`);
  });
  online.on('song-progress', (value) => { st.songProgress = { id: online.room?.song?.id, value }; if (ui.screen === 'online') render(); });
  online.on('song-ready', () => { st.songProgress = null; ui.reloadSongs().then(() => { if (ui.screen === 'online') render(); }); });
  online.on('error', (msg) => ui.toast(msg, 'err'));
  online.on('closed', (reason) => { st.closed = true; ui.toast(reason || 'Room closed', 'err'); });
  online.on('disconnected', () => {
    st.songProgress = null;
    discord.menus();
    if (!st.closed) ui.toast('Disconnected from the room · reconnecting…', 'err');
    st.closed = false;
    if (ui.screen === 'online') render();
  });
  online.on('reconnected', () => {
    if (online.me?.spectator && app.game.running && app.game.online) { app.game.stop(); ui.show('online'); }
    ui.toast(online.me?.spectator ? 'Reconnected · spectating this song' : 'Reconnected to the room', 'ok');
    if (ui.screen === 'online') render();
  });
  online.on('reconnect-failed', (reason) => ui.toast(`Could not reconnect: ${reason}`, 'err'));
  online.on('reconnecting', (n) => { const s = $('#ol-status'); if (s) s.textContent = `Reconnecting (try ${n} of 5)…`; });
  online.on('countdown', (at) => {
    st.countdown = at;
    const el = $('#ol-countdown');
    clearInterval(st.cdTimer);
    if (!at) { el.hidden = true; return; }
    el.hidden = false;
    const tick = () => { const s = Math.ceil((at - performance.now()) / 1000); el.innerHTML = s > 0 ? `${fa('forward-fast')} Everyone's ready · starting in <b>${s}</b>` : `${fa('play')} Here we go!`; if (s <= 0) clearInterval(st.cdTimer); };
    tick(); st.cdTimer = setInterval(tick, 200);
    app.engine.sfxTick(0, true);
  });
  $$('[data-reaction]').forEach((button) => button.addEventListener('click', () => online.react(button.dataset.reaction)));

  $('#ol-chat-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim();
    if (v) online.chat(v);
    e.target.value = '';
  });
  $('#ol-addr').value = localStorage.getItem('stemstage.online.last') || '';
  $('#ol-addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.action('ol-join'); });

  ui.screenHooks.online = render;
  Object.assign(ui.actionHooks, {
    online: () => ui.show('online'),
    'ol-host': () => host(true),
    'ol-host-lan': () => host(false),
    'ol-stop': async () => {
      clearTimeout(st.pollTimer);
      online.close();
      await stopHosting();
      st.code = null;
      publicSync();
      discord.menus();
      ui.toast('Stopped hosting');
      render();
      await refreshHost();
      ui.focusAction('ol-host');
    },
    'ol-copy': async () => {
      const text = st.code || '';
      ui.toast((await copyText(text)) ? `Invite code ${text} copied` : `Invite code: ${text}`, 'ok');
    },
    'ol-join': () => {
      const addr = $('#ol-addr').value.trim();
      if (!addr) { ui.editText($('#ol-addr')); return; }
      localStorage.setItem('stemstage.online.last', addr);
      connect(addr);
    },
    'ol-invite': () => invitePopup(),
    'ol-leave': () => { if (online.host) { ui.actionHooks['ol-stop'](); return; } online.close(); discord.menus(); render(); },
    'ol-ready': () => setMine({ ready: !me()?.ready }),
    'ol-spectate': () => online.spectate(!me()?.spectator),
    'ol-choose': () => { ui.mode = 'online-pick'; ui.show('library'); },
    'ol-start': () => online.start(),
    'ol-rematch': () => {
      if (!online.connected) { ui.toast('You\u2019re not in the room any more', 'err'); return; }
      const mine = online.room?.rematch?.includes(online.id);
      online.rematch(!mine);
      ui.toast(mine ? 'Rematch cancelled' : 'Rematch: it starts as soon as everyone wants it', 'ok');
    },
    'ol-public': () => {
      st.public = !st.public;
      localStorage.setItem('stemstage.online.public', st.public ? '1' : '0');
      delete $('#ol-host-addr').dataset.html; // redraw the host panel
      refreshHost();
      ui.toast(st.public ? 'Your room is listed in Public rooms' : 'Your room is private again (invite code only)', 'ok');
    },
    'ol-quick': () => matchmake(),
    'ol-refresh': () => { delete $('#ol-browse').dataset.html; renderBrowse(true); },
    'ol-chat': () => {
      const el = $('#ol-chat-input');
      const v = el.value.trim();
      if (v) online.chat(v);
      el.value = '';
    },
  });
  ui.pickerHooks.push((which, d) => {
    if (which === 'ol-inst') { const avail = online.room?.song?.instruments?.length ? online.room.song.instruments : INSTS; setMine({ instrument: avail[(avail.indexOf(st.inst) + d + avail.length) % avail.length] }); return true; }
    if (which === 'ol-diff') { setMine({ difficulty: DIFFS[Math.max(0, Math.min(3, DIFFS.indexOf(st.diff) + d))] }); return true; }
    if (which === 'ol-mode') { const i = MATCH_MODES.findIndex(([v]) => v === (online.room?.mode || 'versus')); pickMode(MATCH_MODES[(i + d + MATCH_MODES.length) % MATCH_MODES.length][0]); return true; }
    if (which === 'ol-mm-mode') { const i = MM_MODES.findIndex(([v]) => v === st.mmMode); st.mmMode = MM_MODES[(i + d + MM_MODES.length) % MM_MODES.length][0]; localStorage.setItem('stemstage.online.mm', st.mmMode); renderMatchmaking(); return true; }
    if (!online.host || !online.room) return false;
    const o = online.room.opts;
    if (which === 'ol-stage') { const list = hostStages(); online.setOpts({ stage: list[(Math.max(0, list.indexOf(o.stage)) + d + list.length) % list.length] }); return true; }
    if (which === 'ol-bosses') { const l = ['random', 'always', 'off']; online.setOpts({ bosses: l[(l.indexOf(o.bosses) + d + 3) % 3] }); return true; }
    if (which === 'ol-max') { online.setOpts({ max: Math.max(2, Math.min(8, o.max + d)) }); return true; }
    return false;
  });

  async function host(internet) {
    try {
      const info = await startHosting(identity().name, internet);
      st.hostInfo = info;
      // 'Try again' keeps the same room; only (re)join when not already its host
      if (!(online.connected && online.host && online.address === `127.0.0.1:${info.port}`)) await connect(`127.0.0.1:${info.port}`, info.hostKey);
      refreshHost();
    } catch (e) { ui.toast(e.message, 'err'); }
  }
  online.on('connecting', (n) => { const s = $('#ol-join-status'); if (s && n > 1) s.textContent = 'Looking for the room… (a new room can take a few seconds)'; });

  /** Invite friends: the web link (works for anyone, even without the game), the code, and Discord's own invite. */
  async function invitePopup() {
    const code = online.host ? st.code : inviteCode(online.baseUrl);
    if (!code) {
      ui.toast(online.connected ? 'This is a local-network room: friends on your Wi-Fi join with the address shown under Host' : 'Host or join a room first', 'err');
      return;
    }
    const link = inviteLink(code);
    await ui.openSheet({
      title: 'Invite friends', sub: link,
      items: [
        { label: 'Copy invite link', icon: 'link', desc: 'Paste it in a Discord chat (or anywhere): it shows as a card anyone can click, and installs STEMSTAGE for friends who don\u2019t have it', run: async () => ui.toast((await copyText(link)) ? 'Invite link copied, paste it in Discord' : link, 'ok') },
        { label: 'Copy invite code', icon: 'copy', desc: `${code}: friends type it in Online → Join`, run: async () => ui.toast((await copyText(code)) ? `Invite code ${code} copied` : code, 'ok') },
        { label: 'Discord invite', icon: 'user-plus', desc: settings.discordInvites === 'discord' ? 'In a Discord chat press + → Invite to STEMSTAGE (friends need STEMSTAGE installed for the Join button)' : 'Your Discord status has a Join room button. Or switch Settings → Discord invites to "Discord Join" for Discord\u2019s own invite cards', run: () => {} },
      ],
    });
  }

  /** Called from the setlist when the host picks a song for the room. */
  function selectForRoom(song) {
    const instruments = INSTS.filter((i) => song.charts[i]?.available);
    songRev(song).then((rev) => online.select({ id: song.id, title: song.title, artist: song.artist, duration: song.duration, instruments, rev }));
    ui.mode = 'solo';
    ui.show('online');
  }

  return { selectForRoom, render, decorateResults };
}
