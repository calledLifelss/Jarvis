// Providers / Usage / Combos — 9Router parity UI
// Bridge ops exposed by main.js BRIDGE_OPS + providers_bridge.py OPS:
//   list, save, delete, live_test, fetch_models, overview, bench_log, ...
// Usage/Combos render real bridge data where it exists and explicit empty
// states where the bridge has no op — no fabricated metrics.
//
// ICONS: inline SVG (.nr-ico). The house theme ships no icon font, so the
// Material Symbols ligatures this port originally used rendered as words.
(function () {
  'use strict';

  let providers = [];
  let activeId = null;
  let editingId = null;
  let combos = [];
  let usageRows = [];

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- icons ----------
  const PATHS = {
    server: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 16a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 6.5h.01M7 17.5h.01',
    hub: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3',
    zap: 'M13 2 3 14h8l-1 8 10-12h-8z',
    pencil: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
    x: 'M18 6 6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    alert: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
    chart: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-9',
    layers: 'm12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    route: 'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6 9v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5l-4.3-4.3',
    check: 'M20 6 9 17l-5-5'
  };

  function ico(name, cls) {
    const d = PATHS[name] || PATHS.hub;
    return '<svg class="nr-ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function call(op, args) {
    if (!window.jarvis || !window.jarvis.providers) {
      return Promise.reject(new Error('providers bridge unavailable (restart app)'));
    }
    return window.jarvis.providers(op, args || {});
  }

  // ---------- toast ----------
  function toast(msg, kind) {
    const host = ensureToastHost();
    const t = document.createElement('div');
    t.className = 'prov-toast show ' + (kind || '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 220);
    }, 3200);
  }

  function ensureToastHost() {
    let host = $('nr-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nr-toast-host';
      host.className = 'nr-toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  // ---------- modal shell ----------
  function modalShell(inner, opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'nr-modal fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh]';
    wrap.innerHTML =
      '<div class="absolute inset-0 bg-black/60 backdrop-blur-sm" data-close="1"></div>' +
      '<div class="relative bg-surface border border-border rounded-xl w-full ' +
      (o.wide ? 'max-w-[860px]' : 'max-w-[600px]') +
      ' max-h-[86vh] overflow-y-auto shadow-2xl custom-scrollbar">' +
      '<div class="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-border bg-surface rounded-t-xl">' +
      '<div class="flex items-center gap-2">' +
      (o.icon ? ico(o.icon, 'text-primary') : '') +
      '<span class="font-semibold">' + esc(o.title || '') + '</span>' +
      '</div>' +
      '<button class="p-1 rounded hover:bg-bg text-text-muted hover:text-text-main transition-colors" data-close="1" title="Close">' +
      ico('x') + '</button>' +
      '</div>' +
      '<div class="p-5">' + inner + '</div>' +
      '</div>';

    wrap.addEventListener('click', (e) => {
      const el = e.target.closest ? e.target.closest('[data-close]') : null;
      if (el) wrap.remove();
    });
    const onKey = (e) => {
      if (e.key === 'Escape') { wrap.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    return wrap;
  }

  // ==================================================================
  //  PROVIDERS
  // ==================================================================

  function providersShell() {
    const tab = $('tab-providers');
    if (!tab) return;
    tab.innerHTML =
      '<div class="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">' +
        '<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">' +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-2 mb-1">' +
              ico('server', 'lg text-primary') +
              '<h1 class="text-base lg:text-2xl font-semibold tracking-tight truncate">Providers</h1>' +
            '</div>' +
            '<p class="text-sm text-text-muted truncate">Manage your AI provider connections</p>' +
          '</div>' +
          '<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">' +
            '<button id="nr-prov-testall" class="h-9 rounded border border-black/10 bg-black/[0.02] px-3 text-xs text-text-main outline-none transition-colors hover:bg-black/5">Test All</button>' +
            '<button id="nr-prov-refresh" class="h-9 rounded border border-black/10 bg-black/[0.02] px-3 text-xs text-text-main outline-none transition-colors hover:bg-black/5">Refresh</button>' +
            '<button id="nr-prov-new" class="btn primary sm">＋ Add Provider</button>' +
          '</div>' +
        '</header>' +
        '<section class="flex min-w-0 flex-col gap-6 px-1 sm:px-0">' +
          '<div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">' +
            '<h2 class="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">All Providers</h2>' +
            '<div class="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[420px]">' +
              '<input id="nr-prov-search" class="nr-search" type="text" placeholder="Filter providers…" autocomplete="off" spellcheck="false" />' +
              '<span id="nr-prov-count" class="nr-count"></span>' +
            '</div>' +
          '</div>' +
          '<div id="nr-prov-grid" class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"></div>' +
          '<button id="nr-prov-add" class="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-primary/40 px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5">' +
            ico('plus') + 'Add Provider</button>' +
        '</section>' +
      '</div>';

    $('nr-prov-refresh').addEventListener('click', refreshProviders);
    $('nr-prov-new').addEventListener('click', () => openEditor(null));
    $('nr-prov-add').addEventListener('click', () => openEditor(null));
    $('nr-prov-testall').addEventListener('click', testAll);

    // Live filter: hides cards in place, no re-render, instant feedback.
    const search = $('nr-prov-search');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        $$('#nr-prov-grid > [data-id]').forEach((card) => {
          const p = providers.find((x) => x.id === card.dataset.id) || {};
          const hay = [p.name, p.id, p.prefix, p.base_url, p.default_model, (p.models || []).join(' ')]
            .filter(Boolean).join(' ').toLowerCase();
          const hit = !q || hay.indexOf(q) !== -1;
          card.classList.toggle('nr-hide', !hit);
          if (hit) shown++;
        });
        syncProvCount(providers.length, shown);
      });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { search.value = ''; search.dispatchEvent(new Event('input')); }
      });
    }
  }

  function syncProvCount(total, shown) {
    const el = $('nr-prov-count');
    if (!el) return;
    if (!total) { el.textContent = ''; return; }
    el.textContent = shown === total ? total + ' total' : shown + ' / ' + total;
  }

  async function refreshProviders() {
    const grid = $('nr-prov-grid');
    if (grid) {
      grid.innerHTML = Array.from({ length: 4 }).map(() =>
        '<div class="animate-pulse rounded-xl border border-border-subtle bg-bg-alt h-[74px]"></div>'
      ).join('');
    }
    try {
      const data = await call('list');
      providers = (data && data.providers) || [];
      renderProviders();
    } catch (e) {
      if (grid) {
        grid.innerHTML =
          '<div class="sm:col-span-2 lg:col-span-3 xl:col-span-4 text-center py-8 border border-dashed border-border rounded-xl">' +
          ico('alert', 'big text-text-muted') +
          '<div class="text-text-muted text-sm mt-2">' + esc(e.message || e) + '</div></div>';
      }
    }
  }

  function statusOf(p) {
    if (p.status) return p.status;
    return p.enabled === false ? 'disabled' : 'active';
  }

  function badgeFor(status) {
    if (status === 'active') return '<span class="status-badge status-badge--ok">Active</span>';
    if (status === 'disabled') return '<span class="status-badge">Disabled</span>';
    if (status === 'rate_limited') return '<span class="status-badge status-badge--warn">Cooldown</span>';
    if (status === 'unavailable') return '<span class="status-badge status-badge--rate">Unavailable</span>';
    return '<span class="status-badge">' + esc(status) + '</span>';
  }

  function renderProviders() {
    const grid = $('nr-prov-grid');
    if (!grid) return;
    syncProvCount(providers.length, providers.length);
    if (!providers.length) {
      grid.innerHTML =
        '<div class="sm:col-span-2 lg:col-span-3 xl:col-span-4 text-center py-8 border border-dashed border-border rounded-xl">' +
        ico('server', 'big text-text-muted') +
        '<div class="text-text-muted text-sm mt-2">No providers yet — add one to get started.</div></div>';
      return;
    }
    grid.innerHTML = providers.map((p) => {
      const status = statusOf(p);
      const models = (p.models || []).length;
      const selected = p.id === activeId ? ' ring-1 ring-primary/40' : '';
      return (
        '<div class="group min-w-0 rounded-xl border border-border-subtle bg-bg-alt p-3 transition-colors hover:bg-black/[0.03]' + selected + '" data-id="' + esc(p.id) + '">' +
          '<div class="flex min-w-0 items-center justify-between gap-3">' +
            '<div class="flex min-w-0 items-center gap-3">' +
              '<div class="size-8 shrink-0 rounded flex items-center justify-center bg-primary/10">' +
                ico('hub', 'text-primary') +
              '</div>' +
              '<div class="min-w-0">' +
                '<div class="truncate font-semibold">' + esc(p.name || p.id) + '</div>' +
                '<div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs">' +
                  badgeFor(status) +
                  (p.prefix ? '<span class="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted">' + esc(p.prefix) + '</span>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">' +
              '<button class="nr-p-edit p-1.5 rounded hover:bg-bg text-text-muted hover:text-text-main transition-colors" data-id="' + esc(p.id) + '" title="Edit">' +
                ico('pencil', 'sm') + '</button>' +
              '<button class="nr-p-test p-1.5 rounded hover:bg-bg text-text-muted hover:text-text-main transition-colors" data-id="' + esc(p.id) + '" title="Test">' +
                ico('zap', 'sm') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="mt-2 flex min-w-0 flex-wrap items-center gap-2 rounded bg-black/[0.03] px-3 py-2 text-xs">' +
            '<span class="min-w-0 flex-[1_1_160px] block truncate font-medium">' + esc(p.base_url || '—') + '</span>' +
            '<span class="block truncate text-text-muted">' + esc(p.default_model || (models ? models + ' models' : '—')) + '</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    $$('.nr-p-edit', grid).forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = providers.find((x) => x.id === b.dataset.id);
        if (p) openEditor(p);
      })
    );
    $$('.nr-p-test', grid).forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = providers.find((x) => x.id === b.dataset.id);
        if (p) quickTest(p);
      })
    );
    $$('[data-id]', grid).forEach((card) => {
      if (card.classList.contains('nr-p-edit') || card.classList.contains('nr-p-test')) return;
      card.addEventListener('click', () => {
        activeId = card.dataset.id;
        renderProviders();
      });
      card.addEventListener('dblclick', () => {
        const p = providers.find((x) => x.id === card.dataset.id);
        if (p) openEditor(p);
      });
    });
  }

  function field(label, id, opts) {
    const o = opts || {};
    const input = o.textarea
      ? '<textarea id="' + id + '" rows="' + (o.rows || 3) + '" placeholder="' + esc(o.ph || '') + '" class="w-full rounded border border-border-subtle bg-bg-alt px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none transition-colors resize-none">' + (o.value != null ? esc(o.value) : '') + '</textarea>'
      : o.select
        ? '<select id="' + id + '" class="w-full h-10 rounded border border-border-subtle bg-bg-alt px-3 text-sm focus:border-primary focus:outline-none transition-colors">' +
          (o.options || []).map((op) =>
            '<option value="' + esc(op[0]) + '"' + (String(o.value) === String(op[0]) ? ' selected' : '') + '>' + esc(op[1]) + '</option>'
          ).join('') + '</select>'
        : '<input id="' + id + '" type="' + (o.type || 'text') + '" ' +
          (o.value != null && o.value !== '' ? 'value="' + esc(o.value) + '"' : '') +
          (o.min != null ? ' min="' + o.min + '"' : '') +
          (o.max != null ? ' max="' + o.max + '"' : '') +
          (o.maxlength ? ' maxlength="' + o.maxlength + '"' : '') +
          ' placeholder="' + esc(o.ph || '') + '"' +
          (o.autocomplete ? ' autocomplete="' + esc(o.autocomplete) + '"' : '') +
          ' class="w-full h-10 rounded border border-border-subtle bg-bg-alt px-3 text-sm focus:border-primary focus:outline-none transition-colors" />';
    return (
      '<div>' +
      '<label class="block text-xs font-medium text-text-muted mb-1">' + esc(label) + '</label>' +
      input +
      (o.hint ? '<div class="mt-1 text-[11px] text-text-muted">' + esc(o.hint) + '</div>' : '') +
      '</div>'
    );
  }

  function openEditor(p) {
    editingId = p ? p.id : null;
    const body =
      '<form id="nr-ed-form" class="flex flex-col gap-4">' +
        '<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">' +
          field('Name', 'nr-ed-name', { ph: 'My Provider', value: p ? p.name : '' }) +
          field('Prefix', 'nr-ed-prefix', { ph: 'optional — e.g. TP', value: p ? p.prefix : '', maxlength: 4 }) +
        '</div>' +
        field('Base URL', 'nr-ed-url', { ph: 'https://api.example.com/v1', value: p ? p.base_url : '' }) +
        '<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">' +
          field('API Mode', 'nr-ed-mode', {
            select: true,
            value: p ? p.mode : 'chat_completions',
            options: [
              ['chat_completions', 'chat_completions (OpenAI)'],
              ['anthropic_messages', 'anthropic_messages'],
              ['codex_responses', 'codex_responses']
            ]
          }) +
          field('Default Model', 'nr-ed-model', { ph: 'gpt-4o-mini', value: p ? p.default_model : '' }) +
        '</div>' +
        '<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">' +
          field('Max Output Tokens', 'nr-ed-tokens', { type: 'number', value: p ? (p.max_tokens || 4096) : 4096 }) +
          field('Context Length', 'nr-ed-ctx', { type: 'number', value: p ? (p.context_length || 128000) : 128000 }) +
          field('Priority', 'nr-ed-priority', { type: 'number', min: 1, max: 10, value: p ? (p.priority || 1) : 1 }) +
        '</div>' +
        field('Models (one per line)', 'nr-ed-models', { textarea: true, rows: 4, ph: 'gpt-4o-mini\ngpt-4o', value: p ? (p.models || []).join('\n') : '' }) +
        '<div class="flex flex-wrap items-center gap-4">' +
          '<label class="flex items-center gap-2 text-sm text-text-main cursor-pointer">' +
            '<input id="nr-ed-discover" type="checkbox" class="size-4 accent-primary"' + (p && p.discover_models ? ' checked' : '') + ' />Discover models</label>' +
          '<label class="flex items-center gap-2 text-sm text-text-main cursor-pointer">' +
            '<input id="nr-ed-enabled" type="checkbox" class="size-4 accent-primary"' + (!p || p.enabled !== false ? ' checked' : '') + ' />Enabled</label>' +
        '</div>' +
        '<div class="pt-3 border-t border-border-subtle flex flex-col gap-3">' +
          '<h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider">Authentication</h3>' +
          field('API Key', 'nr-ed-key', { type: 'password', ph: p ? '•••••••• (leave blank to keep)' : 'paste API key…', autocomplete: 'new-password' }) +
          field('Multi-key Pool (one per line, auto-failover)', 'nr-ed-multikeys', { textarea: true, rows: 2, ph: 'optional — extra keys for rotation' }) +
        '</div>' +
        '<div id="nr-ed-out" class="prov-test-out hidden"></div>' +
        '<div class="flex flex-wrap gap-3 pt-3 border-t border-border-subtle">' +
          '<button type="submit" id="nr-ed-save" class="btn primary sm">' + (p ? 'Save Provider' : 'Create Provider') + '</button>' +
          '<button type="button" id="nr-ed-test" class="btn ghost sm">Check</button>' +
          '<button type="button" id="nr-ed-fetch" class="btn ghost sm">Fetch Models</button>' +
          (p ? '<button type="button" id="nr-ed-delete" class="btn ghost sm text-danger hover:bg-red-500/10">Delete</button>' : '') +
          '<button type="button" id="nr-ed-cancel" class="btn ghost sm">Cancel</button>' +
        '</div>' +
      '</form>';

    const wrap = modalShell(body, { title: p ? 'Edit Provider' : 'Add Provider', icon: 'server' });
    const out = () => wrap.querySelector('#nr-ed-out');

    wrap.querySelector('#nr-ed-cancel').addEventListener('click', () => wrap.remove());
    wrap.querySelector('#nr-ed-form').addEventListener('submit', (e) => saveProvider(e, wrap));

    wrap.querySelector('#nr-ed-test').addEventListener('click', async () => {
      const box = out();
      box.classList.remove('hidden');
      box.textContent = 'Checking…';
      try {
        const res = await call('live_test', {
          base_url: wrap.querySelector('#nr-ed-url').value.trim(),
          mode: wrap.querySelector('#nr-ed-mode').value,
          key: wrap.querySelector('#nr-ed-key').value || undefined,
          keys: lines(wrap.querySelector('#nr-ed-multikeys').value)
        });
        box.textContent = JSON.stringify(res, null, 2);
        toast(res && res.ok ? 'Check passed' : 'Check failed', res && res.ok ? 'ok' : 'err');
      } catch (err) {
        box.textContent = 'Error: ' + (err.message || err);
        toast(err.message || 'Check failed', 'err');
      }
    });

    wrap.querySelector('#nr-ed-fetch').addEventListener('click', async () => {
      const box = out();
      box.classList.remove('hidden');
      box.textContent = 'Fetching models…';
      try {
        const res = await call('fetch_models', {
          base_url: wrap.querySelector('#nr-ed-url').value.trim(),
          mode: wrap.querySelector('#nr-ed-mode').value,
          key: wrap.querySelector('#nr-ed-key').value || undefined,
          keys: lines(wrap.querySelector('#nr-ed-multikeys').value)
        });
        const models = (res && res.models) || [];
        if (models.length) {
          wrap.querySelector('#nr-ed-models').value = models.join('\n');
          box.textContent = 'Found ' + models.length + ' models:\n' + models.join('\n');
          toast('Models fetched: ' + models.length, 'ok');
        } else {
          box.textContent = 'No models returned';
          toast('No models found', 'warn');
        }
      } catch (err) {
        box.textContent = 'Error: ' + (err.message || err);
        toast(err.message || 'Fetch failed', 'err');
      }
    });

    const del = wrap.querySelector('#nr-ed-delete');
    if (del) {
      del.addEventListener('click', async () => {
        if (!editingId) return;
        if (!confirm('Delete this provider? Its keys are removed from the keyman vault.')) return;
        try {
          await call('delete', { id: editingId });
          toast('Provider deleted', 'ok');
          wrap.remove();
          await refreshProviders();
        } catch (err) {
          toast(err.message || 'Delete failed', 'err');
        }
      });
    }
  }

  function lines(v) {
    return String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async function saveProvider(e, wrap) {
    e.preventDefault();
    const btn = wrap.querySelector('#nr-ed-save');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      const payload = {
        id: editingId || undefined,
        name: wrap.querySelector('#nr-ed-name').value.trim(),
        base_url: wrap.querySelector('#nr-ed-url').value.trim(),
        mode: wrap.querySelector('#nr-ed-mode').value,
        default_model: wrap.querySelector('#nr-ed-model').value.trim() || undefined,
        max_tokens: parseInt(wrap.querySelector('#nr-ed-tokens').value, 10) || 4096,
        context_length: parseInt(wrap.querySelector('#nr-ed-ctx').value, 10) || 128000,
        models: lines(wrap.querySelector('#nr-ed-models').value),
        discover_models: wrap.querySelector('#nr-ed-discover').checked,
        enabled: wrap.querySelector('#nr-ed-enabled').checked,
        priority: parseInt(wrap.querySelector('#nr-ed-priority').value, 10) || 1,
        prefix: wrap.querySelector('#nr-ed-prefix').value.trim().toUpperCase() || undefined,
        key: wrap.querySelector('#nr-ed-key').value || undefined,
        keys: lines(wrap.querySelector('#nr-ed-multikeys').value)
      };
      if (!payload.name || !payload.base_url) throw new Error('Name and Base URL are required');
      await call('save', payload);
      toast('Provider saved', 'ok');
      wrap.remove();
      await refreshProviders();
    } catch (err) {
      toast(err.message || 'Save failed', 'err');
      const box = wrap.querySelector('#nr-ed-out');
      box.classList.remove('hidden');
      box.textContent = String(err.message || err);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function quickTest(p) {
    const wrap = modalShell('<div id="nr-qt-out" class="prov-test-out">Testing ' + esc(p.name) + '…</div>', {
      title: 'Provider test — ' + (p.name || p.id), icon: 'zap'
    });
    const box = wrap.querySelector('#nr-qt-out');
    try {
      const res = await call('live_test', { base_url: p.base_url, mode: p.mode, id: p.id });
      box.textContent = JSON.stringify(res, null, 2);
      toast((res && res.ok ? 'OK: ' : 'Failed: ') + (p.name || p.id), res && res.ok ? 'ok' : 'err');
    } catch (err) {
      box.textContent = 'Error: ' + (err.message || err);
      toast(err.message || 'Test failed', 'err');
    }
  }

  async function testAll() {
    if (!providers.length) { toast('No providers to test', 'warn'); return; }
    toast('Testing ' + providers.length + ' providers…', '');
    let ok = 0;
    for (const p of providers) {
      try {
        const res = await call('live_test', { base_url: p.base_url, mode: p.mode, id: p.id });
        if (res && res.ok) ok++;
      } catch (_) { /* counted as failure */ }
    }
    toast('Test All: ' + ok + '/' + providers.length + ' responding', ok === providers.length ? 'ok' : 'warn');
  }

  // ==================================================================
  //  USAGE — 9Router parity. Real ledger data, nothing fabricated.
  //
  //  Mirrors 9Router's own Usage pane: Overview/Details segmented
  //  control, Today|24h|7D|30D|60D range pills, five aggregate tiles,
  //  a network graph of the router and the providers it fan-outs to,
  //  a Recent Requests table, and a model breakdown. All of it reads
  //  ~/.9router/db/data.sqlite through the `usage_router` bridge op —
  //  the same rows the 9Router dashboard renders.
  // ==================================================================

  const RANGES = [
    ['today', 'Today'], ['24h', '24h'], ['7d', '7D'],
    ['30d', '30D'], ['60d', '60D']
  ];

  // Provider chips carry a short mark: the 9Router UI uses brand logos
  // it ships as assets. We can't ship those, so a monogram in the same
  // slot reads as the same UI without pretending to be the logo.
  function providerMark(name) {
    const n = String(name || '?').trim();
    const two = n.slice(0, 2).toUpperCase();
    return '<span class="nr-pmark">' + esc(two) + '</span>';
  }

  let usageData = {
    ready: false,
    window: 'today',
    detail: false,
    data: null,
    focus: '',
    graphScale: 1,
    graphPan: { x: 0, y: 0 }
  };

  function fmtInt(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-US');
  }

  function fmtCost(n) {
    n = Number(n) || 0;
    if (!n) return '$0.00';
    if (n < 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }

  function fmtTok(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function relTime(iso) {
    const t = Date.parse(iso || '');
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function usageShell() {
    const tab = $('tab-usage');
    if (!tab) return;
    tab.innerHTML =
      '<div class="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">' +
        '<header class="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">' +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-2 mb-1">' +
              ico('chart', 'lg text-primary') +
              '<h1 class="text-base lg:text-2xl font-semibold tracking-tight truncate">Usage &amp; Analytics</h1>' +
            '</div>' +
            '<p class="text-sm text-text-muted">Monitor your API usage, token consumption, and request logs</p>' +
          '</div>' +
          '<div class="flex flex-col gap-2 sm:flex-row sm:items-center">' +
            '<div class="nr-seg" role="tablist" id="nr-usage-view">' +
              '<button class="nr-seg-btn active" data-view="overview" role="tab">Overview</button>' +
              '<button class="nr-seg-btn" data-view="details" role="tab">Details</button>' +
            '</div>' +
            '<div class="nr-seg" role="tablist" id="nr-usage-range">' +
              RANGES.map((r, i) =>
                '<button class="nr-seg-btn' + (i === 0 ? ' active' : '') + '" data-range="' + r[0] + '" role="tab">' + r[1] + '</button>'
              ).join('') +
            '</div>' +
          '</div>' +
        '</header>' +
        '<div class="flex min-w-0 flex-col gap-5">' +
          '<div id="nr-usage-stats" class="nr-tiles"></div>' +
          '<section class="nr-card nr-graph-card">' +
            '<div class="nr-card-head">' +
              '<span class="nr-card-title">' + ico('route', 'sm') + ' Live provider graph <i class="nr-live-dot" id="nr-usage-livedot"></i></span>' +
              '<span id="nr-usage-graphmeta" class="nr-meta"></span>' +
            '</div>' +
            '<div id="nr-usage-graph" class="nr-graph"></div>' +
          '</section>' +
          '<div id="nr-usage-overview" class="flex min-w-0 flex-col gap-5">' +
            '<section class="nr-card nr-recent-card">' +
              '<div class="nr-card-head">' +
                '<span class="nr-card-title">Recent requests</span>' +
                '<span id="nr-usage-recentmeta" class="nr-meta"></span>' +
              '</div>' +
              '<div class="nr-table-wrap custom-scrollbar">' +
                '<table class="nr-table">' +
                  '<thead><tr><th>Model</th><th class="ta-r">In / Out</th><th class="ta-r">When</th></tr></thead>' +
                  '<tbody id="nr-usage-recent"></tbody>' +
                '</table>' +
              '</div>' +
            '</section>' +
            '<section class="nr-card">' +
              '<div class="nr-card-head">' +
                '<span class="nr-card-title">Requests over time</span>' +
                '<span id="nr-usage-chartmeta" class="nr-meta"></span>' +
              '</div>' +
              '<div id="nr-usage-chart" class="nr-chart"></div>' +
            '</section>' +
          '</div>' +
          '<div id="nr-usage-details" class="hidden min-w-0 flex-col gap-5">' +
            '<section class="nr-card">' +
              '<div class="nr-card-head">' +
                '<span class="nr-card-title">Usage by model</span>' +
                '<span id="nr-usage-modelmeta" class="nr-meta"></span>' +
              '</div>' +
              '<div class="nr-table-wrap custom-scrollbar">' +
                '<table class="nr-table">' +
                  '<thead><tr>' +
                    '<th>Model</th><th class="ta-r">Requests</th><th class="ta-r">Input</th>' +
                    '<th class="ta-r">Output</th><th class="ta-r">Cost</th>' +
                  '</tr></thead>' +
                  '<tbody id="nr-usage-models"></tbody>' +
                '</table>' +
              '</div>' +
            '</section>' +
            '<section class="nr-card">' +
              '<div class="nr-card-head">' +
                '<span class="nr-card-title">Providers</span>' +
                '<span id="nr-usage-provmeta" class="nr-meta"></span>' +
              '</div>' +
              '<div id="nr-usage-bars" class="nr-bars"></div>' +
            '</section>' +
          '</div>' +
        '</div>' +
      '</div>';

    $$('#tab-usage .nr-seg-btn').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.range) {
        usageData.window = b.dataset.range;
        $$('#nr-usage-range .nr-seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        refreshUsage();
        return;
      }
      usageData.detail = b.dataset.view === 'details';
      $$('#nr-usage-view .nr-seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      const ov = $('nr-usage-overview'), dt = $('nr-usage-details');
      if (ov) ov.classList.toggle('hidden', usageData.detail);
      if (dt) dt.classList.toggle('hidden', !usageData.detail);
      paintUsage();
    }));
  }

  async function refreshUsage() {
    const stats = $('nr-usage-stats');
    if (stats && !usageData.data) {
      stats.innerHTML = Array.from({ length: 5 }).map(() =>
        '<div class="animate-pulse h-[104px] rounded-xl bg-bg-alt border border-border-subtle"></div>').join('');
    }
    const recent = $('nr-usage-recent');
    if (recent && !usageData.data) {
      recent.innerHTML = '<tr><td colspan="3" class="nr-td-empty">Loading…</td></tr>';
    }

    let data = null;
    try { data = await call('usage_router', { window: usageData.window, limit: 60 }); }
    catch (e) { data = { available: false, reason: (e && e.message) || 'bridge error' }; }

    // The graph is a now view, so it is fetched outside the range window and
    // refreshed on its own clock — a range pill must never touch it.
    try { usageData.live = await call('live_graph', { active_seconds: 30 }); }
    catch (_) { /* keep the previous snapshot rather than blanking the graph */ }

    usageData.data = data;
    paintUsage();
    startLiveGraph();
  }

  // Poll only the live graph: 6s keeps the flowing links honest without
  // re-reading the whole ledger. A provider counts as live for 30s after its
  // last ledger row — the closest thing to "in flight" the ledger can offer.
  function startLiveGraph() {
    if (usageData.liveTimer) return;
    usageData.liveTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        usageData.live = await call('live_graph', { active_seconds: 30 });
        drawGraph(usageData.live);
      } catch (_) { /* transient bridge error: keep the last snapshot */ }
    }, 6000);
  }

  function niceMax(v) {
    if (v <= 5) return 5;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  function areaChart(items) {
    const W = 760, H = 220;
    const padL = 44, padR = 14, padT = 16, padB = 28;
    const iw = W - padL - padR, ih = H - padT - padB;
    const n = items.length;
    const max = Math.max(1, Math.max.apply(null, items.map((i) => i.value)));
    const top = niceMax(max);
    const step = n > 1 ? iw / (n - 1) : 0;
    const X = (i) => padL + (n > 1 ? i * step : iw / 2);
    const Y = (v) => padT + ih - (v / top) * ih;

    const pts = items.map((it, i) => [X(i), Y(it.value)]);
    let line = '';
    pts.forEach((p, i) => { line += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; });
    const base = (padT + ih).toFixed(1);
    const area = line + 'L' + pts[n - 1][0].toFixed(1) + ' ' + base + ' L' + pts[0][0].toFixed(1) + ' ' + base + ' Z';

    let grid = '';
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const y = (padT + ih - f * ih).toFixed(1);
      grid += '<line class="nr-grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>' +
              '<text class="nr-axis" x="' + (padL - 8) + '" y="' + (Number(y) + 3.5).toFixed(1) + '" text-anchor="end">' +
              Math.round(top * f) + '</text>';
    });

    const idx = n <= 8 ? items.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    let xlabels = '';
    idx.forEach((i) => {
      xlabels += '<text class="nr-axis" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' +
        (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + esc(items[i].label) + '</text>';
    });

    let dots = '';
    pts.forEach((p, i) => {
      dots += '<circle class="nr-dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5">' +
        '<title>' + esc(items[i].label) + ' — ' + items[i].value + '</title></circle>';
    });

    return '<svg class="nr-areachart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Usage over time">' +
      '<defs><linearGradient id="nrAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" style="stop-color:var(--accent);stop-opacity:.42"/>' +
        '<stop offset="100%" style="stop-color:var(--accent);stop-opacity:0"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path class="nr-area" d="' + area + '" fill="url(#nrAreaGrad)"/>' +
      '<path class="nr-line" d="' + line + '"/>' +
      dots + xlabels +
    '</svg>';
  }

  function paintUsage() {
    const d = usageData.data;

    // Painted first and unconditionally: the graph reads its own live payload,
    // so a ledger hiccup must not blank it.
    drawGraph(usageData.live);

    if (!d || !d.available) {
      const why = (d && d.reason) || 'Bridge unavailable — restart the app to reload keyman.';
      const tiles = $('nr-usage-stats');
      if (tiles) tiles.innerHTML = '';
      ['nr-usage-chart', 'nr-usage-bars'].forEach((id) => {
        const el = $(id);
        if (el) el.innerHTML = '<div class="nr-empty">' + esc(why) + '</div>';
      });
      const rec = $('nr-usage-recent');
      if (rec) rec.innerHTML = '<tr><td colspan="3" class="nr-td-empty">' + esc(why) + '</td></tr>';
      const md = $('nr-usage-models');
      if (md) md.innerHTML = '<tr><td colspan="5" class="nr-td-empty">' + esc(why) + '</td></tr>';
      return;
    }

    drawTiles(d.summary);
    drawRecent(d.recent);
    drawSeries(d.series);
    drawModels(d.models);
    drawProviders(d.graph && d.graph.nodes);
  }

  // Five aggregate tiles, the same five 9Router shows at the top of Usage.
  function drawTiles(s) {
    const host = $('nr-usage-stats');
    if (!host || !s) return;
    const tiles = [
      ['Total requests', fmtInt(s.requests), ''],
      ['Total input tokens', fmtInt(s.inputTokens), 'tok-in'],
      ['Cached tokens', fmtInt(s.cachedTokens), 'tok-cache'],
      ['Output tokens', fmtInt(s.outputTokens), 'tok-out'],
      ['Est. cost', '~' + fmtCost(s.cost), 'cost']
    ];
    host.innerHTML = tiles.map((t) =>
      '<div class="nr-tile">' +
        '<div class="nr-tile-k">' + esc(t[0]) + '</div>' +
        '<div class="nr-tile-v ' + t[2] + '">' + esc(t[1]) + '</div>' +
        (t[2] === 'cost' ? '<div class="nr-tile-sub">Estimated, not actual billing</div>' : '') +
      '</div>').join('');
  }

  // Jarvis sits in the middle; every provider added to Jarvis is a node, and
  // every node is wired to the hub by one curved link. A link turns cyan and
  // flows while that provider is moving a request. This is a now view: the
  // range pills never reach it, and a provider with no traffic still appears
  // (dimmed) because it IS configured.
  function drawGraph(live) {
    const host = $('nr-usage-graph');
    const meta = $('nr-usage-graphmeta');
    if (!host) return;

    const nodes = (live && Array.isArray(live.nodes)) ? live.nodes : [];
    if (!live) {
      host.innerHTML = '<div class="nr-empty">Connecting to the live graph…</div>';
      if (meta) meta.textContent = '';
      return;
    }
    if (!live.available || !nodes.length) {
      const why = (live && live.reason) || 'No providers added in Jarvis yet.';
      host.innerHTML = '<div class="nr-empty">' + esc(why) + '</div>';
      if (meta) meta.textContent = '';
      const offDot = $('nr-usage-livedot');
      if (offDot) offDot.classList.remove('on');
      return;
    }

    const W = 900, H = 460, cx = W / 2, cy = H / 2;
    const flowing = nodes.filter((n) => n.state === 'flow').length;
    if (meta) {
      meta.textContent = nodes.length + ' provider' + (nodes.length === 1 ? '' : 's') +
        ' · ' + flowing + ' live now';
    }
    const liveDot = $('nr-usage-livedot');
    if (liveDot) liveDot.classList.toggle('on', flowing > 0);

    const ring = nodes.length > 10 ? 196 : nodes.length > 6 ? 174 : 152;
    const NW = 152, NH = 38;
    const pts = nodes.map((p, i) => {
      const a = (-Math.PI / 2) + (i * 2 * Math.PI) / nodes.length;
      return { p: p, x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring * 0.74, a: a };
    });

    let links = '';
    pts.forEach((t) => {
      const mx = (cx + t.x) / 2 + Math.cos(t.a) * 30;
      const my = (cy + t.y) / 2 + Math.sin(t.a) * 30;
      const st = t.p.state || 'idle';
      const cls = st === 'flow' ? ' flow' : (st === 'off' ? ' off' : '');
      links += '<path class="nr-link' + cls + '" data-node="' + esc(t.p.id) + '" d="M' +
        cx + ' ' + cy + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' +
        t.x.toFixed(1) + ' ' + t.y.toFixed(1) + '"/>';
    });

    let chips = '';
    pts.forEach((t) => {
      const st = t.p.state || 'idle';
      const on = usageData.focus === t.p.id;
      chips += '<g class="nr-node ' + esc(st) + (on ? ' on' : '') + '" data-node="' + esc(t.p.id) + '" transform="translate(' +
        (t.x - NW / 2).toFixed(1) + ' ' + (t.y - NH / 2).toFixed(1) + ')">' +
        '<rect class="nr-node-box" width="' + NW + '" height="' + NH + '" rx="9"/>' +
        '<rect class="nr-node-mark" x="7" y="7" width="24" height="24" rx="6"/>' +
        '<text class="nr-node-ini" x="19" y="23" text-anchor="middle">' + esc(String(t.p.name || '?').slice(0, 2).toUpperCase()) + '</text>' +
        '<text class="nr-node-name" x="39" y="24">' + esc(String(t.p.name || t.p.id).slice(0, 15)) + '</text>' +
        '<circle class="nr-node-dot" cx="' + (NW - 12) + '" cy="19" r="3.5"/>' +
      '</g>';
    });

    const s = usageData.graphScale, px = usageData.graphPan.x, py = usageData.graphPan.y;
    host.innerHTML =
      '<svg class="nr-graphsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Live provider graph">' +
        '<g transform="translate(' + px + ' ' + py + ') scale(' + s + ')">' +
          links +
          '<g class="nr-hub">' +
            '<rect x="' + (cx - 88) + '" y="' + (cy - 30) + '" width="176" height="60" rx="12"/>' +
            '<rect class="nr-node-mark" x="' + (cx - 78) + '" y="' + (cy - 18) + '" width="36" height="36" rx="9"/>' +
            '<text class="nr-node-ini" x="' + (cx - 60) + '" y="' + (cy + 6) + '" text-anchor="middle">J</text>' +
            '<text class="nr-hub-name" x="' + (cx - 32) + '" y="' + (cy + 6) + '">Jarvis</text>' +
            '<circle class="nr-hub-badge" cx="' + (cx + 80) + '" cy="' + (cy - 22) + '" r="11"/>' +
            '<text class="nr-hub-badge-n" x="' + (cx + 80) + '" y="' + (cy - 18) + '" text-anchor="middle">' + nodes.length + '</text>' +
          '</g>' +
          chips +
        '</g>' +
      '</svg>' +
      '<div class="nr-graph-ctl">' +
        '<button type="button" data-zoom="in" title="Zoom in">+</button>' +
        '<button type="button" data-zoom="out" title="Zoom out">−</button>' +
        '<button type="button" data-zoom="fit" title="Fit">⛶</button>' +
      '</div>';

    $$('[data-zoom]', host).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.zoom;
      if (k === 'fit') { usageData.graphScale = 1; usageData.graphPan = { x: 0, y: 0 }; }
      else if (k === 'in') usageData.graphScale = Math.min(2.4, usageData.graphScale + 0.2);
      else usageData.graphScale = Math.max(0.6, usageData.graphScale - 0.2);
      drawGraph(usageData.live);
    }));

    $$('.nr-node, .nr-link', host).forEach((el) => {
      el.addEventListener('mouseenter', () => { usageData.focus = el.dataset.node; drawGraph(usageData.live); });
      el.addEventListener('mouseleave', () => { usageData.focus = ''; drawGraph(usageData.live); });
    });
  }

  function drawRecent(list) {
    const rows = $('nr-usage-recent');
    const meta = $('nr-usage-recentmeta');
    if (!rows) return;
    const items = Array.isArray(list) ? list : [];
    if (meta) meta.textContent = items.length ? items.length + ' shown' : '';
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="3" class="nr-td-empty">No requests in this window.</td></tr>';
      return;
    }
    rows.innerHTML = items.map((r) =>
      '<tr>' +
        '<td class="nr-cell-model"><i class="nr-dot-ok"></i><span class="nr-model">' + esc(r.model) + '</span></td>' +
        '<td class="ta-r nr-io"><span class="tok-in">' + fmtTok(r.input) + '</span>↑ <span class="tok-out">' + fmtTok(r.output) + '</span>↓</td>' +
        '<td class="ta-r nr-when">' + esc(relTime(r.when)) + '</td>' +
      '</tr>').join('');
  }

  function drawSeries(series) {
    const host = $('nr-usage-chart');
    const meta = $('nr-usage-chartmeta');
    if (!host) return;
    const items = (Array.isArray(series) ? series : []).map((p) => ({
      label: String(p.t || '').slice(11) + ':00',
      value: p.requests || 0
    }));
    const any = items.some((i) => i.value > 0);
    if (meta) meta.textContent = items.length ? items.length + ' hour' + (items.length === 1 ? '' : 's') : '';
    host.innerHTML = items.length && any
      ? areaChart(items)
      : '<div class="nr-empty">No requests logged in this window yet.</div>';
  }

  function drawModels(models) {
    const rows = $('nr-usage-models');
    const meta = $('nr-usage-modelmeta');
    if (!rows) return;
    const list = Array.isArray(models) ? models : [];
    if (meta) meta.textContent = list.length + ' model' + (list.length === 1 ? '' : 's');
    if (!list.length) {
      rows.innerHTML = '<tr><td colspan="5" class="nr-td-empty">No model has served a request.</td></tr>';
      return;
    }
    rows.innerHTML = list.map((m) =>
      '<tr>' +
        '<td class="nr-cell-model"><span class="nr-model">' + esc(m.model) + '</span></td>' +
        '<td class="ta-r nr-num">' + fmtInt(m.requests) + '</td>' +
        '<td class="ta-r nr-num tok-in">' + fmtTok(m.inputTokens) + '</td>' +
        '<td class="ta-r nr-num tok-out">' + fmtTok(m.outputTokens) + '</td>' +
        '<td class="ta-r nr-num cost">' + fmtCost(m.cost) + '</td>' +
      '</tr>').join('');
  }

  function drawProviders(nodes) {
    const host = $('nr-usage-bars');
    const meta = $('nr-usage-provmeta');
    if (!host) return;
    const list = (Array.isArray(nodes) ? nodes : []).slice()
      .sort((a, b) => (b.requests || 0) - (a.requests || 0));
    if (!list.length) {
      host.innerHTML = '<div class="nr-empty">No provider served a request.</div>';
      if (meta) meta.textContent = '';
      return;
    }
    const top = Math.max(1, list[0].requests || 0);
    if (meta) meta.textContent = list.length + ' provider' + (list.length === 1 ? '' : 's');
    host.innerHTML = list.map((p) =>
      '<div class="nr-bar-row">' +
        '<span class="nr-bar-name">' + esc(p.name || p.id) + '</span>' +
        '<span class="nr-bar-track"><i class="nr-bar-seg" style="width:' +
          Math.max(2, Math.round(((p.requests || 0) / top) * 100)) + '%"></i></span>' +
        '<span class="nr-bar-num">' + fmtInt(p.requests) + '</span>' +
      '</div>').join('');
  }

  // ==================================================================
  //  COMBOS + VISION — local (no bridge op exists)
  // ==================================================================

  const CKEY = 'jarvis.combos.v1';
  const VKEY = 'jarvis.vision.v1';

  function loadCombos() {
    try { combos = JSON.parse(localStorage.getItem(CKEY) || '[]') || []; } catch (_) { combos = []; }
  }
  function saveCombos() {
    try { localStorage.setItem(CKEY, JSON.stringify(combos)); } catch (_) { /* quota */ }
  }
  function loadVision() {
    try { return JSON.parse(localStorage.getItem(VKEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveVision(v) {
    try { localStorage.setItem(VKEY, JSON.stringify(v)); } catch (_) { /* quota */ }
  }

  const STRATEGIES = [['fallback', 'Fallback'], ['round_robin', 'Round Robin'], ['fusion', 'Fusion']];

  function combosShell() {
    const tab = $('tab-combos');
    if (!tab) return;
    tab.innerHTML =
      '<div class="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">' +
        '<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">' +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-2 mb-1">' +
              ico('layers', 'lg text-primary') +
              '<h1 class="text-base lg:text-2xl font-semibold tracking-tight truncate">Combo &amp; Vision Adapter</h1>' +
            '</div>' +
            '<p class="text-sm text-text-muted truncate">Model combos with fallback support and vision adapter configuration</p>' +
          '</div>' +
          '<button id="nr-combo-new" class="btn primary sm whitespace-nowrap w-full sm:w-auto">＋ Create Combo</button>' +
        '</header>' +
        '<div class="flex flex-col gap-4">' +
          '<div id="nr-combo-list" class="flex flex-col gap-4"></div>' +
          '<div class="rounded-xl border border-border-subtle bg-bg-alt p-4">' +
            '<div class="text-sm font-medium mb-1.5 flex items-center gap-2">' +
              ico('eye', 'sm text-primary') + 'Vision Adapter</div>' +
            '<div class="text-xs text-text-muted mb-3">Attach a vision-capable model to handle images for text-only models.</div>' +
            '<div class="flex flex-col gap-2 sm:flex-row sm:items-center">' +
              '<select id="nr-vision-model" class="w-full sm:w-[240px] h-10 rounded border border-border-subtle bg-bg-alt px-3 text-sm focus:border-primary focus:outline-none"></select>' +
              '<label class="flex items-center gap-2 text-sm text-text-main cursor-pointer">' +
                '<input id="nr-vision-enabled" type="checkbox" class="size-4 accent-primary" />Enabled</label>' +
              '<button id="nr-vision-save" class="btn ghost sm">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    $('nr-combo-new').addEventListener('click', () => openComboEditor(null));
    $('nr-vision-save').addEventListener('click', () => {
      saveVision({
        provider_id: $('nr-vision-model').value,
        enabled: $('nr-vision-enabled').checked
      });
      toast('Vision adapter saved (local)', 'ok');
    });
    renderVision();
    renderCombos();
  }

  function renderVision() {
    const sel = $('nr-vision-model');
    if (!sel) return;
    const v = loadVision();
    const opts = providers.filter((p) => p.enabled !== false).map((p) =>
      '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.default_model || (p.models && p.models[0]) || '?') + ')</option>'
    ).join('');
    sel.innerHTML = '<option value="">Select a provider</option>' + opts;
    sel.value = v.provider_id || '';
    const en = $('nr-vision-enabled');
    if (en) en.checked = !!v.enabled;
  }

  function comboStrategyLabel(s) {
    const found = STRATEGIES.find((x) => x[0] === s);
    return found ? found[1] : 'Fallback';
  }

  function renderCombos() {
    const list = $('nr-combo-list');
    if (!list) return;
    if (!combos.length) {
      list.innerHTML =
        '<div class="text-center py-12">' +
          '<div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">' +
            ico('layers', 'big') +
          '</div>' +
          '<div class="text-text-main font-medium mb-1">No combos yet</div>' +
          '<div class="text-sm text-text-muted mb-4">Create model combos with fallback support</div>' +
          '<button id="nr-combo-new2" class="btn primary sm w-full sm:w-auto">Create Combo</button>' +
        '</div>';
      const b = $('nr-combo-new2');
      if (b) b.addEventListener('click', () => openComboEditor(null));
      return;
    }
    list.innerHTML = combos.map((c, i) =>
      '<div class="rounded-xl border border-border-subtle bg-bg-alt p-4 group" data-i="' + i + '">' +
        '<div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">' +
          '<div class="flex min-w-0 flex-1 items-start gap-3 sm:items-center">' +
            '<div class="size-8 rounded bg-primary/10 flex items-center justify-center shrink-0">' +
              ico('route', 'text-primary') + '</div>' +
            '<div class="min-w-0 flex-1">' +
              '<span class="block truncate font-mono text-sm font-medium">' + esc(c.name) + '</span>' +
              '<div class="mt-1 flex min-w-0 flex-wrap items-center gap-1">' +
                '<span class="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted">' +
                  esc(comboStrategyLabel(c.strategy)) + '</span>' +
                '<span class="text-[10px] text-text-muted">' + (c.models || []).length + ' model' + ((c.models || []).length === 1 ? '' : 's') + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">' +
            '<button class="nr-combo-add flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary" data-i="' + i + '" title="Add models">' +
              ico('plus') +
              '<span class="text-[10px] leading-tight">Models</span></button>' +
            '<button class="nr-combo-edit flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary" data-i="' + i + '">' +
              ico('pencil') +
              '<span class="text-[10px] leading-tight">Edit</span></button>' +
            '<button class="nr-combo-del flex flex-col items-center rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-500/10" data-i="' + i + '">' +
              ico('trash') +
              '<span class="text-[10px] leading-tight">Delete</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">' +
          (c.models || []).map((m) =>
            '<span class="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-1.5 py-0.5 font-mono text-[11px] text-primary">' +
            '<span class="truncate">' + esc(m) + '</span></span>'
          ).join('') +
        '</div>' +
      '</div>'
    ).join('');

    $$('.nr-combo-add', list).forEach((b) =>
      b.addEventListener('click', () => openComboModels(combos[Number(b.dataset.i)]))
    );
    $$('.nr-combo-edit', list).forEach((b) =>
      b.addEventListener('click', () => openComboEditor(combos[Number(b.dataset.i)]))
    );
    $$('.nr-combo-del', list).forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        if (!confirm('Delete combo "' + combos[i].name + '"?')) return;
        combos.splice(i, 1);
        saveCombos();
        renderCombos();
        toast('Combo deleted', 'ok');
      })
    );
  }

  // "Add Model to Combo" — one section per provider, one pill per model.
  // Click toggles membership and saves on the spot; the eye marks what is in.
  function openComboModels(c) {
    let target = c;

    const wrap = modalShell(
      '<div class="nr-cm">' +
        '<div class="nr-cm-info">' +
          '<span class="nr-cm-info-ico">' + ico('alert') + '</span>' +
          '<span>Click to add, click again to remove. Changes are saved automatically.</span>' +
        '</div>' +
        '<div class="nr-cm-search">' + ico('search', 'sm') +
          '<input id="nr-cm-q" type="text" placeholder="Search..." autocomplete="off" spellcheck="false" />' +
        '</div>' +
        '<div id="nr-cm-body"></div>' +
      '</div>',
      { title: 'Add Model to Combo', icon: 'layers' }
    );

    const body = wrap.querySelector('#nr-cm-body');
    const q = wrap.querySelector('#nr-cm-q');

    const inCombo = (m) => (target.models || []).indexOf(m) !== -1;

    function toggle(m) {
      const list = target.models || (target.models = []);
      const i = list.indexOf(m);
      if (i === -1) list.push(m); else list.splice(i, 1);
      saveCombos();
      paint();
      renderCombos();
    }

    function pills(ms, tag) {
      return ms.map((m) => {
        const on = inCombo(m);
        return '<button type="button" class="nr-cm-pill' + (on ? ' on' : '') + '" data-m="' + esc(m) + '">' +
          '<span class="nr-cm-name">' + esc(m) + '</span>' +
          (tag ? '<span class="nr-cm-tag">custom</span>' : '') +
          '<span class="nr-cm-eye' + (on ? ' on' : '') + '">' + ico('eye') + '</span>' +
          '<span class="nr-cm-ai">' + ico('zap') + '</span>' +
        '</button>';
      }).join('');
    }

    function providerModels(p) {
      const ms = [];
      (p.models || []).forEach((m) => { if (ms.indexOf(m) === -1) ms.push(m); });
      if (p.default_model && ms.indexOf(p.default_model) === -1) ms.unshift(p.default_model);
      return ms;
    }

    function render() {
      const out = [];

      out.push(
        '<div class="nr-cm-sec" data-sec="combos">' +
          '<div class="nr-cm-head">' + ico('layers', 'sm') + 'Combos ' +
            '<span class="nr-cm-n">(' + combos.length + ')</span></div>' +
          (combos.length
            ? '<div class="nr-cm-chips">' + combos.map((x) =>
                '<button type="button" class="nr-cm-chip' + (x === target ? ' on' : '') +
                '" data-c="' + esc(x.name) + '">' + esc(x.name) + '</button>').join('') + '</div>'
            : '<div class="nr-cm-empty">No combos yet.</div>') +
        '</div>');

      providers.forEach((p) => {
        const ms = providerModels(p);
        out.push(
          '<div class="nr-cm-sec" data-sec="' + esc(p.id) + '">' +
            '<div class="nr-cm-head">' + ico('hub', 'sm') + esc(p.name || p.id) +
              ' <span class="nr-cm-n">(' + ms.length + ')</span></div>' +
            (ms.length
              ? '<div class="nr-cm-pills">' + pills(ms, false) + '</div>'
              : '<div class="nr-cm-empty">No models listed for this provider.</div>') +
          '</div>');
      });

      const known = {};
      providers.forEach((p) => {
        (p.models || []).forEach((m) => { known[m] = 1; });
        if (p.default_model) known[p.default_model] = 1;
      });
      const custom = (target.models || []).filter((m) => !known[m]);
      if (custom.length) {
        out.push(
          '<div class="nr-cm-sec" data-sec="custom">' +
            '<div class="nr-cm-head">' + ico('zap', 'sm') + 'custom' +
              ' <span class="nr-cm-n">(' + custom.length + ')</span></div>' +
            '<div class="nr-cm-pills">' + pills(custom, true) + '</div>' +
          '</div>');
      }

      body.innerHTML = out.join('');
      filter();
    }

    function paint() {
      $$('.nr-cm-pill', body).forEach((b) => {
        const on = inCombo(b.dataset.m);
        b.classList.toggle('on', on);
        const eye = b.querySelector('.nr-cm-eye');
        if (eye) eye.classList.toggle('on', on);
      });
    }

    function filter() {
      const term = q.value.trim().toLowerCase();
      $$('.nr-cm-sec', body).forEach((sec) => {
        const ps = $$('.nr-cm-pill', sec);
        if (!ps.length) {
          const hay = (sec.dataset.sec || '').toLowerCase() + ' ' + sec.textContent.toLowerCase();
          sec.classList.toggle('nr-hide', !!term && hay.indexOf(term) === -1);
          return;
        }
        let shown = 0;
        ps.forEach((b) => {
          const hit = !term || String(b.dataset.m || '').toLowerCase().indexOf(term) !== -1;
          b.classList.toggle('nr-hide', !hit);
          if (hit) shown++;
        });
        sec.classList.toggle('nr-hide', shown === 0);
      });
    }

    body.addEventListener('click', (e) => {
      const chip = e.target.closest ? e.target.closest('.nr-cm-chip') : null;
      if (chip) {
        const next = combos.filter((x) => x.name === chip.dataset.c)[0];
        if (next && next !== target) { target = next; render(); }
        return;
      }
      const pill = e.target.closest ? e.target.closest('.nr-cm-pill') : null;
      if (pill) toggle(pill.dataset.m);
    });

    q.addEventListener('input', filter);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { q.value = ''; filter(); }
    });

    render();
  }

  function openComboEditor(c) {
    const body =
      '<form id="nr-cb-form" class="flex flex-col gap-3">' +
        field('Combo Name', 'nr-cb-name', { ph: 'My Combo', value: c ? c.name : '' }) +
        '<div>' +
          '<label class="block text-xs font-medium text-text-muted mb-1.5">Strategy</label>' +
          '<div class="grid grid-cols-3 gap-1">' +
            STRATEGIES.map((s) =>
              '<button type="button" class="nr-cb-strat flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary" data-v="' + s[0] + '">' +
              '<span class="text-[11px] leading-tight">' + s[1] + '</span></button>'
            ).join('') +
          '</div>' +
        '</div>' +
        field('Models (one per line, fallback order)', 'nr-cb-models', {
          textarea: true, rows: 4, ph: 'gpt-4o\ngpt-4o-mini\nclaude-3-5-sonnet',
          value: c ? (c.models || []).join('\n') : ''
        }) +
        '<div class="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">' +
          '<button type="submit" class="btn primary sm">' + (c ? 'Save' : 'Create') + '</button>' +
          '<button type="button" id="nr-cb-cancel" class="btn ghost sm">Cancel</button>' +
        '</div>' +
      '</form>';

    const wrap = modalShell(body, { title: c ? 'Edit Combo' : 'Create Combo', icon: 'layers' });
    let strategy = c ? c.strategy : 'fallback';

    function paint() {
      $$('.nr-cb-strat', wrap).forEach((b) => {
        const on = b.dataset.v === strategy;
        b.classList.toggle('bg-primary/10', on);
        b.classList.toggle('text-primary', on);
        b.classList.toggle('text-text-muted', !on);
      });
    }
    $$('.nr-cb-strat', wrap).forEach((b) =>
      b.addEventListener('click', () => { strategy = b.dataset.v; paint(); })
    );
    paint();

    wrap.querySelector('#nr-cb-cancel').addEventListener('click', () => wrap.remove());
    wrap.querySelector('#nr-cb-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = wrap.querySelector('#nr-cb-name').value.trim();
      const models = lines(wrap.querySelector('#nr-cb-models').value);
      if (!name) { toast('Name is required', 'err'); return; }
      if (!models.length) { toast('At least one model is required', 'err'); return; }
      const rec = { name: name, models: models, strategy: strategy };
      if (c) Object.assign(c, rec); else combos.push(rec);
      saveCombos();
      renderCombos();
      wrap.remove();
      toast('Combo saved', 'ok');
    });
  }

  // ==================================================================
  //  PUBLIC API
  // ==================================================================

  window.Providers = {
    init: function () {
      providersShell();
      refreshProviders();
    },
    refresh: refreshProviders,
    getMap: function () {
      const map = {};
      providers.forEach((p) => {
        map[p.id] = {
          id: p.id,
          name: p.name,
          prefix: p.prefix || '',
          models: p.models || [],
          default_model: p.default_model || '',
          enabled: p.enabled !== false
        };
      });
      return map;
    },
    list: function () { return providers.slice(); }
  };

  let usageReady = false;
  window.Usage = {
    init: function () {
      if (!usageReady) { usageReady = true; usageShell(); }
      refreshUsage();
    },
    refresh: refreshUsage
  };

  let combosReady = false;
  window.Combos = {
    init: function () {
      loadCombos();
      if (combosReady) { renderCombos(); renderVision(); return; }
      // providers must be loaded before the vision select can be filled
      const boot = () => { if (combosReady) return; combosReady = true; combosShell(); };
      if (providers.length) { boot(); return; }
      const t = setInterval(() => { if (providers.length) { clearInterval(t); boot(); } }, 120);
      setTimeout(() => { clearInterval(t); if (!$('nr-combo-list')) boot(); }, 4000);
    },
    refresh: function () { renderCombos(); renderVision(); }
  };
})();