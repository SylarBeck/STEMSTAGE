// "Log in with Discord" for the website. OAuth2 implicit grant with scope identify (username + avatar, nothing
// else), same Discord application as the game. Discord sends the browser back to /login/ with a token; the token
// stays in this browser (localStorage) and the API checks it with Discord on every /v1/me call.
//
// Pages include this script and get:
//   - a Log in button (or your avatar + menu) at the right of the nav
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
    .ss-auth > button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; min-width: 42px; border: 0; border-radius: 2px; cursor: pointer; font: 800 16px 'Barlow Condensed', system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; background: #5865f2; padding: 6px 12px; white-space: nowrap; }
    .ss-auth > button i { font-size: 18px; }
    .ss-auth > button:hover { filter: brightness(1.12); }
    .ss-auth > button.me { background: transparent; border: 2px solid rgba(236,229,211,0.26); color: #ece5d3; padding: 3px 10px 3px 3px; letter-spacing: 0.02em; }
    .ss-auth img, .ss-auth .ini { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: #5865f2; font-weight: 800; color: #fff; flex: none; }
    .ss-menu { position: absolute; right: 0; top: calc(100% + 10px); width: min(300px, calc(100vw - 24px)); padding: 8px; border-radius: 0; background: #1a1714; border: 1px solid rgba(236,229,211,0.2); border-top: 5px solid #df3a2c; box-shadow: 0 20px 60px rgba(0,0,0,0.7); z-index: 50; }
    .ss-menu[hidden] { display: none; }
    .ss-menu a, .ss-menu .ss-item { display: flex; gap: 10px; align-items: center; min-height: 44px; padding: 8px 10px; color: #ece5d3; font: 700 18px 'Barlow Condensed', system-ui, sans-serif; text-decoration: none; cursor: pointer; background: none; width: 100%; border: 0; text-align: left; }
    .ss-menu a:hover, .ss-menu .ss-item:hover { background: #ece5d3; color: #15120e; }
    .ss-menu small { display: block; color: #a59d8b; padding: 4px 10px 8px; font: 500 15px 'Barlow Condensed', system-ui, sans-serif; }
    .ss-menu hr { border: 0; border-top: 1px solid rgba(236,229,211,0.12); margin: 6px 0; }
    @media (max-width: 999px) {
      .ss-auth .ss-name { display: none; } .ss-auth > button.me { padding: 3px; }
      /* phones: the avatar sits mid-bar, so a menu hung off it would run off the left edge. Drop it full width under the nav instead */
      .ss-menu { position: fixed; left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right)); top: calc(var(--nav-h, 60px) + env(safe-area-inset-top) + 6px); width: auto; max-height: calc(100svh - var(--nav-h, 60px) - 24px); overflow-y: auto; }
    }`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'ss-auth';
  const mount = () => { const right = document.querySelector('.nav .right'); if (right) right.prepend(box); else (document.querySelector('nav') || document.body).appendChild(box); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  const discordIcon = '<i class="fa-brands fa-discord" aria-hidden="true"></i>';
  function renderOut() {
    box.innerHTML = `<button type="button" aria-label="Log in with Discord">${discordIcon}<span class="ss-name">Log in</span></button>`;
    box.querySelector('button').onclick = login;
  }
  function renderIn(me) {
    const u = me.user;
    const name = u.globalName || u.username;
    box.innerHTML = `<button type="button" class="me" aria-haspopup="true" aria-label="${esc(name)}: your profiles">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="ini">${esc(name[0] || '?')}</span>`}<span class="ss-name">${esc(name)}</span></button>
      <div class="ss-menu" hidden>
        <small>${discordIcon} Logged in as @${esc(u.username)}</small>
        ${me.players.length ? me.players.map((p) => `<a href="/player/?id=${encodeURIComponent(p.playerId)}"><i class="fa-solid fa-user"></i> ${esc(p.name)}<span style="margin-left:auto;opacity:.7">${Number(p.total).toLocaleString()}</span></a>`).join('')
          : '<small>No STEMSTAGE profile is linked to this Discord account yet. In the game: Career → Link Discord, then play a song or press Share profile.</small>'}
        <a href="/leaderboard/"><i class="fa-solid fa-ranking-star"></i> Leaderboard</a>
        <hr><button class="ss-item" type="button" data-out><i class="fa-solid fa-right-from-bracket"></i> Log out</button>
      </div>`;
    const menu = box.querySelector('.ss-menu');
    box.querySelector('button.me').onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) document.querySelector('.nav.open .menu-btn')?.click(); // one menu open at a time
    };
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) menu.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true; });
    box.querySelector('[data-out]').onclick = () => { forget(); location.reload(); };
  }

  renderOut();
  window.stemstageMe = whoAmI().then((me) => {
    if (me) renderIn(me);
    document.dispatchEvent(new CustomEvent('stemstage:me', { detail: me }));
    return me;
  });
})();
