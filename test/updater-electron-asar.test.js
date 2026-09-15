// Regression: the updater must work under REAL Electron, not just plain node.
//
// Bug this pins: Electron wraps fs so that ANY path ending in `.asar` is read
// as "file X inside that archive". A plain readFileSync/copyFileSync on a real
// app.asar therefore throws ENOENT, statSync reports size 0, and the ~2MB patch
// path failed to install for every user (v1.0.4). Plain-node unit tests cannot
// see this — fs is unwrapped there — so they stayed green while the shipped app
// broke. This test runs the real patch path in an Electron main process.
//
// Point it at an Electron:
//   npm i electron                       -> auto-detected
//   JARVIS_ELECTRON_DIST=/path/to/dist   -> extracted AppImage / electron zip
// Without either it SKIPs (never silently passes the asar paths untested).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function electronBinary() {
  try {
    const p = require('electron');
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch {}
  for (const spec of ['electron', path.join(__dirname, '..', 'node_modules', '.bin', 'electron')]) {
    const r = spawnSync(spec, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /v\d+/.test(r.stdout || '')) return spec;
  }
  return null;
}

const distDir = process.env.JARVIS_ELECTRON_DIST && fs.existsSync(process.env.JARVIS_ELECTRON_DIST)
  ? process.env.JARVIS_ELECTRON_DIST
  : null;
const bin = distDir ? null : electronBinary();
if (!distDir && !bin) {
  console.log('SKIP electron-asar — no Electron (npm i electron, or set JARVIS_ELECTRON_DIST)');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-eleasar-'));
const src = path.join(dir, 'src');            // the app we pack
fs.mkdirSync(path.join(src, 'release'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'updater.js'), path.join(src, 'updater.js'));
fs.writeFileSync(
  path.join(src, 'release', 'channel.json'),
  JSON.stringify({ repo: 'calledLifelss/Jarvis', bakedAt: 'test' }),
);
fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'jarvis', version: '1.0.4', main: 'main.js' }));

// a real patch zip, built the way release/make-patch.js does
const newAsar = crypto.randomBytes(4096);
const asarSha = crypto.createHash('sha256').update(newAsar).digest('hex');
const stage = path.join(dir, 'stage');
fs.mkdirSync(stage);
fs.writeFileSync(path.join(stage, 'app.asar'), newAsar);
fs.writeFileSync(
  path.join(stage, 'patch.json'),
  JSON.stringify({ app: 'jarvis', version: '1.0.5', asarSha256: asarSha, files: ['app.asar'] }),
);
const zip = path.join(dir, 'Jarvis-1.0.4-to-1.0.5-delta.zip');
execFileSync('zip', ['-q', '-j', zip, path.join(stage, 'app.asar'), path.join(stage, 'patch.json')]);

