// Discover (the library brain): setlists the game builds from your library and plays, songs like the ones you play
// (artists like yours, to find and import), and your playing in numbers.
import { profiles } from '../profile/profiles.js';
import { loadPlays } from '../storage/library.js';
import { smartSetlists, playStats, topArtists } from '../storage/insights.js';
import { fa, instIcon } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hourName = (h) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} am` : `${h - 12} pm`);

export function installDiscover(ui) {
  const st = { plays: [], lists: [], artists: [], artist: 0, similar: new Map(), loading: null };

  async function load() {
    const all = await loadPlays().catch(() => []);
    const me = profiles.current?.id;
    st.plays = me ? all.filter((p) => p.profileId === me) : all;
    st.lists = smartSetlists(ui.songs, st.plays, { inst: ui.instrument === 'vocals' ? 'guitar' : ui.instrument, diff: ui.difficulty });
    // the built-in demo band has no real-world neighbours
    const demo = new Set(ui.songs.filter((x) => x.method === 'demo').map((x) => x.id));
    st.artists = topArtists(st.plays.filter((p) => !demo.has(p.songId)), ui.songs.filter((x) => !demo.has(x.id)));
    st.artist = Math.min(st.artist, Math.max(0, st.artists.length - 1));
  }

  function render() {
    const el = $('#discover');
    const stats = playStats(st.plays);
    el.innerHTML = `
      <div class="disc-col" data-nav-group="disc-lists">
        <h3 class="disc-h">${fa('wand-magic-sparkles')} Smart setlists <small>${instIcon(ui.instrument)} ${ui.instrument} · ${ui.difficulty}</small></h3>
        ${st.lists.length ? st.lists.map((l, i) => `<button class="disc-list" data-nav data-list="${i}">
          <i>${fa(l.icon)}</i><div><b>${esc(l.name)}</b><small>${esc(l.desc)}</small></div><em>${l.songs.length} songs<br>${l.minutes} min</em></button>`).join('')
          : '<div class="small-note">Import a few songs (with a chart for this instrument) and the game builds setlists from them.</div>'}
      </div>
      <div class="disc-col right">
        <div class="panel disc-panel" data-nav-group="disc-similar">${similarHtml()}</div>
        <div class="panel disc-panel">${statsHtml(stats)}</div>
      </div>`;
    $$('[data-list]', el).forEach((b) => b.addEventListener('click', () => openList(st.lists[+b.dataset.list])));
    $$('[data-find]', el).forEach((b) => b.addEventListener('click', () => { const s = similarFor()?.songs[+b.dataset.find]; if (s) ui.findOnYouTube(s.artist, s.title); }));
    $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); }));
    ui.applyFocus(false);
  }

  const similarFor = () => st.similar.get(st.artists[st.artist]);

  function similarHtml() {
    const artist = st.artists[st.artist];
    if (!artist) return '<h3>Because you play…</h3><div class="small-note">Play or import a song and the game suggests songs like it.</div>';
    const got = similarFor();
    const owned = new Set(ui.songs.map((s) => `${(s.artist || '').toLowerCase()}|${(s.title || '').toLowerCase()}`));
    const rows = got?.error ? `<div class="small-note">Suggestions can’t be reached right now (${esc(got.error)}).</div>`
      : !got ? '<div class="small-note">Finding artists like this one…</div>'
        : got.songs.length ? got.songs.slice(0, 6).map((s, i) => `<div class="disc-sug"><div><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></div>${owned.has(`${s.artist.toLowerCase()}|${s.title.toLowerCase()}`) ? `<span class="ok">${fa('check')} In your setlist</span>` : `<button class="nav-btn" data-nav data-find="${i}">${fa('magnifying-glass')} Find</button>`}</div>`).join('')
          : '<div class="small-note">No similar artists found for this one.</div>';
    return `<h3>Because you play…</h3>
      <div class="picker" data-nav data-picker="disc-artist"><label>Artist</label><div class="picker-options disc-artist"><div class="opt sel">${esc(artist)}</div>${st.artists.length > 1 ? `<span class="lbl-hint">${st.artist + 1} / ${st.artists.length}</span>` : ''}</div></div>
      <div class="disc-sugs">${rows}</div>
      <p class="small-note">Suggestions come from Deezer's related artists. Find opens a YouTube search to import the song.</p>`;
  }

  function statsHtml(s) {
    if (!s) return '<h3>Your stats</h3><div class="small-note">Play a song and your numbers start here.</div>';
    const cell = (v, l) => `<div class="disc-stat"><b>${v}</b><span>${l}</span></div>`;
    return `<h3>Your stats <small>since ${new Date(s.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</small></h3>
      <div class="disc-stats">${[
        cell(s.plays.toLocaleString(), 'songs played'), cell(s.hours < 10 ? s.hours.toFixed(1) : Math.round(s.hours), 'hours'),
        cell(s.days, 'days on stage'), cell(`${Math.round(s.accuracy * 100)}%`, 'accuracy'),
        cell(s.bestStreak, 'best streak'), cell(s.fcs, 'full combos'),
      ].join('')}</div>
      <div class="disc-facts">
        <span>${fa('heart')} Most played: <b>${esc(s.topSong.title)}</b> · ${esc(s.topSong.artist)} (${s.topSong.plays}×)</span>
        <span>${instIcon(s.topInstrument)} Mostly on <b>${s.topInstrument}</b> · usually around <b>${hourName(s.hour)}</b></span>
      </div>`;
  }

  async function fetchSimilar() {
    const artist = st.artists[st.artist];
    if (!artist || st.similar.has(artist) || st.loading === artist) return;
    st.loading = artist;
    try {
      const r = await fetch(`/api/meta/similar?artist=${encodeURIComponent(artist)}`);
      st.similar.set(artist, r.ok ? await r.json() : { error: `HTTP ${r.status}` });
    } catch (e) { st.similar.set(artist, { error: e.message }); }
    st.loading = null;
    if (ui.screen === 'discover') render();
  }

  function openList(l) {
    if (!l) return;
    const songs = l.songs.map((id) => ui.songs.find((s) => s.id === id)).filter(Boolean);
    ui.openSheet({
      title: l.name, sub: songs.map((s) => s.title).slice(0, 6).join(' · ') + (songs.length > 6 ? ` · +${songs.length - 6} more` : ''),
      items: [
        { label: 'Play it now', icon: 'play', desc: `${songs.length} songs back to back, one combined score`, run: () => ui.setlists.startMarathon({ id: `smart-${l.id}`, name: l.name, songs: l.songs, backTo: 'discover', backLabel: 'Discover' }) },
        { label: 'Save as a setlist', icon: 'floppy-disk', run: () => { ui.setlists.create(l.name, [...l.songs]); ui.toast(`Saved "${l.name}" to your setlists`, 'ok'); } },
        { label: 'Back', icon: 'arrow-left', run: () => {} },
      ],
    });
  }

  ui.screenHooks.discover = async () => {
    if (!ui.songs.length) await ui.reloadSongs();
    await load();
    render();
    fetchSimilar();
  };
  Object.assign(ui.actionHooks, { discover: () => ui.show('discover') });
  ui.pickerHooks.push((which, d) => {
    if (which !== 'disc-artist' || !st.artists.length) return false;
    st.artist = (st.artist + d + st.artists.length) % st.artists.length;
    render();
    fetchSimilar();
    return true;
  });
}

