// Edge TTS, native JS (no python). Same wire protocol as edge-tts 7.x:
// wss speech.config + ssml posts, Sec-MS-GEC token, MUID cookie,
// 24khz-48kbitrate-mono-mp3 binary frames.
// One warm WS per voice-config; synths queue behind it.
const crypto = require('crypto');
const WebSocket = require('ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM = '143.0.3650.75';
const MAJOR = CHROMIUM.split('.')[0];
const GEC_VERSION = `1-${CHROMIUM}`;

const WIN_EPOCH = 11644473600;
function secMsGec() {
  let ticks = Date.now() / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks = ticks * 1e9 / 100;
  const s = `${Math.floor(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(s, 'ascii').digest('hex').toUpperCase();
}
function muid() { return crypto.randomBytes(16).toString('hex').toUpperCase(); }
function connectId() { return crypto.randomUUID().replace(/-/g, ''); }
function dateStr() {
  // edge-tts date_to_string: JS-style UTC string
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${mon[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}
function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
}
function mkssml(voice, rate, pitch, volume, text) {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escXml(text)}</prosody></voice></speak>`;
}

// Split like edge-tts: chunks under one WS turn, text split at whitespace.
function splitText(text, limit = 1500) {
  const t = String(text || '');
  if (t.length <= limit) return [t];
  const parts = [];
  let rest = t;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36 Edg/${MAJOR}.0.0.0`;

function connectWs() {
  return new Promise((resolve, reject) => {
    const url = `${WSS_URL}&ConnectionId=${connectId()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${encodeURIComponent(GEC_VERSION)}`;
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Cookie: `muid=${muid()};`,
      },
      // NOTE: perMessageDeflate must stay OFF — negotiating compression
      // makes the service downgrade to audio-16khz and kill the turn (1007).
      perMessageDeflate: false,
    });
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('tts connect timeout')); }, 15000);
    ws.once('open', () => { clearTimeout(timer); resolve(ws); });
    ws.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function synthOnWs(ws, text, voice, rate, pitch, volume) {
  return new Promise((resolve, reject) => {
    const audio = [];
    let done = false;
    let sawAudio = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try { ws.removeAllListeners('message'); } catch {}
      if (err) reject(err);
      else if (!audio.length) reject(new Error('no audio received'));
      else resolve(Buffer.concat(audio));
    };
    const timer = setTimeout(() => finish(new Error('tts synth timeout')), 60000);
    const clear = () => clearTimeout(timer);
    const origFinish = finish;
    const fin = (err) => { clear(); origFinish(err); };

    ws.on('message', (data) => {
      try {
        // Text frames (turn.start/response/turn.end/metadata) may arrive as
        // TEXT opcode (string) or BINARY opcode (Buffer with NO length prefix).
        // Audio frames are BINARY with a 2-byte big-endian header length,
        // and the payload starts at header_length + 2 (edge-tts get_headers_and_data).
        let str = null;
        if (!Buffer.isBuffer(data)) {
          str = String(data);
        } else if (data.length >= 2) {
          const hlen = data.readUInt16BE(0);
          if (hlen <= data.length && hlen >= 10) {
            const header = data.slice(2, hlen).toString('utf8');
            if (header.includes('Path:')) {
              const m = header.match(/Path:([^\r\n]+)/);
              const pth = m ? m[1].trim() : '';
              if (pth === 'audio') {
                const body = data.slice(hlen + 2);
                if (body.length) { audio.push(body); sawAudio = true; }
              }
              // response/turn.start/metadata binary frames: nothing to do
              return;
            }
          }
          // not a framed binary message -> decode whole buffer as text
          str = data.toString('utf8');
        } else {
          return;
        }
        if (str.includes('Path:turn.end')) {
          // server sometimes ends the turn before flushing the last audio
          // frame — wait one beat for stragglers before resolving
          setTimeout(() => fin(), sawAudio ? 400 : 0);
        }
        else if (str.includes('Path:turn.start') || str.includes('Path:response')) { /* keep going */ }
      } catch (e) { fin(e); }
    });
    ws.once('error', fin);
    // close-after-turn is the normal end: if we already have audio, the
    // straggler timer owns the finish — don't let close reject first.
    ws.once('close', () => { if (!done && !sawAudio) fin(new Error('tts socket closed early')); else if (!done) fin(); });

    (async () => {
      try {
        ws.send(
          `X-Timestamp:${dateStr()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
        );
        for (const part of splitText(text)) {
          ws.send(
            `X-RequestId:${connectId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateStr()}Z\r\nPath:ssml\r\n\r\n` +
            mkssml(voice, rate, pitch, volume, part)
          );
        }
      } catch (e) { fin(e); }
    })();
  });
}

// Warm-socket pool keyed by voice+rate+pitch+volume. Sequential use per key;
// a failed socket is discarded, next call reconnects.
const pool = new Map(); // key -> {ws, busy, queue:[]}
function keyFor(voice, rate, pitch, volume) {
  return [voice, rate, pitch, volume].join('|');
}
async function synth(text, voice, rate = '+0%', pitch = '+0Hz', volume = '+0%') {
  const key = keyFor(voice, rate, pitch, volume);
  let slot = pool.get(key);
  if (!slot) {
    slot = { ws: null, busy: false, queue: [] };
    pool.set(key, slot);
  }
  return new Promise((resolve, reject) => {
    slot.queue.push({ text, voice, rate, pitch, volume, resolve, reject });
    pump(key);
  });
}
async function pump(key) {
  const slot = pool.get(key);
  if (!slot || slot.busy) return;
  const job = slot.queue.shift();
  if (!job) return;
  slot.busy = true;
  try {
    if (!slot.ws || slot.ws.readyState !== WebSocket.OPEN) {
      try { slot.ws && slot.ws.close(); } catch {}
      slot.ws = await connectWs();
    }
    const buf = await synthOnWs(slot.ws, job.text, job.voice, job.rate, job.pitch, job.volume);
    job.resolve(buf);
  } catch (e) {
    try { slot.ws && slot.ws.close(); } catch {}
    slot.ws = null;
    job.reject(e);
  } finally {
    slot.busy = false;
    if (slot.queue.length) setImmediate(() => pump(key));
  }
}

module.exports = { synth, _test: { secMsGec, mkssml, splitText } };
