// Jarvis Chatroom — main: windows + IPC.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');

// No gesture needed for agent voice replies to play.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

console.log('[jarvis-main] starting, electron=' + process.versions.electron);
process.on('uncaughtException', (e) => console.error('[jarvis-main] UNCAUGHT:', e && e.stack || e));

let mainWin = null;
let miniWin = null;

function createMainWindow() {
  console.log('[jarvis-main] createMainWindow...');
  mainWin = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    title: 'Jarvis Chatroom',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  console.log('[jarvis-main] loadFile called');
  mainWin.once('ready-to-show', () => { console.log('[jarvis-main] ready-to-show, showing'); mainWin.show(); });
  mainWin.webContents.on('did-fail-load', (_e, code, desc) => console.error('[jarvis-main] did-fail-load', code, desc));
  mainWin.webContents.on('console-message', (_e, _lvl, msg) => console.log('[jarvis-render]', msg));
  mainWin.on('closed', () => { mainWin = null; });
  // OS minimize docks the orb (preventDefault + hide; on Wayland KWin
  // may swallow the event, the rail dock button covers that).
  mainWin.on('minimize', (e) => {
    e.preventDefault();
    mainWin.hide();
    createMiniWindow();
  });
  mainWin.on('restore', () => { closeMiniWindow(); });
  mainWin.on('show', () => { closeMiniWindow(); });
}

