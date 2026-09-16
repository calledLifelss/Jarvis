// Self-update off GitHub releases, no extra deps. The channel is baked
// at build time (release/channel.json); dev builds report unconfigured.
// check -> compare -> download to tmp -> install (native package via
// pkexec prompt, exe handed to the user). Never force-restarts.
//
// Three install shapes, three update paths:
//   • AppImage / Windows portable — the app.asar swap cannot persist, so
//     these always fall through to a full installer.
//   • NSIS install (Windows) — app.asar sits in a normal writable dir, so a
//     ~2MB delta can be swapped in place, or the Setup exe can upgrade the
//     install dir silently (/S --updated).
//   • native Linux package (deb/rpm/pkg) — pkexec into the package manager.
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

// Electron's fs wrapper hijacks EVERY path ending in `.asar` and reads it as
// "file X inside that archive" — so a plain readFileSync on a real app.asar
// throws ENOENT, statSync reports size 0, and copyFileSync fails both ways.
// Every raw byte-level op on an .asar path must run with process.noAsar set.
// (Plain-node unit tests never see this: fs is unwrapped there, so they pass
// green while the shipped app fails. Prove .asar ops under real Electron.)
function noAsar(fn) {
  const prev = process.noAsar;
  process.noAsar = true;
  try { return fn(); } finally { process.noAsar = prev; }
}

// an AppImage's app.asar sits in a read-only squashfs mount (EROFS): the
// ~2MB patch path can never write there, so never pick one for it.
function runningAppImage(platform = process.platform, env = process.env) {
  return platform === 'linux' && !!env.APPIMAGE;
}

// A Windows portable exe runs from a temp dir it RE-EXTRACTS from the .exe on
// every launch, wiping any swapped app.asar. A patch there would report
// success and silently revert on the next start, so never pick one either.
function runningPortable(platform = process.platform, env = process.env) {
  return platform === 'win32' && !!(env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR);
}

// Windows but NOT portable => an NSIS install (or a dev run). The install
// dir is writable, so deltas apply and the Setup exe upgrades in place.
function runningInstalled(platform = process.platform, env = process.env) {
  return platform === 'win32' && !runningPortable(platform, env);
}

// true when an app.asar swap cannot persist for this install shape.
// Platform/env are parameters (not read directly) so every shape is testable
// on any host — see test/updater-electron-asar.test.js.
function patchCannotPersist(platform = process.platform, env = process.env) {
  return runningAppImage(platform, env) || runningPortable(platform, env);
}

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

