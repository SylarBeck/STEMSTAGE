// Shared by every page: the phone menu, the screenshot viewer, and phone detection (STEMSTAGE is a PC game, so
// phones get "send it to my computer" instead of a download they can't run).
(() => {
  const html = document.documentElement;
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  window.stemstagePhone = phone;
  html.classList.toggle('phone', phone);

  // ---------------------------------------------------------------- phone menu
  const nav = document.querySelector('.nav');
  const btn = nav?.querySelector('.menu-btn');
  const setOpen = (on) => {
    if (!nav || !btn) return;
    nav.classList.toggle('open', on);
    document.body.classList.toggle('menu-open', on);
    btn.setAttribute('aria-expanded', String(on));
    btn.querySelector('span').textContent = on ? 'Close' : 'Menu';
    btn.querySelector('i').className = `fa-solid ${on ? 'fa-xmark' : 'fa-bars'}`;
  };
  btn?.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav?.querySelector('.nav-panel')?.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); closeShot(); } });
  matchMedia('(min-width: 1000px)').addEventListener?.('change', (m) => { if (m.matches) setOpen(false); });

  // ---------------------------------------------------------------- "send to my computer"
  /** Phones: the share sheet (mail it, message it to yourself). Computers, or phones without it: copy the link. */
  window.stemstageSend = async (el, url = location.href, title = document.title, text = title) => {
    const label = el.innerHTML;
    if (phone && navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); el.innerHTML = '<i class="fa-solid fa-check"></i> Link copied'; } catch { prompt('Copy this link:', url); return; }
    setTimeout(() => { el.innerHTML = label; }, 2200);
  };

  // ---------------------------------------------------------------- screenshots open full size
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = '<img alt=""><button type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>';
  function closeShot() { lb.classList.remove('open'); }
  lb.addEventListener('click', closeShot);
  document.addEventListener('click', (e) => {
    const shot = e.target.closest('.photo');
    if (!shot) return;
    e.preventDefault(); // photos are links to the full image, so they still work without this script
    const img = shot.querySelector('img');
    lb.querySelector('img').src = img.currentSrc || img.src;
    lb.querySelector('img').alt = img.alt;
    if (!lb.isConnected) document.body.appendChild(lb);
    lb.classList.add('open');
  });
})();
