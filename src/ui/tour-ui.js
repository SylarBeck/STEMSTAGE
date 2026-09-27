// Tour screen: venues unlocked by stars (each a gig played as a marathon) + today's daily challenge.
import { profiles } from '../profile/profiles.js';
import { VENUES, TOUR_MAX, DIFFS, tourStars, unlocked, gigSongs, recordGig, dailyChallenge, dailyMet, dailyDone, completeDaily } from '../profile/career.js';
import { coverUrl } from '../storage/library.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const INSTS = [['guitar', '🎸'], ['bass', '🎸'], ['drums', '🥁'], ['keys', '🎹'], ['vocals', '🎤']];
const ICON = Object.fromEntries(INSTS);

export function installTour(ui) {
  const st = { venue: 0, diff: null };
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
      <div class="dl-goal">🎯 ${esc(ch.text)} <em>+${ch.xp} XP</em></div>
      <div class="dl-foot">${done ? '<span class="ok">✓ Done today</span>' : ''}${streak ? `<span>🔥 ${streak}-day streak</span>` : ''}</div>
      ${done ? '' : '<button class="nav-btn primary" data-nav data-action="tour-daily">Play challenge</button>'}</div>`;
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
    el.innerHTML = `
      <div class="tour-col" data-nav-group="venues">
        ${dailyCard(p)}
        <div class="tour-total"><span>TOUR STARS</span><b>★ ${stars}</b><small>/ ${TOUR_MAX}</small><div class="xpbar"><div style="width:${Math.round((stars / TOUR_MAX) * 100)}%"></div></div></div>
        <div class="venues">${VENUES.map((v, i) => {
          const open = unlocked(p, v);
          const rec = p.tour?.venues?.[v.id];
          return `<button class="venue ${open ? '' : 'locked'} ${i === st.venue ? 'sel' : ''}" data-nav data-venue="${i}" style="--vh:${v.hue}">
            <i>${open ? v.icon : '🔒'}</i><div><b>${esc(v.name)}</b><small>${open ? `★ ${rec?.stars || 0} / ${v.songs * 5}` : `Needs ★ ${v.need}`}</small></div></button>`;
        }).join('')}</div>
      </div>
      <div class="venue-detail panel" data-nav-group="gig">${detail(p)}</div>`;
    bind(el);
    $$('[data-venue]', el).forEach((b) => b.addEventListener('click', () => { st.venue = +b.dataset.venue; st.diff = null; render(true); }));
    if (!keep) ui.applyFocus(false); else ui.applyFocus(false);
  }

  function detail(p) {
    const v = VENUES[st.venue];
    const open = unlocked(p, v);
    const rec = p.tour?.venues?.[v.id] || {};
    const head = `<div class="vd-banner" style="--vh:${v.hue}"><i>${v.icon}</i><div><h2>${esc(v.name)}</h2><p>${esc(v.blurb)}</p></div></div>`;
    if (!open) return `${head}<div class="vd-locked">🔒 Earn <b>★ ${v.need}</b> on tour to unlock (you have ★ ${tourStars(p)}).</div>`;
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
      <div class="vd-best">${rec.plays ? `Best gig: <b>★ ${rec.stars} / ${v.songs * 5}</b> · ${Number(rec.score || 0).toLocaleString()} · played ${rec.plays}×` : 'Not played yet'}</div>
      <div class="picker" data-nav data-picker="tour-inst"><label>Instrument</label><div class="picker-options">${INSTS.map(([i, ico]) => `<div class="opt ${ui.instrument === i ? 'sel' : ''}">${ico} ${i}</div>`).join('')}</div></div>
      <div class="picker" data-nav data-picker="tour-diff"><label>Difficulty <span class="lbl-hint">${v.minDiff}+</span></label><div class="picker-options">${DIFFS.map((d, i) => `<div class="opt ${st.diff === d ? 'sel' : ''} ${i < minIdx(v) ? 'disabled' : ''}">${d}</div>`).join('')}</div></div>
      <div class="sl-songs">${rows || '<div class="small-note">Import songs to fill this gig.</div>'}</div>
      <div class="btn-row"><button class="nav-btn primary" data-nav data-action="tour-play" ${ids.length ? '' : 'disabled'}>▶ Play gig</button></div>`;
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
        for (const a of out.achievements) ui.toast(`🏆 ${a.name} — ${a.desc}`, 'ok');
        return `<div class="gig-result">${v.icon} ${esc(v.name)} · <b>★ ${stars} / ${v.songs * 5}</b>${out.best ? ' · NEW BEST' : ''}${out.newVenues.map((nv) => `<div class="unlock">🔓 ${esc(nv.name)} unlocked!</div>`).join('')}</div>`;
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

  /** Every solo result: does it beat today's challenge? */
  async function onResult(r) {
    const p = profiles.current;
    if (!p || r.mode !== 'solo' || r.practice) return;
    const ch = daily();
    const me = r.players[0];
    if (!ch || dailyDone(p, ch.date) || r.song.id !== ch.songId || me.instrument !== ch.instrument || DIFFS.indexOf(me.difficulty) < DIFFS.indexOf(ch.difficulty)) return;
    if (!dailyMet(ch, me)) { ui.toast(`Daily challenge not quite: ${ch.text}`); return; }
    const out = await completeDaily(p, ch);
    if (!out) return;
    ui.toast(`📅 Daily challenge beaten! +${out.xp} XP · 🔥 ${out.streak}-day streak`, 'ok');
    for (const a of out.achievements) ui.toast(`🏆 ${a.name} — ${a.desc}`, 'ok');
  }

  ui.screenHooks.tour = async () => { if (!ui.songs.length) await ui.reloadSongs(); render(); };
  Object.assign(ui.actionHooks, {
    tour: () => ui.show('tour'),
    'tour-play': () => playGig(),
    'tour-daily': () => playDaily(),
  });
  ui.pickerHooks.push((which, d) => {
    if (which === 'tour-inst') { const i = INSTS.findIndex(([v]) => v === ui.instrument); ui.instrument = INSTS[(i + d + INSTS.length) % INSTS.length][0]; render(true); return true; }
    if (which === 'tour-diff') { const v = VENUES[st.venue]; st.diff = DIFFS[Math.max(minIdx(v), Math.min(3, DIFFS.indexOf(st.diff) + d))]; render(true); return true; }
    return false;
  });

  return { onResult, daily, render };
}
