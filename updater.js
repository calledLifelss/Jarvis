// Self-update off GitHub releases, no extra deps. The channel is baked
// at build time (release/channel.json); dev builds report unconfigured.
// check -> compare -> download to tmp -> install (native package via
// pkexec prompt, exe handed to the user). Never force-restarts.
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let CHANNEL = null;
try {
  CHANNEL = require(path.join(__dirname, 'release', 'channel.json'));
} catch { CHANNEL = null; }

function cmpVer(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function getJson(url, headers = {}, tries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const lib = url.startsWith('https:') ? https : http;
      const req = lib.get(url, {
        headers: { 'user-agent': 'jarvis-updater', accept: 'application/vnd.github+json', ...headers },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          getJson(res.headers.location, headers, tries).then(resolve, reject);
          return;
        }
        if (res.statusCode === 403 && n < tries) {
          // rate-limit / filtered network — wait and retry
          res.resume();
          setTimeout(() => attempt(n + 1), 3000 * n);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          if (n < tries) setTimeout(() => attempt(n + 1), 2000 * n);
          else reject(new Error('HTTP ' + res.statusCode + ' from update server (check internet/VPN, then retry)'));
          return;
        }
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad release json')); }
        });
      });
      req.on('error', () => {
        if (n < tries) setTimeout(() => attempt(n + 1), 2000 * n);
        else reject(new Error('update check failed after 3 tries (check internet/VPN, then retry)'));
      });
      req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    };
    attempt(1);
  });
}

