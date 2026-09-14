// applyPatch end-to-end: build a real patch zip, run install({isPatch}),
// confirm the asar is swapped and the hash check passes. This is the path
// that crashed on 1.0.2/1.0.3 (global crypto has no createHash in Electron).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-patchtest-'));
const target = path.join(dir, 'app.asar');
fs.writeFileSync(target, 'OLD-ASAR');

const newContent = 'NEW-ASAR-v104-' + Math.random();
const asarSha = crypto.createHash('sha256').update(newContent).digest('hex');

// stage the patch exactly like release/make-patch.js does
const stage = path.join(dir, 'stage');
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, 'app.asar'), newContent);
fs.writeFileSync(path.join(stage, 'patch.json'), JSON.stringify({
  app: 'jarvis', version: '1.0.4', asarSha256: asarSha, files: ['app.asar'],
}));
const zip = path.join(dir, 'patch.zip');
execFileSync('zip', ['-q', '-j', zip, path.join(stage, 'app.asar'), path.join(stage, 'patch.json')]);

// point the updater's asar finder at our temp file
const updater = require('../updater.js');
updater.__testAsarPath = target;

(async () => {
  let n = 0;
  const ok = (d, c) => { n++; assert.ok(c, d); console.log(`ok ${n} - ${d}`); };

  // the repo ships `const crypto = require('crypto')`; without it this throws
  // "crypto.createHash is not a function" in Electron main
  const src = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');
  ok('updater.js requires crypto explicitly', /require\(['"]crypto['"]\)/.test(src));

  // global (WebCrypto) crypto is what the buggy versions accidentally used
  ok('global crypto lacks createHash (the 1.0.2 crash)', typeof globalThis.crypto?.createHash === 'undefined');

  const res = await updater.install(zip, { isPatch: true });
  ok('patch install resolved', res && res.action === 'relaunch');
  ok('asar was swapped to the new content', fs.readFileSync(target, 'utf8') === newContent);
  ok('no .bak litter left behind', !fs.readdirSync(dir).some((f) => f.includes('.bak-')));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nPASS patch-install (${n} tests)`);
})().catch((e) => { console.error('FAIL', e.message); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(1); });