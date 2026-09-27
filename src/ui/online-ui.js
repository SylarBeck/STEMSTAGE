// Online screen: host (invite code over the internet, or LAN) / join, lobby (players, instruments, ready),
// song selection, chat, match start.
import { online, hostInfo, startHosting, stopHosting, inviteCode } from '../net/online.js';
import { profiles, PROFILE_COLORS } from '../profile/profiles.js';
import { getSong, getAudio, coverUrl } from '../storage/library.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { guitar: '🎸', bass: '🎸', drums: '🥁', keys: '🎹', vocals: '🎤' };
const INSTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const DIFFS = ['easy', 'medium', 'hard', 'expert'];

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
  const st = { inst: localStorage.getItem('stemstage.online.inst') || 'guitar', diff: localStorage.getItem('stemstage.online.diff') || 'medium', hostInfo: null, songProgress: null };
  const app = ui.app;

  const me = () => online.me;
  const identity = () => {
    const p = profiles.current;
    return { name: p?.name || `Guest ${Math.floor(Math.random() * 900 + 100)}`, color: p?.color || PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)], profileId: p?.id || null };
  };

  async function refreshHost() {
    const info = st.hostInfo = await hostInfo();
    const el = $('#ol-host-addr');
    clearTimeout(st.pollTimer);
    let html = '';
    if (info.hosting && info.internet) {
      const t = info.tunnel || {};
      if (t.status === 'ready' && t.url) {
        st.code = inviteCode(t.url);
        html = `<div class="invite-label">Invite code</div><div class="invite-code">${esc(st.code)}</div>
          <div class="btn-row tight"><button class="nav-btn primary" data-nav data-action="ol-copy">Copy invite</button></div>
          <small>Friends choose Online → Join and type this code. No port forwarding needed.</small>`;
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

  function render() {
    const connected = online.connected;
    $('#online-lobby').hidden = !connected;
    $('#online-connect').hidden = false;
    refreshHost();
    if (!connected) { ui.applyFocus(false); return; }
    const room = online.room;
    $('#ol-room').textContent = `Room ${room.code}`;
    $('#ol-status').textContent = online.host ? 'You are the host' : `Connected${inviteCode(online.baseUrl) ? ` to ${inviteCode(online.baseUrl)}` : ` to ${online.address}`}${online.rtt ? ` · ${Math.round(online.rtt)} ms` : ''}`;
    const song = room.song;
    const local = song && ui.songs.find((s) => s.id === song.id);
    const cv = local && coverUrl(local);
    $('#ol-song').innerHTML = song
      ? `<div class="cv" style="background:${cv ? `url('${cv}') center/cover` : 'linear-gradient(135deg,#ff2d7a,#29e0ff)'}"></div><div><b>${esc(song.title)}</b><div class="small-note">${esc(song.artist)}${song.duration ? ` · ${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : ''}</div></div>`
      : `<div class="small-note">${online.host ? 'Choose a song for the match.' : 'Waiting for the host to choose a song...'}</div>`;
    $('#ol-players').innerHTML = room.players.map((p) => {
      const status = !song ? '' : p.hasSong ? (p.ready || p.host ? '<span class="rd ok">READY</span>' : '<span class="rd">NOT READY</span>') : `<span class="rd">DOWNLOADING ${Math.round((p.loading || 0) * 100)}%</span>`;
      return `<div class="ol-player" style="--pc:${p.color}"><i></i><span>${esc(p.name)}${p.host ? ' 👑' : ''}${p.id === online.id ? ' (you)' : ''}</span><span>${ICON[p.instrument] || ''} ${p.instrument}</span><span>${p.difficulty}</span>${status || '<span></span>'}</div>`;
    }).join('');
    const avail = song?.instruments?.length ? song.instruments : INSTS;
    if (!avail.includes(st.inst)) st.inst = avail[0];
    $('#ol-pick-inst').innerHTML = INSTS.map((i) => `<div class="opt ${i === st.inst ? 'sel' : ''} ${avail.includes(i) ? '' : 'disabled'}" data-i="${i}">${ICON[i]} ${i}</div>`).join('');
    $('#ol-pick-diff').innerHTML = DIFFS.map((d) => `<div class="opt ${d === st.diff ? 'sel' : ''}" data-d="${d}">${d}</div>`).join('');
    $$('#ol-pick-inst [data-i]').forEach((o) => o.addEventListener('click', () => setMine({ instrument: o.dataset.i })));
    $$('#ol-pick-diff [data-d]').forEach((o) => o.addEventListener('click', () => setMine({ difficulty: o.dataset.d })));
    const m = me();
    $('#ol-ready').textContent = m?.ready ? 'Not ready' : 'Ready';
    $('#ol-ready').style.display = online.host ? 'none' : '';
    $('#ol-choose').style.display = online.host ? '' : 'none';
    $('#ol-start').style.display = online.host ? '' : 'none';
    const others = room.players.filter((p) => !p.host);
    $('#ol-start').disabled = !song || !others.every((p) => p.ready && p.hasSong);
    ui.applyFocus(false);
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
    const mine = msg.lineup.find((p) => p.id === online.id);
    if (!mine) { ui.toast('Match started without you (song still downloading?)', 'err'); return; }
    const [song, audio] = await Promise.all([getSong(msg.song.id), getAudio(msg.song.id)]);
    if (!song || !audio) { ui.toast('The song is missing locally', 'err'); return; }
    if (!song.charts[mine.instrument]?.available) { ui.toast(`No ${mine.instrument} chart in this song`, 'err'); return; }
    app.menuMusic(false);
    ui.stopPreview?.();
    ui.show('hud');
    ui.lastPlay = { online: true };
    const cfg = { name: mine.name, color: mine.color, device: 'any', instrument: mine.instrument, difficulty: mine.difficulty, strum: mine.instrument !== 'drums' && ui.strumFor('any'), profileId: profiles.current?.id || null };
    await app.game.start(song, audio, [cfg], { online: { client: online, lineup: msg.lineup, startAt: msg.startAt, matchId: msg.matchId } });
  }

  online.on('room', () => { if (ui.screen === 'online') render(); });
  online.on('results', (list, msg) => {
    // a late finisher's result arrived after we already showed the results screen
    const r = ui.lastResultRaw;
    if (!msg?.update || ui.screen !== 'results' || r?.mode !== 'online') return;
    r.remotePlayers = list.filter((x) => x.id !== online.id).map((x) => ({ ...x, remote: true }));
    ui.showResults(r, { rerender: true });
  });
  online.on('start', onStart);
  online.on('chat', (m) => log(`<b style="--pc:${esc(m.color)}">${esc(m.from)}:</b> ${esc(m.text)}`));
  online.on('song-progress', () => { if (ui.screen === 'online') render(); });
  online.on('song-ready', () => ui.reloadSongs().then(() => { if (ui.screen === 'online') render(); }));
  online.on('error', (msg) => ui.toast(msg, 'err'));
  online.on('closed', (reason) => { st.closed = true; ui.toast(reason || 'Room closed', 'err'); });
  online.on('disconnected', () => {
    if (!st.closed) ui.toast('Disconnected from the room', 'err');
    st.closed = false;
    if (ui.screen === 'online') render();
  });

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
    'ol-leave': () => { if (online.host) { ui.actionHooks['ol-stop'](); return; } online.close(); render(); },
    'ol-ready': () => setMine({ ready: !me()?.ready }),
    'ol-choose': () => { ui.mode = 'online-pick'; ui.show('library'); },
    'ol-start': () => online.start(),
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

  /** Called from the setlist when the host picks a song for the room. */
  function selectForRoom(song) {
    const instruments = INSTS.filter((i) => song.charts[i]?.available);
    online.select({ id: song.id, title: song.title, artist: song.artist, duration: song.duration, instruments });
    ui.mode = 'solo';
    ui.show('online');
  }

  return { selectForRoom, render };
}