async function check(currentVersion) {
  if (!CHANNEL || !CHANNEL.repo) return { configured: false };
  const api = `https://api.github.com/repos/${CHANNEL.repo}/releases/latest`;
  const rel = await getJson(api);
  const latest = String(rel.tag_name || rel.name || '').replace(/^v/, '');
  const assets = (rel.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }));
  // pull the checksums file so downloads + patches verify (best effort)
  try {
    const sums = assets.find((a) => /^sha256sums/i.test(a.name));
    if (sums) {
      const txt = await new Promise((resolve, reject) => {
        https.get(sums.url, { headers: { 'user-agent': 'jarvis-updater' } }, (res) => {
          if (res.statusCode !== 200) { reject(new Error('sums HTTP ' + res.statusCode)); return; }
          let d = '';
          res.on('data', (c) => { d += c; });
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      const table = {};
      for (const line of txt.split('\n')) {
        const m = line.match(/^([0-9a-f]{64})\s+(\S+)/i);
        if (m) table[m[2]] = m[1].toLowerCase();
      }
      for (const a of assets) {
        if (table[a.name]) a.expectedSha256 = table[a.name];
      }
    }
  } catch {}
  return {
    configured: true,
    current: currentVersion,
    latest,
    hasUpdate: cmpVer(latest, currentVersion) > 0,
    notes: String(rel.body || '').slice(0, 2000),
    assets,
    page: rel.html_url,
  };
}

function pickAsset(assets, latestVersion, currentVersion) {
  // Patches first: `Jarvis-<from>-to-<to>-patch.zip` (~2MB) replaces just
  // app.asar (whole-file swap, so any older install can jump straight to
  // latest). Match order: exact from-version patch, then a target-only
  // patch (`Jarvis-<to>-patch.zip`, universal), then full installers.
  const names = assets.map((a) => a.name.toLowerCase());
  const find = (...needles) => assets[names.findIndex((n) => needles.every((w) => n.includes(w)))];
  const cur = String(currentVersion || '').replace(/^v/, '').toLowerCase();
  const lat = String(latestVersion || '').replace(/^v/, '').toLowerCase();
  // version-boundary match: "1.0.1" must not match inside "1.0.12"
  const hasVer = (n, v) => v && new RegExp(`(^|[^0-9.])${v.replace(/\./g, '\\.')}([^0-9.]|$)`).test(n);
  // Deltas are the primary (~2MB). `-patch.zip` is still accepted so older
  // 1.0.4-era builds written before the rename keep working.
  const isDelta = (n) => n.includes('-delta.zip') || n.includes('-patch.zip');
  const patchIdx = names.findIndex((n) =>
    isDelta(n) && hasVer(n, lat) && (hasVer(n, cur) || n.includes('any')));
  if (cur && lat && patchIdx >= 0) return { ...assets[patchIdx], isPatch: true };
  if (lat) {
    const uni = names.findIndex((n) => isDelta(n) && hasVer(n, lat) && !/-to-/.test(n));
    if (uni >= 0 && cmpVer(lat, cur) > 0) return { ...assets[uni], isPatch: true };
  }
  const plat = process.platform;
  if (plat === 'win32') return find('.exe') || find('.zip') || null;
  if (plat === 'darwin') return find('.dmg') || find('-mac', '.zip') || null;
  // linux: match the distro's native package, AppImage as fallback
  try {
    const osrel = fs.readFileSync('/etc/os-release', 'utf8');
    if (/ID_LIKE=.*(debian|ubuntu)|ID=(debian|ubuntu|linuxmint|pop)/.test(osrel)) return find('.deb') || find('.appimage') || null;
    if (/ID_LIKE=.*(arch)|ID=(arch|cachyos|endeavouros|manjaro)/.test(osrel)) return find('.pkg.tar.') || find('.appimage') || null;
    if (/ID_LIKE=.*(rhel|fedora|suse)|ID=(fedora|rhel|opensuse)/.test(osrel)) return find('.rpm') || find('.appimage') || null;
  } catch {}
  return find('.appimage') || find('.deb') || find('.rpm') || null;
}

function download(asset, onProgress) {
  // Resumable: keeps a .part file, sends Range on retry. Retries 3x, then
  // verifies sha256 when the release provides a checksums asset.
  return new Promise((resolve, reject) => {
    const dest = path.join(os.tmpdir(), asset.name);
    const part = dest + '.part';
    let start = 0;
    try { start = fs.existsSync(part) ? fs.statSync(part).size : 0; } catch {}
    let attempts = 0;
    const attempt = (offset) => {
      attempts++;
      const headers = { 'user-agent': 'jarvis-updater' };
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      const file = fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' });
      const killed = { done: false };
      const fail = (msg, retryOffset) => {
        if (killed.done) return;
        killed.done = true;
        try { file.close(); } catch {}
        if (attempts < 3) setTimeout(() => attempt(retryOffset), 2000 * attempts);
        else reject(new Error(msg));
      };
      const lib = asset.url.startsWith('https:') ? https : http;
      const req = lib.get(asset.url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try { file.close(); } catch {}
          killed.done = true; // this attempt is over; the redirect continues it
          asset = { ...asset, url: res.headers.location };
          attempt(offset); // redirect keeps the offset via Range
          return;
        }
        if (offset > 0 && res.statusCode === 200) {
          // server ignored Range — full body would corrupt the .part append.
          // restart clean instead of appending.
          res.resume();
          try { file.close(); } catch {}
          killed.done = true;
          attempt(0);
          return;
        }
        if (res.statusCode === 416) {
          // server can't resume (or part is complete) — verify what we have
          file.close(() => finish(part));
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          file.close(() => { if (attempts < 3) attempt(0); else reject(new Error('download HTTP ' + res.statusCode)); });
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10) + offset;
        let got = offset;
        res.on('data', (c) => {
          got += c.length;
          if (total && onProgress) {
            try { onProgress(Math.round((got / total) * 100)); } catch {}
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => finish(part)));
      });
      req.on('error', (e) => {
        fail('download failed after 3 attempts (' + (e.message || 'network') + ')', startSize());
      });
      req.setTimeout(600000, () => { try { req.destroy(); } catch {} fail('download stalled for 10 minutes', startSize()); });
    };
    const startSize = () => { try { return fs.existsSync(part) ? fs.statSync(part).size : 0; } catch { return 0; } };
    const finish = (f) => {
      // promote .part -> dest, clean up, verify when possible
      try { fs.renameSync(f, dest); } catch {}
      const need = asset.expectedSha256;
      if (need) {
        const got = shaFile(dest);
        if (got !== need) {
          try { fs.unlinkSync(dest); } catch {}
          reject(new Error('download hash mismatch — redownload'));
          return;
        }
      }
      resolve(dest);
    };
    attempt(start);
  });
}

// Install the download. Returns {action, detail}: 'relaunch' (package
// installed, restart the app), 'replace+relaunch' (portable file, restart),
// 'manual' (installer opened for the user).
// Patches ({isPatch}) go through applyPatch: verify + swap app.asar in place.
function install(filePath, opts = {}) {
  if (opts.isPatch || /-patch\.zip$/i.test(filePath)) return applyPatch(filePath);
  return new Promise((resolve, reject) => {
    const lower = filePath.toLowerCase();
    const plat = process.platform;
    if (plat === 'win32' || lower.endsWith('.exe')) {
      // portable exe: launch the installer, user finishes it themselves
      const child = spawn(`"${filePath}"`, ['/S'], { shell: true, detached: true, stdio: 'ignore' });
      child.unref();
      resolve({ action: 'manual', detail: 'Installer launched — finish setup, then reopen Jarvis.' });
      return;
    }
    if (lower.endsWith('.rpm') || lower.endsWith('.deb') || lower.includes('.pkg.tar.')) {
      // pkexec prompt, right package manager per suffix
      const mgr = lower.endsWith('.rpm')
        ? `dnf install -y "${filePath}" || yum install -y "${filePath}" || rpm -Uvh "${filePath}"`
        : lower.endsWith('.deb')
          ? `apt-get install -y "${filePath}" || dpkg -i "${filePath}"`
          : `pacman -U --noconfirm "${filePath}"`;
      const child = spawn('pkexec', ['sh', '-c', mgr], { stdio: 'ignore', detached: true });
      child.on('error', (e) => reject(new Error('could not launch installer: ' + e.message)));
      child.on('exit', (code) => {
        if (code === 0) resolve({ action: 'relaunch', detail: 'Package installed — restart Jarvis to run the new build.' });
        else reject(new Error('package install exited ' + code + ' (cancelled?)'));
      });
      return;
    }
    if (lower.endsWith('.appimage') || lower.endsWith('.zip')) {
      resolve({ action: 'replace+relaunch', file: filePath, detail: 'Downloaded to ' + filePath });
      return;
    }
    reject(new Error('unknown installer type: ' + path.basename(filePath)));
  });
}

function shaFile(f) {
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}

// Patch flow: unzip -> verify asar hash -> backup current asar -> swap.
// Rollback on any verification failure. Root-owned targets retry via pkexec.
function applyPatch(zipPath) {
  return new Promise((resolve, reject) => {
    let tmp;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-patch-'));
      const { execFileSync } = require('child_process');
      execFileSync('unzip', ['-oq', zipPath, '-d', tmp]);
      const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'patch.json'), 'utf8'));
      if (meta.app !== 'jarvis' || !meta.version || !meta.asarSha256) {
        throw new Error('patch manifest invalid');
      }
      const newAsar = path.join(tmp, 'app.asar');
      if (shaFile(newAsar) !== meta.asarSha256) throw new Error('patch asar hash mismatch — redownload');
      const target = findInstalledAsar();
      if (!target) {
        throw new Error('cannot find installed app.asar (portable zip? apply manually: replace resources/app.asar)');
      }
      const bak = target + '.bak-' + Date.now();
      fs.copyFileSync(target, bak);
      try {
        fs.copyFileSync(newAsar, target);
      } catch (e) {
        // likely permissions (native package owned by root) — retry elevated
        const { spawnSync } = require('child_process');
        const r = spawnSync('pkexec', ['cp', newAsar, target], { stdio: 'ignore' });
        if (r.status !== 0) {
          fs.copyFileSync(bak, target); // roll back
          throw new Error('needs root to patch ' + target + ' (cancelled?)');
        }
      }
      // sanity: patched asar hashes the same
      if (shaFile(target) !== meta.asarSha256) {
        try { fs.copyFileSync(bak, target); } catch {}
        throw new Error('patched file failed verification — rolled back');
      }
      try { fs.unlinkSync(bak); } catch {}
      resolve({ action: 'relaunch', detail: `Patched to v${meta.version} (~2MB) — restart Jarvis.` });
    } catch (e) { reject(e); }
    finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  });
}

