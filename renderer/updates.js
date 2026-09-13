// Check channel -> Update -> download -> install.
(function () {
  const $ = (id) => document.getElementById(id);
  let pendingAsset = null;
  let downloadedFile = null;

  function toast(msg, kind) {
    const t = $('upd-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'prov-toast show ' + (kind || '');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 5000);
  }

  async function refresh() {
    const cur = $('upd-current'), lat = $('upd-latest'), pill = $('upd-pill');
    const note = $('upd-note'), btn = $('upd-install');
    try {
      const v = await window.jarvis.updates('version');
      if (cur) cur.textContent = 'v' + v.version;
    } catch { if (cur) cur.textContent = '?'; }
    if (lat) lat.textContent = 'unknown';
    if (pill) pill.textContent = 'idle';
    if (btn) btn.disabled = true;
    if (note) note.textContent = 'Press “Check for updates”.';
  }

  async function onCheck() {
    const lat = $('upd-latest'), pill = $('upd-pill');
    const note = $('upd-note'), btn = $('upd-install');
    if (lat) lat.textContent = 'checking…';
    if (pill) pill.textContent = '…';
    try {
      const r = await window.jarvis.updates('check');
      if (!r.configured) {
        if (lat) lat.textContent = 'no channel';
        if (pill) pill.textContent = 'dev';
        if (note) note.textContent = 'No update channel baked into this build (dev run). Release builds check your repo.';
        return;
      }
      if (lat) lat.textContent = 'v' + r.latest;
      if (note && r.notes) note.textContent = r.notes.slice(0, 300);
      if (!r.hasUpdate) {
        if (pill) pill.textContent = 'current';
        toast('Already on the latest build ✓', 'ok');
        return;
      }
      pendingAsset = r.pick || null;
      downloadedFile = null;
      if (pill) pill.textContent = 'update ready';
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Update to v' + r.latest; }
      toast('Update found: v' + r.latest + (pendingAsset ? ' (' + pendingAsset.name + ')' : ''), 'ok');
    } catch (e) {
      if (lat) lat.textContent = 'failed';
      if (pill) pill.textContent = 'error';
      toast('Check failed: ' + (e.message || e), 'err');
    }
  }

  async function onInstall() {
    const btn = $('upd-install');
    if (btn) { btn.disabled = true; btn.textContent = '⬇ Downloading…'; }
    toast('Downloading update… (large file, up to a few minutes)', '');
    try {
      if (!downloadedFile) {
        const r = await window.jarvis.updates('download');
        downloadedFile = r.file;
      }
      if (btn) btn.textContent = '⬇ Installing…';
      const r2 = await window.jarvis.updates('install', { file: downloadedFile });
      toast(r2.detail || 'Installer launched.', 'ok');
      if (btn) btn.textContent = '⬇ Update';
    } catch (e) {
      toast('Update failed: ' + (e.message || e), 'err');
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Update'; }
    }
  }

  window.Updates = { refresh };
  document.addEventListener('DOMContentLoaded', () => {
    if ($('upd-check')) $('upd-check').addEventListener('click', onCheck);
    if ($('upd-install')) $('upd-install').addEventListener('click', onInstall);
    refresh();
  });
})();
