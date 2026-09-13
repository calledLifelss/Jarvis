// Fetch real icon glyphs from Iconify (Lucide, Phosphor, Tabler, Heroicons,
// Remix, Iconoir, Material Symbols, Hugeicons, MingCute, Streamline) — one
// distinct set per theme pack, plus fresh Lucide for the house theme.
// Writes: renderer/icons/house/*.svg, manifest.json, pack-blocks.css.
// Run: node scripts/fetch-pack-icons.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'renderer', 'icons');
const SLOTS = ['backend', 'sessions', 'cron', 'sound', 'dock', 'settings', 'clip', 'mic', 'send'];

// slot -> candidate names per collection (first 200 wins)
const SETS = {
  lucide: {
    backend: ['cpu'], sessions: ['messages-square', 'message-square'],
    cron: ['clock', 'alarm-clock'], sound: ['volume-2'],
    dock: ['crosshair'], settings: ['settings'],
    clip: ['paperclip'], mic: ['mic'], send: ['send-horizontal', 'send'],
  },
  tabler: {
    backend: ['cpu'], sessions: ['messages', 'message-2'],
    cron: ['alarm', 'clock'], sound: ['volume'],
    dock: ['crosshair'], settings: ['settings'],
    clip: ['paperclip'], mic: ['microphone'], send: ['send'],
  },
  ph: {
    backend: ['cpu'], sessions: ['chats', 'chat-centered-text'],
    cron: ['timer', 'clock'], sound: ['speaker-high'],
    dock: ['crosshair'], settings: ['gear'],
    clip: ['paperclip'], mic: ['microphone'], send: ['paper-plane-tilt', 'paper-plane'],
  },
  heroicons: {
    backend: ['cpu-chip'], sessions: ['chat-bubble-left-right', 'chat-bubble-oval-left-ellipsis'],
    cron: ['clock'], sound: ['speaker-wave'],
    dock: ['arrows-pointing-out', 'viewfinder-circle'], settings: ['cog-6-tooth'],
    clip: ['paper-clip'], mic: ['microphone'], send: ['paper-airplane'],
  },
  ri: {
    backend: ['cpu-line'], sessions: ['message-3-line', 'message-2-line'],
    cron: ['time-line'], sound: ['volume-up-line'],
    dock: ['focus-3-line', 'fullscreen-line'], settings: ['settings-3-line'],
    clip: ['attachment-line'], mic: ['mic-line'], send: ['send-plane-line'],
  },
  iconoir: {
    backend: ['cpu'], sessions: ['message-text', 'chat-lines'],
    cron: ['clock'], sound: ['sound-high'],
    dock: ['maximize', 'expand'], settings: ['settings'],
    clip: ['attachment', 'paperclip'], mic: ['mic'], send: ['send'],
  },
  mingcute: {
    backend: ['chip-fill'], sessions: ['message-3-fill'],
    cron: ['time-fill'], sound: ['volume-fill'],
    dock: ['fullscreen-2-fill'], settings: ['settings-3-fill'],
    clip: ['attachment-fill'], mic: ['mic-2-fill'], send: ['send-plane-fill'],
  },
  streamline: {
    backend: ['computer-chip-1'], sessions: ['notification-message-alert'],
    cron: ['circle-clock'], sound: ['volume-level-high'],
    dock: ['expand'], settings: ['ai-settings-spark'],
    clip: ['paperclip-1'], mic: ['voice-scan-2', 'microphone'], send: ['send-email'],
  },
  pixelarticons: {
    backend: ['cpu'], sessions: ['message'],
    cron: ['clock'], sound: ['volume-3'],
    dock: ['expand'], settings: ['settings-cog'],
    clip: ['attachment'], mic: ['mic'], send: ['send'],
  },
  'material-symbols': {
    backend: ['memory'], sessions: ['forum'],
    cron: ['schedule'], sound: ['volume-up'],
    dock: ['picture-in-picture', 'dock-to-bottom'], settings: ['settings'],
    clip: ['attachment'], mic: ['mic'], send: ['send'],
  },
  hugeicons: {
    backend: ['cpu'], sessions: ['message-02', 'chatting-01'],
    cron: ['clock-01'], sound: ['volume-high'],
    dock: ['expand-01', 'target-02'], settings: ['settings-01'],
    clip: ['attachment-01'], mic: ['mic-01'], send: ['sent', 'mail-send-01'],
  },
  iconsax: {
    backend: ['cpu'], sessions: ['message', 'messages-2'],
    cron: ['clock'], sound: ['volume-high'],
    dock: ['maximize-4', 'expand'], settings: ['setting-2'],
    clip: ['paperclip', 'link-2'], mic: ['mic'], send: ['send-1'],
  },
  streamline: {
    backend: ['chip', 'cpu-chip'], sessions: ['chat-bubble', 'message-bubble'],
    cron: ['clock'], sound: ['volume-up', 'speaker'],
    dock: ['expand', 'maximize'], settings: ['cog', 'settings'],
    clip: ['paperclip', 'attachment'], mic: ['microphone', 'mic'], send: ['send', 'paper-plane'],
  },
};

