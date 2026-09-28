// "Log in with Discord" for the website. OAuth2 implicit grant with scope identify (username + avatar, nothing
// else), same Discord application as the game. Discord sends the browser back to /login/ with a token; the token
// stays in this browser (localStorage) and the API checks it with Discord on every /v1/me call.
//
// Pages include this script and get:
//   - a Log in button (or your avatar + menu) in the nav's .links
//   - window.stemstageMe: a promise of { user, players: [{ playerId, name, total, charts }] } or null
//   - a 'stemstage:me' event on document with the same object as detail
(() => {
  const CLIENT_ID = '1553872601603117127';
  // Discord only accepts the exact redirect registered for the app: always the https site (a page opened over
  // http:// or through sylarbeck.github.io would otherwise send a different address). Local previews keep theirs.
  const HOME = 'https://stemstage.varconstint.com';
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!local && location.origin !== HOME) { location.replace(HOME + location.pathname + location.search + location.hash); return; }
  const SITE = local ? location.origin : HOME;
  const params = new URLSearchParams(location.search);
  const localApi = params.get('api');
  const API = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/v1$/.test(localApi || '') ? localApi : 'https://api.stemstage.varconstint.com/v1';
  const KEY = 'stemstage.web.discord';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.expires > Date.now() ? v : null; } catch { return null; } };
  const forget = () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(`${KEY}.me`); } catch { /* storage blocked */ } };

  function login() {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(`${KEY}.state`, JSON.stringify({ state, back: location.pathname + location.search })); } catch { /* storage blocked */ }
    const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'token', scope: 'identify', state, redirect_uri: `${SITE}/login/`, prompt: 'none' });
    location.assign(`https://discord.com/oauth2/authorize?${q}`);
  }

  async function whoAmI() {
    const s = read();
    if (!s) return null;
    try { const c = JSON.parse(sessionStorage.getItem(`${KEY}.me`) || 'null'); if (c && Date.now() - c.at < 120000) return c.me; } catch { /* no cache */ }
    const r = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${s.token}` } }).catch(() => null);
    if (!r) return null;
    if (r.status === 401) { forget(); return null; }
    if (!r.ok) return null;
    const me = await r.json();
    try { sessionStorage.setItem(`${KEY}.me`, JSON.stringify({ at: Date.now(), me })); } catch { /* storage blocked */ }
    return me;
  }

  const style = document.createElement('style');
  style.textContent = `
    .ss-auth { position: relative; display: flex; align-items: center; }
    .ss-auth button { display: inline-flex; align-items: center; gap: 8px; border: 0; cursor: pointer; font: 700 15px 'Rajdhani', system-ui, sans-serif; color: #fff; background: #5865f2; padding: 7px 14px; border-radius: 999px; white-space: nowrap; }
    .ss-auth button:hover { filter: brightness(1.1); }
    .ss-auth button.me { background: rgba(255,255,255,0.08); padding: 4px 12px 4px 4px; }
    .ss-auth img, .ss-auth .ini { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: #5865f2; font-weight: 800; }
    .ss-menu { position: absolute; right: 0; top: calc(100% + 8px); min-width: 230px; padding: 8px; border-radius: 14px; background: #120c22; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 60px rgba(0,0,0,0.6); z-index: 50; }
    .ss-menu[hidden] { display: none; }
    .ss-menu a, .ss-menu .ss-item { display: flex; gap: 10px; align-items: center; padding: 9px 10px; border-radius: 9px; color: #f4f1fb; font: 600 16px 'Rajdhani', system-ui, sans-serif; text-decoration: none; cursor: pointer; background: none; width: 100%; border: 0; text-align: left; }
    .ss-menu a:hover, .ss-menu .ss-item:hover { background: rgba(255,255,255,0.07); }
    .ss-menu small { display: block; color: #a79fbe; padding: 4px 10px 8px; font-size: 13px; }
    .ss-menu hr { border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 6px 0; }
    tr.mine td { background: rgba(88,101,242,0.16) !important; }
    li.mine { background: rgba(88,101,242,0.12); border-radius: 8px; padding-left: 8px !important; }
    @media (max-width: 760px) { .ss-auth .ss-name { display: none; } }`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'ss-auth';
  const mount = () => (document.querySelector('nav .links') || document.querySelector('nav') || document.body).appendChild(box);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  const discordIcon = '<i class="fa-brands fa-discord" aria-hidden="true"></i>';
  function renderOut() {
    box.innerHTML = `<button type="button">${discordIcon}<span class="ss-name">Log in</span></button>`;
    box.querySelector('button').onclick = login;
  }
  function renderIn(me) {
    const u = me.user;
    const name = u.globalName || u.username;
    box.innerHTML = `<button type="button" class="me" aria-haspopup="true">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="ini">${esc(name[0] || '?')}</span>`}<span class="ss-name">${esc(name)}</span></button>
      <div class="ss-menu" hidden>
        <small>${discordIcon} Logged in as @${esc(u.username)}</small>
        ${me.players.length ? me.players.map((p) => `<a href="/player/?id=${encodeURIComponent(p.playerId)}"><i class="fa-solid fa-user"></i> ${esc(p.name)}<span style="margin-left:auto;color:#a79fbe">${Number(p.total).toLocaleString()}</span></a>`).join('')
          : '<small>No STEMSTAGE profile is linked to this Discord account yet. In the game: Career → Link Discord, then play a song or press Share profile.</small>'}
        <a href="/leaderboard/"><i class="fa-solid fa-ranking-star"></i> Leaderboard</a>
        <hr><button class="ss-item" type="button" data-out><i class="fa-solid fa-right-from-bracket"></i> Log out</button>
      </div>`;
    const menu = box.querySelector('.ss-menu');
    box.querySelector('button.me').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) menu.hidden = true; });
    box.querySelector('[data-out]').onclick = () => { forget(); location.reload(); };
  }

  renderOut();
  window.stemstageMe = whoAmI().then((me) => {
    if (me) renderIn(me);
    document.dispatchEvent(new CustomEvent('stemstage:me', { detail: me }));
    return me;
  });
})();
