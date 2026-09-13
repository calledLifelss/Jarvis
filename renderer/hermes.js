// Hermes: WS JSON-RPC to local `hermes serve` (:9119). Token from GET /,
// then session.create -> prompt.submit -> message.delta -> message.complete.
// Model list: model.options {explicit_only} -> providers[].models.
// Switch: config.set {session_id, key:'model', value:'<model> --provider <slug> --session'}.
(function () {
  // Hermes host is configurable (Backends tab) so the app can talk to a
  // remote `hermes serve` on the LAN/VPN, not just localhost.
  function getHost() {
    try { return localStorage.getItem('jarvis-hermes-host') || '127.0.0.1:9119'; }
    catch { return '127.0.0.1:9119'; }
  }
  function setHost(h) {
    const clean = String(h || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!clean) throw new Error('empty host');
    try { localStorage.setItem('jarvis-hermes-host', clean); } catch {}
    disconnect();
    return clean;
  }
  const base = () => 'http://' + getHost();
  const wsBase = () => 'ws://' + getHost();

  const st = {
    ws: null, connected: false, sessionId: null, storedSessionId: null,
    model: null, provider: null, token: null,
    onEvent: null, // legacy single handler (kept for compat)
    _subs: new Set(), // extra event subscribers: fn(type, data)
    _nid: 0, _pending: new Map(),
  };

  function onHermesEvent(fn) {
    st._subs.add(fn);
    return () => st._subs.delete(fn);
  }

  function rpc(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!st.ws || st.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Hermes socket not connected'));
        return;
      }
      const id = 'j' + (++st._nid);
      const timer = setTimeout(() => {
        st._pending.delete(id);
        reject(new Error('RPC timeout: ' + method));
      }, timeoutMs);
      st._pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || ('RPC error: ' + method)));
        else resolve(msg.result);
      });
      st.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async function fetchToken() {
    let res;
    try {
      res = await fetch(base() + '/', { cache: 'no-store' });
    } catch {
      throw new Error('cannot reach hermes at ' + getHost() + ' — is `hermes serve` running there?');
    }
    if (!res.ok) throw new Error('hermes serve HTTP ' + res.status);
    const html = await res.text();
    const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
    if (!m) throw new Error('no session token in serve response');
    return m[1];
  }

  async function connect() {
    disconnect();
    st.token = await fetchToken();
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase() + '/api/ws?token=' + encodeURIComponent(st.token));
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('WS connect timeout')); }, 8000);
      ws.onopen = () => { clearTimeout(timer); st.ws = ws; st.connected = true; resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('WS connection failed')); };
      ws.onclose = () => { st.connected = false; st.ws = null; emit('conn', { connected: false }); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.id && st._pending.has(m.id)) {
          const cb = st._pending.get(m.id);
          st._pending.delete(m.id);
          cb(m);
        } else if (m.method === 'event' && m.params) {
          routeEvent(m.params);
        }
      };
    });
    emit('conn', { connected: true });
    return true;
  }

  function disconnect() {
    try { if (st.ws) st.ws.close(); } catch {}
    st.ws = null;
    st.connected = false;
  }

  function routeEvent(ev) {
    // ev: {type, session_id?, payload}
    emit(ev.type, ev);
  }

  function emit(type, data) {
    try { if (st.onEvent) st.onEvent(type, data); } catch (e) { console.error('[hermes]', e); }
    for (const fn of [...st._subs]) { try { fn(type, data); } catch (e) { console.error('[hermes-sub]', e); } }
  }

  async function ensureSession() {
    if (st.sessionId) return st.sessionId;
    const r = await rpc('session.create', { source: 'jarvis-chatroom', title: 'Jarvis chat' });
    st.sessionId = r.session_id;
    st.storedSessionId = r.stored_session_id;
    if (r.info) { st.model = r.info.model || null; st.provider = r.info.provider || null; }
    emit('session', { session_id: st.sessionId, model: st.model, provider: st.provider });
    return st.sessionId;
  }

  async function modelOptions() {
    const params = { explicit_only: true };
    if (st.sessionId) params.session_id = st.sessionId;
    const r = await rpc('model.options', params);
    return r; // {providers:[{slug,name,models[],is_current...}], model, provider}
  }

  async function setModel(model, providerSlug) {
    const sid = await ensureSession();
    const value = `${model} --provider ${providerSlug} --session`;
    const r = await rpc('config.set', { session_id: sid, key: 'model', value });
    st.model = model;
    st.provider = providerSlug;
    emit('model', { model, provider: providerSlug, deferred: r && r.deferred });
    return r;
  }

  // Submit text; streams via onEvent('message.delta'...). Resolves with full text on complete.
  // opts.stopToken = {stopped:false} — polled to abort locally after session.interrupt.
  async function chat(text, { onDelta, stopToken } = {}) {
    const sid = await ensureSession();
    return new Promise((resolve, reject) => {
      let full = '';
      let settled = false;
      const finish = (fn, val) => { if (!settled) { settled = true; st.onEvent = prev; fn(val); } };
      const prev = st.onEvent;
      const handler = (type, data) => {
        if (prev) { try { prev(type, data); } catch {} }
        const ev = data && data.type ? data : { type, payload: data };
        const evSid = data && data.session_id;
        if (evSid && evSid !== sid && evSid !== st.storedSessionId) return;
        if (ev.type === 'message.delta' && ev.payload && typeof ev.payload.text === 'string') {
          if (stopToken && stopToken.stopped) return; // dropped: user hit stop
          full += ev.payload.text;
          if (onDelta) { try { onDelta(ev.payload.text, full); } catch {} }
        } else if (ev.type === 'message.complete') {
          if (ev.payload && typeof ev.payload.text === 'string' && !(stopToken && stopToken.stopped)) full = ev.payload.text;
          finish(resolve, { text: full, usage: ev.payload && ev.payload.usage, stopped: !!(stopToken && stopToken.stopped) });
        } else if (ev.type === 'session.info' && ev.payload) {
          if (ev.payload.model) st.model = ev.payload.model;
          if (ev.payload.provider) st.provider = ev.payload.provider;
          emit('model', { model: st.model, provider: st.provider });
        }
      };
      st.onEvent = handler;
      rpc('prompt.submit', { session_id: sid, text }, 120000).then((ack) => {
        if (!ack || ack.status === 'error') {
          finish(reject, new Error('submit rejected: ' + JSON.stringify(ack).slice(0, 200)));
        }
        // else: completion arrives as events; safety timeout
        setTimeout(() => {
          if (st.onEvent === handler && !settled) {
            if (full) finish(resolve, { text: full, usage: null, timedOut: true });
            else finish(reject, new Error('turn timed out with no output'));
          }
        }, 300000);
      }).catch((e) => finish(reject, e));
    });
  }

  async function newSession() {
    st.sessionId = null;
    st.storedSessionId = null;
    return ensureSession();
  }

  async function listSessions() {
    const r = await rpc('session.list', {});
    return (r && r.sessions) || [];
  }

  // Open a previous session by stored id: resume -> full history -> render.
  async function openSession(storedId) {
    const r = await rpc('session.resume', { session_id: storedId, source: 'jarvis-chatroom' });
    st.sessionId = r.session_id;
    st.storedSessionId = r.resumed || storedId;
    if (r.info) { st.model = r.info.model || null; st.provider = r.info.provider || null; }
    let msgs = r.messages || [];
    try {
      const h = await rpc('session.history', { session_id: st.sessionId });
      if (h && h.messages && h.messages.length) msgs = h.messages;
    } catch {}
    emit('session', { session_id: st.sessionId, model: st.model, provider: st.provider, opened: st.storedSessionId });
    return { messages: msgs, info: r.info, storedId: st.storedSessionId };
  }

  async function history() {
    if (!st.sessionId) return [];
    const h = await rpc('session.history', { session_id: st.sessionId });
    return (h && h.messages) || [];
  }

  // Slash commands: catalog + live completion + exec (output renders inline).
  let slashCache = null;
  async function slashCatalog() {
    if (slashCache) return slashCache;
    const r = await rpc('commands.catalog', {});
    slashCache = (r && r.pairs) || [];
    return slashCache;
  }
  async function slashComplete(text) {
    const sid = st.sessionId;
    const r = await rpc('complete.slash', sid ? { text, session_id: sid } : { text });
    return (r && r.items) || [];
  }
  async function slashExec(command) {
    const sid = await ensureSession();
    const r = await rpc('slash.exec', { session_id: sid, command: command.replace(/^\/+/, '') });
    return r;
  }

  // Stop the live turn server-side (best effort — never throws).
  async function interrupt() {
    if (!st.sessionId) return false;
    try {
      await rpc('session.interrupt', { session_id: st.sessionId }, 8000);
      return true;
    } catch { return false; }
  }

  window.HermesBackend = {
    state: st, connect, disconnect, ensureSession, modelOptions, setModel, chat, newSession, rpc,
    getHost, setHost,
    listSessions, openSession, history, onEvent: onHermesEvent, interrupt,
    approve: (requestId, choice, sessionId) => rpc('approval.respond', {
      choice, request_id: requestId, ...(sessionId ? { session_id: sessionId } : {}),
    }),
    slashCatalog, slashComplete, slashExec,
  };
})();
