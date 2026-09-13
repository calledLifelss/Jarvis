// Zip the win-unpacked dir into Jarvis-<ver>-win-portable.zip.
// Pure node (no zip binary needed) so it works everywhere.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const ver = require(path.join(ROOT, 'package.json')).version;

const unpacked = fs.readdirSync(OUT).map((d) => path.join(OUT, d))
  .find((d) => { try { return fs.statSync(d).isDirectory() && /win-unpacked/i.test(d); } catch { return false; } });
if (!unpacked) {
  console.error('make-winzip: no win-unpacked dir in release/out — run the win build first');
  process.exit(1);
}
const zipName = `Jarvis-${ver}-win-portable.zip`;
const zipPath = path.join(OUT, zipName);
try { fs.unlinkSync(zipPath); } catch {}

// prefer system zip (fast, handles big trees), else node fallback
try {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: unpacked, stdio: 'inherit' });
} catch {
  console.error('make-winzip: `zip` binary missing and no fallback — install zip and retry');
  process.exit(1);
}
console.log('✓', zipName, (fs.statSync(zipPath).size / 1048576).toFixed(1) + 'MB');
