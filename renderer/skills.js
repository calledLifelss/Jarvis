// Skills: installed list via `hermes skills list`, toggle state read from
// the table, inspect preview, hub search/browse/install. All through the
// hermes-cli IPC bridge (execFile allowlist, no shell).
// Table parsing is defensive: box-drawing rows only, never header/separator.
(function () {
  const $ = (id) => document.getElementById(id);

  async function cli(op, args) {
    if (!window.jarvis || !window.jarvis.cli) throw new Error('cli bridge unavailable (restart app)');
    return window.jarvis.cli(op, args || {});
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Parse rich-table rows: lines containing │ but not the header/separator glyphs.
  function tableRows(out) {
    const rows = [];
    for (const line of String(out || '').split('\n')) {
      if (!line.includes('│')) continue;
      if (/[┏┡┗━┳┻]/.test(line)) continue;
      const cells = line.split('│').slice(1, -1).map((c) => c.trim());
      if (!cells.length) continue;
      if (/^name$/i.test(cells[0])) continue; // header row
      rows.push(cells);
    }
    return rows;
  }

  function toast(msg, kind) {
    const t = $('skills-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'prov-toast show ' + (kind || '');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 3500);
  }

  let skills = []; // {name, category, source, trust, status}
  let selected = null;

  function renderList(filter) {
    const list = $('skills-list');
    if (!list) return;
    const q = (filter || '').toLowerCase();
    list.innerHTML = '';
    const shown = skills.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q));
    if (!shown.length) {
      list.innerHTML = '<div class="sess-empty">no skills match</div>';
      return;
    }
    for (const s of shown.slice(0, 200)) {
      const b = document.createElement('button');
      const enabled = /enabled/i.test(s.status || '');
      b.className = 'prov-item' + (s.name === selected ? ' sel' : '') + (enabled ? '' : ' off');
      b.innerHTML = `<span class="prov-dot"></span><span class="prov-main"><span class="prov-name"></span><span class="prov-sub"></span></span><span class="prov-key"></span>`;
      b.querySelector('.prov-name').textContent = s.name;
      b.querySelector('.prov-sub').textContent = [s.category, s.source].filter(Boolean).join(' · ');
      b.querySelector('.prov-key').textContent = s.status || '';
      b.addEventListener('click', () => selectSkill(s.name));
      list.appendChild(b);
    }
    const count = $('skills-count');
    if (count) count.textContent = `${shown.length}/${skills.length}`;
  }

  async function refresh() {
    const list = $('skills-list');
    if (list) list.innerHTML = '<div class="sess-empty">loading skills…</div>';
    try {
      const r = await cli('skills.list');
      if (r.code !== 0 && !r.out.includes('│')) throw new Error((r.errText || r.out || 'skills list failed').slice(0, 160));
      skills = tableRows(r.out).map((c) => ({
        name: c[0] || '', category: c[1] || '', source: c[2] || '', trust: c[3] || '', status: c[4] || '',
      })).filter((s) => s.name);
      renderList($('skills-filter') ? $('skills-filter').value : '');
    } catch (e) {
      if (list) list.innerHTML = '<div class="sess-empty">skills failed: ' + esc(e.message || e) + '</div>';
    }
  }

  async function selectSkill(name) {
    selected = name;
    renderList($('skills-filter') ? $('skills-filter').value : '');
    const out = $('skills-detail');
    if (out) out.textContent = 'inspecting ' + name + '… (CLI spins up, ~20s)';
    try {
      const r = await cli('skills.inspect', { name });
      const text = (r.out || r.errText || '').slice(0, 3000) || '(no detail)';
      if (out) out.textContent = text;
    } catch (e) {
      if (out) out.textContent = 'inspect failed: ' + (e.message || e);
    }
  }

  async function checkUpdates() {
    const out = $('skills-detail');
    if (out) out.textContent = 'checking hub skills for updates…';
    try {
      const r = await cli('skills.check');
      if (out) out.textContent = (r.out || r.errText || '(no output)').slice(0, 2000);
    } catch (e) {
      if (out) out.textContent = 'check failed: ' + (e.message || e);
    }
  }

  async function updateAll() {
    const out = $('skills-detail');
    if (out) out.textContent = 'updating hub skills… (up to 3 min)';
    try {
      const r = await cli('skills.update');
      if (out) out.textContent = (r.out || r.errText || '(no output)').slice(0, 2000);
      toast('Skills update finished', r.code === 0 ? 'ok' : 'err');
      await refresh();
    } catch (e) {
      if (out) out.textContent = 'update failed: ' + (e.message || e);
    }
  }

  async function audit() {
    const out = $('skills-detail');
    if (out) out.textContent = 're-scanning installed skills…';
    try {
      const r = await cli('skills.audit');
      if (out) out.textContent = (r.out || r.errText || '(no output)').slice(0, 2000);
      await refresh();
    } catch (e) {
      if (out) out.textContent = 'audit failed: ' + (e.message || e);
    }
  }

  async function hubSearch() {
    const q = ($('skills-hub-q') || {}).value || '';
    const out = $('skills-detail');
    if (!q.trim()) { toast('Type a search term first', 'err'); return; }
    if (out) out.textContent = 'searching hub for "' + q.trim() + '"…';
    try {
      const r = await cli('skills.search', { query: q.trim(), limit: 20 });
      renderHubResults(r.out || '');
    } catch (e) {
      if (out) out.textContent = 'search failed: ' + (e.message || e);
    }
  }

  // Visual hub cards from --json: name, source · trust, description,
  // click a card to stage its identifier for install.
  function renderHubResults(jsonText) {
    const out = $('skills-detail');
    if (!out) return;
    let items;
    try {
      items = JSON.parse(jsonText);
      if (!Array.isArray(items)) throw new Error('unexpected shape');
    } catch {
      out.textContent = 'hub returned an unexpected format:\n' + String(jsonText).slice(0, 800);
      return;
    }
    out.innerHTML = '';
    if (!items.length) {
      out.textContent = 'no hub results.';
      return;
    }
    const head = document.createElement('div');
    head.className = 'hint';
    head.textContent = `${items.length} hub result(s) — click one to stage it for install`;
    out.appendChild(head);
    for (const it of items.slice(0, 30)) {
      const b = document.createElement('button');
      b.className = 'hub-card';
      const top = document.createElement('div');
      top.className = 'hub-top';
      const nm = document.createElement('span');
      nm.className = 'hub-name';
      nm.textContent = it.name || '(unnamed)';
      const meta = document.createElement('span');
      meta.className = 'hub-meta';
      meta.textContent = [it.source, it.trust_level].filter(Boolean).join(' · ');
      top.appendChild(nm);
      top.appendChild(meta);
      const desc = document.createElement('div');
      desc.className = 'hub-desc';
      desc.textContent = (it.description || '').slice(0, 220);
      const id = document.createElement('div');
      id.className = 'hub-id';
      id.textContent = it.identifier || '';
      b.appendChild(top);
      b.appendChild(desc);
      b.appendChild(id);
      b.title = 'Click to stage for install';
      b.addEventListener('click', () => {
        const q = $('skills-hub-q');
        if (q && it.identifier) q.value = it.identifier;
        toast('Staged "' + (it.name || it.identifier) + '" — hit Install', 'ok');
      });
      out.appendChild(b);
    }
  }

  async function hubInstall() {
    const q = ($('skills-hub-q') || {}).value || '';
    if (!q.trim()) { toast('Type the skill identifier first', 'err'); return; }
    const out = $('skills-detail');
    if (out) out.textContent = 'installing "' + q.trim() + '"… (up to 3 min)';
    try {
      const r = await cli('skills.install', { name: q.trim(), yes: true });
      if (out) out.textContent = (r.out || r.errText || '(no output)').slice(0, 3000);
      toast(r.code === 0 ? 'Skill installed ✅' : 'Install exited ' + r.code, r.code === 0 ? 'ok' : 'err');
      await refresh();
    } catch (e) {
      if (out) out.textContent = 'install failed: ' + (e.message || e);
    }
  }

  async function hubUninstall() {
    if (!selected) { toast('Select an installed skill first', 'err'); return; }
    if (!confirm(`Remove hub skill "${selected}"?`)) return;
    try {
      const r = await cli('skills.uninstall', { name: selected });
      toast(r.code === 0 ? 'Removed ✅' : 'Uninstall exited ' + r.code, r.code === 0 ? 'ok' : 'err');
      selected = null;
      await refresh();
    } catch (e) {
      toast('Uninstall failed: ' + (e.message || e), 'err');
    }
  }

  function init() {
    if ($('skills-refresh')) $('skills-refresh').addEventListener('click', refresh);
    if ($('skills-check')) $('skills-check').addEventListener('click', checkUpdates);
    if ($('skills-update')) $('skills-update').addEventListener('click', updateAll);
    if ($('skills-audit')) $('skills-audit').addEventListener('click', audit);
    if ($('skills-hub-search')) $('skills-hub-search').addEventListener('click', hubSearch);
    if ($('skills-hub-install')) $('skills-hub-install').addEventListener('click', hubInstall);
    if ($('skills-hub-uninstall')) $('skills-hub-uninstall').addEventListener('click', hubUninstall);
    const f = $('skills-filter');
    if (f) f.addEventListener('input', () => renderList(f.value));
    const hq = $('skills-hub-q');
    if (hq) hq.addEventListener('keydown', (e) => { if (e.key === 'Enter') hubSearch(); });
  }

  window.Skills = { init, refresh };
})();
