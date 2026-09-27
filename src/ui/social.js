// Profile sign-in, career page, leaderboards and the XP/achievement block on the results screen.
import { profiles, PROFILE_COLORS, ACHIEVEMENTS, levelInfo } from '../profile/profiles.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
import { instIcon, fa, starsOnly, achIcon } from './icons.js';
import { discord, discordAvatar, STATUS_LABEL } from '../net/discord.js';
const ICON = { guitar: instIcon('guitar'), bass: instIcon('bass'), drums: instIcon('drums'), keys: instIcon('keys'), vocals: instIcon('vocals') };
const DIFFS = ['easy', 'medium', 'hard', 'expert'];
const INSTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
const ago = (t) => {
  const d = (Date.now() - t) / 1000;
  if (d < 90) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

// a linked Discord account shows its avatar (the initials stay underneath in case it can't load)
export const avatarHtml = (p, size = 40) => `<span class="avatar" style="--pc:${p?.color || '#555'};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc(initials(p?.name || 'G'))}${p?.discord ? `<img src="${discordAvatar(p.discord, size > 64 ? 256 : 64)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
const dcIcon = '<i class="fa-brands fa-discord" aria-hidden="true"></i>';

export function installSocial(ui) {
  const state = { formColor: PROFILE_COLORS[0], pinFor: null, lbTab: 'overall', lbSong: 0, lbInst: 'guitar', lbDiff: 'expert', careerId: null, afterSignIn: 'menu', careerTab: 'overview' };
  const CAREER_TABS = [['overview', 'Overview'], ['history', 'History'], ['achievements', 'Achievements']];

  // ---------------------------------------------------------------- profiles screen
  function renderProfiles() {
    $('#profile-form').hidden = true;
    $('#pin-pad').hidden = true;
    const grid = $('#profile-grid');
    grid.hidden = false;
    grid.innerHTML = profiles.list.map((p) => {
      const lv = levelInfo(p.xp);
      return `<div class="profile-card" data-nav data-profile="${p.id}" style="--pc:${p.color}">${avatarHtml(p, 84)}<b>${esc(p.name)}</b><span>Level ${lv.level} · ${esc(lv.rank)}${p.pinHash ? ` · ${fa('lock')}` : ''}${p.discord ? ` · ${dcIcon}` : ''}</span></div>`;
    }).join('') + `<div class="profile-card add" data-nav data-action="pf-new">${'<span class="avatar" style="width:84px;height:84px;font-size:40px">+</span>'}<b>New profile</b><span>Name, colour, optional PIN</span></div>
      <div class="profile-card add" data-nav data-action="pf-guest"><span class="avatar" style="width:84px;height:84px;font-size:30px">?</span><b>Guest</b><span>Nothing is saved</span></div>`;
    $$('[data-profile]', grid).forEach((c) => c.addEventListener('click', () => pick(c.dataset.profile)));
    $$('[data-action]', grid).forEach((c) => c.addEventListener('click', () => ui.action(c.dataset.action)));
    ui.focus = 0;
    ui.applyFocus(false);
  }

  async function pick(id) {
    const p = profiles.byId(id);
    if (!p) return;
    if (p.pinHash) {
      state.pinFor = id;
      $('#profile-grid').hidden = true;
      $('#pin-pad').hidden = false;
      $('#pin-title').textContent = `PIN for ${p.name}`;
      $('#pin-error').textContent = '';
      $('#pin-input').value = '';
      if (ui.family === 'keyboard') setTimeout(() => $('#pin-input').focus(), 50);
      else setTimeout(() => ui.editText($('#pin-input')), 60);
      ui.focus = 0;
      ui.applyFocus(false);
      return;
    }
    await profiles.signIn(id);
    signedIn();
  }

  function signedIn() {
    ui.toast(`Signed in as ${profiles.current.name}`, 'ok');
    ui.refreshStatus();
    ui.show(state.afterSignIn || 'menu');
  }

  function showForm() {
    $('#profile-grid').hidden = true;
    $('#profile-form').hidden = false;
    $('#pf-error').textContent = '';
    $('#pf-name').value = '';
    $('#pf-pin').value = '';
    state.formColor = PROFILE_COLORS[profiles.list.length % PROFILE_COLORS.length];
    $('#pf-colors').innerHTML = PROFILE_COLORS.map((c) => `<div class="swatch ${c === state.formColor ? 'sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
    $$('#pf-colors .swatch').forEach((s) => s.addEventListener('click', () => {
      state.formColor = s.dataset.c;
      $$('#pf-colors .swatch').forEach((x) => x.classList.toggle('sel', x === s));
    }));
    if (ui.family === 'keyboard') setTimeout(() => $('#pf-name').focus(), 50);
    ui.focus = 0;
    ui.applyFocus(false);
  }

  async function saveForm() {
    const name = $('#pf-name').value.trim();
    const pin = $('#pf-pin').value.trim();
    if (pin && !/^\d{4,8}$/.test(pin)) { $('#pf-error').textContent = 'PIN must be 4-8 digits'; return; }
    try {
      const p = await profiles.create({ name, color: state.formColor, pin });
      await profiles.signIn(p.id, pin);
      signedIn();
    } catch (e) { $('#pf-error').textContent = e.message; }
  }

  async function submitPin() {
    try {
      await profiles.signIn(state.pinFor, $('#pin-input').value.trim());
      signedIn();
    } catch (e) { $('#pin-error').textContent = e.message; $('#pin-input').select(); }
  }

  $('#pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitPin(); } });
  $('#pf-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveForm(); } });
  $('#pf-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pf-pin').focus(); } });

  // ---------------------------------------------------------------- career
  function renderCareer() {
    const id = state.careerId || profiles.current?.id;
    const root = $('#career');
    const c = id && profiles.career(id);
    if (!c) {
      root.innerHTML = `<div class="card"><h3>No profile</h3><p class="small-note">Sign in to track your career: XP, levels, achievements, history and leaderboards.</p><div class="btn-row"><button class="nav-btn primary" data-nav data-action="profiles">Sign in / create profile</button></div></div>`;
      $$('[data-action]', root).forEach((b) => b.addEventListener('click', () => ui.action(b.dataset.action)));
      ui.applyFocus(false);
      return;
    }
    const { profile: p, level: lv, totals: t, byInst, recent, topScores } = c;
    const mine = profiles.current?.id === p.id;
    root.dataset.tab = state.careerTab; // the big profile header only shows on Overview
    root.innerHTML = `
      <div class="career-head" style="--pc:${p.color}">
        ${avatarHtml(p, 96)}
        <div><h2>${esc(p.name)}</h2><div class="rank">LEVEL ${lv.level} · ${esc(lv.rank.toUpperCase())}</div>
          <div class="xpbar"><div style="width:${Math.round(lv.progress * 100)}%"></div></div>
          <small>${lv.into.toLocaleString()} / ${lv.span.toLocaleString()} XP to level ${lv.level + 1} · ${p.xp.toLocaleString()} XP total</small>
          ${p.discord ? `<div class="dc-line">${dcIcon}<b>${esc(p.discord.globalName || p.discord.username || 'Discord')}</b>${p.discord.username ? `<small>@${esc(p.discord.username)}</small>` : ''}<span class="dc-status" data-s="unknown"><i></i><em>checking…</em></span><span class="dc-activity"></span></div>` : ''}</div>
        <div class="actions">
          <button class="nav-btn" data-nav data-action="profiles">Switch profile</button>
          ${mine ? '<button class="nav-btn" data-nav data-action="pf-signout">Sign out</button><button class="nav-btn" data-nav data-action="pf-pin">Set PIN</button>' : ''}
          ${mine ? `<button class="nav-btn discord" data-nav data-action="pf-discord">${dcIcon} ${p.discord ? 'Unlink Discord' : 'Link Discord'}</button>` : ''}
          ${mine ? '<button class="nav-btn danger" data-nav data-action="pf-delete">Delete</button>' : ''}
        </div>
      </div>
      <div class="picker row career-tabs" data-nav data-picker="career-tab"><label>View</label><div class="picker-options">${CAREER_TABS.map(([v, l]) => `<div class="opt ${state.careerTab === v ? 'sel' : ''}" data-ct="${v}">${l}</div>`).join('')}</div></div>
      <div class="career-page" data-page="overview" ${state.careerTab === 'overview' ? '' : 'hidden'}>
      <div class="tiles">
        ${[['Songs played', t.plays], ['Different songs', t.songs], ['Career score', t.score.toLocaleString()], ['Notes hit', t.notes.toLocaleString()],
    ['Stars earned', t.stars], ['Full combos', t.fcs], ['Best streak', t.bestStreak], ['Avg accuracy', `${Math.round(t.accuracy * 100)}%`],
    ['Time played', fmtDur(t.seconds)], ['Achievements', `${Object.keys(p.achievements || {}).length}/${ACHIEVEMENTS.length}`], ['Favourite', c.favorite ? `${ICON[c.favorite]} ${c.favorite}` : '—']]
    .map(([l, v]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="career-cols">
        <div class="card"><h3>Instruments</h3><table class="tbl"><tr><th>Instrument</th><th>Plays</th><th>Best</th><th>Accuracy</th><th>FCs</th></tr>
          ${INSTS.map((i) => { const s = byInst[i]; return `<tr><td>${ICON[i]} ${i}</td><td>${s?.plays || 0}</td><td>${s ? s.best.toLocaleString() : '—'}</td><td>${s ? `${Math.round(s.acc * 100)}%` : '—'}</td><td>${s?.fcs || 0}</td></tr>`; }).join('')}
        </table></div>
        <div class="card"><h3>Top scores</h3><table class="tbl"><tr><th>Song</th><th>Part</th><th>Score</th><th>Stars</th></tr>
          ${topScores.map((x) => `<tr><td>${esc(x.songTitle)}</td><td>${ICON[x.instrument]} ${x.difficulty[0].toUpperCase()}</td><td>${x.score.toLocaleString()}</td><td>${starsOnly(x.stars)}${x.fc ? ` ${fa('gem')}` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="small-note">No plays yet</td></tr>'}
        </table></div>
      </div>
      </div>
      <div class="career-page" data-page="history" ${state.careerTab === 'history' ? '' : 'hidden'}>
      <div class="card"><h3>Recent</h3><table class="tbl"><tr><th>When</th><th>Song</th><th>Part</th><th>Mode</th><th>Score</th><th>Accuracy</th><th>Streak</th></tr>
        ${recent.map((x) => `<tr><td>${ago(x.date)}</td><td>${esc(x.songTitle)} <small>${esc(x.songArtist || '')}</small></td><td>${ICON[x.instrument]} ${x.instrument} · ${x.difficulty}</td><td>${x.mode}</td><td>${x.score.toLocaleString()}${x.failed ? ' <small>(failed)</small>' : ''}</td><td>${Math.round(x.accuracy * 100)}%</td><td>${x.maxStreak}</td></tr>`).join('') || '<tr><td colspan="7" class="small-note">Play a song to start your career.</td></tr>'}
      </table></div>
      </div>
      <div class="career-page" data-page="achievements" ${state.careerTab === 'achievements' ? '' : 'hidden'}>
      <div class="card"><h3>Achievements</h3><div class="ach-grid">
        ${ACHIEVEMENTS.map((a) => `<div class="ach ${p.achievements?.[a.id] ? 'on' : ''}" title="${p.achievements?.[a.id] ? `Unlocked ${new Date(p.achievements[a.id]).toLocaleDateString()}` : 'Locked'}"><span class="i">${achIcon(a.id)}</span><div><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div></div>`).join('')}
      </div></div></div>`;
    $$('[data-action]', root).forEach((b) => b.addEventListener('click', () => ui.action(b.dataset.action)));
    $$('[data-ct]', root).forEach((o) => o.addEventListener('click', () => { state.careerTab = o.dataset.ct; renderCareer(); }));
    ui.focus = 0;
    ui.applyFocus(false);
    if (p.discord) showPresence(p);
  }

  /** Fill in the linked account's live Discord status (and keep it fresh while the career page is open). */
  async function showPresence(p, fresh = false) {
    clearTimeout(state.dcTimer);
    const pr = await discord.presence(p.discord.id, { fresh });
    const line = $('#career .dc-line');
    if (!line || ui.screen !== 'career') return;
    const st = line.querySelector('.dc-status'), act = line.querySelector('.dc-activity');
    if (pr.ok) {
      st.dataset.s = pr.status;
      st.querySelector('em').textContent = STATUS_LABEL[pr.status] || pr.status;
      const bits = [];
      if (pr.custom?.text || pr.custom?.emoji) bits.push(esc(`${pr.custom.emoji || ''} ${pr.custom.text || ''}`.trim()));
      if (pr.playing) bits.push(`Playing <b>${esc(pr.playing.name)}</b>${pr.playing.details ? ` · ${esc(pr.playing.details)}` : ''}`);
      else if (pr.listening) bits.push(`Listening to <b>${esc(pr.listening.song)}</b> · ${esc(pr.listening.artist)}`);
      act.innerHTML = bits.join(' · ');
      // keep the stored name / avatar in step with Discord
      const u = pr.user;
      if (u && profiles.current?.id === p.id && (u.avatar !== p.discord.avatar || u.username !== p.discord.username || u.globalName !== p.discord.globalName)) profiles.setDiscord(p.id, u);
    } else {
      st.dataset.s = 'unknown';
      st.querySelector('em').textContent = pr.error === 'not_monitored' ? 'status hidden' : 'status unavailable';
      act.textContent = pr.error === 'not_monitored' ? 'Join the Lanyard Discord server (discord.gg/lanyard) to show your live status here' : '';
    }
    state.dcTimer = setTimeout(() => { if (ui.screen === 'career' && profiles.byId(p.id)?.discord) showPresence(profiles.byId(p.id), true); }, 30000);
  }

  /** Link Discord: "Log in with Discord" (OAuth). The page goes to discord.com and comes back (finishDiscordLogin). */
  async function linkDiscord() {
    const p = profiles.current;
    if (!p) return;
    if (p.discord) {
      if (!(await ui.confirmDialog('Unlink Discord?', `${p.name} stops showing ${p.discord.globalName || p.discord.username || 'the Discord account'}.`, 'Unlink'))) return;
      await profiles.setDiscord(p.id, null);
      ui.toast('Discord unlinked');
      renderCareer();
      return;
    }
    if (!(await ui.confirmDialog('Log in with Discord?', 'Discord opens so you can sign in and allow STEMSTAGE to see your username and avatar (nothing else). You come back here afterwards.', 'Continue'))) return;
    try { discord.login(p.id); } catch (e) { ui.toast(e.message, 'err'); }
  }

  /** Back from the Discord login (start-up): link the account to the profile that asked for it. */
  async function finishDiscordLogin() {
    const r = await discord.finishLogin();
    if (!r) return;
    if (r.error) { ui.toast(r.error, 'err'); return; }
    const p = profiles.byId(r.profileId);
    if (!p) return;
    await profiles.setDiscord(p.id, r.user);
    ui.toast(`Discord linked: ${r.user.globalName || r.user.username}`, 'ok');
    if (profiles.current?.id === p.id) { state.careerId = null; state.careerTab = 'overview'; ui.show('career'); }
  }

  // ---------------------------------------------------------------- leaderboards
  function renderLeaderboard() {
    $('#lb-tabs').innerHTML = [['overall', 'Overall'], ['songs', 'Songs']].map(([v, l]) => `<div class="opt ${state.lbTab === v ? 'sel' : ''}" data-v="${v}">${l}</div>`).join('');
    $$('#lb-tabs .opt').forEach((o) => o.addEventListener('click', () => { state.lbTab = o.dataset.v; renderLeaderboard(); }));
    const filters = $('#lb-filters');
    const content = $('#lb-content');
    const meId = profiles.current?.id;
    if (state.lbTab === 'overall') {
      filters.innerHTML = '';
      const rows = profiles.globalBoard();
      content.innerHTML = `<div class="card"><table class="tbl"><tr><th>#</th><th>Player</th><th>Level</th><th>Total score</th><th>Stars</th><th>FCs</th><th>Plays</th><th>Achievements</th></tr>
        ${rows.map((r, i) => `<tr class="${r.profile.id === meId ? 'me' : ''}"><td>${i + 1}</td><td>${avatarHtml(r.profile, 24)} ${esc(r.profile.name)}</td><td>${r.level.level} <small>${esc(r.level.rank)}</small></td><td>${r.totalScore.toLocaleString()}</td><td>${r.stars}</td><td>${r.fcs}</td><td>${r.plays}</td><td>${r.achievements}</td></tr>`).join('') || '<tr><td colspan="8" class="small-note">No profiles yet.</td></tr>'}
      </table><p class="small-note">Total score adds up each player's best score on every chart.</p></div>`;
    } else {
      const songs = ui.songs;
      if (!songs.length) { filters.innerHTML = ''; content.innerHTML = '<div class="card small-note">No songs yet.</div>'; ui.applyFocus(false); return; }
      state.lbSong = Math.max(0, Math.min(songs.length - 1, state.lbSong));
      const s = songs[state.lbSong];
      filters.innerHTML = `
        <div class="picker" data-nav data-picker="lb-song"><label>Song</label><div class="picker-options"><div class="opt sel">${esc(s.title)} — ${esc(s.artist)}</div></div></div>
        <div class="picker" data-nav data-picker="lb-inst"><label>Instrument</label><div class="picker-options">${INSTS.map((i) => `<div class="opt ${i === state.lbInst ? 'sel' : ''} ${s.charts[i]?.available ? '' : 'disabled'}" data-i="${i}">${ICON[i]} ${i}</div>`).join('')}</div></div>
        <div class="picker" data-nav data-picker="lb-diff"><label>Difficulty</label><div class="picker-options">${DIFFS.map((d) => `<div class="opt ${d === state.lbDiff ? 'sel' : ''}" data-d="${d}">${d}</div>`).join('')}</div></div>`;
      $$('[data-i]', filters).forEach((o) => o.addEventListener('click', () => { state.lbInst = o.dataset.i; renderLeaderboard(); }));
      $$('[data-d]', filters).forEach((o) => o.addEventListener('click', () => { state.lbDiff = o.dataset.d; renderLeaderboard(); }));
      const rows = profiles.leaderboard(s.id, state.lbInst, state.lbDiff, 25);
      content.innerHTML = `<div class="card"><table class="tbl"><tr><th>#</th><th>Player</th><th>Score</th><th>Stars</th><th>Accuracy</th><th>Streak</th><th>Mode</th><th>When</th></tr>
        ${rows.map((r, i) => `<tr class="${r.profileId === meId ? 'me' : ''}"><td>${i + 1}</td><td>${avatarHtml(r.profile, 24)} ${esc(r.profileName)}</td><td>${r.score.toLocaleString()}</td><td>${starsOnly(r.stars)}${r.fc ? ` ${fa('gem')}` : ''}</td><td>${Math.round(r.accuracy * 100)}%</td><td>${r.maxStreak}</td><td>${r.mode}</td><td>${ago(r.date)}</td></tr>`).join('') || '<tr><td colspan="8" class="small-note">No scores on this chart yet.</td></tr>'}
      </table></div>`;
    }
    ui.applyFocus(false);
  }

  function lbPicker(which, d) {
    if (which === 'lb-tab') state.lbTab = state.lbTab === 'overall' ? 'songs' : 'overall';
    if (which === 'lb-song') state.lbSong = (state.lbSong + d + ui.songs.length) % Math.max(1, ui.songs.length);
    if (which === 'lb-inst') state.lbInst = INSTS[(INSTS.indexOf(state.lbInst) + d + INSTS.length) % INSTS.length];
    if (which === 'lb-diff') state.lbDiff = DIFFS[Math.max(0, Math.min(3, DIFFS.indexOf(state.lbDiff) + d))];
    renderLeaderboard();
  }

  // ---------------------------------------------------------------- results: XP + achievements
  async function recordResults(r) {
    const el = $('#res-progress');
    el.innerHTML = '';
    if (r.practice) { el.innerHTML = '<div class="small-note">Practice run — nothing saved.</div>'; return; }
    const results = r.players.filter((p) => p.profileId);
    if (!results.length) {
      el.innerHTML = profiles.list.length || !profiles.current ? '<div class="small-note">Playing as guest — sign in to save scores, XP and achievements.</div>' : '';
      return;
    }
    const summaries = await profiles.recordPlays(results, { song: r.song, mode: r.mode, onlineWinnerId: r.onlineWinnerId, bandSize: r.players.length, ghost: r.ghost });
    el.innerHTML = summaries.map((s) => {
      const p = profiles.byId(s.profileId);
      const lv = levelInfo(p.xp);
      return `<div class="rp-prof" style="--pc:${p.color}">${avatarHtml(p, 40)}<div class="info"><b>${esc(p.name)}</b> +${s.xpGained} XP · level ${lv.level} ${s.levelAfter > s.levelBefore ? '<span class="lvlup">LEVEL UP!</span>' : ''}
        <div class="xpbar"><div style="width:${Math.round(lv.progress * 100)}%"></div></div>
        ${s.achievements.length ? `<div class="rp-ach">${s.achievements.map((a) => `<span>${achIcon(a.id)} ${esc(a.name)}</span>`).join('')}</div>` : ''}</div></div>`;
    }).join('');
    for (const s of summaries) for (const a of s.achievements) ui.toast(`${s.name}: ${a.name} — ${a.desc}`, 'ok', 'trophy');
  }

  // ---------------------------------------------------------------- wiring
  ui.screenHooks.profiles = renderProfiles;
  ui.screenHooks.career = renderCareer;
  ui.screenHooks.leaderboard = renderLeaderboard;
  Object.assign(ui.actionHooks, {
    profiles: () => { state.afterSignIn = ui.screen === 'title' ? 'menu' : (ui.screen === 'profiles' ? 'menu' : ui.screen); ui.show('profiles'); },
    career: () => { state.careerId = null; ui.show('career'); },
    leaderboard: () => ui.show('leaderboard'),
    'pf-new': showForm,
    'pf-save': saveForm,
    'pf-cancel': renderProfiles,
    'pf-guest': () => { profiles.signOut(); ui.refreshStatus(); ui.show(state.afterSignIn || 'menu'); ui.toast('Playing as guest'); },
    'pin-ok': submitPin,
    'pin-cancel': renderProfiles,
    'pf-discord': linkDiscord,
    'pf-signout': () => { profiles.signOut(); ui.refreshStatus(); ui.show('profiles'); },
    'pf-pin': async () => {
      const p = profiles.current;
      if (!p) return;
      const oldPin = p.pinHash ? await ui.osk.show({ title: 'Current PIN', type: 'number', password: true, max: 8 }) : '';
      if (p.pinHash && oldPin === null) return;
      const next = await ui.osk.show({ title: 'New PIN', hint: '4-8 digits — leave empty to remove the PIN', type: 'number', password: true, max: 8 });
      if (next === null) return;
      if (next && !/^\d{4,8}$/.test(next)) { ui.toast('PIN must be 4-8 digits', 'err'); return; }
      try { await profiles.setPin(p.id, oldPin, next); ui.toast(next ? 'PIN set' : 'PIN removed', 'ok'); renderCareer(); } catch (e) { ui.toast(e.message, 'err'); }
    },
    'pf-delete': async () => {
      const p = profiles.current;
      if (!p || !(await ui.confirmDialog(`Delete profile "${p.name}"?`, 'Its play history stays in the leaderboard files, but the profile is gone.', 'Delete'))) return;
      const pin = p.pinHash ? await ui.osk.show({ title: 'PIN', type: 'number', password: true, max: 8 }) : '';
      if (pin === null) return;
      try { await profiles.remove(p.id, pin); ui.toast('Profile deleted'); ui.show('profiles'); } catch (e) { ui.toast(e.message, 'err'); }
    },
  });
  ui.pickerHooks.push((which, d) => {
    if (which === 'career-tab') {
      const i = CAREER_TABS.findIndex(([v]) => v === state.careerTab);
      state.careerTab = CAREER_TABS[(i + d + CAREER_TABS.length) % CAREER_TABS.length][0];
      renderCareer();
      ui.focus = Math.max(0, ui.navItems().findIndex((x) => x.dataset.picker === 'career-tab'));
      ui.applyFocus(false);
      return true;
    }
    if (which.startsWith('lb-')) { lbPicker(which, d); return true; }
    if (which === 'pf-color') {
      state.formColor = PROFILE_COLORS[(PROFILE_COLORS.indexOf(state.formColor) + d + PROFILE_COLORS.length) % PROFILE_COLORS.length];
      $$('#pf-colors .swatch').forEach((x) => x.classList.toggle('sel', x.dataset.c === state.formColor));
      return true;
    }
    return false;
  });
  ui.navHooks.push((dir) => {
    if (ui.screen !== 'profiles' || dir !== 'back') return false;
    if (!$('#profile-form').hidden || !$('#pin-pad').hidden) { renderProfiles(); return true; }
    return false;
  });

  return { recordResults, renderCareer, finishDiscordLogin, openCareer: (id) => { state.careerId = id; ui.show('career'); } };
}
