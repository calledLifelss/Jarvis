// Providers: list / add / edit / test API providers + keys through the
// providers_bridge (same protocol as providers-manager). Renderer only ever
// sees masked keys. Backend->provider mapping via per-chat config.set.
// API: Providers.init(), Providers.refresh()
(function () {
  let providers = [];
  let active = { provider: '', model: '' };
  let selectedId = null;
  let loadedKeyMask = '';

  const $ = (id) => document.getElementById(id);

  function toast(msg, kind) {
    const t = $('prov-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'prov-toast show ' + (kind || '');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function call(op, args) {
    if (!window.jarvis || !window.jarvis.providers) throw new Error('providers bridge unavailable (restart app)');
    return window.jarvis.providers(op, args || {});
  }

  async function refresh() {
    const list = $('prov-list');
    if (list) list.innerHTML = '<div class="sess-empty">loading providers…</div>';
    try {
      const data = await call('list');
      providers = data.providers || [];
      active = data.active || { provider: '', model: '' };
      renderList();
      renderMapping();
    } catch (e) {
      if (list) list.innerHTML = '<div class="sess-empty">bridge failed: ' + esc(e.message || e) + '</div>';
    }
  }

  function renderList() {
    const list = $('prov-list');
    if (!list) return;
    list.innerHTML = '';
    if (!providers.length) {
      list.innerHTML = '<div class="sess-empty">no providers yet — Add your own Provider below</div>';
      return;
    }
    for (const p of providers) {
      const b = document.createElement('button');
      b.className = 'prov-item' + (p.id === selectedId ? ' sel' : '') + (p.enabled === false ? ' off' : '');
      b.innerHTML = `<span class="prov-dot"></span><span class="prov-main"><span class="prov-name"></span><span class="prov-sub"></span></span><span class="prov-key"></span>`;
      b.querySelector('.prov-name').textContent = p.name || p.id;
      b.querySelector('.prov-sub').textContent = `${p.models ? p.models.length : 0} models · ${p.mode || ''}`;
      b.querySelector('.prov-key').textContent = p.has_key ? (p.key_masked || '••••') : 'no key';
      b.title = (p.name || p.id) + '\n' + (p.base_url || '');
      b.addEventListener('click', () => selectProvider(p.id));
      list.appendChild(b);
    }
    const count = $('prov-count');
    if (count) count.textContent = providers.length;
  }

  function selectProvider(id) {
    selectedId = id;
    const p = providers.find((x) => x.id === id);
    renderList();
    if (!p) return;
    $('prov-ed-id').value = p.id;
    $('prov-ed-name').value = p.name || '';
    $('prov-ed-url').value = p.base_url || '';
    $('prov-ed-mode').value = p.mode || 'chat_completions';
    $('prov-ed-model').value = p.model || '';
    $('prov-ed-models').value = (p.models || []).join('\n');
    $('prov-ed-tokens').value = p.max_output_tokens || '';
    $('prov-ed-ctx').value = p.context_length || '';
    $('prov-ed-discover').checked = !!p.discover_models;
    $('prov-ed-enabled').checked = p.enabled !== false;
    $('prov-ed-key').value = '';
    $('prov-ed-key').placeholder = p.has_key ? ('saved ' + (p.key_masked || '••••') + ' — type to replace') : 'paste API key…';
    loadedKeyMask = p.key_masked || '';
    $('prov-ed-title').textContent = 'Edit · ' + (p.name || p.id);
    $('prov-test-out').textContent = '';
  }

  function readForm() {
    return {
      id: $('prov-ed-id').value.trim() || $('prov-ed-name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      old_id: $('prov-ed-id').value.trim(),
      name: $('prov-ed-name').value.trim(),
      base_url: $('prov-ed-url').value.trim(),
      mode: $('prov-ed-mode').value,
      model: $('prov-ed-model').value.trim(),
      models: $('prov-ed-models').value.split('\n').map((s) => s.trim()).filter(Boolean),
      max_output_tokens: $('prov-ed-tokens').value.trim(),
      context_length: $('prov-ed-ctx').value.trim(),
      extra_headers: {},
      discover_models: $('prov-ed-discover').checked,
      enabled: $('prov-ed-enabled').checked,
    };
  }

  async function save() {
    const form = readForm();
    if (!form.name) { toast('Provider name is required', 'err'); return; }
    if (!/^https?:\/\//i.test(form.base_url)) { toast('Base URL must start with http(s)://', 'err'); return; }
    // multi-key pool rides inside save (bridge-native); single key via api_key
    const multi = $('prov-ed-multikeys').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const typedKey = $('prov-ed-key').value.trim();
    if (multi.length) {
      form.multi = { enabled: true, keys: multi };
    } else if (typedKey) {
      form.api_key = typedKey;
    }
    try {
      $('prov-save').disabled = true;
      await call('save', form);
      toast('Provider saved ✅', 'ok');
      $('prov-ed-multikeys').value = '';
      $('prov-ed-key').value = '';
      await refresh();
      selectedId = form.id;
      renderList();
      const p = providers.find((x) => x.id === form.id);
      if (p) selectProvider(p.id);
    } catch (e) {
      toast('Save failed: ' + (e.message || e), 'err');
    } finally {
      $('prov-save').disabled = false;
    }
  }

  async function removeSelected() {
    if (!selectedId) { toast('Select a provider first', 'err'); return; }
    if (!confirm('Delete provider "' + selectedId + '"? Keys in the vault stay, config entry is removed.')) return;
    try {
      await call('delete', { id: selectedId });
      toast('Deleted', 'ok');
      selectedId = null;
      blankEditor();
      await refresh();
    } catch (e) { toast('Delete failed: ' + (e.message || e), 'err'); }
  }

  function blankEditor() {
    selectedId = null;
    for (const id of ['prov-ed-id', 'prov-ed-name', 'prov-ed-url', 'prov-ed-model', 'prov-ed-models', 'prov-ed-tokens', 'prov-ed-ctx', 'prov-ed-key', 'prov-ed-multikeys']) {
      const e2 = $(id);
      if (e2) e2.value = '';
    }
    $('prov-ed-mode').value = 'chat_completions';
    $('prov-ed-discover').checked = false;
    $('prov-ed-enabled').checked = true;
    $('prov-ed-title').textContent = 'Add your own Provider';
    $('prov-test-out').textContent = '';
    renderList();
  }

  async function liveTest() {
    const out = $('prov-test-out');
    const form = readForm();
    const typedKey = $('prov-ed-key').value.trim();
    out.textContent = 'testing…';
    try {
      let r;
      if (typedKey) {
        // standalone scratch check — saves nothing
        r = await call('live_test', {
          base_url: form.base_url, mode: form.mode,
          model: form.model || (form.models[0] || ''), api_key: typedKey,
        });
        out.textContent = `${r.verdict === 'valid' ? '✅' : '❌'} ${r.headline || r.verdict}\n${r.advice || ''}`.trim()
          + (r.model_count ? `\n${r.model_count} models reachable` : '');
      } else {
        // vault-backed probe of the saved provider
        r = await call('test', { id: form.id || selectedId, base_url: form.base_url, mode: form.mode, model: form.model || (form.models[0] || '') });
        const steps = (r.steps || []).map((s) => `${s.ok ? '✅' : '❌'} ${s.step}: ${s.detail || s.status}`).join('\n');
        out.textContent = `${r.authenticated ? '✅ authenticated' : '❌ auth failed'} (key ${r.key_used || '?'})\n${steps}`.slice(0, 600);
      }
    } catch (e) {
      out.textContent = '❌ ' + (e.message || e);
    }
  }

  async function fetchModels() {
    const out = $('prov-test-out');
    const form = readForm();
    const typedKey = $('prov-ed-key').value.trim();
    out.textContent = 'fetching models…';
    try {
      const r = await call('fetch_models', { base_url: form.base_url, mode: form.mode, api_key: typedKey || '__vault__' + (form.id || selectedId) });
      const models = r.models || r.data || r;
      if (Array.isArray(models) && models.length) {
        $('prov-ed-models').value = models.slice(0, 200).join('\n');
        out.textContent = `✅ ${models.length} models loaded into the list`;
      } else {
        out.textContent = '❌ no models: ' + JSON.stringify(r).slice(0, 200);
      }
    } catch (e) {
      out.textContent = '❌ ' + (e.message || e);
    }
  }

  // --- backend -> provider mapping -------------------------------------------
  // Each chat backend (hermes live chat, mock) picks which provider it talks to.
  // Stored locally; applied per-chat via config.set model --provider.
  function getMap() {
    try { return JSON.parse(localStorage.getItem('jarvis-backend-map') || '{}'); } catch { return {}; }
  }
  function setMap(m) { localStorage.setItem('jarvis-backend-map', JSON.stringify(m)); }

  function renderMapping() {
    const host = $('prov-mapping');
    if (!host) return;
    host.innerHTML = '';
    const map = getMap();
    const rows = [
      { backend: 'hermes', label: 'Hermes live chat', desc: 'per-chat model --provider switch' },
      { backend: 'mock', label: 'Mock brain', desc: 'offline fallback (no provider needed)' },
    ];
    for (const r of rows) {
      const div = document.createElement('div');
      div.className = 'map-row';
      const lab = document.createElement('span');
      lab.className = 'map-label';
      lab.innerHTML = `<b></b><small></small>`;
      lab.querySelector('b').textContent = r.label;
      lab.querySelector('small').textContent = r.desc;
      const sel = document.createElement('select');
      sel.className = 'map-select';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = r.backend === 'mock' ? '—' : 'gateway default';
      sel.appendChild(none);
      for (const p of providers) {
        if (p.enabled === false) continue;
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = `${p.name || p.id} (${(p.models || []).length} models${p.has_key ? '' : ', no key'})`;
        sel.appendChild(o);
      }
      sel.value = map[r.backend] || '';
      if (r.backend === 'mock') sel.disabled = true;
      sel.addEventListener('change', async () => {
        const m = getMap();
        if (sel.value) m[r.backend] = sel.value;
        else delete m[r.backend];
        setMap(m);
        toast(`Hermes chat → ${sel.value || 'gateway default'}`, 'ok');
        // apply live: re-fill model picker scoped to that provider
        if (window.JarvisApplyProvider) {
          try { await window.JarvisApplyProvider(sel.value); } catch (e) { toast(e.message, 'err'); }
        }
      });
      div.appendChild(lab);
      div.appendChild(sel);
      host.appendChild(div);
    }
    const cur = document.createElement('div');
    cur.className = 'hint';
    cur.textContent = active.provider ? `gateway active default: ${active.provider} / ${active.model}` : 'gateway default: (auto)';
    host.appendChild(cur);
  }

  function init() {
    if ($('prov-refresh')) $('prov-refresh').addEventListener('click', refresh);
    if ($('prov-new')) $('prov-new').addEventListener('click', blankEditor);
    if ($('prov-save')) $('prov-save').addEventListener('click', save);
    if ($('prov-delete')) $('prov-delete').addEventListener('click', removeSelected);
    if ($('prov-test')) $('prov-test').addEventListener('click', liveTest);
    if ($('prov-models')) $('prov-models').addEventListener('click', fetchModels);
    blankEditor();
  }

  window.Providers = { init, refresh, renderMapping, getMap };
})();
