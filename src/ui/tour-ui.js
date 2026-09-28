// Tour screen: venues unlocked by stars (each a gig played as a marathon), today's daily challenge, and the
// world's weekly challenge + season standings.
import { profiles } from '../profile/profiles.js';
import { VENUES, TOUR_MAX, DIFFS, tourStars, unlocked, gigSongs, recordGig, dailyChallenge, dailyMet, dailyDone, completeDaily } from '../profile/career.js';
import { coverUrl, getSong } from '../storage/library.js';
import { weeklyChallenge, seasonStandings, findLocalSong, timeLeft } from '../net/challenge.js';
import { allowRanked } from '../net/charts.js';
import { settings } from '../settings.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { instIcon, fa, VENUE_ICON } from './icons.js';
const INSTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'].map((i) => [i, instIcon(i)]);
const vIcon = (v) => fa(VENUE_ICON[v.id] || 'star');
const ICON = Object.fromEntries(INSTS);

export function installTour(ui) {
  const st = { venue: 0, diff: null, view: 'venue', weekly: null, season: null, wkErr: null, wkSong: null, wkAt: 0 };
  const songById = (id) => ui.songs.find((s) => s.id === id);
  const minIdx = (v) => DIFFS.indexOf(v.minDiff);

  function daily() { return dailyChallenge(ui.songs); }

  function dailyCard(p) {
    const ch = daily();
    if (!ch) return '<div class="daily panel"><div class="dl-k">DAILY CHALLENGE</div><div class="small-note">Import a song to unlock daily challenges.</div></div>';
    const done = dailyDone(p, ch.date);
    const streak = p?.daily?.streak || 0;
    return `<div class="daily panel ${done ? 'done' : ''}">
      <div class="dl-k">DAILY CHALLENGE · ${new Date().toLocaleDateString(undefined, { weekday: 'long' })}</div>
      <b>${esc(ch.title)}</b><small>${esc(ch.artist)} · ${ICON[ch.instrument]} ${ch.instrument} · ${ch.difficulty}+</small>
      <div class="dl-goal">${fa('bullseye')} ${esc(ch.text)} <em>+${ch.xp} XP</em></div>
      <div class="dl-foot">${done ? `<span class="ok">${fa('check')} Done today</span>` : ''}${streak ? `<span>${fa('fire')} ${streak}-day streak</span>` : ''}</div>
      ${done ? '' : '<button class="nav-btn primary" data-nav data-action="tour-daily">Play challenge</button>'}</div>`;
  }

  // ---------------------------------------------------------------- weekly challenge + season
  const place = (n) => `#${n}`;
  async function loadWeekly(fresh = false) {
    if (!fresh && Date.now() - st.wkAt < 30_000) return;
    st.wkAt = Date.now();
    try {
      [st.weekly, st.season] = await Promise.all([weeklyChallenge(fresh), seasonStandings(fresh)]);
      st.wkErr = null;
      st.wkSong = st.weekly && !st.weekly.none ? await findLocalSong(ui.songs, st.weekly.song.key) : null;
    } catch (e) { st.wkErr = e.message; }
    if (ui.screen === 'tour') render(true);
  }

  function weeklyCard() {
    if (settings.worldLeaderboard === false) return '';
    const c = st.weekly;
    const body = st.wkErr ? '<div class="small-note">The weekly challenge can\u2019t be reached right now.</div>'
      : !c ? '<div class="small-note">Loading this week\u2019s challenge…</div>'
        : c.none ? '<div class="small-note">No weekly challenge yet: it starts once a song has a ranked chart.</div>'
          : `<b>${esc(c.song.title)}</b><small>${esc(c.song.artist)} · ${ICON[c.instrument]} ${c.instrument} · ${c.difficulty}</small>
            <div class="dl-foot"><span>${fa('hourglass-half')} ${timeLeft(c.ends)}</span>${c.me ? `<span class="ok">${fa('trophy')} ${place(c.me.rank)} of ${c.players}</span>` : `<span>${c.players} player${c.players === 1 ? '' : 's'}</span>`}</div>`;
    return `<div class="daily weekly panel ${st.view === 'weekly' ? 'sel' : ''}">
      <div class="dl-k">WEEKLY CHALLENGE${c && !c.none ? ` · SEASON ${c.season}` : ''}</div>${body}
      <button class="nav-btn" data-nav data-action="tour-weekly">${fa('ranking-star')} Weekly &amp; season</button></div>`;
  }

  function weeklyDetail() {
    const c = st.weekly, s = st.season;
    if (!c || c.none) return `<div class="vd-banner"><i>${fa('ranking-star')}</i><div><h2>Weekly challenge</h2><p>${c?.none ? 'Starts once a song has a ranked chart: play any song while signed in to make the first one.' : st.wkErr ? 'Can\u2019t be reached right now.' : 'Loading…'}</p></div></div>`;
    const me = profiles.current?.cloud?.id;
    const row = (r, cols) => `<tr class="${r.playerId === me ? 'me' : ''}"><td>${r.rank}</td><td>${esc(r.player)}</td>${cols(r)}</tr>`;
    const play = st.wkSong
      ? `<button class="nav-btn primary" data-nav data-action="tour-weekly-play">${fa('play')} Play it (${c.instrument} · ${c.difficulty})</button>`
      : `<button class="nav-btn primary" data-nav data-action="tour-weekly-find">${fa('magnifying-glass')} Find it on YouTube</button><div class="small-note">You don\u2019t have this song yet. Import it and the ranked chart is lined up with your copy.</div>`;
    return `<div class="vd-banner wk"><i>${fa('ranking-star')}</i><div><h2>${esc(c.song.title)}</h2><p>${esc(c.song.artist)} · ${ICON[c.instrument]} ${c.instrument} · ${c.difficulty} · week ${c.week + 1} · ${timeLeft(c.ends)}</p></div></div>
      <p class="small-note">Everyone plays the ranked chart. Your best run this week counts, and your place earns season points (100 for first, down to 10 for taking part).</p>
      <div class="btn-row">${play}</div>
      <div class="wk-cols">
        <div><h4>This week</h4><table class="tbl"><tr><th>#</th><th>Player</th><th>Score</th><th>Pts</th></tr>
          ${c.rows.slice(0, 10).map((r) => row(r, (x) => `<td>${x.score.toLocaleString()}</td><td>${x.points}</td>`)).join('') || '<tr><td colspan="4" class="small-note">No runs yet: be the first.</td></tr>'}
          ${c.me && c.me.rank > 10 ? row(c.me, (x) => `<td>${x.score.toLocaleString()}</td><td>${x.points}</td>`) : ''}</table></div>
        <div><h4>Season ${s?.season ?? c.season} <small>${s ? timeLeft(s.ends) : ''}</small></h4><table class="tbl"><tr><th>#</th><th>Player</th><th>Points</th><th>Wins</th></tr>
          ${(s?.rows || []).slice(0, 10).map((r) => row(r, (x) => `<td>${x.points}</td><td>${x.wins}</td>`)).join('') || '<tr><td colspan="4" class="small-note">No points yet this season.</td></tr>'}
          ${s?.me && s.me.rank > 10 ? row(s.me, (x) => `<td>${x.points}</td><td>${x.wins}</td>`) : ''}</table>
          <div class="wk-weeks">${(s?.weeks || []).map((w) => `<span>W${w.week + 1}: ${esc(w.song.title)}${w.winner ? ` · ${fa('crown')} ${esc(w.winner.player)}` : ''}</span>`).join('')}</div></div>
      </div>`;
  }

  async function playWeekly() {
    const c = st.weekly;
    const s = st.wkSong && ui.songs.find((x) => x.id === st.wkSong.id);
    if (!c || !s) return;
    if (!s.charts?.[c.instrument]?.available) { ui.toast(`This song has no ${c.instrument} chart: re-chart it with AI`, 'err'); return; }
    // only runs on the ranked chart count: a part pinned to another chart goes back to the ranked one
    const part = s.charts[c.instrument];
    if (part.pin || part.refused) { const song = await getSong(s.id); await allowRanked(song, c.instrument); await ui.reloadSongs(); ui.toast('This part is back on the ranked chart for the weekly challenge', 'ok'); }
    ui.selected = ui.songs.find((x) => x.id === s.id) || s;
    ui.instrument = c.instrument;
    ui.difficulty = c.difficulty;
    ui.mode = 'solo';
    ui.play({ ghost: null });
  }

  function render(keep = false) {
    const p = profiles.current;
    const el = $('#tour');
    if (!p) {
      el.innerHTML = `<div class="card tour-signin"><h3>Sign in to go on tour</h3><p class="small-note">Tour progress, stars and daily streaks are saved on your profile.</p><div class="btn-row"><button class="nav-btn primary" data-nav data-action="profiles">Sign in / create profile</button></div></div>`;
      bind(el);
      ui.applyFocus(false);
      return;
    }
    const stars = tourStars(p);
    st.venue = Math.min(st.venue, VENUES.length - 1);
    // the stage behind the tour screen is the venue you're looking at (the arena for one that's still locked)
    ui.app.stage.setVenue(unlocked(p, VENUES[st.venue]) ? VENUES[st.venue].id : 'arena');
    el.innerHTML = `
      <div class="tour-col" data-nav-group="venues">
        ${dailyCard(p)}
        ${weeklyCard()}
        <div class="tour-total"><span>TOUR STARS</span><b>${fa('star')} ${stars}</b><small>/ ${TOUR_MAX}</small><div class="xpbar"><div style="width:${Math.round((stars / TOUR_MAX) * 100)}%"></div></div></div>
        <div class="venues">${VENUES.map((v, i) => {
          const open = unlocked(p, v);
          const rec = p.tour?.venues?.[v.id];
          return `<button class="venue ${open ? '' : 'locked'} ${i === st.venue ? 'sel' : ''}" data-nav data-venue="${i}" style="--vh:${v.hue}">
            <i>${open ? vIcon(v) : fa('lock')}</i><div><b>${esc(v.name)}</b><small>${open ? `${fa('star')} ${rec?.stars || 0} / ${v.songs * 5}` : `Needs ${fa('star')} ${v.need}`}</small></div></button>`;
        }).join('')}</div>
      </div>
      <div class="venue-detail panel" data-nav-group="gig">${st.view === 'weekly' ? weeklyDetail() : detail(p)}</div>`;
    bind(el);
    $$('[data-venue]', el).forEach((b) => b.addEventListener('click', () => { st.venue = +b.dataset.venue; st.diff = null; st.view = 'venue'; render(true); }));
    loadWeekly();
    if (!keep) ui.applyFocus(false); else ui.applyFocus(false);
  }

  function detail(p) {
    const v = VENUES[st.venue];
    const open = unlocked(p, v);
    const rec = p.tour?.venues?.[v.id] || {};
    const head = `<div class="vd-banner" style="--vh:${v.hue}"><i>${vIcon(v)}</i><div><h2>${esc(v.name)}</h2><p>${esc(v.blurb)}</p></div></div>`;
    if (!open) return `${head}<div class="vd-locked">${fa('lock')} Earn <b>${fa('star')} ${v.need}</b> on tour to unlock (you have ${tourStars(p)}).</div>`;
    const ids = gigSongs(p, v, ui.songs);
    if (st.diff == null || DIFFS.indexOf(st.diff) < minIdx(v)) st.diff = DIFFS[Math.max(minIdx(v), DIFFS.indexOf(ui.difficulty))];
    const rows = ids.map((id, i) => {
      const s = songById(id);
      if (!s) return '';
      const ok = !!s.charts?.[ui.instrument]?.available;
      const cv = coverUrl(s);
      return `<div class="sl-song ${ok ? '' : 'nochart'}"><span class="n">${i + 1}</span><i class="cv" style="background:${cv ? `url('${cv}') center/cover` : ui.art(s)}"></i><div><b>${esc(s.title)}</b><small>${esc(s.artist)}${ok ? '' : ` · no ${ui.instrument} chart (skipped)`}</small></div></div>`;
    }).join('');
    return `${head}
      <div class="vd-best">${rec.plays ? `Best gig: <b>${fa('star')} ${rec.stars} / ${v.songs * 5}</b> · ${Number(rec.score || 0).toLocaleString()} · played ${rec.plays}×` : 'Not played yet'}</div>
      <div class="picker" data-nav data-picker="tour-inst"><label>Instrument</label><div class="picker-options">${INSTS.map(([i, ico]) => `<div class="opt ${ui.instrument === i ? 'sel' : ''}">${ico} ${i}</div>`).join('')}</div></div>
      <div class="picker" data-nav data-picker="tour-diff"><label>Difficulty <span class="lbl-hint">${v.minDiff}+</span></label><div class="picker-options">${DIFFS.map((d, i) => `<div class="opt ${st.diff === d ? 'sel' : ''} ${i < minIdx(v) ? 'disabled' : ''}">${d}</div>`).join('')}</div></div>
      <div class="sl-songs">${rows || '<div class="small-note">Import songs to fill this gig.</div>'}</div>
      <div class="btn-row"><button class="nav-btn primary" data-nav data-action="tour-play" ${ids.length ? '' : 'disabled'}>${fa('play')} Play gig</button></div>`;
  }

  function bind(el) { $$('[data-action]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); })); }

  function playGig() {
    const p = profiles.current;
    const v = VENUES[st.venue];
    if (!p || !unlocked(p, v)) return;
    ui.difficulty = st.diff;
    ui.setlists.startMarathon({
      id: `tour-${v.id}`, name: v.name, songs: gigSongs(p, v, ui.songs), backTo: 'tour', backLabel: 'Tour',
      onDone: async (m) => {
        const results = m.results.map((x) => x.players[0]);
        // every song of the gig counts: skipped/unfinished songs earn nothing
        const stars = results.reduce((s, r) => s + (r.stars || 0), 0);
        const score = results.reduce((s, r) => s + (r.score || 0), 0);
        const out = await recordGig(p, v, stars, score);
        for (const a of out.achievements) ui.toast(`${a.name} — ${a.desc}`, 'ok', 'trophy');
        return `<div class="gig-result">${vIcon(v)} ${esc(v.name)} · <b>${fa('star')} ${stars} / ${v.songs * 5}</b>${out.best ? ' · NEW BEST' : ''}${out.newVenues.map((nv) => `<div class="unlock">${fa('lock-open')} ${esc(nv.name)} unlocked!</div>`).join('')}</div>`;
      },
    }, { band: false });
  }

  function playDaily() {
    const ch = daily();
    const s = ch && songById(ch.songId);
    if (!s) return;
    ui.selected = s;
    ui.instrument = ch.instrument;
    ui.difficulty = ch.difficulty;
    ui.mode = 'solo';
    ui.play({ ghost: null });
  }

  /** Every solo result: does it beat today's challenge? Does it place on this week's? */
  async function onResult(r) {
    const p = profiles.current;
    if (!p || r.mode !== 'solo' || r.practice) return;
    weeklyResult(r);
    const ch = daily();
    const me = r.players[0];
    if (!ch || dailyDone(p, ch.date) || r.song.id !== ch.songId || me.instrument !== ch.instrument || DIFFS.indexOf(me.difficulty) < DIFFS.indexOf(ch.difficulty)) return;
    if (!dailyMet(ch, me)) { ui.toast(`Daily challenge not quite: ${ch.text}`); return; }
    const out = await completeDaily(p, ch);
    if (!out) return;
    ui.toast(`Daily challenge beaten! +${out.xp} XP · ${out.streak}-day streak`, 'ok', 'calendar-check');
    for (const a of out.achievements) ui.toast(`${a.name} — ${a.desc}`, 'ok', 'trophy');
  }

  /** A run on this week's challenge: its place on the board once the world has it. */
  async function weeklyResult(r) {
    const c = st.weekly, me = r.players[0];
    if (!c || c.none || !st.wkSong || r.song.id !== st.wkSong.id || me.instrument !== c.instrument || me.difficulty !== c.difficulty) return;
    const sent = await ui.lastSubmit?.catch(() => []);
    if (!sent?.some((x) => x.ranked && x.chartId === c.chart)) return;
    try {
      st.weekly = await weeklyChallenge(true);
      if (st.weekly.me) ui.toast(`Weekly challenge: you're ${place(st.weekly.me.rank)} of ${st.weekly.players} (${st.weekly.me.points} season points)`, 'ok', 'ranking-star');
    } catch { /* offline */ }
  }

  ui.screenHooks.tour = async () => { if (!ui.songs.length) await ui.reloadSongs(); render(); };
  Object.assign(ui.actionHooks, {
    tour: () => ui.show('tour'),
    'tour-play': () => playGig(),
    'tour-daily': () => playDaily(),
    'tour-weekly': () => { st.view = st.view === 'weekly' ? 'venue' : 'weekly'; loadWeekly(true); render(true); },
    'tour-weekly-play': () => playWeekly(),
    'tour-weekly-find': () => { const c = st.weekly; if (c?.song) ui.findOnYouTube(c.song.artist, c.song.title); },
  });
  ui.pickerHooks.push((which, d) => {
    if (which === 'tour-inst') { const i = INSTS.findIndex(([v]) => v === ui.instrument); ui.instrument = INSTS[(i + d + INSTS.length) % INSTS.length][0]; render(true); return true; }
    if (which === 'tour-diff') { const v = VENUES[st.venue]; st.diff = DIFFS[Math.max(minIdx(v), Math.min(3, DIFFS.indexOf(st.diff) + d))]; render(true); return true; }
    return false;
  });

  return { onResult, daily, render };
}
