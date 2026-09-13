// Download engine vs a local HTTP server: resume-after-drop, Range-ignored
// restart, sha256 verify + mismatch reject, progress ticks. No internet.
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const u = require('../updater.js');

const body = crypto.randomBytes(300000);
const sha = crypto.createHash('sha256').update(body).digest('hex');
let dlHits = 0;
let ignoreRangeOnce = false;

const srv = http.createServer((req, res) => {
  if (req.url === '/drop') {
    dlHits++;
    if (dlHits === 1) {
      // drop mid-stream: client must resume with Range
      res.writeHead(200, { 'content-length': body.length });
      res.write(body.slice(0, 100000));
      res.destroy();
      return;
    }
    const m = (req.headers.range || '').match(/bytes=(\d+)-/);
    const off = m ? +m[1] : 0;
    res.writeHead(off ? 206 : 200, { 'content-length': body.length - off });
    res.end(body.slice(off));
    return;
  }
  if (req.url === '/norange') {
    // server ignores Range and sends 200: client must restart clean
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
    return;
  }
  res.writeHead(404);
  res.end();
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  let n = 0;
  const ok = (desc, cond) => { n++; assert.ok(cond, desc); console.log(`ok ${n} - ${desc}`); };

  // 1. resume after mid-stream drop
  const pcts = [];
  const f = await u.download(
    { name: 't-resume.bin', size: body.length, url: `http://127.0.0.1:${port}/drop`, expectedSha256: sha },
    (p) => pcts.push(p),
  );
  const got = fs.readFileSync(f);
  ok('resume: bytes identical after drop', got.equals(body));
  ok('resume: took exactly 2 hits', dlHits === 2);
  ok('progress ticks fired, last is 100', pcts.length > 0 && pcts[pcts.length - 1] === 100);

  // 2. hash mismatch rejects and deletes the file
  let rejected = null;
  try {
    await u.download({ name: 't-bad.bin', size: body.length, url: `http://127.0.0.1:${port}/norange`, expectedSha256: '0'.repeat(64) });
  } catch (e) { rejected = e; }
  ok('hash mismatch rejects', rejected && /mismatch/.test(rejected.message));
  ok('bad file deleted', !fs.existsSync(path.join(os.tmpdir(), 't-bad.bin')));

  // 3. Range-ignored server: stale .part exists, must still verify clean
  const stalePart = path.join(os.tmpdir(), 't-norange.bin.part');
  fs.writeFileSync(stalePart, body.slice(0, 50000)); // stale partial, server ignores Range
  const f3 = await u.download(
    { name: 't-norange.bin', size: body.length, url: `http://127.0.0.1:${port}/norange`, expectedSha256: sha },
    () => {},
  );
  ok('range-ignored restart verifies', fs.readFileSync(f3).equals(body));

  for (const x of [f, f3]) { try { fs.unlinkSync(x); } catch {} }
  srv.close();
  console.log(`\nPASS download-engine (${n} tests)`);
})().catch((e) => { console.error('FAIL', e); try { srv.close(); } catch {} process.exit(1); });
