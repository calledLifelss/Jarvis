// Activity feed: per-turn timeline (thinking, reasoning, tool runs with
// live timers + results + file chips, status notes, approvals).
// API: Activity.beginTurn(), Activity.pushDelta(), Activity.event(type, ev),
//      Activity.endTurn(text), Activity.approve(requestId, choice)
(function () {
  const feedHost = () => document.getElementById('activity');
  let turn = null; // {block, body, rows:Map(toolId->row), thinkLine, startedAt, done}

  function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  function fmtDur(ms) {
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function iconFor(name) {
    const n = String(name || '').toLowerCase();
    if (/terminal|shell|exec|bash/.test(n)) return '▸_';
    if (/read|cat|file/.test(n)) return '☰';
    if (/write|edit|patch|apply/.test(n)) return '✎';
    if (/search|grep|find|glob/.test(n)) return '⌕';
    if (/browser|web|fetch|http/.test(n)) return '◉';
    if (/memory/.test(n)) return '❖';
    return '⚙';
  }

  function shortArg(args) {
    if (!args || typeof args !== 'object') return '';
    const a = args;
    for (const k of ['command', 'path', 'file_path', 'file', 'filename', 'query', 'url', 'pattern', 'text']) {
      if (typeof a[k] === 'string' && a[k].trim()) {
        const v = a[k].trim();
        return v.length > 90 ? v.slice(0, 90) + '…' : v;
      }
    }
    const keys = Object.keys(a);
    return keys.length ? keys.join(', ') : '';
  }

  function fileChip(args) {
    if (!args || typeof args !== 'object') return null;
    for (const k of ['path', 'file_path', 'filename', 'file', 'target_file', 'new_path', 'dest']) {
      if (typeof args[k] === 'string' && args[k].trim()) return args[k].trim().split('/').pop();
    }
    return null;
  }

  function beginTurn() {
    endTurn(true); // seal any stray previous turn
    const block = el('div', 'act-turn');
    const head = el('button', 'act-head');
    head.innerHTML = '<span class="act-dots"><i></i><i></i><i></i></span><span class="act-title">working…</span><span class="act-time"></span><svg class="act-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const body = el('div', 'act-body');
    block.appendChild(head);
    block.appendChild(body);
    head.addEventListener('click', () => block.classList.toggle('closed'));
    const host = feedHost();
    if (host) host.appendChild(block);
    turn = { block, body, head, rows: new Map(), thinkLine: null, startedAt: Date.now(), done: false, timer: null };
    turn.timer = setInterval(() => {
      if (!turn || turn.done) return;
      const t = head.querySelector('.act-time');
      if (t) t.textContent = fmtDur(Date.now() - turn.startedAt);
    }, 250);
    return turn;
  }

  function setTitle(t) {
    if (turn && !turn.done) {
      const e = turn.head.querySelector('.act-title');
      if (e) e.textContent = t;
    }
  }

  function thinkLine(text) {
    if (!turn || turn.done || !text || !text.trim()) return;
    if (!turn.thinkLine) {
      turn.thinkLine = el('div', 'act-think');
      turn.body.appendChild(turn.thinkLine);
    }
    turn.thinkLine.textContent = text.trim().slice(0, 160);
    setTitle('thinking…');
  }

  function reasoning(text) {
    if (!turn || turn.done || !text || !text.trim()) return;
    const d = el('div', 'act-reason', text.trim().slice(0, 220));
    turn.body.appendChild(d);
  }

  function statusNote(kind, text) {
    if (!turn || turn.done || !text) return;
    // skip noisy backend warnings
    if (/title generation failed|CommandTokenSource/i.test(text)) return;
    const d = el('div', 'act-status ' + (kind || 'info'), text.slice(0, 200));
    turn.body.appendChild(d);
  }

  function toolStart(p) {
    if (!turn || turn.done) return;
    const id = p.tool_id || p.name + Date.now();
    if (turn.rows.has(id)) return;
    const row = el('div', 'act-tool running');
    row.innerHTML = '<span class="act-tool-ic"></span><span class="act-tool-main"><span class="act-tool-name"></span><span class="act-tool-arg"></span></span><span class="act-tool-dur"></span>';
    row.querySelector('.act-tool-ic').textContent = iconFor(p.name);
    row.querySelector('.act-tool-name').textContent = p.context || p.name || 'tool';
    row.querySelector('.act-tool-arg').textContent = shortArg(p.args);
    const chip = fileChip(p.args);
    if (chip) {
      const c = el('span', 'act-file', '◈ ' + chip);
      row.appendChild(c);
    }
    turn.body.appendChild(row);
    const rec = { row, startedAt: Date.now(), timer: setInterval(() => {
      const d = row.querySelector('.act-tool-dur');
      if (d) d.textContent = fmtDur(Date.now() - rec.startedAt);
    }, 200) };
    turn.rows.set(id, rec);
    setTitle('running ' + (p.name || 'tool') + '…');
  }

  function toolDone(p) {
    if (!turn) return;
    const id = p.tool_id;
    const rec = (id && turn.rows.get(id)) || [...turn.rows.values()].pop();
    if (!rec) return;
    clearInterval(rec.timer);
    rec.row.classList.remove('running');
    const failed = !!p.error;
    rec.row.classList.add(failed ? 'failed' : 'ok');
    const d = rec.row.querySelector('.act-tool-dur');
    if (d) d.textContent = fmtDur((p.duration_s ? p.duration_s * 1000 : (Date.now() - rec.startedAt)));
    if (failed) {
      const e = el('div', 'act-tool-err', String(p.error).slice(0, 220));
      rec.row.appendChild(e);
    } else if (p.result && typeof p.result.output === 'string' && p.result.output.trim()) {
      const out = p.result.output.trim();
      const prev = el('button', 'act-tool-out', out.length > 140 ? out.slice(0, 140) + '…' : out);
      prev.title = 'click to expand';
      prev.addEventListener('click', () => {
        prev.textContent = prev.dataset.open === '1' ? prev.dataset.short : prev.dataset.full;
        prev.dataset.open = prev.dataset.open === '1' ? '0' : '1';
      });
      prev.dataset.full = out.slice(0, 2000);
      prev.dataset.short = out.length > 140 ? out.slice(0, 140) + '…' : out;
      prev.dataset.open = '0';
      rec.row.appendChild(prev);
    }
    if (typeof p.inline_diff === 'string' && p.inline_diff.trim()) {
      const f = el('div', 'act-file', '± diff ' + p.inline_diff.split('\n').length + ' lines');
      rec.row.appendChild(f);
    }
    setTitle('working…');
  }

  function approval(req) {
    // req: {request_id, command, description, choices?, sessionId}
    const card = el('div', 'act-approval');
    card.innerHTML = '<div class="ap-title">Permission needed</div><div class="ap-cmd"></div><div class="ap-desc"></div><div class="ap-row"></div>';
    card.querySelector('.ap-cmd').textContent = req.command || '(command)';
    card.querySelector('.ap-desc').textContent = req.description || '';
    const row = card.querySelector('.ap-row');
    const choices = (req.choices && req.choices.length ? req.choices : ['once', 'deny']);
    for (const c of choices) {
      const b = el('button', 'btn sm' + (c === 'deny' ? ' ghost' : ' primary'), c);
      b.addEventListener('click', () => {
        b.disabled = true;
        row.querySelectorAll('button').forEach((x) => { if (x !== b) x.disabled = true; });
        window.ActivityAnswer && window.ActivityAnswer(req.request_id, c, req.sessionId);
        card.classList.add('answered-' + c);
        const note = el('div', 'ap-note', c === 'deny' ? 'denied — agent will work around it' : 'approved (' + c + ') — resuming…');
        card.appendChild(note);
      });
      row.appendChild(b);
    }
    // approvals live in the chat flow (not inside the collapsible turn)
    const host = document.getElementById('messages');
    if (host) {
      const wrap = el('div', 'msg agent ap-wrap');
      wrap.appendChild(card);
      host.appendChild(wrap);
      host.scrollTop = host.scrollHeight;
    } else if (turn && !turn.done) {
      turn.body.appendChild(card);
    }
    setTitle('waiting for approval…');
    return card;
  }

  function endTurn(silent) {
    if (!turn) return;
    if (turn.timer) clearInterval(turn.timer);
    for (const rec of turn.rows.values()) clearInterval(rec.timer);
    turn.done = true;
    const total = fmtDur(Date.now() - turn.startedAt);
    const t = turn.head.querySelector('.act-time');
    if (!turn.head.querySelector('.act-title').textContent || /working|thinking|running|…/.test(turn.head.querySelector('.act-title').textContent)) {
      turn.head.querySelector('.act-title').textContent = 'done in ' + total;
    }
    if (t) t.textContent = total;
    turn.block.classList.add('done');
    if (!silent) turn = null;
    else if (turn.done) turn = null;
  }

  function event(type, ev) {
    const p = (ev && ev.payload) || {};
    switch (type) {
      case 'thinking.delta': thinkLine(p.text); break;
      case 'reasoning.available': reasoning(p.text); break;
      case 'status.update': statusNote(p.kind, p.text); break;
      case 'tool.generating': setTitle('preparing ' + (p.name || 'tool') + '…'); break;
      case 'tool.start':
      case 'tool.progress': toolStart(p); break;
      case 'tool.complete': toolDone(p); break;
      case 'approval.request':
        approval({ request_id: p.request_id, command: p.command, description: p.description, choices: p.choices, sessionId: ev.session_id });
        break;
    }
  }

  window.Activity = { beginTurn, endTurn, event, thinkLine, reasoning, toolStart, toolDone, approval, setTitle };
})();