// Mini mode: compact dock panel, bottom-left, header strip + 120px orb + input.
const MINI_W = 232, MINI_H = 330, MINI_M = 24;
function miniXY() {
  const { height } = screen.getPrimaryDisplay().workAreaSize;
  return { x: MINI_M, y: height - MINI_H - MINI_M };
}
function createMiniWindow() {
  if (miniWin) {
    // re-pin every show: orb ALWAYS lives bottom-left, dragged or not
    const { x, y } = miniXY();
    try { miniWin.setPosition(x, y); } catch {}
    miniWin.show();
    return;
  }
  const { x, y } = miniXY();
  miniWin = new BrowserWindow({
    width: MINI_W,
    height: MINI_H,
    x, y,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0d12',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    title: 'Jarvis Orb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  miniWin.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
  miniWin.on('closed', () => { miniWin = null; });
}

function closeMiniWindow() {
  if (miniWin) miniWin.close();
  if (mainWin) {
    if (!mainWin.isVisible()) mainWin.show();
    else if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
}

console.log('[jarvis-main] registering whenReady');
app.whenReady().then(() => {
  console.log('[jarvis-main] app ready');
  createMainWindow();
  ipcMain.on('enter-mini-mode', createMiniWindow);
  ipcMain.on('exit-mini-mode', closeMiniWindow);
  ipcMain.on('mini-close-orb', () => { if (miniWin) miniWin.close(); });
  // ── Providers bridge (providers-manager protocol) ──
  // Long-lived python bridge over stdio. Renderer only sees masked keys.
  const KEYMAN = path.join(os.homedir(), '.hermes', 'keyman');
  const BRIDGE_PY = path.join(KEYMAN, 'providers_bridge.py');
  const VENV_PY = path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'python');
  let bridgeProc = null, bridgeId = 0;
  const bridgePending = new Map();
  let bridgeBuf = '';
  function bridgeSpawn() {
    if (bridgeProc) return bridgeProc;
    bridgeProc = spawn(fs.existsSync(VENV_PY) ? VENV_PY : 'python3', [BRIDGE_PY], { stdio: ['pipe', 'pipe', 'pipe'] });
    bridgeProc.stdout.on('data', (d) => {
      bridgeBuf += d.toString();
      let idx;
      while ((idx = bridgeBuf.indexOf('\n')) >= 0) {
        const line = bridgeBuf.slice(0, idx).trim();
        bridgeBuf = bridgeBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const cb = bridgePending.get(msg.id);
          if (cb) { bridgePending.delete(msg.id); cb(msg); }
        } catch (e) { console.error('[jarvis-bridge] bad line:', line.slice(0, 120)); }
      }
    });
    bridgeProc.stderr.on('data', (d) => console.error('[jarvis-bridge:stderr]', d.toString().slice(0, 300)));
    bridgeProc.on('exit', () => { bridgeProc = null; bridgeBuf = ''; for (const [, cb] of bridgePending) cb({ ok: false, error: 'bridge exited' }); bridgePending.clear(); });
    return bridgeProc;
  }
  function bridgeCall(op, args = {}) {
    return new Promise((resolve, reject) => {
      try {
        const proc = bridgeSpawn();
        const id = ++bridgeId;
        const timer = setTimeout(() => { bridgePending.delete(id); reject(new Error('bridge timeout: ' + op)); }, 45000);
        bridgePending.set(id, (msg) => {
          clearTimeout(timer);
          if (msg.ok) resolve(msg.data);
          else reject(new Error(msg.error || ('bridge error: ' + op)));
        });
        proc.stdin.write(JSON.stringify({ id, op, args }) + '\n');
      } catch (e) { reject(e); }
    });
  }
  const BRIDGE_OPS = new Set(['list', 'overview', 'save', 'delete', 'get_key', 'set_key', 'bulk_keys', 'multi_status', 'multi_reset', 'multi_freeze', 'check_keys', 'live_test', 'test', 'resolve', 'migrate_legacy', 'set_active', 'backups', 'backup_now', 'backup_pin', 'backup_changes', 'backup_restore', 'test_key', 'fetch_models', 'bench_log', 'claude_status', 'claude_save', 'claude_reset', 'claude_test', 'claude_provider_url']);
  ipcMain.handle('providers-call', async (_ev, op, args) => {
    if (!BRIDGE_OPS.has(op)) throw new Error('bridge op not allowed: ' + op);
    return bridgeCall(op, args || {});
  });
  // ── hermes CLI: skills + cron ──
  // The :9119 WS router only does session/prompt/config/slash
  // (skills.* / cron.* all return -32601), so this goes through the CLI.
  // execFile with a strict argv allowlist, no shell.
  const HERMES_BIN = path.join(os.homedir(), '.local', 'bin', 'hermes');
  const CLI_ALLOW = new Set([
    'skills.list', 'skills.inspect', 'skills.search', 'skills.browse',
    'skills.install', 'skills.uninstall', 'skills.update', 'skills.check',
    'skills.audit', 'skills.list-modified',
    'cron.list', 'cron.create', 'cron.edit', 'cron.pause', 'cron.resume',
    'cron.run', 'cron.remove', 'cron.status', 'cron.runs', 'cron.doctor',
  ]);
  function cliRun(argv, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      execFile(HERMES_BIN, argv, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && err.killed) { reject(new Error('hermes cli timed out')); return; }
        resolve({ code: err ? (err.code || 1) : 0, out: String(stdout || ''), errText: String(stderr || '').slice(0, 500) });
      });
    });
  }
  ipcMain.handle('hermes-cli', async (_ev, op, args) => {
    if (!CLI_ALLOW.has(op)) throw new Error('cli op not allowed: ' + op);
    const a = args || {};
    const argv = op.split('.');
    // skills ops: list/inspect/search/browse/install/uninstall/update/check/audit/list-modified
    // cron ops: list/create/edit/pause/resume/run/remove/status/runs/doctor
    if (op === 'skills.list' || op === 'skills.list-modified' || op === 'skills.check' || op === 'skills.audit') {
      // plain table output; renderer parses defensively
    } else if (op === 'skills.inspect') {
      if (!a.name) throw new Error('skills.inspect needs name');
      argv.push(String(a.name).slice(0, 120));
    } else if (op === 'skills.search' || op === 'skills.browse') {
      if (op === 'skills.search') {
        if (!a.query) throw new Error('skills.search needs query');
        argv.push(String(a.query).slice(0, 120));
        // machine-readable: renderer builds visual cards from this
        argv.push('--json');
      } else if (a.query) argv.push(String(a.query).slice(0, 120));
      if (a.limit) argv.push('--limit', String(Math.min(50, parseInt(a.limit, 10) || 20)));
    } else if (op === 'skills.install' || op === 'skills.uninstall' || op === 'skills.update') {
      // update without a name = update all outdated
      if (op !== 'skills.update' || a.name) {
        if (!a.name) throw new Error(op + ' needs name');
        argv.push(String(a.name).slice(0, 160));
      }
      if (a.yes) argv.push('-y');
    } else if (op === 'cron.list' || op === 'cron.status' || op === 'cron.doctor') {
      if (op === 'cron.list' && a.all) argv.push('--all');
      // default list hides one-shots/paused; UI passes all:true
    } else if (op === 'cron.runs') {
      if (a.job) argv.push(String(a.job).slice(0, 120));
      if (a.limit) argv.push('--limit', String(Math.min(500, parseInt(a.limit, 10) || 20)));
    } else if (op === 'cron.pause' || op === 'cron.resume' || op === 'cron.run' || op === 'cron.remove') {
      if (!a.job) throw new Error(op + ' needs job');
      argv.push(String(a.job).slice(0, 120));
    } else if (op === 'cron.create') {
      if (!a.schedule) throw new Error('cron.create needs schedule');
      argv.push(String(a.schedule).slice(0, 120));
      if (a.prompt) argv.push(String(a.prompt).slice(0, 4000));
      if (a.name) argv.push('--name', String(a.name).slice(0, 120));
      if (a.deliver) argv.push('--deliver', String(a.deliver).slice(0, 120));
      if (a.model) argv.push('--model', String(a.model).slice(0, 120));
      if (a.provider) argv.push('--provider', String(a.provider).slice(0, 120));
      if (a.workdir) argv.push('--workdir', String(a.workdir).slice(0, 300));
      if (a.noAgent) argv.push('--no-agent');
      if (a.script) argv.push('--script', String(a.script).slice(0, 300));
      if (Array.isArray(a.skills)) for (const s of a.skills.slice(0, 8)) argv.push('--skill', String(s).slice(0, 120));
      if (a.paused) argv.push('--paused');
    } else if (op === 'cron.edit') {
      if (!a.job) throw new Error('cron.edit needs job');
      argv.push(String(a.job).slice(0, 120));
      if (a.schedule) argv.push('--schedule', String(a.schedule).slice(0, 120));
      if (a.prompt !== undefined) argv.push('--prompt', String(a.prompt).slice(0, 4000));
      if (a.name) argv.push('--name', String(a.name).slice(0, 120));
      if (a.deliver) argv.push('--deliver', String(a.deliver).slice(0, 120));
      if (a.model !== undefined) argv.push('--model', String(a.model).slice(0, 120));
      if (a.provider !== undefined) argv.push('--provider', String(a.provider).slice(0, 120));
      // no --paused toggle on edit: pause/resume are separate ops
    }
    return cliRun(argv, op.startsWith('skills.install') || op === 'skills.update' ? 180000 : 60000);
  });
  // Edge TTS, native JS (no python on user machines, warm WS per voice).
  const edgeTTS = require(path.join(__dirname, 'edge_tts_native.js'));
  app.on('before-quit', () => {});
  ipcMain.handle('tts-speak', async (_ev, { text, voice, rate, pitch, volume }) => {
    const clean = String(text || '').slice(0, 2000);
    if (!clean.trim()) return { ok: false, error: 'empty' };
    const buf = await edgeTTS.synth(
      clean, voice || 'en-US-GuyNeural',
      rate || '+0%', pitch || '+0Hz', volume || '+0%',
    );
    if (!buf || !buf.length) throw new Error('tts produced no audio (voice may be retired)');
    return { ok: true, audio: buf.toString('base64') };
  });
  // ── Self-update (GitHub releases) ──
  // Channel baked at build time in release/channel.json. The renderer
  // drives check -> download -> install; picked asset cached main-side.
  const updater = require(path.join(__dirname, 'updater.js'));
  let updCache = null; // {rel, pick}
  ipcMain.handle('jarvis-updates', async (_ev, op, args) => {
    const a = args || {};
    if (op === 'version') return { version: app.getVersion() };
    if (op === 'check') {
      const rel = await updater.check(app.getVersion());
      if (!rel.configured) return rel;
      const pick = updater.pickAsset(rel.assets || [], rel.latest, app.getVersion());
      updCache = { rel, pick };
      return { ...rel, pick: pick ? { name: pick.name, size: pick.size, isPatch: !!pick.isPatch, expectedSha256: pick.expectedSha256 || null } : null };
    }
    if (op === 'download') {
      if (!updCache || !updCache.pick) throw new Error('check first — no update picked');
      const win = BrowserWindow.getAllWindows()[0];
      const file = await updater.download(updCache.pick, (pct) => {
        try { if (win && !win.isDestroyed()) win.webContents.send('jarvis-update-progress', pct); } catch {}
      });
      return { file, isPatch: !!updCache.pick.isPatch };
    }
    if (op === 'install') {
      const file = a.file;
      if (!file || !fs.existsSync(file)) throw new Error('downloaded file missing — download first');
      const isPatch = !!(updCache && updCache.pick && updCache.pick.isPatch);
      return updater.install(file, { isPatch });
    }
    throw new Error('updates op not allowed: ' + op);
  });
  // ── Hermes gateway: find it, or start it ourselves ──
  // `hermes serve` binds :0 (random port). The page can't read /proc,
  // main can: match LISTEN sockets to hermes-owned pids via inode.
  function hermesPortsSync() {
    const ports = new Set();
    try {
      const tcp = fs.readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1);
      const listen = new Set();
      for (const line of tcp) {
        const f = line.trim().split(/\s+/);
        if (f.length < 10 || f[3] !== '0A') continue; // LISTEN only
        const port = parseInt(f[1].split(':')[1], 16);
        if (port > 0) listen.add(port + ':' + f[9]); // port:inode
      }
      const byInode = new Map();
      for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
        let exe = '';
        try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch {}
        let cmd = '';
        try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch {}
        // match the serve process itself, not anything under a .hermes path
        // (that false-positives Electron, whose dist lives under .hermes/)
        const exeBase = exe.split('/').pop();
        if (!(exeBase === 'hermes' || /hermes_cli/.test(cmd) || /hermes serve/.test(cmd))) continue;
        let fds = [];
        try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
        for (const fd of fds) {
          try {
            const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
            const m = link.match(/^socket:\[(\d+)\]$/);
            if (m) byInode.set(m[1], true);
          } catch {}
        }
      }
      for (const entry of listen) {
        const [port, inode] = entry.split(':');
        if (byInode.has(inode)) ports.add(parseInt(port, 10));
      }
    } catch (e) { console.error('[jarvis-ports]', e.message); }
    return [...ports].sort((a, b) => a - b);
  }
  ipcMain.handle('hermes-ports', async () => ({ ports: hermesPortsSync() }));

  // Start our own gateway when none is running. Detached `hermes serve`
  // on :0, then poll the scan until its port appears (or time out).
  // Killed on app quit only if WE started it.
  let ownGateway = null;
  let ensuring = null; // in-flight ensure (concurrent clicks share it)
  ipcMain.handle('hermes-ensure', async () => {
    if (hermesPortsSync().length) return { started: false, ports: hermesPortsSync() };
    if (ensuring) return ensuring;
    ensuring = (async () => {
    const bin = path.join(os.homedir(), '.local', 'bin', 'hermes');
    if (!fs.existsSync(bin)) {
      return { started: false, ports: [], error: 'no hermes CLI — install Hermes for the live backend (mock works offline)' };
    }
    try {
      ownGateway = spawn(bin, ['serve', '--skip-build'], {
        detached: true, stdio: 'ignore',
      });
      ownGateway.unref();
      ownGateway.on('error', () => { ownGateway = null; });
    } catch (e) {
      return { started: false, ports: [], error: 'could not start hermes: ' + e.message };
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      await new Promise((r) => setTimeout(r, 1000));
      const ports = hermesPortsSync();
      if (ports.length) return { started: true, ports };
      if (!ownGateway) break;
    }
    return { started: false, ports: [], error: 'hermes serve did not come up in 45s' };
    })();
    try { return await ensuring; }
    finally { ensuring = null; }
  });
  // only kill what we started, and never mid-startup (the poll above holds
  // `ensuring` — quitting mid-ensure leaves the gateway running, harmless)
  app.on('before-quit', () => {
    if (ensuring) return;
    try { if (ownGateway) process.kill(-ownGateway.pid); } catch {}
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
