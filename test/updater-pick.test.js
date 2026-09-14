// Pick-matrix + version-compare unit tests. No network.
const assert = require('node:assert/strict');
const u = require('../updater.js');
const A = (n) => ({ name: n, size: 1, url: 'x' });

let n = 0;
const t = (desc, got, want) => {
  n++;
  assert.deepEqual(got, want, `${desc}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  console.log(`ok ${n} - ${desc}`);
};

t('exact from-version patch wins',
  u.pickAsset([A('Jarvis-1.0.1-win-portable.exe'), A('Jarvis-1.0.0-to-1.0.2-delta.zip'), A('Jarvis-1.0.2-win-portable.exe')], '1.0.2', '1.0.0').name,
  'Jarvis-1.0.0-to-1.0.2-delta.zip');

t('universal patch matches 1.0.1',
  u.pickAsset([A('Jarvis-1.0.2-win-portable.exe'), A('Jarvis-1.0.2-delta.zip')], '1.0.2', '1.0.1').isPatch, true);

t('universal patch matches 1.0.0',
  u.pickAsset([A('Jarvis-1.0.2-win-portable.exe'), A('Jarvis-1.0.2-delta.zip')], '1.0.2', '1.0.0').isPatch, true);

t('exact beats universal when both present',
  u.pickAsset([A('Jarvis-1.0.2-delta.zip'), A('Jarvis-1.0.0-to-1.0.2-delta.zip'), A('Jarvis-1.0.2-win-portable.exe')], '1.0.2', '1.0.0').name,
  'Jarvis-1.0.0-to-1.0.2-delta.zip');

// legacy '-patch.zip' still honoured for 1.0.4-era builds
t('legacy -patch.zip still matched',
  u.pickAsset([A('Jarvis-1.0.4-patch.zip'), A('Jarvis-1.0.4-x86_64.rpm')], '1.0.4', '1.0.3').isPatch, true);

// the 1.0.2/1.0.3 escape hatch: a delta-only release must NOT look like a
// patch to their broken pickAsset, so they fall through to a full installer
const oldPick = (assets, v) => {
  const names = assets.map((a) => a.name.toLowerCase());
  const find = (...n) => assets[names.findIndex((x) => n.every((w) => x.includes(w)))];
  return (v && find('-patch.zip', v)) || find('.rpm');
};
t('1.0.2-era client does not match a -delta.zip',
  oldPick([A('Jarvis-1.0.3-to-1.0.4-delta.zip'), A('Jarvis-1.0.4.x86_64.rpm')], '1.0.4').name,
  'Jarvis-1.0.4.x86_64.rpm');

const r = u.pickAsset([A('Jarvis-1.0.1-to-1.0.2-patch.zip'), A('Jarvis-1.0.2-x86_64.rpm')], '1.0.2', '1.0.12');
t('boundary: 1.0.1 patch does not catch 1.0.12', r && r.name, 'Jarvis-1.0.2-x86_64.rpm');

t('no patch in release -> full installer',
  u.pickAsset([A('Jarvis-1.0.2-x86_64.rpm')], '1.0.2', '1.0.1').name, 'Jarvis-1.0.2-x86_64.rpm');

t('nothing matches -> null', u.pickAsset([A('notes.txt')], '1.0.2', '1.0.1'), null);

t('cmp 1.0.10 > 1.0.2', u.cmpVer('1.0.10', '1.0.2'), 1);
t('cmp equal', u.cmpVer('1.0.2', '1.0.2'), 0);
t('cmp older', u.cmpVer('1.0.1', '1.0.2'), -1);

console.log(`\nPASS pick-matrix (${n} tests)`);
