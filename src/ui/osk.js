// On-screen keyboard: text entry with a controller. D-pad moves, confirm types, back deletes,
// alt (△ / Y) = space, alt2 (▢ / X) = shift, start = done. A physical keyboard can type too.
const LAYOUTS = {
  text: ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_.@'],
  number: ['123', '456', '789', '0'],
  address: ['123', '456', '789', '.0:'],
};

export class Osk {
  constructor(ui) {
    this.ui = ui;
    this.el = document.getElementById('osk');
    this.open = false;
    this.shift = false;
    this._onKey = (e) => this._physical(e);
  }

  /** opts: { title, value, type: 'text'|'number'|'address', max, password, hint } → Promise<string|null> */
  show(opts = {}) {
    if (this.open) this._finish(null);
    const ui = this.ui;
    if (!ui.sheet) ui._saved = { screen: ui.screen, index: ui.focus, el: ui.navItems()[ui.focus] };
    this.opts = { type: 'text', max: 60, ...opts };
    this.value = String(opts.value ?? '');
    this.shift = false;
    this.open = true;
    this.el.hidden = false;
    this.render();
    window.addEventListener('keydown', this._onKey, true);
    this.ui.focus = this.ui.navItems().findIndex((x) => x.dataset.k === (this.opts.type === 'text' ? 'q' : '1'));
    this.ui.applyFocus(false);
    this.ui.refreshLegend();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  render() {
    const o = this.opts;
    const rows = LAYOUTS[o.type] || LAYOUTS.text;
    const shown = o.password ? '•'.repeat(this.value.length) : this.value;
    this.el.innerHTML = `
      <div class="osk-card">
        <div class="osk-title">${esc(o.title || 'Enter text')}</div>
        <div class="osk-field"><span>${esc(shown)}</span><i class="osk-caret"></i></div>
        ${o.hint ? `<div class="osk-hint">${esc(o.hint)}</div>` : ''}
        <div class="osk-keys">
          ${rows.map((r) => `<div class="osk-row">${[...r].map((c) => {
            const ch = this.shift ? c.toUpperCase() : c;
            return `<button class="osk-key" data-nav data-k="${esc(c)}">${esc(ch)}</button>`;
          }).join('')}</div>`).join('')}
          <div class="osk-row">
            ${o.type === 'text' ? `<button class="osk-key wide ${this.shift ? 'on' : ''}" data-nav data-k="@shift">⇧ Shift</button><button class="osk-key space" data-nav data-k="@space">Space</button>` : ''}
            <button class="osk-key wide" data-nav data-k="@bksp">⌫</button>
            <button class="osk-key wide done" data-nav data-k="@done">Done</button>
          </div>
        </div>
      </div>`;
    for (const b of this.el.querySelectorAll('[data-k]')) b.addEventListener('click', (e) => { e.stopPropagation(); this.press(b.dataset.k); });
  }

  press(k) {
    if (k === '@done') { this._finish(this.value); return; }
    if (k === '@bksp') this.value = this.value.slice(0, -1);
    else if (k === '@space') this._type(' ');
    else if (k === '@shift') { this.shift = !this.shift; }
    else this._type(this.shift ? k.toUpperCase() : k);
    this._refresh();
  }

  _type(ch) {
    if (this.value.length >= this.opts.max) return;
    this.value += ch;
    this.ui.app.engine.sfxUi?.('move');
  }

  _refresh() {
    const keep = this.ui.navItems()[this.ui.focus]?.dataset.k;
    this.render();
    const idx = this.ui.navItems().findIndex((x) => x.dataset.k === keep);
    if (idx >= 0) this.ui.focus = idx;
    this.ui.applyFocus(false);
  }

  /** Menu navigation while open. Returns true when handled here. */
  nav(dir) {
    if (dir === 'back') {
      if (!this.value.length) this._finish(null);
      else { this.value = this.value.slice(0, -1); this._refresh(); }
      return true;
    }
    if (dir === 'alt') { if (this.opts.type === 'text') { this._type(' '); this._refresh(); } return true; }
    if (dir === 'alt2') { if (this.opts.type === 'text') { this.shift = !this.shift; this._refresh(); } return true; }
    if (dir === 'start') { this._finish(this.value); return true; }
    if (dir === 'select' || dir === 'pgup' || dir === 'pgdn' || dir === 'prev' || dir === 'next') return true;
    return false;
  }

  _physical(e) {
    if (!this.open) return;
    if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); e.stopPropagation(); this._finish(this.value); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._finish(null); return; }
    if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); this.value = this.value.slice(0, -1); this._refresh(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const allowed = this.opts.type === 'number' ? /\d/ : this.opts.type === 'address' ? /[\d.:a-z-]/i : /./;
      e.preventDefault(); e.stopPropagation();
      if (allowed.test(e.key)) { this._type(e.key); this._refresh(); }
    }
  }

  _finish(result) {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    this.el.innerHTML = '';
    window.removeEventListener('keydown', this._onKey, true);
    const r = this.resolve;
    this.resolve = null;
    this.ui.navLock = performance.now() + 200;
    this.ui.restoreFocus?.();
    this.ui.refreshLegend();
    r?.(result);
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