// pack -> [primary collection, fallback, slot overrides]
const PACKS = {
  'jarvis-blue': ['tabler', 'lucide', {}],
  midnight: ['ph', 'lucide', {}],
  crimson: ['heroicons', 'lucide', {}],
  forest: ['iconoir', 'lucide', {}],
  sand: ['ri', 'lucide', {}],
  light: ['material-symbols', 'lucide', {}],
  violet: ['hugeicons', 'lucide', {}],
  sakura: ['mingcute', 'lucide', {}],
  minecraft: ['pixelarticons', 'lucide', {}],
  noir: null, // bespoke stamps, committed — never refetch
  ocean: ['streamline', 'tabler', {
    backend: ['computer-chip-1', 'cpu'], mic: ['microphone', 'mic'],
    send: ['send-email', 'send'], cron: ['alarm-clock', 'clock'],
    sound: ['volume-level-high', 'volume'], settings: ['ai-settings-spark', 'settings'],
    clip: ['paperclip-1', 'paperclip'], dock: ['expand', 'maximize'],
    mic: ['voice-scan-2', 'microphone'],
    sessions: ['notification-message-alert', 'message'],
  }],
  ember: ['tabler', 'lucide', { backend: ['flame', 'cpu'] }],
  royal: ['lucide', 'tabler', { dock: ['crown', 'crosshair'], sessions: ['gem', 'messages-square'] }],
  desert: ['heroicons', 'tabler', {}],
  ghost: ['ph', 'lucide', { backend: ['radio-tower', 'cpu'], dock: ['ghost', 'crosshair'] }],
};
const HOUSE = 'lucide';

function get(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'jarvis-icon-fetch' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  });
}

async function fetchIcon(collection, name, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const svg = await get(`https://api.iconify.design/${collection}/${name}.svg?width=24&height=24`);
      if (!svg.startsWith('<svg') || !svg.includes('viewBox')) throw new Error('not svg');
      return svg;
    } catch (e) {
      if (i === tries - 1) console.error(`  giving up ${collection}:${name}: ${e.message}`);
      last = e; await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

// normalize: root svg -> 24x24 grid (some sets ship 14px viewBoxes),
// drop fixed size from the ROOT tag only (inner shapes keep theirs).
// Masks get black paint.
function normalize(svg, forMask) {
  const vb = (svg.match(/viewBox="0 0 (\d+) (\d+)"/) || [])[1];
  let s = svg.replace(/<svg([^>]*)>/, (m, attrs) => {
    let a = attrs.replace(/\s(width|height)="[^"]*"/g, '');
    a = a.replace(/viewBox="[^"]*"/, 'viewBox="0 0 24 24"');
    return '<svg' + a + '>';
  });
  if (vb && vb !== '24') {
    // scale non-24 artwork up to the 24 grid
    const k = (24 / +vb).toFixed(3);
    s = s.replace(/(<svg[^>]*>)/, `$1<g transform="scale(${k})">`);
    s = s.replace(/<\/svg>\s*$/, '</g></svg>');
  }
  if (forMask) s = s.split('currentColor').join('black');
  return s.trim();
}

async function resolveSlot(collection, fallback, slot, overrides) {
  const tried = [];
  const cands = [
    ...(overrides[slot] || []),
    ...(SETS[collection][slot] || []),
  ];
  for (const name of cands) {
    tried.push(`${collection}:${name}`);
    try {
      const svg = await fetchIcon(collection, name, 5);
      return { collection, name, svg };
    } catch (e) {
      if (!/429|timeout|timed out|ECONN|ENOTFOUND/i.test(e.message || '')) continue;
      // rate-limit: cool down, then keep trying the SAME set (don't demote the pack)
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const svg = await fetchIcon(collection, name, 5);
        return { collection, name, svg };
      } catch {}
    }
  }
  for (const name of (SETS[fallback][slot] || ['cpu'])) {
    tried.push(`${fallback}:${name}`);
    try {
      const svg = await fetchIcon(fallback, name);
      return { collection: fallback, name, svg };
    } catch {}
  }
  for (const name of SETS.lucide[slot] || ['cpu']) {
    tried.push(`lucide:${name}`);
    try {
      const svg = await fetchIcon('lucide', name);
      return { collection: 'lucide', name, svg };
    } catch {}
  }
  throw new Error(`no glyph for ${slot} (tried ${tried.join(', ')})`);
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'house'), { recursive: true });
  const manifest = { house: { set: HOUSE, slots: {} }, packs: {} };

  // house first (also serves as connectivity proof)
  for (const slot of SLOTS) {
    const r = await resolveSlot(HOUSE, 'tabler', slot, {});
    manifest.house.slots[slot] = { set: r.collection, name: r.name };
    fs.writeFileSync(path.join(OUT, 'house', `${slot}.svg`), normalize(r.svg, false) + '\n');
    console.log(`house/${slot}: ${r.collection}:${r.name}`);
  }

  // packs, 4 at a time (Iconify rate-limits aggressive bursts)
  const entries = Object.entries(PACKS);
  const pool = 4;
  async function worker(queue) {
    while (queue.length) {
      const [pack, spec] = queue.shift();
      if (!spec) { console.log(`${pack}: skipped (bespoke, committed)`); continue; }
      const [col, fb, over] = spec;
      manifest.packs[pack] = { set: col, slots: {} };
      const dir = path.join(OUT, pack);
      fs.mkdirSync(dir, { recursive: true });
      for (const slot of SLOTS) {
        const r = await resolveSlot(col, fb, slot, over);
        manifest.packs[pack].slots[slot] = { set: r.collection, name: r.name };
        fs.writeFileSync(path.join(dir, `${slot}.svg`), normalize(r.svg, false) + '\n');
        await new Promise((r2) => setTimeout(r2, 250));
      }
      console.log(`${pack}: done (${manifest.packs[pack].slots.dock.set}:${manifest.packs[pack].slots.dock.name} dock)`);
    }
  }
  const queue = [...entries];
  await Promise.all(Array.from({ length: pool }, () => worker(queue)));

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nwrote manifest.json');
}

main().catch((e) => { console.error('FETCH_FAIL', e.message); process.exit(1); });
