// Chatroom: orb, Hermes WS + model picker, mock fallback, voice-out,
// rail, settings, mini-mode.
(function () {
  const messagesEl = document.getElementById('messages');
  const input = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const btnClip = document.getElementById('btn-clip');
  const fileInput = document.getElementById('file-input');
  const chipsEl = document.getElementById('attach-chips');
  const backendPill = document.getElementById('backend-status');
  const backendSelect = document.getElementById('backend-select');
  const hermesStatus = document.getElementById('hermes-status');
  const modelSelect = document.getElementById('model-select');
  const modelHint = document.getElementById('model-hint');
  const orbModel = document.getElementById('orb-model');
  function showModel(m) {
    if (orbModel) orbModel.innerHTML = 'model — <b>' + String(m || '?').replace(/</g, '&lt;') + '</b>';
  }

  window.voiceOn = true;
  const attached = [];
  let busy = false;

  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // message row: timestamp gutter + label + body
  const ROLE_LABEL = { user: 'you', agent: 'jarvis', sys: '' };
  function nowTs() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function wireCopyButtons(root) {
    root.querySelectorAll('.code-copy').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.parentElement.nextElementSibling.textContent); b.textContent = 'copied ✓'; }
        catch { b.textContent = 'copy failed'; }
        setTimeout(() => { b.textContent = 'copy'; }, 1500);
      });
    });
  }
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.setAttribute('data-ts', nowTs());
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (role === 'sys') {
      body.textContent = text;
    } else {
      const lab = document.createElement('span');
      lab.className = 'msg-label';
      lab.textContent = ROLE_LABEL[role] || role;
      body.appendChild(lab);
      const content = document.createElement('div');
      content.innerHTML = renderRich(text);
      body.appendChild(content);
      wireCopyButtons(body);
    }
    div.appendChild(body);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function renderRich(text) {
    const parts = String(text).split(/(```[\s\S]*?```)/g);
    return parts.map((part) => {
      if (part.startsWith('```')) {
        const m = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
        const lang = (m && m[1]) || 'code';
        const code = escHtml((m && m[2]) || part.slice(3, -3));
        return `<div class="codeblock"><div class="code-head"><span>${escHtml(lang)}</span><button class="code-copy">copy</button></div><pre>${code}</pre></div>`;
      }
      let h = escHtml(part);
      h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
      return h.replace(/\n/g, '<br>');
    }).join('');
  }

  // streamed row done: full render + copy buttons
  function finalizeBubble(div, full) {
    if (!div || !div.isConnected) return;
    const body = div.querySelector('.msg-body');
    if (!body) return;
    const lab = body.querySelector('.msg-label');
    body.innerHTML = '';
    if (lab) body.appendChild(lab);
    const content = document.createElement('div');
    content.innerHTML = renderRich(full);
    body.appendChild(content);
    wireCopyButtons(body);
  }

  // status row: hairline sweep + label + elapsed
  function addTyping() {
    const div = document.createElement('div');
    div.className = 'msg agent live';
    div.setAttribute('data-ts', nowTs());
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = '<span class="tline"><span class="tbar"></span></span><span class="typing-label">jarvis is thinking</span>';
    div.appendChild(body);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  // feed host sits inside the turn block, below the user msg
  function addActivityHost() {
    const host = document.createElement('div');
    host.className = 'msg agent act-host-msg';
    host.innerHTML = '<div id="activity"></div>';
    messagesEl.appendChild(host);
    return host;
  }

  function orbFor(text) {
    if (/search|web|find|lookup|browse/i.test(text)) return ['searching', 'Searching…', 'Searching the Web…'];
    if (/code|build|fix|write|debug|implement/i.test(text)) return ['coding', 'Coding…', 'Working on your code…'];
    return ['thinking', 'Thinking…', 'Reasoning…'];
  }

  // --- Backends -----------------------------------------------------------
  const backends = {
    mock: {
      name: 'mock',
      async *chat(text) {
        const [s, c, d] = orbFor(text);
        window.setOrbState(s, c, d + ' (mock)');
        await new Promise((r) => setTimeout(r, 600));
        window.setOrbState('speaking', 'Answering…', 'Streaming reply… (mock)');
        const reply = `Mock brain 🧠\nYou said: "${text}"\n\nSwitch to Hermes for real answers.`;
        for (let i = 0; i < reply.length; i += 6) {
          yield reply.slice(i, i + 6);
          await new Promise((r) => setTimeout(r, 12));
        }
        window.setOrbState('idle', 'Idle', 'Ready.');
      },
    },
    hermes: {
      name: 'hermes',
      async *chat(text, hooks = {}) {
        const [s, c, d] = orbFor(text);
        window.setOrbState(s, c, 'Hermes: ' + d);
        window.Activity.beginTurn();
        // Subscribe raw events -> activity feed for this turn
        const unsub = window.HermesBackend.onEvent((type, data) => window.Activity.event(type, data));
        let full = '';
        try {
          const res = await window.HermesBackend.chat(text, {
            onDelta: (chunk) => {
              full += chunk;
              if (hooks.onDelta) hooks.onDelta(chunk, full);
            },
          });
          full = (res && res.text) || full;
        } finally {
          unsub();
        }
        window.setOrbState('speaking', 'Answering…', 'Hermes reply ready…');
        yield full;
        window.setOrbState('idle', 'Idle', 'Ready.');
      },
    },
  };
  let activeBackend = 'hermes'; // Hermes-first; falls back to mock if unreachable

  let stopToken = null; // {stopped} for the live turn
  let liveCtx = null; // {typing, agentDiv, full} so stop can finalize UI
  const sendQueue = []; // messages scheduled while the agent works
  const btnSchedule = document.getElementById('btn-schedule');

  function refreshScheduleBtn() {
    if (!btnSchedule) return;
    const hasText = input.value.trim().length > 0;
    btnSchedule.classList.toggle('hidden', !(busy && hasText));
    btnSchedule.textContent = sendQueue.length ? `Schedule (${sendQueue.length} queued)` : 'Schedule';
  }
  if (btnSchedule) {
    btnSchedule.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      sendQueue.push({ text, attached: attached.slice() });
      input.value = '';
      addMsg('sys', `⏳ Queued for after this turn (${sendQueue.length}): ${text.slice(0, 80)}`);
      refreshScheduleBtn();
      input.focus();
    });
  }
  input.addEventListener('input', refreshScheduleBtn);

  function drainQueue() {
    if (!sendQueue.length) return;
    const next = sendQueue.shift();
    refreshScheduleBtn();
    input.value = next.text;
    attached.length = 0;
    for (const f of (next.attached || [])) attached.push(f);
    sendMessage();
  }

  function setSendMode(mode) {
    // mode: 'send' | 'stop'
    const btn = btnSend;
    if (mode === 'stop') {
      btn.classList.add('stop');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>Stop</span>';
    } else {
      btn.classList.remove('stop');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904zM6 12h16"/></svg>';
    }
  }

  async function stopAll() {
    if (stopToken) stopToken.stopped = true;
    try { window.EdgeTTS.stop(); } catch {}
    try { speechSynthesis.cancel(); } catch {}
    if (activeBackend === 'hermes') {
      try { await window.HermesBackend.interrupt(); } catch {}
    }
    if (liveCtx) {
      try { liveCtx.typing.remove(); } catch {}
      const { agentDiv, full } = liveCtx;
      if (agentDiv) {
        agentDiv.style.display = '';
        const body = agentDiv.querySelector('.msg-body');
        const hasText = body && body.textContent.trim();
        if (full && body && !hasText) {
          finalizeBubble(agentDiv, full);
        } else if (body && !hasText) {
          body.textContent = '■ stopped.';
          agentDiv.classList.add('stopped-note');
        }
      }
    }
    window.Activity.endTurn();
    window.setOrbState('idle', 'Idle', 'Stopped. Ready.');
    // clear any error tint the interrupt may have flashed
    setTimeout(() => { if (!busy) window.setOrbState('idle', 'Idle', 'Stopped. Ready.'); }, 400);
    busy = false;
    setSendMode('send');
    liveCtx = null;
    stopToken = null;
    refreshScheduleBtn();
  }

  async function sendMessage() {
    if (busy) { stopAll(); return; } // send button IS the stop button mid-turn
    const text = input.value.trim();
    if (!text && !attached.length) return;
    // first message docks the giant stage into a slim bar
    const layer = document.getElementById('orb-layer');
    if (layer && !layer.classList.contains('docked') && document.querySelectorAll('.msg.user').length === 0) {
      layer.classList.add('docked');
    }
    // slash commands run locally and render inline
    if (text.startsWith('/') && activeBackend === 'hermes' && !attached.length) {
      input.value = '';
      addMsg('user', text);
      window.Activity.beginTurn();
      try {
        await window.SlashPalette.tryExec(text, addMsg);
      } finally {
        window.Activity.endTurn();
      }
      busy = false;
      setSendMode('send');
      input.focus();
      return;
    }
    busy = true;
    stopToken = { stopped: false };
    setSendMode('stop');
    refreshScheduleBtn();
    // one #activity host at a time (ids must stay unique)
    const stale = document.getElementById('activity');
    if (stale) stale.removeAttribute('id');
    addMsg('user', text || '(files attached)');
    input.value = '';
    chipsEl.innerHTML = '';
    addActivityHost();
    const typing = addTyping();
    const agentDiv = addMsg('agent', '');
    agentDiv.style.display = 'none';
    let full = '';
    let firstDelta = false;
    liveCtx = { typing, agentDiv, full: '' };
    const render = (t) => {
      if (stopToken && stopToken.stopped) return;
      if (!firstDelta && t) {
        firstDelta = true;
        try { typing.remove(); } catch {}
        if (agentDiv && agentDiv.isConnected) agentDiv.style.display = '';
      }
      if (!agentDiv || !agentDiv.isConnected) return;
      // stream into the row body; the msg-label must survive every repaint
      const body = agentDiv.querySelector('.msg-body');
      if (!body) return;
      const lab = body.querySelector('.msg-label');
      body.innerHTML = '';
      if (lab) body.appendChild(lab);
      const content = document.createElement('div');
      content.innerHTML = renderRich(t);
      body.appendChild(content);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    try {
      const gen = backends[activeBackend].chat(text, { onDelta: (_c, f) => render(f), stopToken });
      for await (const chunk of gen) {
        if (stopToken && stopToken.stopped) break;
        full += chunk;
        liveCtx.full = full;
        render(full);
      }
      if (stopToken && stopToken.stopped) {
        // stopAll already finalized UI; just exit
        attached.length = 0;
        input.focus();
        return;
      }
      if (!full) { typing.remove(); agentDiv.remove(); }
      else finalizeBubble(agentDiv, full);
      window.Activity.endTurn();
      if (full) window.speakText(full);
    } catch (e) {
      try { typing.remove(); } catch {}
      agentDiv.style.display = '';
      window.Activity.endTurn();
      const msg = String((e && e.message) || e);
      const errBody = agentDiv.querySelector('.msg-body');
      const setErr = (t) => {
        if (errBody) {
          const lab = errBody.querySelector('.msg-label');
          errBody.innerHTML = '';
          if (lab) errBody.appendChild(lab);
          const c = document.createElement('div');
          c.textContent = t;
          errBody.appendChild(c);
        } else { agentDiv.textContent = t; }
      };
      if (activeBackend === 'hermes' && /not connected|timeout|failed|WS/i.test(msg)) {
        setErr('Hermes unreachable (' + msg + ') — mock fallback:\nMock 🧠 ' + text);
        window.setOrbState('error', 'Hermes down', 'Fell back to mock.');
        setTimeout(() => window.setOrbState('idle', 'Idle', 'Ready.'), 2500);
      } else {
        setErr('Error: ' + msg);
        window.setOrbState('error', 'Error', msg.slice(0, 100));
      }
    }
    attached.length = 0;
    busy = false;
    setSendMode('send');
    liveCtx = null;
    stopToken = null;
    refreshScheduleBtn();
    input.focus();
    // queued messages go next, one turn at a time
    if (sendQueue.length) {
      setTimeout(drainQueue, 400);
    }
  }

  btnSend.addEventListener('click', sendMessage);
  // docked-orb messages arrive here on restore
  window.addEventListener('focus', () => {
    let pending = null;
    try { pending = localStorage.getItem('jarvis-mini-pending'); localStorage.removeItem('jarvis-mini-pending'); } catch {}
    if (pending && pending.trim()) {
      input.value = pending.trim();
      sendMessage();
    }
  });
  // welcome-stage starter prompts
  document.querySelectorAll('#stage-hints button').forEach((b) => {
    b.addEventListener('click', () => {
      input.value = b.dataset.q || b.textContent;
      sendMessage();
    });
  });
  // Slash palette + Providers + Packs + InfoDots + Skills + Cron init
  try { window.SlashPalette && window.SlashPalette.init(); } catch {}
  try { window.Providers && window.Providers.init(); } catch {}
  try { window.Packs && window.Packs.init(); } catch {}
  try { window.InfoDots && window.InfoDots.attachAll(); } catch {}
  try { window.Skills && window.Skills.init(); } catch {}
  try { window.Cron && window.Cron.init(); } catch {}
  // model picker follows the mapped provider
  window.JarvisApplyProvider = async function (providerId) {
    if (!providerId) { await fillModels(); return; }
    await fillModels(providerId);
  };
  // Esc stops a live turn too
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && busy) { stopAll(); return; }
    if (e.key === 'Enter') sendMessage();
  });

  // --- Attachments ---------------------------------------------------------
  btnClip.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    for (const f of fileInput.files) {
      attached.push(f);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = (f.type.startsWith('image/') ? '🖼 ' : '📎 ') + f.name;
      chipsEl.appendChild(chip);
    }
    fileInput.value = '';
  });

  // --- Hermes connect + model selector -------------------------------------
  async function fillModels(onlyProvider) {
    modelSelect.innerHTML = '<option>loading…</option>';
    try {
      const opts = await window.HermesBackend.modelOptions();
      const provs = (opts && opts.providers) || [];
      modelSelect.innerHTML = '';
      let count = 0;
      for (const p of provs) {
        if (onlyProvider && p.slug !== onlyProvider) continue;
        if (!p.models || !p.models.length) continue;
        const g = document.createElement('optgroup');
        g.label = p.name || p.slug;
        for (const m of p.models.slice(0, 60)) {
          const o = document.createElement('option');
          o.value = JSON.stringify({ model: m, provider: p.slug });
          o.textContent = m;
          if ((opts.model === m && (opts.provider === p.slug || !opts.provider)) || p.is_current) o.selected = true;
          g.appendChild(o);
          count++;
        }
        modelSelect.appendChild(g);
      }
      const cur = window.HermesBackend.state;
      modelHint.textContent = `current: ${cur.model || opts.model || '?'} · ${count} models · switch applies to this chat (--session)`;
      showModel(cur.model || opts.model);
      // honor saved backend->provider mapping
      try {
        const m = window.Providers && window.Providers.getMap();
        const want = m && m.hermes;
        if (want && !onlyProvider) {
          const has = provs.some((p) => p.slug === want && p.models && p.models.length);
          if (has) { await fillModels(want); return; }
        }
      } catch {}
    } catch (e) {
      modelSelect.innerHTML = '<option>unavailable</option>';
      modelHint.textContent = 'model list failed: ' + (e.message || e);
    }
  }

  modelSelect.addEventListener('change', async () => {
    try {
      const { model, provider } = JSON.parse(modelSelect.value);
      modelHint.textContent = 'switching…';
      await window.HermesBackend.setModel(model, provider);
      modelHint.textContent = `current: ${model} · switched ✅`;
      showModel(model);
      addMsg('sys', `Model → ${model} (provider ${provider})`);
    } catch (e) {
      modelHint.textContent = 'switch failed: ' + (e.message || e);
    }
  });

  async function connectHermes() {
    hermesStatus.textContent = '● connecting…';
    try {
      await window.HermesBackend.connect();
      await window.HermesBackend.ensureSession();
      const cur = window.HermesBackend.state;
      hermesStatus.textContent = '● live';
      hermesStatus.classList.add('ok');
      backendPill.textContent = 'hermes';
      backendSelect.value = 'hermes';
      activeBackend = 'hermes';
      await fillModels();
      refreshSessCount();
      try { document.getElementById('rail-conn').textContent = 'live · ' + (cur.model || 'model?'); } catch {}
      addMsg('sys', `Hermes connected ✅ model: ${cur.model || '?'} — type something 👇`);
      window.setOrbState('idle', 'Idle', 'Hermes live. Ready.');
      // live event -> orb reactions (tool activity etc.)
      window.HermesBackend.state.onEvent = (type, data) => {
        if (type === 'message.delta' && window.getOrbState() !== 'speaking') {
          window.setOrbState('speaking', 'Answering…', 'Hermes reply streaming…');
        }
      };
    } catch (e) {
      hermesStatus.textContent = '● offline (' + (e.message || e).slice(0, 40) + ')';
      backendPill.textContent = 'mock';
      backendSelect.value = 'mock';
      activeBackend = 'mock';
      try { document.getElementById('rail-conn').textContent = 'offline — mock'; } catch {}
      addMsg('sys', 'Hermes unreachable (' + (e.message || e).slice(0, 90) + ') — on mock. Same machine: run `hermes serve`. Another PC: set the Hermes host above to your LAN/VPN address.');
      window.setOrbState('idle', 'Idle', 'Mock mode. Ready.');
    }
  }

  // Approval answers: agent is BLOCKED until approval.respond lands — answer fast.
  window.ActivityAnswer = async function (requestId, choice, sessionId) {
    try {
      await window.HermesBackend.approve(requestId, choice, sessionId);
    } catch (e) {
      addMsg('sys', '❌ approval reply failed: ' + (e.message || e));
    }
  };

  // reconnect button lives in backends tab
  try {
    const hostInput = document.getElementById('hermes-host');
    if (hostInput && window.HermesBackend.getHost) {
      hostInput.value = window.HermesBackend.getHost();
      hostInput.addEventListener('change', () => {
        try {
          const h = window.HermesBackend.setHost(hostInput.value);
          hostInput.value = h;
          addMsg('sys', 'Hermes host → ' + h + ' — reconnecting…');
          if (activeBackend === 'hermes') connectHermes();
        } catch (e) { addMsg('sys', 'Bad host: ' + (e.message || e)); }
      });
    }
  } catch {}
  document.getElementById('hermes-reconnect').addEventListener('click', () => {
    hermesStatus.classList.remove('ok');
    connectHermes();
  });
  document.getElementById('hermes-newchat').addEventListener('click', async () => {
    try {
      await window.HermesBackend.newSession();
      await fillModels();
      messagesEl.innerHTML = '';
      addMsg('sys', 'Fresh Hermes chat started ✅');
    } catch (e) { addMsg('sys', 'new chat failed: ' + (e.message || e)); }
  });

  backendSelect.addEventListener('change', () => {
    activeBackend = backendSelect.value;
    backendPill.textContent = activeBackend;
    addMsg('sys', 'Backend switched to ' + activeBackend);
    if (activeBackend === 'hermes' && !window.HermesBackend.state.connected) connectHermes();
  });

  // --- Sessions: inline rail list -----------------------------------
  const sessToggle = document.getElementById('sess-toggle');
  const sessMenu = document.getElementById('sess-menu');
  const sessVeil = document.getElementById('sess-veil'); // inert legacy hook
  const sessCount = document.getElementById('sess-count');
  let sessCache = null, sessCacheAt = 0;
  const SESS_TTL = 30000;
  async function refreshSessCount() {
    try {
      const sessions = await window.HermesBackend.listSessions();
      sessCache = sessions;
      sessCacheAt = Date.now();
      sessCount.textContent = sessions.length;
    } catch { sessCount.textContent = '–'; }
  }
  const sessList = document.getElementById('sess-list');
  function setSessMenu(open) {
    sessMenu.classList.toggle('hidden', !open);
    sessToggle.classList.toggle('open', open);
    sessToggle.textContent = open ? 'Hide' : 'List';
    if (open) loadSessions();
  }
  function fmtDate(ts) {
    try {
      const d = new Date(ts * 1000);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return sameDay ? hm : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hm;
    } catch { return ''; }
  }
  async function loadSessions(force) {
    // cached list first, refresh in background
    if (!force && sessCache && Date.now() - sessCacheAt < SESS_TTL) {
      renderSessionRows(sessCache);
      refreshSessionsBg();
      return;
    }
    sessList.innerHTML = '<div class="sess-empty">loading…</div>';
    try {
      const sessions = await window.HermesBackend.listSessions();
      sessCache = sessions;
      sessCacheAt = Date.now();
      sessCount.textContent = sessions.length;
      renderSessionRows(sessions);
    } catch (e) {
      sessList.innerHTML = '<div class="sess-empty">failed: ' + String(e.message || e).slice(0, 80) + '</div>';
    }
  }
  async function refreshSessionsBg() {
    try {
      const sessions = await window.HermesBackend.listSessions();
      sessCache = sessions;
      sessCacheAt = Date.now();
      sessCount.textContent = sessions.length;
      // only re-render if menu still open (don't yank rows mid-click)
      if (!sessMenu.classList.contains('hidden')) renderSessionRows(sessions);
    } catch {}
  }
  function renderSessionRows(sessions) {
      const cur = window.HermesBackend.state.storedSessionId;
      sessList.innerHTML = '';
      if (!sessions.length) {
        sessList.innerHTML = '<div class="sess-empty">no sessions yet — start one with ＋ New Session</div>';
        return;
      }
      // newest first
      sessions.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
      for (const s of sessions.slice(0, 60)) {
        const b = document.createElement('button');
        b.className = 'sess-item' + (s.id === cur ? ' current' : '');
        const title = (s.title && s.title.trim()) || (s.preview && s.preview.trim()) || 'untitled';
        b.innerHTML = `<span class="t"></span><span class="m">${s.message_count || 0} msgs</span><span class="d"></span>`;
        b.querySelector('.t').textContent = title;
        b.querySelector('.d').textContent = fmtDate(s.started_at);
        b.title = title;
        b.addEventListener('click', () => openSessionById(s.id, title));
        sessList.appendChild(b);
      }
  }
  function renderMessages(msgs) {
    messagesEl.innerHTML = '';
    let shown = 0;
    for (const m of msgs.slice(-120)) {
      const role = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'agent' : 'sys';
      const text = m.text || m.content || '';
      if (!text.trim()) continue;
      addMsg(role, text.length > 4000 ? text.slice(0, 4000) + ' …' : text);
      shown++;
    }
    if (!shown) addMsg('sys', '(empty session)');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  async function openSessionById(storedId, title) {
    setSessMenu(false);
    sessCacheAt = 0; // opened chat jumps to top next open
    const layer = document.getElementById('orb-layer');
    if (layer) layer.classList.add('docked'); // history needs room, not stage
    window.setOrbState('thinking', 'Opening…', 'Loading: ' + String(title || storedId).slice(0, 60));
    addMsg('sys', 'Opening session…');
    try {
      const { messages, info } = await window.HermesBackend.openSession(storedId);
      activeBackend = 'hermes';
      backendSelect.value = 'hermes';
      backendPill.textContent = 'hermes';
      renderMessages(messages);
      if (info && info.model) showModel(info.model);
      await fillModels();
      window.setOrbState('idle', 'Idle', 'Session loaded. Ready.');
    } catch (e) {
      addMsg('sys', '❌ open failed: ' + (e.message || e));
      window.setOrbState('error', 'Error', String(e.message || e).slice(0, 80));
      setTimeout(() => window.setOrbState('idle', 'Idle', 'Ready.'), 2500);
    }
  }
  async function startNewSession() {
    setSessMenu(false);
    sessCacheAt = 0;
    try {
      await window.HermesBackend.newSession();
      await fillModels();
      messagesEl.innerHTML = '';
      const layer = document.getElementById('orb-layer');
      if (layer) layer.classList.remove('docked');
      window.setOrbState('idle', 'Idle', 'Fresh stage. Ready.');
      addMsg('sys', 'Fresh Hermes chat started ✅');
      input.focus();
    } catch (e) { addMsg('sys', 'new chat failed: ' + (e.message || e)); }
  }
  sessToggle.addEventListener('click', () => setSessMenu(sessMenu.classList.contains('hidden')));
  document.getElementById('sess-new').addEventListener('click', startNewSession);
  document.getElementById('rail-sessions').addEventListener('click', () => setSessMenu(true));
  document.getElementById('rail-cron').addEventListener('click', () => {
    modal.classList.remove('hidden');
    document.querySelector('.tab[data-tab="cron"]').click();
    try { window.Cron && window.Cron.refresh(); } catch {}
  });

  // --- Providers & Routing Manager: full page over the chat area -----------
  (function initProvidersPage() {
    const page = document.getElementById('prov-page');
    const chat = document.querySelector('.chat-panel');
    const toggle = document.getElementById('rail-prov-toggle');
    const back = document.getElementById('prov-back');
    if (!page || !chat || !toggle) return;

    function openPageTab(name) {
      page.querySelectorAll('.tab-body').forEach((b) => b.classList.add('hidden'));
      const body = document.getElementById('tab-' + name);
      if (body) body.classList.remove('hidden');
      page.querySelectorAll('.rpt').forEach((t) =>
        t.classList.toggle('active', t.dataset.rtab === name)
      );
      try {
        if (name === 'providers' && window.Providers) window.Providers.refresh();
        if (name === 'usage' && window.Usage) window.Usage.init();
        if (name === 'combos' && window.Combos) window.Combos.init();
      } catch {}
    }

    function openPage(name) {
      chat.classList.add('hidden');
      page.classList.remove('hidden');
      toggle.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      openPageTab(name || 'providers');
    }

    function closePage() {
      page.classList.add('hidden');
      chat.classList.remove('hidden');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    window.JarvisOpenProvidersRail = openPage;
    window.JarvisCloseProvidersPage = closePage;

    toggle.addEventListener('click', () => {
      if (page.classList.contains('hidden')) openPage('providers');
      else closePage();
    });
    if (back) back.addEventListener('click', closePage);

    // Keyboard: Esc closes, Alt+1/2/3 jumps between sections while open.
    const ORDER = ['providers', 'usage', 'combos'];
    document.addEventListener('keydown', (e) => {
      if (page.classList.contains('hidden')) return;
      if (e.key === 'Escape') { closePage(); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey && ORDER[Number(e.key) - 1]) {
        e.preventDefault();
        openPageTab(ORDER[Number(e.key) - 1]);
      }
    });

    page.querySelectorAll('.rpt').forEach((t) =>
      t.addEventListener('click', () => openPageTab(t.dataset.rtab))
    );
  })();

  // --- Rail: fixed work rail. Inert legacy hooks kept for compat ---------------
  function setRail() { /* fixed rail: nothing to toggle */ }
  try {
    const rt = document.getElementById('rail-toggle');
    if (rt) rt.addEventListener('click', () => {});
    const rv = document.getElementById('rail-veil');
    if (rv) rv.addEventListener('click', () => {});
  } catch {}

  // --- Settings modal ------------------------------------------------------
  const modal = document.getElementById('settings-modal');
  document.getElementById('btn-settings').addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('settings-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('rail-backend').addEventListener('click', () => {
    modal.classList.remove('hidden');
    document.querySelector('.tab[data-tab="backends"]').click();
  });
  // scope to the modal: the rail's Providers panels are .tab-body too
  modal.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      modal.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      modal.querySelectorAll('.tab-body').forEach((b) => b.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
      // lazy-load heavy tabs on first open (serialized: concurrent CLI
      // spawns race the shared detail pane)
      try {
        if (tab.dataset.tab === 'skills' && window.Skills) await window.Skills.refresh();
        if (tab.dataset.tab === 'cron' && window.Cron) await window.Cron.refresh();
        if (tab.dataset.tab === 'themes' && window.Packs) window.Packs.render();
        if (tab.dataset.tab === 'updates' && window.Updates) window.Updates.refresh();

      } catch {}
    });
  });
  // (Appearance tab is a fixed identity note; no theme switching.)
  const savedTheme = null;
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  // --- Voice-out -------------------------------------------------
  const btnSound = document.getElementById('btn-sound');
  btnSound.addEventListener('click', () => {
    window.voiceOn = !window.voiceOn;
    btnSound.classList.toggle('on', window.voiceOn);
    if (!window.voiceOn) window.EdgeTTS.stop();
  });

  // --- Orb dock: same mini-orb as OS minimize (Wayland may swallow that event)
  document.getElementById('btn-dock').addEventListener('click', () => {
    try { window.jarvis && window.jarvis.enterMiniMode(); } catch {}
  });

  // populate TTS voice dropdowns grouped by language from EdgeTTS.VOICES
  function fillVoiceSel(sel, group) {
    sel.innerHTML = '';
    for (const v of window.EdgeTTS.VOICES.filter((x) => x.group === group)) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = `${v.label} — ${v.lang}`;
      sel.appendChild(o);
    }
  }
  const ttsVoiceSel = document.getElementById('tts-voice');
  const ttsVoiceFaSel = document.getElementById('tts-voice-fa');
  fillVoiceSel(ttsVoiceSel, 'en');
  fillVoiceSel(ttsVoiceFaSel, 'fa');
  ttsVoiceSel.value = window.EdgeTTS.getVoice();
  ttsVoiceFaSel.value = window.EdgeTTS.getFaVoice();
  ttsVoiceSel.addEventListener('change', () => window.EdgeTTS.setVoice(ttsVoiceSel.value));
  ttsVoiceFaSel.addEventListener('change', () => window.EdgeTTS.setVoice(ttsVoiceFaSel.value));
  // language mode + rate + pitch knobs (persisted in EdgeTTS)
  const ttsLangSel = document.getElementById('tts-langmode');
  if (ttsLangSel) {
    ttsLangSel.value = window.EdgeTTS.getLangMode();
    ttsLangSel.addEventListener('change', () => {
      window.EdgeTTS.setLangMode(ttsLangSel.value);
      addMsg('sys', 'Voice language → ' + ttsLangSel.options[ttsLangSel.selectedIndex].text);
    });
  }
  const ttsRateSel = document.getElementById('tts-rate');
  if (ttsRateSel) {
    ttsRateSel.value = window.EdgeTTS.getRate();
    ttsRateSel.addEventListener('change', () => window.EdgeTTS.setRate(ttsRateSel.value));
  }
  const ttsPitchSel = document.getElementById('tts-pitch');
  if (ttsPitchSel) {
    ttsPitchSel.value = window.EdgeTTS.getPitch();
    ttsPitchSel.addEventListener('change', () => window.EdgeTTS.setPitch(ttsPitchSel.value));
  }

  document.getElementById('tts-test').addEventListener('click', async () => {
    window.EdgeTTS.setVoice(ttsVoiceSel.value);
    const v = ttsVoiceSel.value;
    addMsg('sys', `🔊 Testing voice: ${v} …`);
    window.setOrbState('speaking', 'Speaking…', 'Voice test: ' + v);
    try {
      await window.EdgeTTS.speak('Hello. I am Jarvis, your chatroom assistant. This is my voice.', v);
      addMsg('sys', `✅ Voice OK: ${v}`);
    } catch (e) {
      addMsg('sys', `❌ Voice failed (${v}): ${e.message} — trying built-in fallback…`);
      try {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance('Fallback voice. Edge TTS failed.'));
      } catch {}
    }
    window.setOrbState('idle', 'Idle', 'Ready.');
  });

  document.getElementById('tts-test-fa').addEventListener('click', async () => {
    window.EdgeTTS.setVoice(ttsVoiceFaSel.value);
    const v = ttsVoiceFaSel.value;
    addMsg('sys', `🔊 تست صدای فارسی: ${v} …`);
    window.setOrbState('speaking', 'Speaking…', 'تست فارسی: ' + v);
    try {
      await window.EdgeTTS.speak('سلام! من جارویس هستم، دستیار صوتی شما. این صدای فارسی من است.', v);
      addMsg('sys', `✅ صدای فارسی سالمه: ${v}`);
    } catch (e) {
      addMsg('sys', `❌ صدای فارسی خرابه (${v}): ${e.message}`);
    }
    window.setOrbState('idle', 'Idle', 'Ready.');
  });

  // --- speakText ---------------------------------------------------
  function speechClean(text) {
    let t = String(text || '');
    // code fences read aloud terribly, collapse them
    t = t.replace(/```[\s\S]*?```/g, ' [code omitted] ');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/[*_#>]+/g, '');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // links -> text
    return t.replace(/\s+/g, ' ').trim().slice(0, 600);
  }
  window.speakText = async function (text) {
    if (!window.voiceOn) return;
    const clean = speechClean(text);
    if (!clean.trim()) return;
    window.setOrbState('speaking', 'Speaking…', clean.slice(0, 80));
    // play each chunk as it arrives instead of batching: first audio
    // starts while later chunks still synthesize
    const chunks = clean.match(/[^.!?…\n]+[.!?…]+["”)]?\s*|[^.!?…\n]+$/g) || [clean];
    const queue = chunks.map((c) => c.trim()).filter(Boolean).slice(0, 12);
    for (const chunk of queue) {
      try {
        await window.EdgeTTS.speak(chunk);
      } catch (e) {
        // that chunk falls back to the built-in voice, keep going
        try {
          await new Promise((res) => {
            const u = new SpeechSynthesisUtterance(chunk.slice(0, 400));
            u.onend = res; u.onerror = res;
            speechSynthesis.speak(u);
            setTimeout(res, 8000); // never hang the loop on a dead voice
          });
        } catch {}
      }
      if (!window.voiceOn) break;
    }
    if (window.getOrbState() === 'speaking') window.setOrbState('idle', 'Idle', 'Ready.');
  };

  addMsg('sys', 'Connecting to Hermes…');
  window.setOrbState('thinking', 'Connecting…', 'Dialing hermes serve :9119…');
  connectHermes();
})();