function pickAsset(assets, latestVersion, currentVersion, host = {}) {
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
  // AppImage: skip the delta — its app.asar is inside a read-only squashfs
  // mount, so a patch would download and then fail to install. Windows
  // portable: same, it re-extracts on launch and would revert the swap. Both
  // fall through to the full installer, which handles those shapes properly.
  const allowPatch = !patchCannotPersist(host.platform, host.env);
  const patchIdx = allowPatch ? names.findIndex((n) =>
    isDelta(n) && hasVer(n, lat) && (hasVer(n, cur) || n.includes('any'))) : -1;
  if (cur && lat && patchIdx >= 0) return { ...assets[patchIdx], isPatch: true };
  if (lat && allowPatch) {
    const uni = names.findIndex((n) => isDelta(n) && hasVer(n, lat) && !/-to-/.test(n));
    if (uni >= 0 && cmpVer(lat, cur) > 0) return { ...assets[uni], isPatch: true };
  }
  const plat = host.platform || process.platform;
  if (plat === 'win32') {
    // Two Windows shapes, two full-installer choices: a portable build can
    // only be replaced by a new portable exe, an NSIS install takes the
    // Setup exe (which upgrades the install dir in place, silently).
    if (runningPortable(plat, host.env)) return find('win-portable.exe') || find('.exe') || find('.zip') || null;
    return find('setup') || find('-setup.exe') || find('.exe') || find('.zip') || null;
  }
  if (plat === 'darwin') return find('.dmg') || find('-mac', '.zip') || null;
  // linux: match the distro's native package, AppImage as fallback
  try {
    const osrel = host.osRelease != null ? host.osRelease : fs.readFileSync('/etc/os-release', 'utf8');
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

// Install the download. Returns {action, detail}:
//   'relaunch'         package/patch installed, restart the app yourself
//   'upgrade'          Windows NSIS install: silent in-place upgrade started,
//                      the installer relaunches the app (caller should quit)
//   'replace+relaunch' portable file, replace and restart
//   'manual'           installer opened for the user to finish
// Patches ({isPatch}) go through applyPatch: verify + swap app.asar in place.
function install(filePath, opts = {}) {
  if (opts.isPatch || /-patch\.zip$/i.test(filePath)) return applyPatch(filePath);
  return new Promise((resolve, reject) => {
    const lower = filePath.toLowerCase();
    const plat = process.platform;
    if (plat === 'win32' || lower.endsWith('.exe')) {
      if (plat !== 'win32') {
        // an .exe on a non-Windows host: nothing to install, just hand it over
        resolve({ action: 'manual', detail: 'Installer downloaded to ' + filePath });
        return;
      }
      if (runningPortable(plat, process.env)) {
        // Portable build: there is no install dir to upgrade, so the user
        // picks where the new build goes (or keeps using the portable zip).
        const child = spawn(`"${filePath}"`, [], { shell: true, detached: true, stdio: 'ignore' });
        child.unref();
        resolve({ action: 'manual', detail: 'Installer launched — finish setup, then reopen Jarvis.' });
        return;
      }
      // NSIS install: run the Setup exe silently (/S) with --updated so it
      // skips the first-install pages and keeps the install dir, shortcuts
      // and update channel. Chain the app's own relaunch so the user is not
      // left with nothing, then step aside (the caller quits us) so the
      // installer can replace the running exe.
      if (!process.defaultApp) {
        const exe = process.execPath;
        try {
          const child = spawn('cmd.exe',
            ['/c', `"${filePath}" /S --updated && start "" "${exe}"`],
            { detached: true, stdio: 'ignore', windowsHide: true });
          child.unref();
        } catch (e) {
          reject(new Error('could not launch installer: ' + e.message));
          return;
        }
        resolve({
          action: 'upgrade',
          detail: `Updating in place${opts.version ? ' to v' + opts.version : ''} — Jarvis closes and reopens when the installer finishes.`,
        });
        return;
      }
      // dev run: just show the installer
      const child = spawn(`"${filePath}"`, [], { shell: true, detached: true, stdio: 'ignore' });
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
      // Portable files: the updater can't swap itself. If we were launched
      // FROM an AppImage, replace that file in place (via pkexec when it sits
      // somewhere we can't write) and say exactly what to run next.
      if (lower.endsWith('.appimage') && runningAppImage()) {
        const self = process.env.APPIMAGE;
        try {
          fs.chmodSync(filePath, 0o755);
          let how = 'replaced';
          try {
            fs.copyFileSync(filePath, self);
          } catch {
            if (!copyElevated(filePath, self)) {
              resolve({
                action: 'manual',
                detail: `New AppImage is at ${filePath} — replace ${self} with it and reopen (needs root, prompt cancelled).`,
              });
              return;
            }
            how = 'replaced (with root)';
          }
          if (shaFile(self) !== shaFile(filePath)) {
            reject(new Error('AppImage replace failed verification'));
            return;
          }
          resolve({
            action: 'relaunch',
            detail: `v${opts.version || ''} ${how} at ${self} — close Jarvis and run it again to use the new build.`.replace('v ', 'v'),
          });
          return;
        } catch (e) {
          resolve({ action: 'manual', detail: `New AppImage is at ${filePath} — replace ${self} with it and reopen (${e.message}).` });
          return;
        }
      }
      resolve({ action: 'replace+relaunch', file: filePath, detail: 'Downloaded to ' + filePath });
      return;
    }
    reject(new Error('unknown installer type: ' + path.basename(filePath)));
  });
}

function shaFile(f) {
  // must bypass the asar wrapper: reading a real app.asar as a file needs noAsar
  return noAsar(() => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
}

// single-quote a literal for PowerShell ('' escapes an embedded quote)
function psLit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// Copy src -> dst, asking the OS for elevation when a plain copy can't
// write (root-owned native package on Linux, per-machine Windows install).
// Returns true only when dst ends up byte-identical to src.
function copyElevated(src, dst) {
  const { spawnSync } = require('child_process');
  if (process.platform === 'win32') {
    // write the copy to a temp .ps1 so the quoting stays sane, then re-launch
    // powershell elevated (UAC) and wait for it
    const script = path.join(os.tmpdir(), 'jarvis-elev-' + Date.now() + '.ps1');
    try {
      fs.writeFileSync(script, `Copy-Item -LiteralPath ${psLit(src)} -Destination ${psLit(dst)} -Force\r\n`);
      const r = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Start-Process -FilePath powershell.exe -Verb RunAs -Wait ` +
        `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psLit(script)}`,
      ], { stdio: 'ignore', windowsHide: true, timeout: 120000 });
      if (r.status !== 0) return false;
      try { return shaFile(dst) === shaFile(src); } catch { return false; }
    } finally {
      try { fs.unlinkSync(script); } catch {}
    }
  }
  const r = spawnSync('pkexec', ['cp', src, dst], { stdio: 'ignore' });
  if (r.status !== 0) return false;
  try { return shaFile(dst) === shaFile(src); } catch { return false; }
}

// Minimal pure-Node zip reader. Previously this shelled out to `unzip`,
// which does not exist on Windows — every patch there failed with ENOENT.
// Reads the central directory and inflates method 0 (store) / 8 (deflate).
function readZip(zipPath, names) {
  const buf = fs.readFileSync(zipPath);
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66560; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  const zlib = require('zlib');
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (names && !names.includes(name)) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('corrupt zip local header');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out[name] = Buffer.from(raw);
    else if (method === 8) out[name] = zlib.inflateRawSync(raw);
    else throw new Error('unsupported zip compression method ' + method);
  }
  return out;
}

// Patch flow: unzip -> verify asar hash -> backup current asar -> swap.
// Rollback on any verification failure. Root-owned targets retry via pkexec.
function applyPatch(zipPath) {
  return new Promise((resolve, reject) => {
    let tmp;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-patch-'));
      const files = readZip(zipPath, ['patch.json', 'app.asar']);
      if (!files['patch.json'] || !files['app.asar']) throw new Error('patch zip is missing patch.json/app.asar');
      const meta = JSON.parse(files['patch.json'].toString('utf8'));
      if (meta.app !== 'jarvis' || !meta.version || !meta.asarSha256) {
        throw new Error('patch manifest invalid');
      }
      const newAsar = path.join(tmp, 'app.asar');
      // this path ends in .asar, so the wrapper must be off for the write too
      noAsar(() => fs.writeFileSync(newAsar, files['app.asar']));
      if (shaFile(newAsar) !== meta.asarSha256) throw new Error('patch asar hash mismatch — redownload');
      const target = findInstalledAsar();
      if (!target) {
        throw new Error('cannot find installed app.asar (portable zip? apply manually: replace resources/app.asar)');
      }
      // Every byte-level op on the .asar paths below must bypass Electron's
      // asar fs wrapper, which otherwise treats them as paths INSIDE an asar
      // and throws ENOENT (this is what made 1.0.4 patches fail to install).
      const bak = target + '.bak-' + Date.now();
      noAsar(() => {
        fs.copyFileSync(target, bak);
        try {
          fs.copyFileSync(newAsar, target);
        } catch {
          // likely permissions — read-only AppImage mount, a root-owned native
          // package, or a per-machine Windows install. Retry elevated.
          if (!copyElevated(newAsar, target)) {
            fs.copyFileSync(bak, target); // roll back
            throw new Error('needs elevation to patch ' + target + ' (cancelled or read-only filesystem)');
          }
        }
      });
      // sanity: patched asar hashes the same
      if (shaFile(target) !== meta.asarSha256) {
        try { noAsar(() => fs.copyFileSync(bak, target)); } catch {}
        throw new Error('patched file failed verification — rolled back');
      }
      try { noAsar(() => fs.unlinkSync(bak)); } catch {}
      resolve({ action: 'relaunch', detail: `Patched to v${meta.version} (~2MB) — restart Jarvis.` });
    } catch (e) { reject(e); }
    finally { try { noAsar(() => fs.rmSync(tmp, { recursive: true, force: true })); } catch {} }
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
    if (p && p.endsWith('.asar') && noAsar(() => fs.existsSync(p))) return p;
    if (p && noAsar(() => fs.existsSync(path.join(p, 'resources', 'app.asar')))) {
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
    // NSIS per-user install (the default: %LOCALAPPDATA%\Programs\<ProductName>)
    if (process.env.LOCALAPPDATA) {
      cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Jarvis', 'resources', 'app.asar'));
      cands.push(path.join(process.env.LOCALAPPDATA, 'Jarvis', 'resources', 'app.asar'));
    }
    // NSIS per-machine install
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
      if (process.env[key]) cands.push(path.join(process.env[key], 'Jarvis', 'resources', 'app.asar'));
    }
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      cands.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'app.asar'));
    }
  }
  for (const c of cands) { try { if (noAsar(() => fs.existsSync(c))) return c; } catch {} }
  return null;
}

module.exports = {
  check,
  pickAsset,
  download,
  install,
  cmpVer,
  noAsar,
  runningAppImage,
  runningPortable,
  runningInstalled,
  patchCannotPersist,
  copyElevated,
};