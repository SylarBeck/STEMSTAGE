// Chart library: every song players have charted (the world API's /v1/library), with its ranked parts. A song
// you have opens in the setlist; one you don't is searched on YouTube and imported under the world's title and
// artist, so its ranked charts are lined up with your copy when you play.
import { API, songKey } from '../net/leaderboard.js';
import { cleanApi } from '../net/api-clean.js';
import { settings } from '../settings.js';
import { instIcon, fa } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function installChartLibrary(ui) {
  const st = { q: '', rows: null, err: null, ticket: 0, keys: new Map() };

  /** The library's songs by world key (artist + title, as the leaderboards match them). */
  async function localByKey() {
    const out = new Map();
    for (const s of ui.songs) {
      const id = `${s.artist}|${s.title}`;
      if (!st.keys.has(id)) st.keys.set(id, await songKey(s.artist, s.title));
      out.set(st.keys.get(id), s);
    }
    return out;
  }

  async function load() {
    const ticket = ++st.ticket;
    st.err = null;
    try {
      const r = await fetch(`${API}/v1/library?${new URLSearchParams({ limit: 150, ...(st.q ? { q: st.q } : {}) })}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `library ${r.status}`);
      if (ticket === st.ticket) st.rows = cleanApi(Array.isArray(j.rows) ? j.rows : [], 'rows');
    } catch (e) { if (ticket === st.ticket) { st.err = e.message; st.rows = null; } }
    if (ticket === st.ticket && ui.screen === 'chartlib') render();
  }

  async function render() {
    const el = $('#cl-list');
    if (settings.worldLeaderboard === false) { el.innerHTML = '<div class="small-note">The chart library is part of the world leaderboard, which is off in Settings.</div>'; ui.applyFocus(false); return; }
    if (st.err) { el.innerHTML = `<div class="small-note">The chart library can’t be reached right now (${esc(st.err)}).</div>`; ui.applyFocus(false); return; }
    if (!st.rows) { el.innerHTML = '<div class="small-note">Loading the chart library…</div>'; return; }
    const mine = await localByKey();
    el.innerHTML = st.rows.map((r) => {
      const have = mine.get(r.key);
      return `<button class="cl-song ${have ? 'have' : ''}" data-nav data-key="${esc(r.key)}">
        <div class="cl-t"><b>${esc(r.title)}</b><small>${esc(r.artist || '')}</small></div>
        <div class="cl-parts">${r.parts.map((p) => `<span title="Ranked ${esc(p)} chart">${instIcon(p)}</span>`).join('')}</div>
        <div class="cl-meta">${r.players} player${r.players === 1 ? '' : 's'} · ${r.charts} chart${r.charts === 1 ? '' : 's'}</div>
        <div class="cl-act">${have ? `${fa('check')} In your library` : `${fa('magnifying-glass')} Get it`}</div></button>`;
    }).join('') || `<div class="small-note">${st.q ? 'No charted songs match that search.' : 'No charts yet: finish a song while signed in and yours is the first.'}</div>`;
    $$('[data-key]', el).forEach((b) => b.addEventListener('click', () => open(b.dataset.key, mine)));
    ui.applyFocus(false);
  }

  function open(key, mine) {
    const r = st.rows?.find((x) => x.key === key);
    if (!r) return;
    const have = mine.get(key);
    if (have) {
      ui.mode = 'solo';
      ui.show('library');
      ui.selectSong(have.id);
      ui.toast(`${r.parts.length ? `Ranked ${r.parts.join(', ')} charts are lined up with your copy when you play` : 'Your copy'} · Song options → World charts`, 'ok', 'earth-americas');
      return;
    }
    ui.findOnYouTube(r.artist, r.title);
  }

  $('#cl-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.action('cl-search'); } });
  ui.screenHooks.chartlib = async () => { if (!ui.songs.length) await ui.reloadSongs(); render(); load(); };
  Object.assign(ui.actionHooks, {
    chartlib: () => ui.show('chartlib'),
    'cl-search': () => { st.q = $('#cl-q').value.trim(); st.rows = null; render(); load(); },
  });
}
