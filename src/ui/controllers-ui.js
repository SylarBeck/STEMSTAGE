// Controllers hub: every connected device with its picture and live input, its config profile
// (pick / create / rename / delete / reset), per-profile options, bindings, DualSense tools and
// the button-map wizard for non-standard controllers.
import { controllerSvg, controllerPicture, detectController, paintArt, KIND_LABEL, LANE_COLORS } from './controller-art.js';
import { bindings, ACTIONS, ACTION_LABELS, OPTION_SCHEMA, srcLabel, sameSrc } from '../input/bindings.js';
import { padName, isDualSensePad } from '../input/input.js';
import { Trigger } from '../input/dualsense.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DRUM_KEY_COLORS = ['#ff8a1a', '#f2332b', '#ffd21f', '#2f84f0', '#2ed24f'];

export function installControllers(ui) {
  const app = ui.app, input = app.input, ds = app.ds;
  const st = { sel: null, mode: 'five', artFor: null, capturing: false, mapping: false };

  // ---------------------------------------------------------------- model
  function devices() {
    return input.listDevices().map((d) => ({ ...d, det: detectController(d, bindings.baseOf(d.profileKey)) }));
  }
  function selected(list = devices()) {
    return list.find((d) => d.id === st.sel) || list.find((d) => d.pad?.hid) || list.find((d) => d.kind === 'pad') || list[0];
  }
  const profileName = (key) => bindings.label(key, padName);
  const dsDeviceFor = (d) => (d?.pad?.hid ? ds.deviceForPad(d.pad) : null);

  function connectionText(d) {
    if (d.kind === 'key') return d.id === 'kb2' ? 'Second keyboard layout (for two players on one keyboard)' : 'Keyboard';
    if (d.kind === 'midi') return 'MIDI input';
    const dev = dsDeviceFor(d);
    if (dev) {
      const b = d.pad.battery;
      return `Controller bridge (pydualsense) · ${dev.bt ? 'Bluetooth' : 'USB'}${b ? ` · battery ${b.level}%${b.charging ? ' (charging)' : ''}` : ''}`;
    }
    if (isDualSensePad(d.pad)) return ds.online ? 'Gamepad API · press Find DualSense to hand it to the controller bridge' : 'Gamepad API · start the controller bridge for adaptive triggers, haptics and lightbar';
    return `${d.pad.mapping === 'standard' ? 'Standard layout' : 'Non-standard layout'} · Gamepad API`;
  }

  function statusPills(d) {
    const pills = [];
    if (d.kind === 'pad') {
      if (d.pad.hid) pills.push(['ok', 'Triggers + haptics']);
      else if (isDualSensePad(d.pad)) pills.push(['warn', 'Not linked']);
      if (!d.profileKey) pills.push(['bad', 'Needs a button map']);
      if (d.pad.vibrationActuator && !d.pad.hid) pills.push(['', 'Rumble']);
    }
    return pills.map(([c, t]) => `<span class="pill ${c}">${esc(t)}</span>`).join('');
  }

  function laneKeysFor(d) {
    if (d.kind !== 'key' || !d.profileKey) return {};
    const prof = bindings.profile(d.profileKey);
    const out = {};
    const mode = st.mode;
    const cols = mode === 'drums' ? DRUM_KEY_COLORS : LANE_COLORS;
    ['lane0', 'lane1', 'lane2', 'lane3', 'lane4'].forEach((a, i) => { for (const s of prof?.[mode]?.[a] || []) if (s.k) out[s.k] = cols[i]; });
    for (const s of prof?.[mode]?.od || []) if (s.k && !out[s.k]) out[s.k] = '#ffcf3a';
    return out;
  }

  function artFor(d, big = false) {
    const accent = d.kind === 'pad' && d.pad?.hid ? '#f0b429' : '#df3a2c';
    return controllerSvg(d.det.kind, { accent, laneKeys: big ? laneKeysFor(d) : {} });
  }

  // ---------------------------------------------------------------- render
  function render(keepFocus = false) {
    const list = devices();
    const sel = selected(list);
    st.sel = sel?.id || null;
    $('#hub-list').innerHTML = list.map((d) => `
      <div class="dev-card ${d.id === st.sel ? 'sel' : ''}" data-nav data-dev="${esc(d.id)}">
        <div class="dev-art ctl-art">${controllerPicture(d.det.kind)}</div>
        <div class="dev-txt"><b>${esc(d.det.name)}</b><small>${esc(d.kind === 'pad' && d.pad.hid ? 'Linked · ' + (dsDeviceFor(d)?.bt ? 'Bluetooth' : 'USB') : KIND_LABEL[d.det.kind] || '')}</small>
          <span class="dev-prof">${d.profileKey ? esc(bindings.shortLabel(d.profileKey, padName)) : 'Needs mapping'}</span></div>
        <i class="dev-live"></i>
      </div>`).join('') + (input.getPads().length ? '' : '<div class="hub-empty">No gamepads yet — press a button on a controller so the browser shows it.</div>');
    $$('#hub-list [data-dev]').forEach((c) => c.addEventListener('click', () => select(c.dataset.dev)));
    renderDetail(sel);
    const warn = $('#browser-warn-2');
    if (warn) warn.hidden = 'requestMIDIAccess' in navigator;
    const find = $('[data-action="ds-connect"]', $('#screen-controller'));
    find.textContent = ds.online ? (ds.connected ? `DualSense connected (${ds.devices.length})` : 'Find DualSense') : 'Bridge offline';
    find.classList.toggle('primary', ds.online && !ds.connected);
    $('[data-action="midi-enable"]', $('#screen-controller')).textContent = input.midiEnabled ? `MIDI on · ${input.midiInputs.size} device${input.midiInputs.size === 1 ? '' : 's'}` : 'Enable MIDI devices';
    if (!keepFocus) {
      const items = ui.navItems();
      const idx = items.findIndex((x) => x.dataset.dev === st.sel);
      if (idx >= 0) ui.focus = idx;
    }
    ui.applyFocus(false);
  }

  function select(id, focusDetail = false) {
    if (st.sel === id && !focusDetail) return;
    st.sel = id;
    $$('#hub-list .dev-card').forEach((c) => c.classList.toggle('sel', c.dataset.dev === id));
    renderDetail(selected());
    if (focusDetail) {
      const items = ui.navItems();
      const idx = items.findIndex((x) => x.dataset.picker === 'hub-prof');
      if (idx >= 0) { ui.focus = idx; ui.applyFocus(); }
    } else ui.applyFocus(false);
  }

  function renderDetail(d) {
    const box = $('#hub-detail');
    if (!d) { box.innerHTML = '<div class="hub-empty">No devices.</div>'; return; }
    const det = d.det;
    const key = d.profileKey;
    const fam = d.family;
    const padId = d.pad?.id || null;
    const profiles = fam ? bindings.list(fam, fam.startsWith('raw:') || fam === 'std' || fam === 'sony-raw' ? padId : null) : [];
    const isUser = bindings.isUser(key);
    const opts = key ? bindings.options(key) : null;
    const schema = OPTION_SCHEMA.filter((o) => !o.pad || d.kind === 'pad');
    const dsDev = dsDeviceFor(d);
    const dsKind = det.kind === 'dualsense' || det.kind === 'dualsense-edge';

    const tools = [];
    if (dsKind || dsDev) {
      if (!dsDev) tools.push(`<button class="nav-btn primary" data-nav data-action="ds-connect">${ds.online ? 'Find DualSense' : 'Retry controller bridge'}</button>`);
      if (dsDev) tools.push('<button class="nav-btn" data-nav data-action="ds-test-triggers">Test adaptive triggers</button>');
    }
    if (d.kind === 'pad') tools.push('<button class="nav-btn" data-nav data-action="hub-rumble">Test haptics</button>');
    if (d.kind === 'pad' && d.pad.mapping !== 'standard') tools.push(`<button class="nav-btn ${key ? '' : 'primary'}" data-nav data-action="hub-map">Map buttons</button>`);
    if (d.kind === 'pad' && bindings.hasCustom(padId)) tools.push('<button class="nav-btn danger" data-nav data-action="hub-unmap">Clear button map</button>');
    if (d.kind === 'midi' && !input.midiEnabled) tools.push('<button class="nav-btn" data-nav data-action="midi-enable">Enable MIDI</button>');
    const diag = [];
    if (dsDev) diag.push(`${dsDev.bt ? 'Bluetooth · report 0x31 + CRC' : 'USB · report 0x02'} · output reports ${dsDev.sent} · input reports ${dsDev.reports}${dsDev.lastError ? ` · <span class="err">${esc(dsDev.lastError)}</span>` : ''}`);
    if (dsKind && !dsDev && ds.online) diag.push('Not showing up? Turn it on, then close Steam / DS4Windows.');
    if (dsKind && !ds.online) diag.push('Controller bridge offline — triggers and haptics need it (it starts with the desktop app).');
    if (d.kind === 'pad' && !key) diag.push('Non-standard layout — use Map buttons once.');


    box.innerHTML = `
      <div class="hub-hero">
        <div class="hub-art ctl-art big" id="hub-art">${artFor(d, true)}</div>
        <div class="hub-info">
          <div class="hub-kind">${esc(KIND_LABEL[det.kind] || 'Controller')}</div>
          <h2>${esc(det.name)}</h2>
          <div class="hub-conn">${esc(connectionText(d))}</div>
          <div class="hub-pills">${statusPills(d)}</div>
        </div>
      </div>
      ${key || profiles.length ? `
      <div class="hub-section">
        <div class="picker wide" data-nav data-picker="hub-prof"><label>Config profile</label>
          <div class="picker-options">${profiles.map((k) => `<div class="opt ${k === key ? 'sel' : ''}" data-prof="${esc(k)}">${esc(bindings.shortLabel(k, padName))}</div>`).join('')}</div></div>
        <div class="btn-row tight">
          <button class="nav-btn" data-nav data-action="hub-new">＋ New profile</button>
          ${isUser ? '<button class="nav-btn" data-nav data-action="hub-rename">Rename</button>' : ''}
          <button class="nav-btn" data-nav data-action="hub-reset">${isUser ? 'Reset bindings' : 'Reset to defaults'}</button>
          ${isUser ? '<button class="nav-btn danger" data-nav data-action="hub-delete">Delete</button>' : ''}
        </div>
        ${isUser ? `<div class="small-note">Based on ${esc(bindings.shortLabel(bindings.baseOf(key), padName))}</div>` : ''}
      </div>
      <div class="hub-section opts">
        ${schema.map((o) => `<div class="picker row" data-nav data-picker="hub-opt-${o.key}"><label>${esc(o.label)}<small>${esc(o.desc)}</small></label>
          <div class="picker-options">${o.options.map((v) => `<div class="opt ${opts[o.key] === v ? 'sel' : ''}" data-opt="${o.key}" data-v="${esc(v)}">${esc(v)}</div>`).join('')}</div></div>`).join('')}
      </div>` : ''}
      ${tools.length || diag.length ? `<div class="hub-section"><div class="btn-row tight">${tools.join('')}</div>${diag.length ? `<div class="hub-diag">${diag.join('<br/>')}</div>` : ''}</div>` : ''}
      ${key ? `<div class="hub-section binds">
        <div class="picker" data-nav data-picker="hub-mode"><label>Bindings for</label><div class="picker-options">
          <div class="opt ${st.mode === 'five' ? 'sel' : ''}" data-mode="five"><i class="fa-solid fa-guitar"></i> Guitar · Bass · Keys</div><div class="opt ${st.mode === 'drums' ? 'sel' : ''}" data-mode="drums"><i class="fa-solid fa-drum"></i> Drums</div></div></div>
        <div class="bind-table">${ACTIONS[st.mode].map((action) => {
          const list = bindings.profile(key)?.[st.mode]?.[action] || [];
          const chips = list.length ? list.map((src, i) => `<span class="chip">${esc(srcLabel(src, key, det.family))}<i data-del="${st.mode}|${action}|${i}" title="Remove">✕</i></span>`).join('') : '<span class="chip none">unbound</span>';
          const lane = /^lane(\d)$/.exec(action);
          const dot = lane ? `<i class="lane-dot" style="background:${(st.mode === 'drums' ? DRUM_KEY_COLORS : LANE_COLORS)[+lane[1]]}"></i>` : '';
          return `<div class="bind-row" data-nav data-bind="${st.mode}|${action}"><span class="act">${dot}${ACTION_LABELS[st.mode][action]}</span><div class="chips">${chips}</div><button class="bind-add" data-add="${st.mode}|${action}" tabindex="-1">＋</button></div>`;
        }).join('')}</div>
      </div>` : ''}
      <div class="map-prompt" id="map-prompt"></div>`;

    $$('[data-prof]', box).forEach((o) => o.addEventListener('click', () => assign(o.dataset.prof)));
    $$('[data-opt]', box).forEach((o) => o.addEventListener('click', () => { bindings.setOption(selected().profileKey, o.dataset.opt, o.dataset.v); renderDetail(selected()); ui.applyFocus(false); }));
    $$('[data-mode]', box).forEach((o) => o.addEventListener('click', () => { st.mode = o.dataset.mode; renderDetail(selected()); ui.applyFocus(false); }));
    $$('[data-action]', box).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ui.action(b.dataset.action, b); }));
    $$('.bind-row', box).forEach((r) => r.addEventListener('click', (e) => { if (e.target.dataset.del || e.target.dataset.add) return; beginCapture(r.dataset.bind, true); }));
    $$('[data-add]', box).forEach((b) => b.addEventListener('click', () => beginCapture(b.dataset.add, false)));
    $$('[data-del]', box).forEach((x) => x.addEventListener('click', () => {
      const [mode, action, i] = x.dataset.del.split('|');
      const k = selected().profileKey;
      const list = [...(bindings.profile(k)[mode][action] || [])];
      list.splice(+i, 1);
      bindings.set(k, mode, action, list);
      renderDetail(selected()); ui.applyFocus(false);
    }));
    st.artFor = d.id;
  }

  function assign(key) {
    const d = selected();
    if (!d) return;
    bindings.assign(input.deviceKeys(d.id, d.pad), key);
    ui.toast(`${d.det.name} now uses "${bindings.shortLabel(key, padName)}"`, 'ok');
    render(true);
    ui.refreshPad();
  }

  // ---------------------------------------------------------------- rebinding
  function beginCapture(bind, replace) {
    const d = selected();
    const key = d?.profileKey;
    if (!key) return;
    const [mode, action] = bind.split('|');
    const kind = bindings.kind(key);
    const banner = $('#capture-banner');
    const what = kind === 'key' ? 'a key' : kind === 'midi' ? 'a note / pad on your MIDI device' : `a button on ${d.det.name}`;
    banner.innerHTML = `Press ${esc(what)} for <b>${esc(ACTION_LABELS[mode][action])}</b><small>${kind === 'key' ? 'Esc cancels · Delete clears' : 'Esc cancels'}</small>`;
    banner.classList.add('show');
    $$('.bind-row').forEach((r) => r.classList.toggle('listening', r.dataset.bind === bind));
    st.capturing = true;
    ui.capturing = true;
    clearTimeout(st.captureTimer);
    st.captureTimer = setTimeout(() => { stopCapture(); ui.toast('Rebind timed out'); }, 10000);
    st.keyHandler = (e) => { if (e.code === 'Escape' && kind !== 'key') { e.preventDefault(); stopCapture(); } };
    window.addEventListener('keydown', st.keyHandler, true);
    input.startCapture(kind, (res) => {
      if (res.cancel) { stopCapture(); return; }
      const prof = bindings.profile(key);
      if (res.clear) { bindings.set(key, mode, action, []); stopCapture(); renderDetail(selected()); return; }
      const src = res.src;
      if (!src) return;
      if (kind === 'pad' && res.pad && d.pad && res.pad.index !== d.pad.index) { ui.toast(`Press the button on ${d.det.name}`); return; }
      if (kind === 'midi' && res.deviceId !== d.id) return;
      for (const other of ACTIONS[mode]) {
        if (other === action) continue;
        const l = prof[mode][other] || [];
        if (l.some((s) => sameSrc(s, src))) {
          bindings.set(key, mode, other, l.filter((s) => !sameSrc(s, src)));
          ui.toast(`${srcLabel(src, key, d.det.family)} moved from ${ACTION_LABELS[mode][other]}`);
        }
      }
      const cur = bindings.profile(key)[mode][action] || [];
      const next = replace ? [src] : cur.some((s) => sameSrc(s, src)) ? cur : [...cur, src].slice(-6);
      bindings.set(key, mode, action, next);
      app.engine.sfxUi('confirm');
      stopCapture();
      renderDetail(selected());
      const idx = ui.navItems().findIndex((x) => x.dataset.bind === bind);
      if (idx >= 0) ui.focus = idx;
      ui.applyFocus(false);
    }, { padIndex: kind === 'pad' ? d.pad?.index : undefined });
  }

  function stopCapture() {
    if (!st.capturing) return;
    st.capturing = false;
    ui.capturing = false;
    clearTimeout(st.captureTimer);
    input.stopCapture();
    if (st.keyHandler) window.removeEventListener('keydown', st.keyHandler, true);
    $('#capture-banner').classList.remove('show');
    $$('.bind-row.listening').forEach((r) => r.classList.remove('listening'));
    ui.navLock = performance.now() + 250;
  }

  // ---------------------------------------------------------------- button-map wizard
  function startPadMap() {
    const d = selected();
    const pad = d?.pad;
    if (!pad) { ui.toast('Select a controller first', 'err'); return; }
    const steps = [
      ['lane0', 'Lane 1 (green) / kick'], ['lane1', 'Lane 2 (red) / snare'], ['lane2', 'Lane 3 (yellow) / hi-hat'],
      ['lane3', 'Lane 4 (blue) / tom'], ['lane4', 'Lane 5 (orange) / cymbal'], ['strum', 'Strum bar (Delete on the keyboard to skip)'],
      ['od', 'Overdrive / star power'], ['pause', 'Pause / Start'], ['up', 'Menu up'], ['down', 'Menu down'], ['confirm', 'Menu confirm'], ['back', 'Menu back'],
    ];
    const got = {};
    let i = 0;
    const name = d.det.name;
    const prompt = () => $('#map-prompt');
    const ask = () => { const p = prompt(); if (p) { p.className = 'map-prompt active'; p.textContent = `${name}: press ${steps[i][1]}  (${i + 1}/${steps.length}) — Esc cancels`; } };
    const next = (src) => {
      got[steps[i][0]] = src ? [src] : [];
      app.engine.sfxUi('confirm');
      i++;
      if (i < steps.length) { ask(); return; }
      input.stopCapture();
      window.removeEventListener('keydown', keyHandler, true);
      const lanes = Object.fromEntries(['lane0', 'lane1', 'lane2', 'lane3', 'lane4'].map((l) => [l, got[l]]));
      bindings.setCustom(pad.id, {
        five: { ...lanes, strum: got.strum, od: got.od, pause: got.pause },
        drums: { ...lanes, od: got.od, pause: got.pause },
        menu: { up: got.up, down: got.down, left: got.lane0, right: got.lane4, confirm: got.confirm, back: got.back, start: got.pause },
      });
      bindings.assign(input.deviceKeys(d.id, pad), `custom:${pad.id}`);
      st.mapping = false;
      ui.padMapping = false;
      ui.toast(`${name} is mapped`, 'ok');
      render(true);
      ui.refreshPad();
    };
    const keyHandler = (e) => {
      if (e.code === 'Escape') { e.preventDefault(); cancelPadMap(); }
      if (e.code === 'Delete') { e.preventDefault(); next(null); }
    };
    window.addEventListener('keydown', keyHandler, true);
    st.mapKeyHandler = keyHandler;
    st.mapping = true;
    ui.padMapping = true;
    ask();
    input.startCapture('pad', (res) => { if (res.src) next(res.src); }, { padIndex: pad.index });
  }

  function cancelPadMap() {
    input.stopCapture();
    st.mapping = false;
    ui.padMapping = false;
    if (st.mapKeyHandler) window.removeEventListener('keydown', st.mapKeyHandler, true);
    const p = $('#map-prompt');
    if (p) { p.className = 'map-prompt'; p.textContent = 'Mapping cancelled'; }
  }

  // ---------------------------------------------------------------- DualSense / haptics tests
  function testTriggers() {
    const dev = dsDeviceFor(selected()) || ds.primary;
    if (!dev) { ui.toast(ds.online ? 'No DualSense found by the controller bridge' : 'The controller bridge is not running', 'err'); return; }
    const seq = [
      ['Click (lane press)', Trigger.weapon(2, 5, ds.scaleT(6))],
      ['Kick pedal', Trigger.weapon(3, 6, ds.scaleT(8))],
      ['Sustain buzz', Trigger.vibration(2, ds.scaleT(5), 50)],
      ['Resistance', Trigger.feedback(1, ds.scaleT(6))],
    ];
    seq.forEach(([label, fx], i) => setTimeout(() => { dev.setTriggers(fx, fx); ui.toast(`Triggers: ${label} — squeeze L2 / R2`); }, i * 2600));
    setTimeout(() => dev.setTriggers(Trigger.off(), Trigger.off()), seq.length * 2600);
  }

  function testRumble() {
    const d = selected();
    const dev = dsDeviceFor(d);
    const pulse = (s, w, ms) => {
      if (dev) dev.rumble(s, w, ms);
      else if (d?.pad?.vibrationActuator) d.pad.vibrationActuator.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: s / 255, weakMagnitude: w / 255 }).catch?.(() => {});
      else ds.rumble(s, w, ms);
    };
    pulse(255, 0, 300);
    setTimeout(() => pulse(0, 255, 300), 350);
    setTimeout(() => pulse(180, 180, 500), 700);
    if (!dev && !d?.pad?.vibrationActuator) ui.toast('This controller does not report rumble support to the browser');
  }

  async function linkDualSense() {
    try {
      app.engine.unlock();
      const ok = await ds.request();
      if (ok) {
        ui.toast(`${ds.label} linked — triggers, haptics and lightbar on`, 'ok');
        ds.rumble(120, 120, 250);
        // select the linked controller once its first input report arrives
        setTimeout(() => { const hid = devices().find((x) => x.pad?.hid); if (hid) st.sel = hid.id; if (ui.screen === 'controller') render(); }, 400);
      }
    } catch (e) {
      ui.toast(e?.message || 'Could not reach the controller bridge', 'err');
    }
    if (ui.screen === 'controller') render(true);
  }

  // ---------------------------------------------------------------- profile management
  async function newProfile() {
    const d = selected();
    if (!d?.profileKey) { ui.toast('Map this controller first', 'err'); return; }
    const suggestion = `${d.det.name.split(' ')[0]} ${bindings.list(d.family, d.pad?.id).filter((k) => bindings.isUser(k)).length + 1}`;
    const name = await ui.osk.show({ title: 'Name the new profile', value: suggestion, max: 28, hint: `Copies "${bindings.shortLabel(d.profileKey, padName)}"` });
    if (!name?.trim()) return;
    const key = bindings.create(d.profileKey, name.trim());
    bindings.assign(input.deviceKeys(d.id, d.pad), key);
    ui.toast(`Profile "${name.trim()}" created`, 'ok');
    render(true);
  }
  async function renameProfile() {
    const d = selected();
    if (!bindings.isUser(d?.profileKey)) return;
    const name = await ui.osk.show({ title: 'Rename profile', value: bindings.shortLabel(d.profileKey), max: 28 });
    if (!name?.trim()) return;
    bindings.rename(d.profileKey, name.trim());
    render(true);
  }
  async function deleteProfile() {
    const d = selected();
    if (!bindings.isUser(d?.profileKey)) return;
    const ok = await ui.confirmDialog(`Delete "${bindings.shortLabel(d.profileKey)}"?`, 'Controllers using it go back to their default profile.', 'Delete');
    if (!ok) return;
    bindings.remove(d.profileKey);
    ui.toast('Profile deleted');
    render(true);
    const idx = ui.navItems().findIndex((x) => x.dataset.picker === 'hub-prof');
    if (idx >= 0) { ui.focus = idx; ui.applyFocus(); }
  }
  async function resetProfile() {
    const d = selected();
    if (!d?.profileKey) return;
    const ok = await ui.confirmDialog('Reset bindings?', bindings.isUser(d.profileKey) ? 'Restores the bindings of the preset this profile was made from.' : 'Restores the factory bindings and options of this preset.', 'Reset');
    if (!ok) return;
    bindings.reset(d.profileKey);
    ui.toast('Bindings reset', 'ok');
    render(true);
  }

  // ---------------------------------------------------------------- live input
  let tick = 0;
  function frame() {
    if (ui.screen !== 'controller') return;
    const list = input.listDevices();
    for (const card of $$('#hub-list .dev-card')) {
      const c = input.activeControls(card.dataset.dev);
      card.classList.toggle('live', c.size > 0);
    }
    const d = list.find((x) => x.id === st.sel);
    const art = $('#hub-art');
    if (d && art) {
      const controls = input.activeControls(d.id);
      const actions = input.actionsFor(d.profileKey, st.mode, controls);
      paintArt(art, { controls, actions, pad: d.pad, whammy: d.pad ? input._whammyValue(d.pad, d.profileKey) : 0 });
    }
    // device list changed (connected / linked / unplugged)
    if (++tick % 30 === 0) {
      const sig = list.map((x) => `${x.id}:${x.profileKey}`).join('|');
      if (sig !== st.sig) { const first = st.sig == null; st.sig = sig; if (!first && !st.capturing && !st.mapping) render(true); }
    }
  }

  // ---------------------------------------------------------------- wiring
  ui.screenHooks.controller = () => { st.sig = null; render(); };
  ui.focusHooks.controller = (el) => { if (el?.dataset.dev) select(el.dataset.dev); };
  Object.assign(ui.actionHooks, {
    'ds-connect': linkDualSense,
    'ds-test-triggers': testTriggers,
    'ds-test-rumble': testRumble,
    'hub-rumble': testRumble,
    'hub-new': newProfile,
    'hub-rename': renameProfile,
    'hub-delete': deleteProfile,
    'hub-reset': resetProfile,
    'hub-map': startPadMap,
    'hub-unmap': () => {
      const d = selected();
      if (!d?.pad) return;
      bindings.reset(`custom:${d.pad.id}`);
      ui.toast('Button map cleared', 'ok');
      render(true);
    },
  });
  ui.pickerHooks.push((which, dir) => {
    const d = selected();
    if (which === 'hub-prof' && d) {
      const fam = d.family;
      const list = bindings.list(fam, d.pad?.id || null);
      if (!list.length) return true;
      const i = list.indexOf(d.profileKey);
      assign(list[(i + dir + list.length) % list.length]);
      return true;
    }
    if (which === 'hub-mode') { st.mode = st.mode === 'five' ? 'drums' : 'five'; renderDetail(d); ui.applyFocus(false); return true; }
    const m = /^hub-opt-(\w+)$/.exec(which);
    if (m && d?.profileKey) {
      const o = OPTION_SCHEMA.find((x) => x.key === m[1]);
      const cur = bindings.options(d.profileKey)[o.key];
      bindings.setOption(d.profileKey, o.key, o.options[(o.options.indexOf(cur) + dir + o.options.length) % o.options.length]);
      renderDetail(selected());
      ui.applyFocus(false);
      return true;
    }
    return false;
  });
  ui.navHooks.push((dir) => {
    if (ui.screen !== 'controller') return false;
    if (st.mapping) { if (dir === 'back') cancelPadMap(); return true; }
    if (st.capturing) return true;
    const el = ui.navItems()[ui.focus];
    if (dir === 'confirm' && el?.dataset.dev) { select(el.dataset.dev, true); return true; }
    if (dir === 'confirm' && el?.dataset.bind) { beginCapture(el.dataset.bind, true); return true; }
    if (dir === 'alt' && el?.dataset.bind) { beginCapture(el.dataset.bind, false); return true; }
    if (dir === 'alt2' && el?.dataset.bind) {
      const [mode, action] = el.dataset.bind.split('|');
      bindings.set(selected().profileKey, mode, action, []);
      renderDetail(selected()); ui.applyFocus(false);
      return true;
    }
    if (dir === 'back' && !el?.dataset.dev) {
      const idx = ui.navItems().findIndex((x) => x.dataset.dev === st.sel);
      if (idx >= 0) { ui.focus = idx; ui.applyFocus(); return true; }
    }
    if (dir === 'prev' || dir === 'next') {
      const list = devices();
      const i = list.findIndex((x) => x.id === st.sel);
      const n = list[(i + (dir === 'next' ? 1 : -1) + list.length) % list.length];
      if (n) { select(n.id); const idx = ui.navItems().findIndex((x) => x.dataset.dev === n.id); if (idx >= 0 && ui.navItems()[ui.focus]?.dataset.dev) { ui.focus = idx; ui.applyFocus(); } }
      return true;
    }
    return false;
  });
  input.onDevicesChanged = () => { if (ui.screen === 'controller') render(true); };
  ds.onChange(() => { if (ui.screen === 'controller') setTimeout(() => render(true), 300); });

  return {
    render, frame, stopCapture, get capturing() { return st.capturing; }, get mapping() { return st.mapping; },
    selectedDevice: () => selected(),
    legend() {
      const el = ui.navItems()[ui.focus];
      if (st.capturing || st.mapping) return [['back', 'Cancel']];
      if (el?.dataset.bind) return [['confirm', 'Rebind'], ['alt', 'Add'], ['alt2', 'Clear'], ['back', 'Devices']];
      if (el?.dataset.dev) return [['confirm', 'Configure'], ['prevnext', 'Switch device'], ['back', 'Back']];
      if (el?.dataset.picker) return [['lr', 'Change'], ['ud', 'Move'], ['back', 'Devices']];
      return [['confirm', 'Select'], ['back', 'Devices']];
    },
  };
}
