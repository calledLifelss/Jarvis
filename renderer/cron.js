// Schedules: cron jobs via `hermes cron ...`. List, create, pause/resume,
// run-now, remove, runs history, scheduler status. All through the
// hermes-cli IPC bridge (execFile allowlist, no shell).
(function () {
  const $ = (id) => document.getElementById(id);

  async function cli(op, args) {
    if (!window.jarvis || !window.jarvis.cli) throw new Error('cli bridge unavailable (restart app)');
    return window.jarvis.cli(op, args || {});
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toast(msg, kind) {
    const t = $('cron-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'prov-toast show ' + (kind || '');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 3500);
  }

  let selectedJob = null;

  function parseJobs(out) {
    // Two formats: rich table (--all off) OR card blocks (--all on):
    //   <id8..> [state]
    //     Name: ... / Schedule: ... / Next run: ... / Deliver: ...
    const text = String(out || '');
    const cards = [];
    const cardRe = /^ {0,3}([0-9a-f]{8,64})\s*\[([^\]]*)\]\s*$/gm;
    let m, lastIdx = 0, lastHead = null;
    const heads = [];
    while ((m = cardRe.exec(text))) heads.push({ id: m[1], state: m[2].trim(), idx: m.index });
    for (let i = 0; i < heads.length; i++) {
      const end = i + 1 < heads.length ? heads[i + 1].idx : text.length;
      const body = text.slice(heads[i].idx, end);
      const get = (k) => { const mm = body.match(new RegExp('^\\s*' + k + ':\\s*(.+)$', 'm')); return mm ? mm[1].trim() : ''; };
      cards.push({
        card: true, id: heads[i].id, state: heads[i].state,
        name: get('Name') || heads[i].id, schedule: get('Schedule'),
        next: get('Next run'), deliver: get('Deliver'), last: get('Last run'),
      });
    }
    if (cards.length) return cards;
    // fallback: rich table rows
    const rows = [];
    for (const line of text.split('\n')) {
      if (!line.includes('│')) continue;
      if (/[┏┡┗━┳┻]/.test(line)) continue;
      const cells = line.split('│').slice(1, -1).map((c) => c.trim());
      if (!cells.length) continue;
      if (/^(id|name|job)\b/i.test(cells[0])) continue;
      rows.push(cells);
    }
    return rows;
  }

  async function refresh() {
    const list = $('cron-list');
    if (list) list.innerHTML = '<div class="sess-empty">loading jobs…</div>';
    // scheduler status line (cheap, parallel)
    cli('cron.status').then((r) => {
      const el = $('cron-status-line');
      if (el) el.textContent = (r.out || r.errText || '').split('\n').slice(0, 4).join(' ').slice(0, 200) || 'scheduler: unknown';
    }).catch(() => {});
    try {
      const r = await cli('cron.list', { all: true });
      const text = r.out || '';
      if (/no scheduled jobs/i.test(text)) {
        if (list) list.innerHTML = '<div class="sess-empty">no scheduled jobs — create one below</div>';
        const c = $('cron-count');
        if (c) c.textContent = '0';
        return;
      }
      const rows = parseJobs(text);
      if (list) {
        list.innerHTML = '';
        if (!rows.length) {
          // unparseable but non-empty: show raw so nothing is hidden
          const pre = document.createElement('div');
          pre.className = 'prov-test-out';
          pre.textContent = text.slice(0, 1500);
          list.appendChild(pre);
        }
        for (const row of rows.slice(0, 100)) {
          const b = document.createElement('button');
          if (row.card) {
            const paused = /paus|disabled/i.test(row.state || '');
            b.className = 'prov-item' + (paused ? ' off' : '');
            b.innerHTML = `<span class="prov-dot"></span><span class="prov-main"><span class="prov-name"></span><span class="prov-sub"></span></span><span class="prov-key"></span>`;
            b.querySelector('.prov-name').textContent = row.name || row.id;
            b.querySelector('.prov-sub').textContent = [row.schedule, row.next && row.next !== 'None' ? 'next ' + row.next : row.state].filter(Boolean).join(' · ').slice(0, 120);
            b.querySelector('.prov-key').textContent = row.state || '';
            b.title = [row.id, row.schedule, row.deliver, row.last].filter(Boolean).join('\n');
            b.addEventListener('click', () => selectJob(row.id, [row.name, row.schedule, row.next, row.deliver, row.last].filter(Boolean)));
          } else {
            const cells = row;
            const paused = /paus/i.test(cells.join(' '));
            b.className = 'prov-item' + (paused ? ' off' : '');
            // id = first cell; name guess = second non-empty cell
            const id = cells[0] || '';
            b.innerHTML = `<span class="prov-dot"></span><span class="prov-main"><span class="prov-name"></span><span class="prov-sub"></span></span>`;
            b.querySelector('.prov-name').textContent = cells[1] || id || '(job)';
            b.querySelector('.prov-sub').textContent = cells.slice(2, 5).join(' · ').slice(0, 120) || id;
            b.title = cells.join(' | ');
            b.addEventListener('click', () => selectJob(id, cells));
          }
          list.appendChild(b);
        }
      }
      const c = $('cron-count');
      if (c) c.textContent = String(rows.length);
    } catch (e) {
      if (list) list.innerHTML = '<div class="sess-empty">cron failed: ' + esc(e.message || e) + '</div>';
    }
  }

  function selectJob(id, cells) {
    selectedJob = id;
    const out = $('cron-detail');
    if (out) out.textContent = cells ? cells.join('\n') : id;
    const lbl = $('cron-sel-label');
    if (lbl) lbl.textContent = 'Selected: ' + id;
  }

  function readForm() {
    return {
      schedule: ($('cron-schedule') || {}).value || '',
      prompt: ($('cron-prompt') || {}).value || '',
      name: ($('cron-name') || {}).value || '',
      deliver: ($('cron-deliver') || {}).value || '',
      model: ($('cron-model') || {}).value || '',
      provider: ($('cron-provider') || {}).value || '',
      noAgent: ($('cron-noagent') || {}).checked || false,
      script: ($('cron-script') || {}).value || '',
    };
  }

  async function create() {
    const f = readForm();
    if (!f.schedule.trim()) { toast('Schedule is required (e.g. every 2h, 0 9 * * *)', 'err'); return; }
    const out = $('cron-detail');
    if (out) out.textContent = 'creating…';
    try {
      const args = { schedule: f.schedule.trim() };
      if (f.prompt.trim()) args.prompt = f.prompt.trim();
      if (f.name.trim()) args.name = f.name.trim();
      if (f.deliver.trim()) args.deliver = f.deliver.trim();
      if (f.model.trim()) args.model = f.model.trim();
      if (f.provider.trim()) args.provider = f.provider.trim();
      if (f.noAgent) args.noAgent = true;
      if (f.script.trim()) args.script = f.script.trim();
      const r = await cli('cron.create', args);
      if (out) out.textContent = ((r.out || '') + '\n' + (r.errText || '')).slice(0, 2000).trim() || '(no output)';
      toast(r.code === 0 ? 'Job created ✅' : 'Create exited ' + r.code, r.code === 0 ? 'ok' : 'err');
      await refresh();
    } catch (e) {
      if (out) out.textContent = 'create failed: ' + (e.message || e);
    }
  }

  async function jobOp(op, label) {
    if (!selectedJob) { toast('Select a job first', 'err'); return; }
    const out = $('cron-detail');
    if (out) out.textContent = label + ' ' + selectedJob + '…';
    try {
      const r = await cli(op, { job: selectedJob });
      if (out) out.textContent = ((r.out || '') + '\n' + (r.errText || '')).slice(0, 2000).trim() || '(done)';
      toast(r.code === 0 ? `${label} ✅` : `${label} exited ${r.code}`, r.code === 0 ? 'ok' : 'err');
      if (op === 'cron.remove') selectedJob = null;
      await refresh();
    } catch (e) {
      if (out) out.textContent = label + ' failed: ' + (e.message || e);
    }
  }

  async function runs() {
    const out = $('cron-detail');
    if (out) out.textContent = 'loading run history…';
    try {
      const r = await cli('cron.runs', selectedJob ? { job: selectedJob, limit: 20 } : { limit: 20 });
      if (out) out.textContent = ((r.out || '') + '\n' + (r.errText || '')).slice(0, 3000).trim() || '(no runs)';
    } catch (e) {
      if (out) out.textContent = 'runs failed: ' + (e.message || e);
    }
  }

  async function doctor() {
    const out = $('cron-detail');
    if (out) out.textContent = 'checking jobs…';
    try {
      const r = await cli('cron.doctor');
      if (out) out.textContent = ((r.out || '') + '\n' + (r.errText || '')).slice(0, 2000).trim() || '(healthy)';
    } catch (e) {
      if (out) out.textContent = 'doctor failed: ' + (e.message || e);
    }
  }

  function init() {
    if ($('cron-refresh')) $('cron-refresh').addEventListener('click', refresh);
    if ($('cron-create')) $('cron-create').addEventListener('click', create);
    if ($('cron-pause')) $('cron-pause').addEventListener('click', () => jobOp('cron.pause', 'Pausing'));
    if ($('cron-resume')) $('cron-resume').addEventListener('click', () => jobOp('cron.resume', 'Resuming'));
    if ($('cron-run')) $('cron-run').addEventListener('click', () => jobOp('cron.run', 'Queueing'));
    if ($('cron-remove')) $('cron-remove').addEventListener('click', () => {
      if (!selectedJob) { toast('Select a job first', 'err'); return; }
      if (!confirm(`Remove scheduled job "${selectedJob}"?`)) return;
      jobOp('cron.remove', 'Removing');
    });
    if ($('cron-runs')) $('cron-runs').addEventListener('click', runs);
    if ($('cron-doctor')) $('cron-doctor').addEventListener('click', doctor);
  }

  window.Cron = { init, refresh };
})();
