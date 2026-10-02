// Stream mode: Twitch chat (read-only) drives song votes, song requests and crowd hype; the game
// publishes what's on screen for the OBS overlay (/overlay.html, an OBS Browser Source).
//   !vote 1-3     vote for the next song while a vote runs
//   !sr <words>   request a song from the library (2 per viewer)
//   !hype         pyro + crowd roar during a song (shared 15 s cooldown)
import { settings, isIOS } from '../settings.js';
import { coverUrl } from '../storage/library.js';
import { fa } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VOTE_SECONDS = 30;
const HYPE_COOLDOWN = 15000;

export function installStream(ui) {
  if (isIOS) return { onResults() {}, publish() {} };
  const app = ui.app;
  const st = { status: { status: 'off', channel: '', overlays: 0 }, vote: null, requests: [], log: [], lastHype: 0, lastResult: null };
  const overlayUrl = () => `${location.origin}/overlay.html`;

  // ---------------------------------------------------------------- server link
  let es = null;
  function listen() {
    try { es?.close(); } catch { /* closed */ }
    es = new EventSource('/api/stream/events?role=game');
    es.addEventListener('hello', (e) => { st.status = JSON.parse(e.data); refresh(); });
    es.addEventListener('status', (e) => { st.status = JSON.parse(e.data); refresh(); });
    es.addEventListener('chat', (e) => onChat(JSON.parse(e.data)));
    es.onerror = () => { /* EventSource reconnects by itself */ };
  }

  async function connect(channel) {
    settings.twitchChannel = channel;
    try { st.status = await (await fetch('/api/stream/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) })).json(); } catch { /* offline */ }
    refresh();
  }

  // ---------------------------------------------------------------- chat commands
  function log(user, text) {
    st.log.unshift({ user, text, at: Date.now() });
    st.log.length = Math.min(st.log.length, 12);
  }

  function findSong(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const hay = (s) => `${s.title} ${s.artist}`.toLowerCase();
    const hits = ui.songs.filter((s) => words.every((w) => hay(s).includes(w)));
    return hits.sort((a, b) => a.title.length - b.title.length)[0] || null;
  }

  function onChat({ user, text }) {
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case '!vote': {
        const n = parseInt(arg, 10);
        if (!st.vote || !(n >= 1 && n <= st.vote.options.length)) return;
        st.vote.voters.set(user.toLowerCase(), n - 1);
        st.vote.tallies = st.vote.options.map((_, i) => [...st.vote.voters.values()].filter((v) => v === i).length);
        break;
      }
      case '!sr': case '!request': {
        const s = findSong(arg);
        if (!s) { log(user, `no match for "${arg}"`); break; }
        if (st.requests.filter((r) => r.user.toLowerCase() === user.toLowerCase()).length >= 2) { log(user, 'already has 2 requests'); break; }
        if (st.requests.some((r) => r.id === s.id)) { log(user, `"${s.title}" is already requested`); break; }
        st.requests.push({ id: s.id, title: s.title, artist: s.artist, user });
        log(user, `requested ${s.title}`);
        if (ui.screen !== 'stream' && !app.game.running) ui.toast(`${user} requested "${s.title}"`, '', 'music');
        break;
      }
      case '!hype': {
        if (!settings.streamHype || !app.game.running || app.game.finished) return;
        if (Date.now() - st.lastHype < HYPE_COOLDOWN) return;
        st.lastHype = Date.now();
        app.game.hype(user);
        log(user, 'hyped the crowd');
        break;
      }
      default: return;
    }
    refresh();
    publish(true);
  }

  // ---------------------------------------------------------------- votes
  function startVote() {
    if (st.vote) return;
    const pool = [...st.requests.map((r) => ui.songs.find((s) => s.id === r.id)).filter(Boolean)];
    const rest = ui.songs.filter((s) => !pool.includes(s)).sort(() => Math.random() - 0.5);
    const options = [...pool, ...rest].slice(0, 3);
    if (options.length < 2) { ui.toast('A vote needs at least 2 songs', 'err'); return; }
    st.vote = { options, tallies: options.map(() => 0), voters: new Map(), endsAt: Date.now() + VOTE_SECONDS * 1000 };
    st.voteTimer = setInterval(() => { if (Date.now() >= st.vote.endsAt) endVote(); else { refresh(); publish(true); } }, 1000);
    ui.toast(`Song vote started — chat types !vote 1-${options.length}`, 'ok');
    refresh();
    publish(true);
  }

  function endVote() {
    clearInterval(st.voteTimer);
    const v = st.vote;
    st.vote = null;
    if (!v) return;
    const max = Math.max(...v.tallies);
    const top = v.options.filter((_, i) => v.tallies[i] === max);
    const winner = top[Math.floor(Math.random() * top.length)];
    st.requests = st.requests.filter((r) => r.id !== winner.id);
    st.lastWinner = { title: winner.title, artist: winner.artist, votes: max };
    ui.toast(`Chat picked "${winner.title}" (${max} vote${max === 1 ? '' : 's'})`, 'ok', 'trophy');
    refresh();
    publish(true);
    playSong(winner, settings.streamAutoPlay);
  }

  function playSong(song, start = true) {
    ui.selected = ui.songs.find((s) => s.id === song.id) || song;
    if (!ui.selected.charts?.[ui.instrument]?.available) ui.instrument = ['guitar', 'bass', 'drums', 'keys', 'vocals'].find((i) => ui.selected.charts?.[i]?.available) || ui.instrument;
    ui.mode = 'solo';
    if (start && !app.game.running) ui.play();
    else if (!app.game.running) { ui.show('library'); ui.renderLibrary(ui.selected.id); }
  }

  // ---------------------------------------------------------------- overlay publishing
  let lastPub = 0;
  function snapshot() {
    const g = app.game;
    const base = {
      channel: st.status.channel,
      vote: st.vote && { options: st.vote.options.map((s) => ({ title: s.title, artist: s.artist })), tallies: st.vote.tallies, left: Math.max(0, Math.ceil((st.vote.endsAt - Date.now()) / 1000)) },
      requests: st.requests.slice(0, 5), winner: st.lastWinner || null,
    };
    if (g.running && g.song) {
      return {
        ...base, mode: 'play', song: { title: g.song.title, artist: g.song.artist, cover: coverUrl(g.song) },
        progress: Math.max(0, Math.min(1, (g.engine.songTime - g.startTime) / Math.max(1, g.endTime - g.startTime))),
        players: g.players.map((p) => ({ name: p.cfg.name, color: p.cfg.color, instrument: p.inst, difficulty: p.diff, score: Math.floor(p.score), streak: p.streak, mult: p.mult * (p.odActive ? 2 : 1), od: p.odActive, failed: p.failed })),
      };
    }
    if (ui.screen === 'results' && st.lastResult) return { ...base, mode: 'results', result: st.lastResult };
    return { ...base, mode: 'menu' };
  }

  function publish(force = false) {
    if (!st.status.overlays) return;
    const now = performance.now();
    if (!force && now - lastPub < 250) return;
    lastPub = now;
    fetch('/api/stream/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()) }).catch(() => {});
  }
  setInterval(() => publish(), 300);

  function onResults(r) {
    st.lastResult = { song: { title: r.song.title, artist: r.song.artist, cover: coverUrl(r.song) }, players: r.players.map((p) => ({ name: p.name, color: p.color, instrument: p.instrument, difficulty: p.difficulty, score: p.score, stars: p.stars, accuracy: p.accuracy })) };
    publish(true);
  }

  // ---------------------------------------------------------------- screen
  function refresh() {
    if (ui.screen === 'stream') render(true);
  }

  function render(keep = false) {
    const s = st.status;
    const el = $('#stream');
    const statusText = s.status === 'connected' ? `${fa('check')} Reading chat in #${esc(s.channel)}` : s.status === 'connecting' ? `Connecting to #${esc(s.channel)}…` : s.channel ? `Not connected${s.error ? ` — ${esc(s.error)}` : ''}` : 'Not connected';
    const v = st.vote;
    el.innerHTML = `
      <div class="st-col">
        <div class="panel">
          <h3>Twitch chat</h3>
          <div class="yt-search"><input type="text" id="st-channel" placeholder="Your channel name" spellcheck="false" data-osk="Twitch channel" data-osk-submit="st-connect" value="${esc(settings.twitchChannel || '')}" />
            <button class="nav-btn primary" data-nav data-action="st-connect">${s.status === 'connected' ? 'Reconnect' : 'Connect'}</button></div>
          <div class="st-status ${s.status}">${statusText}</div>
          <small class="small-note">Read-only — no login. Chat commands: <b>!vote 1-3</b> · <b>!sr song</b> · <b>!hype</b></small>
        </div>
        <div class="panel">
          <h3>OBS overlay</h3>
          <div class="invite-code small">${esc(overlayUrl())}</div>
          <div class="btn-row tight"><button class="nav-btn" data-nav data-action="st-copy">Copy overlay link</button></div>
          <small class="small-note">OBS → Sources → + → Browser, paste the link, 1920×1080. ${s.overlays ? `<b>${s.overlays} overlay${s.overlays === 1 ? '' : 's'} connected</b>` : 'No overlay connected yet'}.</small>
        </div>
        <div class="panel">
          <h3>Options</h3>
          <div class="set-row" data-nav data-action="st-hype"><span>Chat !hype<small>Pyro and a crowd roar during songs</small></span><b>${settings.streamHype ? 'On' : 'Off'}</b></div>
          <div class="set-row" data-nav data-action="st-auto"><span>Play the vote winner<small>Starts the winning song right away</small></span><b>${settings.streamAutoPlay ? 'On' : 'Off'}</b></div>
        </div>
      </div>
      <div class="st-col">
        <div class="panel">
          <h3>Song vote</h3>
          ${v ? `<div class="st-vote">${v.options.map((o, i) => { const total = Math.max(1, v.tallies.reduce((a, b) => a + b, 0)); return `<div class="sv-row"><b>${i + 1}</b><div><span>${esc(o.title)}</span><small>${esc(o.artist)}</small><i style="width:${Math.round((v.tallies[i] / total) * 100)}%"></i></div><em>${v.tallies[i]}</em></div>`; }).join('')}</div>
            <div class="btn-row tight"><button class="nav-btn primary" data-nav data-action="st-endvote">End vote now (${Math.max(0, Math.ceil((v.endsAt - Date.now()) / 1000))}s)</button></div>`
            : `<p class="small-note">Chat picks the next song from 3 options (requests first).${st.lastWinner ? ` Last winner: <b>${esc(st.lastWinner.title)}</b>` : ''}</p><div class="btn-row tight"><button class="nav-btn primary" data-nav data-action="st-vote">Start a vote</button></div>`}
        </div>
        <div class="panel">
          <h3>Requests · ${st.requests.length}</h3>
          <div class="st-reqs">${st.requests.map((r, i) => `<div class="st-req" data-nav data-req="${i}"><div><b>${esc(r.title)}</b><small>${esc(r.artist)} · from ${esc(r.user)}</small></div><span>${fa('play')}</span></div>`).join('') || '<p class="small-note">Viewers type !sr and a song name.</p>'}</div>
        </div>
        <div class="panel st-log"><h3>Chat commands</h3>${st.log.map((l) => `<div><b>${esc(l.user)}</b> ${esc(l.text)}</div>`).join('') || '<p class="small-note">Nothing yet.</p>'}</div>
      </div>`;
    $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); }));
    $$('[data-req]', el).forEach((r) => r.addEventListener('click', () => requestMenu(+r.dataset.req)));
    $('#st-channel').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.action('st-connect'); } });
    if (!keep) ui.focus = 0;
    ui.applyFocus(false);
  }

  function requestMenu(i) {
    const r = st.requests[i];
    if (!r) return;
    ui.openSheet({
      title: r.title, sub: `${r.artist} · requested by ${r.user}`,
      items: [
        { label: 'Play now', icon: 'play', run: () => { st.requests.splice(i, 1); playSong(r, true); } },
        { label: 'Remove request', danger: true, run: () => { st.requests.splice(i, 1); render(true); publish(true); } },
      ],
    });
  }

  ui.screenHooks.stream = () => render();
  Object.assign(ui.actionHooks, {
    stream: () => ui.show('stream'),
    'st-connect': () => connect(($('#st-channel')?.value || '').trim()),
    'st-copy': async () => {
      try { await navigator.clipboard.writeText(overlayUrl()); ui.toast('Overlay link copied — add it to OBS as a Browser source', 'ok'); } catch { ui.toast(overlayUrl()); }
    },
    'st-hype': () => { settings.streamHype = !settings.streamHype; render(true); },
    'st-auto': () => { settings.streamAutoPlay = !settings.streamAutoPlay; render(true); },
    'st-vote': () => startVote(),
    'st-endvote': () => endVote(),
  });

  listen();
  if (settings.twitchChannel) setTimeout(() => connect(settings.twitchChannel), 1500);
  return { onResults, publish };
}