// Where does the running app's asar live? Packaged apps set app.getAppPath()
// to .../resources/app.asar. Dev runs return the source dir (no asar).
function findInstalledAsar() {
  // test hook: lets the patch test point at a throwaway asar
  if (module.exports.__testAsarPath) return module.exports.__testAsarPath;
  try {
    // updater runs in main; app may not be imported here — resolve lazily
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    const p = app && app.getAppPath && app.getAppPath();
    if (p && p.endsWith('.asar') && fs.existsSync(p)) return p;
    if (p && fs.existsSync(path.join(p, 'resources', 'app.asar'))) {
      return path.join(p, 'resources', 'app.asar');
    }
  } catch {}
  // well-known install spots (same tree the native packages lay down)
  const cands = [
    '/opt/Jarvis/resources/app.asar',
    '/usr/lib/jarvis-chatroom/resources/app.asar',
  ];
  if (process.platform === 'win32') {
    // portable exe: asar sits next to the running exe
    try {
      const electron = require('electron');
      const app = electron.app || (electron.remote && electron.remote.app);
      if (app && app.getAppPath) {
        const p = app.getAppPath();
        const dir = p.endsWith('.asar') ? path.dirname(path.dirname(p)) : p;
        cands.push(path.join(dir, 'resources', 'app.asar'));
      }
    } catch {}
    if (process.env.LOCALAPPDATA) {
      cands.push(path.join(process.env.LOCALAPPDATA, 'Jarvis', 'resources', 'app.asar'));
    }
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      cands.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'app.asar'));
    }
  }
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}

module.exports = { check, pickAsset, download, install, cmpVer };
