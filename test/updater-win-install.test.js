// The Windows upgrade path (NSIS silent in-place /S --updated, portable
// hand-over) cannot execute on Linux, so this test stubs child_process.spawn
// and swaps process.platform to prove install() picks the right action and
// builds the right command line for every Windows install shape.
//
// Why it matters: a wrong action here means either the app quits and nothing
// replaces it (dead end), or the installer runs while the old exe is still
// locked (upgrade silently fails and the user stays on the old build).
const assert = require('assert');
const path = require('path');

let spawned = [];
const childProcess = require('child_process');
childProcess.spawn = (cmd, args, opts) => {
  spawned.push({ cmd, args, opts });
  return { unref() {}, on() {}, once() {}, kill() {} };
};

// updater.js destructures spawn at require time, so patch before loading it.
const updater = require(path.join(__dirname, '..', 'updater.js'));

function withPlatform(plat, env, defaultApp, fn) {
  const desc = Object.getOwnPropertyDescriptor(process, 'platform');
  const realEnv = process.env;
  const hadDefault = Object.prototype.hasOwnProperty.call(process, 'defaultApp');
  const realDefault = process.defaultApp;
  Object.defineProperty(process, 'platform', { value: plat, configurable: true });
  process.env = { ...env };
  process.defaultApp = !!defaultApp;
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', desc);
    process.env = realEnv;
    if (hadDefault) process.defaultApp = realDefault; else delete process.defaultApp;
  }
}

const n = { c: 0 };
const ok = (d) => { n.c++; console.log(`ok ${n.c} - ${d}`); };

(async () => {
  // 1. installed NSIS build: silent in-place upgrade, then the caller quits so
  //    the Setup exe can replace the running Jarvis.exe
  spawned = [];
  const r1 = await withPlatform('win32', {}, false, () =>
    updater.install('C:\\Users\\x\\AppData\\Local\\Temp\\Jarvis-Setup-1.0.6.exe', { version: '1.0.6' }));
  assert.strictEqual(r1.action, 'upgrade');
  ok('installed NSIS install -> action "upgrade" (caller quits)');
  assert.strictEqual(spawned.length, 1);
  const c1 = spawned[0];
  assert.strictEqual(c1.cmd, 'cmd.exe');
  assert.ok(/\/S\b/.test(c1.args[1]), 'installer runs silent (/S)');
  ok('runs the Setup exe with /S');
  assert.ok(c1.args[1].includes('--updated'), 'passes --updated so setup keeps the install dir');
  ok('passes --updated (keeps install dir + shortcuts + channel)');
  assert.ok(c1.args[1].includes('start ""'), 'relaunches Jarvis after the install finishes');
  ok('chains the app relaunch so the user is not left with nothing');
  assert.strictEqual(c1.opts.detached, true);
  assert.strictEqual(c1.opts.windowsHide, true);
  ok('detached + windowless, so it outlives the quitting app');

  // 2. portable build: there is no install dir to upgrade
  spawned = [];
  const r2 = await withPlatform('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\Jarvis.exe' }, false, () =>
    updater.install('C:\\Temp\\Jarvis-Setup-1.0.6.exe'));
  assert.strictEqual(r2.action, 'manual');
  ok('portable build -> action "manual" (no install dir to upgrade)');
  assert.ok(!spawned[0].args.join(' ').includes('--updated'));
  ok('portable does NOT run the installer silent/--updated');

  // 3. an .exe landing on a non-Windows host must not crash
  spawned = [];
  const r3 = await withPlatform('linux', {}, false, () =>
    updater.install('/tmp/Jarvis-Setup-1.0.6.exe'));
  assert.strictEqual(r3.action, 'manual');
  assert.strictEqual(spawned.length, 0);
  ok('non-Windows host: exe handed over, nothing spawned');

  // 4. dev run on Windows must not relaunch-quit the dev process under itself
  spawned = [];
  const r4 = await withPlatform('win32', {}, true, () =>
    updater.install('C:\\Temp\\Jarvis-Setup-1.0.6.exe'));
  assert.strictEqual(r4.action, 'manual');
  ok('dev run -> manual, never quits the dev process');

  // 5. which install shapes may take a ~2MB delta at all
  assert.strictEqual(updater.patchCannotPersist('win32', {}), false);
  ok('installed win32 may take a delta');
  assert.strictEqual(updater.patchCannotPersist('win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\x' }), true);
  ok('portable win32 may NOT (re-extracts on launch, would revert)');
  assert.strictEqual(updater.patchCannotPersist('linux', { APPIMAGE: '/x/Jarvis.AppImage' }), true);
  ok('AppImage may NOT (read-only squashfs mount)');

  console.log(`\nPASS win-install (${n.c} tests)`);
})().catch((e) => { console.error('FAIL win-install:', e.message); process.exit(1); });