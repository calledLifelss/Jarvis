// Slash palette: / in the composer -> command suggestions, Enter inserts,
// send executes and renders inline as a sys bubble.
(function () {
  let menu = null, input = null, items = [], sel = 0, open = false;
  let debounce = null;

  function init() {
    menu = document.getElementById('slash-menu');
    input = document.getElementById('chat-input');
    if (!menu || !input) return false;
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey, true);
    document.addEventListener('click', (e) => {
      if (open && !menu.contains(e.target) && e.target !== input) hide();
    });
    return true;
  }

  function show() { open = true; menu.classList.remove('hidden'); }
  function hide() { open = false; menu.classList.add('hidden'); items = []; sel = 0; }
  function isOpen() { return open; }

  async function onInput() {
    const v = input.value;
    if (!v.startsWith('/') || v.includes(' ') && !/^\/\S*$/.test(v)) {
      // only complete the first token
      if (!/^\/\S*$/.test(v.split(' ')[0]) || !v.startsWith('/')) { hide(); return; }
    }
    const token = v.split(' ')[0];
    if (!token.startsWith('/')) { hide(); return; }
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        if (window.HermesBackend && window.HermesBackend.state.connected) {
          items = await window.HermesBackend.slashComplete(token);
        } else {
          items = [];
        }
        // fallback: local catalog filter when backend completion fails
        if (!items.length && window.HermesBackend) {
          try {
            const cat = await window.HermesBackend.slashCatalog();
            const q = token.slice(1).toLowerCase();
            items = cat
              .filter(([name]) => name.slice(1).toLowerCase().startsWith(q))
              .slice(0, 12)
              .map(([name, desc]) => ({ text: name.slice(1), display: name, meta: desc, kind: 'command' }));
          } catch {}
        }
        render();
      } catch { hide(); }
    }, 120);
  }

  function render() {
    if (!items.length) { hide(); return; }
    sel = Math.min(sel, items.length - 1);
    menu.innerHTML = '';
    items.slice(0, 12).forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'slash-item' + (i === sel ? ' sel' : '');
      const cmd = document.createElement('span');
      cmd.className = 'cmd';
      cmd.textContent = it.display || ('/' + it.text);
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = it.meta || '';
      b.appendChild(cmd);
      b.appendChild(desc);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      menu.appendChild(b);
    });
    show();
  }

  function pick(i) {
    const it = items[i];
    if (!it) return;
    input.value = (it.display || ('/' + it.text)) + ' ';
    hide();
    input.focus();
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); sel = (sel + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); sel = (sel - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Tab' && items.length) { e.preventDefault(); e.stopPropagation(); pick(sel); }
    else if (e.key === 'Enter' && items.length && !input.value.includes(' ')) { e.preventDefault(); e.stopPropagation(); pick(sel); }
    else if (e.key === 'Escape') { hide(); }
  }

  // Execute a full /command line via slash.exec; returns true if handled.
  async function tryExec(line, addMsg) {
    if (!line.startsWith('/')) return false;
    const cmd = line.trim();
    if (!window.HermesBackend || !window.HermesBackend.state.connected) return false;
    window.setOrbState('thinking', line.split(' ')[0], 'Running ' + line.split(' ')[0] + '…');
    try {
      const r = await window.HermesBackend.slashExec(cmd);
      const out = (r && (r.output || r.text)) || (cmd + ': done (no output)');
      addMsg('sys', cmd + '\n' + String(out).slice(0, 3000));
      if (r && r.session_id) { /* some commands mint turns; history will show */ }
    } catch (e) {
      addMsg('sys', cmd + ' → ❌ ' + (e.message || e));
    }
    window.setOrbState('idle', 'Idle', 'Ready.');
    return true;
  }

  window.SlashPalette = { init, isOpen, hide, tryExec };
})();
