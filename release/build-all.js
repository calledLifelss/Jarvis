// Full release run: syntax gate -> linux targets -> win targets ->
// win portable-zip -> channel.json -> checksums -> Desktop drop folder.
// Usage: npm run release
// Env: JARVIS_REPO=user/repo (bakes the update channel into builds).
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');

function sh(cmd, args, opts = {}) {
  console.log('›', cmd, (args || []).join(' '));
  execFileSync(cmd, args || [], { stdio: 'inherit', cwd: ROOT, ...opts });
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

(function main() {
  // 0. syntax gate — never ship a build that doesn't parse
  for (const f of ['main.js', 'preload.js', 'updater.js', 'edge_tts_native.js', 'renderer/updates.js', 'renderer/app.js']) {
    sh('node', ['--check', f]);
  }
  console.log('✓ syntax gate passed');

  // 1. write the update channel BEFORE packing (it ships inside the app)
  const repo = process.env.JARVIS_REPO || '';
  const channelDir = path.join(ROOT, 'release');
  fs.mkdirSync(channelDir, { recursive: true });
  fs.writeFileSync(
    path.join(channelDir, 'channel.json'),
    JSON.stringify({ repo, bakedAt: new Date().toISOString() }, null, 2),
  );
  console.log(repo ? `✓ channel baked: ${repo}` : '· no JARVIS_REPO — dev build, updater shows "no channel"');

  // 2. builds
  fs.mkdirSync(OUT, { recursive: true });
  sh('npx', ['electron-builder', '--linux', 'AppImage', 'rpm', 'deb', 'pacman', '--x64', '--publish', 'never']);
  sh('npx', ['electron-builder', '--win', 'nsis', 'portable', '--x64', '--publish', 'never']);

  // 3. portable zip from the win unpacked dir (needs no extra tools)
  sh('node', ['release/make-winzip.js']);

  // 4. checksums for everything shippable
  const files = fs.readdirSync(OUT).filter((f) =>
    /\.(AppImage|rpm|deb|pkg\.tar\.zst|exe|zip)$/.test(f),
  ).sort();
  const lines = files.map((f) => `${sha256(path.join(OUT, f))}  ${f}`);
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  console.log('✓ checksums for', files.length, 'artifacts');

  // 5. Desktop drop folder
  const desk = path.join(process.env.HOME || '/tmp', 'Desktop', 'Jarvis-Installers');
  fs.mkdirSync(desk, { recursive: true });
  for (const f of [...files, 'SHA256SUMS.txt']) {
    fs.copyFileSync(path.join(OUT, f), path.join(desk, f));
  }
  fs.writeFileSync(path.join(desk, 'HOW-TO-INSTALL.txt'), installNotes());
  console.log('✓ Desktop drop:', desk);
  console.log('\n' + files.map((f) => '  • ' + f).join('\n'));
})();

function installNotes() {
  return `JARVIS — install notes (v${require(path.join(ROOT, 'package.json')).version})
==============================
No python, no terminal, no setup. Native packages install like any app.

FEDORA / RHEL / openSUSE (.rpm)
  Double-click the .rpm → Software Center installs it,
  or: sudo dnf install ./Jarvis-*.rpm

DEBIAN / UBUNTU / MINT / POP!_OS (.deb)
  Double-click the .deb → installer opens,
  or: sudo apt install ./Jarvis-*.deb

ARCH / CACHYOS / ENDEAVOUROS / MANJARO (.pkg.tar.zst)
  Double-click → Pamac/Yay handles it,
  or: sudo pacman -U ./Jarvis-*.pkg.tar.zst

ANY OTHER LINUX (.AppImage)
  Right-click → Properties → allow executing, then double-click.
  Or: chmod +x ./Jarvis-*.AppImage && ./Jarvis-*.AppImage

WINDOWS 10/11 (.exe installer)
  Double-click Jarvis-*-setup.exe → Next → Next → Finish.
  (Desktop + Start Menu shortcuts are created.)

WINDOWS portable (.zip)
  Unzip anywhere → run Jarvis.exe. Nothing installed.

UPDATES
  Open Jarvis → Settings → Updates → Check for updates → Update.
  New builds come from the release channel automatically.

VERIFY (optional)
  sha256sum -c SHA256SUMS.txt
`;
}
