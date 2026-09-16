#!/usr/bin/env node
'use strict';
// Create/refresh the GitHub release for package.json's version and upload
// every artifact in release/out that belongs to that version.
//
//   GITHUB_TOKEN=<repo-scope PAT> node release/publish-github.js
//   node release/publish-github.js --dry-run        # no token needed
//
// Idempotent: an existing release for the tag is reused, and an asset whose
// name is already uploaded is deleted and re-uploaded, so a rebuilt artifact
// replaces the stale one instead of 422-ing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const DRY = process.argv.includes('--dry-run');

const ver = require(path.join(ROOT, 'package.json')).version;
const tag = `v${ver}`;

function die(msg) { console.error('\u2717 ' + msg); process.exit(1); }

let repo = process.env.JARVIS_REPO || '';
if (!repo) {
  try { repo = JSON.parse(fs.readFileSync(path.join(__dirname, 'channel.json'), 'utf8')).repo || ''; } catch {}
}
if (!repo) die('no repo \u2014 set JARVIS_REPO=owner/name or bake release/channel.json');
const token = process.env.GITHUB_TOKEN || '';
if (!token && !DRY) die('no GITHUB_TOKEN \u2014 pass a repo-scope classic PAT');

// --- what ships ------------------------------------------------------------
const assets = fs.readdirSync(OUT).filter((f) => {
  const p = path.join(OUT, f);
  return fs.statSync(p).isFile()
    && !f.endsWith('.blockmap')
    && (f.includes(ver) || f.includes(`to-${ver}`))
    && /\.(exe|zip|AppImage|deb|rpm|pkg\.tar\.zst|txt)$/.test(f);
}).sort();
if (!assets.length) die(`nothing for ${ver} in release/out`);

const size = (f) => fs.statSync(path.join(OUT, f)).size;
const mb = (n) => (n / 1048576).toFixed(1) + 'MB';
console.log(`release ${tag}  ->  ${repo}`);
for (const f of assets) console.log(`  \u2022 ${f}  ${mb(size(f))}`);
console.log(`  ${assets.length} assets, ${mb(assets.reduce((n, f) => n + size(f), 0))} total`);
if (DRY) { console.log('\n(dry run \u2014 nothing sent, no token needed)'); process.exit(0); }

// --- github ----------------------------------------------------------------
const H = [
  '-H', `Authorization: Bearer ${token}`,
  '-H', 'Accept: application/vnd.github+json',
  '-H', 'X-GitHub-Api-Version: 2022-11-28',
];
const API = `https://api.github.com/repos/${repo}`;
const UP = `https://uploads.github.com/repos/${repo}`;
const curl = (args) => execFileSync('curl', ['-sS', ...args], { encoding: 'utf8', maxBuffer: 64 * 1048576 });

const body = `Jarvis ${ver}\n\n` + assets.map((f) => `- \`${f}\``).join('\n');

let release = null;
try { const j = JSON.parse(curl([...H, `${API}/releases/tags/${tag}`])); if (j && j.id) release = j; } catch {}
if (release) {
  console.log(`\u00b7 reusing existing release #${release.id}`);
  curl([...H, '-X', 'PATCH', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ body }), `${API}/releases/${release.id}`]);
} else {
  const payload = JSON.stringify({ tag_name: tag, name: `Jarvis ${ver}`, body });
  const j = JSON.parse(curl([...H, '-X', 'POST', '-H', 'Content-Type: application/json', '-d', payload, `${API}/releases`]));
  if (!j || !j.id) die('create release failed: ' + JSON.stringify(j).slice(0, 400));
  release = j;
  console.log(`\u00b7 created release #${release.id}`);
}

for (const f of assets) {
  const old = (release.assets || []).find((a) => a.name === f);
  if (old) {
    curl([...H, '-X', 'DELETE', `${API}/releases/assets/${old.id}`]);
    console.log('\u00b7 replaced', f);
  }
  const raw = curl([...H, '-X', 'POST', '-H', 'Content-Type: application/octet-stream',
    '--data-binary', '@' + path.join(OUT, f),
    `${UP}/releases/${release.id}/assets?name=${encodeURIComponent(f)}`]);
  let j = null;
  try { j = JSON.parse(raw); } catch {}
  if (!j || !j.id) die(`upload failed for ${f}: ${raw.slice(0, 300)}`);
  console.log('\u2713', f);
}
console.log(`\nhttps://github.com/${repo}/releases/tag/${tag}`);