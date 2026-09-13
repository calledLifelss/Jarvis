// Self-update off GitHub releases, no extra deps. The channel is baked
// at build time (release/channel.json); dev builds report unconfigured.
// check -> compare -> download to tmp -> install (native package via
// pkexec prompt, exe handed to the user). Never force-restarts.
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, {
      headers: { 'user-agent': 'jarvis-updater', accept: 'application/vnd.github+json', ...headers },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        getJson(res.headers.location, headers).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad release json')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('update check timed out')); });
  });
}

async function check(currentVersion) {
  if (!CHANNEL || !CHANNEL.repo) return { configured: false };
  const api = `https://api.github.com/repos/${CHANNEL.repo}/releases/latest`;
  const rel = await getJson(api);
  const latest = String(rel.tag_name || rel.name || '').replace(/^v/, '');
  return {
    configured: true,
    current: currentVersion,
    latest,
    hasUpdate: cmpVer(latest, currentVersion) > 0,
    notes: String(rel.body || '').slice(0, 2000),
    assets: (rel.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
    page: rel.html_url,
  };
}

function pickAsset(assets) {
  const plat = process.platform;
  const names = assets.map((a) => a.name.toLowerCase());
  const find = (...needles) => assets[names.findIndex((n) => needles.every((w) => n.includes(w)))];
  if (plat === 'win32') return find('.exe') || find('.zip');
  if (plat === 'darwin') return find('.dmg') || find('-mac', '.zip');
  // linux: match the distro's native package, AppImage as fallback
  try {
    const osrel = fs.readFileSync('/etc/os-release', 'utf8');
    if (/ID_LIKE=.*(debian|ubuntu)|ID=(debian|ubuntu|linuxmint|pop)/.test(osrel)) return find('.deb') || find('.appimage');
    if (/ID_LIKE=.*(arch)|ID=(arch|cachyos|endeavouros|manjaro)/.test(osrel)) return find('.pkg.tar.') || find('.appimage');
    if (/ID_LIKE=.*(rhel|fedora|suse)|ID=(fedora|rhel|opensuse)/.test(osrel)) return find('.rpm') || find('.appimage');
  } catch {}
  return find('.appimage') || find('.deb') || find('.rpm');
}

function download(asset, onProgress) {
  return new Promise((resolve, reject) => {
    const dest = path.join(os.tmpdir(), asset.name);
    const file = fs.createWriteStream(dest);
    const lib = asset.url.startsWith('https:') ? https : http;
    const req = lib.get(asset.url, { headers: { 'user-agent': 'jarvis-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // release assets live behind signed-URL redirects
        download({ ...asset, url: res.headers.location }, onProgress).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('download HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        if (total && onProgress) {
          try { onProgress(Math.round((got / total) * 100)); } catch {}
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
    req.setTimeout(600000, () => { req.destroy(); reject(new Error('download timed out')); });
  });
}

// Install the download. Returns {action, detail}: 'relaunch' (package
// installed, restart the app), 'replace+relaunch' (portable file, restart),
// 'manual' (installer opened for the user).
function install(filePath) {
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

module.exports = { check, pickAsset, download, install, cmpVer };
