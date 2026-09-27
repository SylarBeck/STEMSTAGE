// Desktop app updates: signed releases from GitHub (Tauri updater, driven by the launcher's
// check_update / install_update commands). Checked quietly at start-up; Settings → Updates checks on demand.
import { settings } from '../settings.js';

const invoke = window.__TAURI__?.core?.invoke;
export const canUpdate = !!invoke;

export async function checkForUpdates(ui, { quiet = false } = {}) {
  if (!invoke) { if (!quiet) ui.toast('Updates work in the STEMSTAGE desktop app'); return null; }
  let info;
  try { info = await invoke('check_update', { feed: settings.updateFeed || null }); } catch (e) {
    if (!quiet) ui.toast(`Update check failed: ${e}`, 'err');
    return null;
  }
  if (!info.configured) { if (!quiet) ui.toast('No update source yet — set your GitHub repository under Settings → Updates'); return info; }
  if (!info.available) { if (!quiet) ui.toast(`STEMSTAGE ${info.current} is up to date`, 'ok'); return info; }
  const pick = await ui.openSheet({
    title: `Update to ${info.version}`, sub: `You have ${info.current}${info.notes ? ` · ${info.notes.slice(0, 140)}` : ''}`,
    items: [
      { id: 'now', label: 'Install now', icon: 'download', desc: 'Downloads, closes the game and restarts on the new version' },
      { id: 'later', label: 'Later', desc: 'Ask again next time the game starts' },
    ],
  });
  if (pick?.id === 'now') install(ui);
  return info;
}

async function install(ui) {
  if (ui.app.game.running) { ui.toast('Finish or quit the song first', 'err'); return; }
  ui.toast('Downloading the update… the game restarts when it is ready');
  try { await invoke('install_update', { feed: settings.updateFeed || null }); } catch (e) { ui.toast(`Update failed: ${e}`, 'err'); }
}

/** Quiet check a few seconds after start-up (desktop app only, when enabled). */
export function autoCheck(ui) {
  if (!invoke || settings.autoUpdate === false) return;
  setTimeout(() => { if (!ui.app.game.running) checkForUpdates(ui, { quiet: true }); }, 8000);
}