const resultFile = path.join(dir, 'result.json');
const mainSrc = `
const { app } = require('electron');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
app.whenReady().then(async () => {
  const res = { checks: [] };
  const ck = (name, ok, detail) => res.checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  const updater = require(path.join(__dirname, 'updater.js'));
  const installed = app.getAppPath();
  try {
    ck('app runs from a real .asar', /\.asar$/.test(installed), installed);
        // ROOT CAUSE probe: with the asar wrapper active, a raw read of a real
        // app.asar throws ENOENT — this is the bug, and it is why every 1.0.4
        // patch install failed. It must still be demonstrable here.
        let rawErr = null;
        try { fs.readFileSync(installed); } catch (e) { rawErr = e; }
        ck('raw readFileSync on a real .asar is hijacked by the asar wrapper',
           rawErr && (rawErr.code === 'ENOENT' || /Invalid package/.test(rawErr.message)),
           rawErr ? rawErr.code + ' ' + rawErr.message : 'no error (wrapper inactive: test cannot prove the bug)');
        // ...and the updater must be able to bypass it
        ck('updater can read the installed .asar as a file (noAsar escape hatch)',
           updater.noAsar(() => fs.readFileSync(installed).length) > 0);
        ck('the escape hatch leaves process.noAsar unset (safe for later I/O)',
           process.noAsar === undefined || process.noAsar === false);
    // findInstalledAsar must locate the running asar, not a phantom
    const r = await updater.install(${JSON.stringify(zip)}, { isPatch: true, version: '1.0.5' });
    ck('patch install() resolves', r && r.action === 'relaunch', r && r.detail);
    const after = updater.noAsar(() => fs.readFileSync(installed));
    ck('installed asar was swapped to the patched build',
       crypto.createHash('sha256').update(after).digest('hex') === ${JSON.stringify(asarSha)});
    ck('no .bak litter left beside the asar',
       !fs.readdirSync(path.dirname(installed)).some((f) => f.includes('.bak-')));
  } catch (e) {
    ck('patch install() did not throw', false, (e.code || '') + ' ' + e.message);
  }

  // the patch path used to shell out to an external unzip binary, which does
  // not exist on Windows. The harness strips PATH, so this only passes if the
  // extraction is handled in-process. (Behavioural, not a source grep.)

  // running from an AppImage: the delta can never be applied (read-only squashfs).
  // host is passed as data, so every install shape is testable on any host.
  const assetsFor = () => [
    { name: 'Jarvis-1.0.4-to-1.0.5-delta.zip', size: 1, url: 'x' },
    { name: 'Jarvis-1.0.5-linux.AppImage', size: 1, url: 'x' },
    { name: 'Jarvis-1.0.5-win-portable.exe', size: 1, url: 'x' },
  ];
  const picked = updater.pickAsset(assetsFor(), '1.0.5', '1.0.4',
    { platform: 'linux', osRelease: 'ID=fedora', env: { APPIMAGE: '/tmp/Jarvis-1.0.5-linux.AppImage' } });
  ck('AppImage run skips the unapplyable delta, takes the full AppImage',
     picked && /appimage$/i.test(picked.name) && !picked.isPatch, picked && picked.name);

  // A Windows portable exe re-extracts its app from the .exe on every launch,
  // so a swapped asar would silently revert on the next start
  const pickedWin = updater.pickAsset(assetsFor(), '1.0.5', '1.0.4',
    { platform: 'win32', osRelease: '', env: { PORTABLE_EXECUTABLE_FILE: 'C:\\Jarvis-1.0.5-win-portable.exe' } });
  ck('Windows portable skips the delta that would revert on relaunch',
     pickedWin && /\.exe$/i.test(pickedWin.name) && !pickedWin.isPatch, pickedWin && pickedWin.name);

  // a real (installed) Windows build does still get the cheap delta
  const pickedWinInstalled = updater.pickAsset(assetsFor(), '1.0.5', '1.0.4',
    { platform: 'win32', osRelease: '', env: {} });
  ck('installed Windows build still picks the delta',
     pickedWinInstalled && pickedWinInstalled.isPatch, pickedWinInstalled && pickedWinInstalled.name);

  // and a non-AppImage linux install still prefers the cheap delta
  const picked2 = updater.pickAsset(assetsFor(), '1.0.5', '1.0.4', { platform: 'linux', osRelease: 'ID=fedora', env: {} });
  ck('native linux install still picks the delta',
     picked2 && picked2.isPatch, picked2 && picked2.name);

  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(res, null, 2));
  app.exit(0);
});
`;
fs.writeFileSync(path.join(src, 'main.js'), mainSrc);

const asar = require('@electron/asar');
(async () => {
  const packedAsar = path.join(dir, 'packed-app.asar');
  await asar.createPackage(src, packedAsar);

  // runDir: where the electron binary finds resources/app.asar
  let runDir = src;
  let argv = [src, '--no-sandbox'];
  let exe = bin;
  if (distDir) {
    runDir = path.join(dir, 'run');
    execFileSync('cp', ['-al', distDir, runDir]);          // hardlink: cheap
    const target = path.join(runDir, 'resources', 'app.asar');
    fs.rmSync(target, { force: true });                     // break the hardlink
    fs.copyFileSync(packedAsar, target);                    // real file, patchable
    exe = path.join(runDir, 'jarvis');
    argv = ['--no-sandbox'];
  } else {
    fs.mkdirSync(path.join(src, 'resources'), { recursive: true });
    fs.copyFileSync(packedAsar, path.join(src, 'resources', 'app.asar'));
  }

  const run = spawnSync(exe, argv, {
    encoding: 'utf8',
    timeout: 120000,
    // PATH stripped: the patch must extract in-process, never shell out to
    // `unzip` (which does not exist on Windows). Also proves no other
    // external helper crept into the install path.
    env: { ...process.env, PATH: '/nonexistent' },
  });

  let res;
  try {
    res = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } catch {
    console.error('FAIL electron-asar — main process produced no result');
    console.error('stdout:', (run.stdout || '').slice(-1200));
    console.error('stderr:', (run.stderr || '').slice(-1200));
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }

  let n = 0;
  let failed = 0;
  for (const c of res.checks) {
    n++;
    if (c.ok) console.log(`ok ${n} - ${c.name}`);
    else {
      failed++;
      console.log(`not ok ${n} - ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) {
    console.error(`\nFAIL electron-asar (${failed}/${n} checks failed)`);
    process.exit(1);
  }
  console.log(`\nPASS electron-asar (${n} checks, real Electron main process)`);
})();