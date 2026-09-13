// Info dots: small ⓘ buttons beside controls that need explaining.
// Hover (or focus) for 1.5s -> a small bubble fades in above the dot with
// a quick explanation. Leaving early cancels; Esc dismisses.
// API: InfoDots.attachAll() — scans [data-info] elements once.
(function () {
  const HOLD_MS = 1500;
  let openBubble = null;
  let openTimer = null;

  function close() {
    if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    if (openBubble) { openBubble.remove(); openBubble = null; }
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function show(anchor, text) {
    close();
    if (!text) text = anchor.getAttribute('data-info');
    if (!text) return;
    const b = document.createElement('div');
    b.className = 'info-bubble';
    b.textContent = text;
    b.setAttribute('role', 'tooltip');
    // position above the dot, clamped to viewport
    const r = anchor.getBoundingClientRect();
    b.style.visibility = 'hidden';
    document.body.appendChild(b);
    const bw = b.offsetWidth, bh = b.offsetHeight;
    let x = r.left + r.width / 2 - bw / 2;
    x = Math.max(8, Math.min(window.innerWidth - bw - 8, x));
    let y = r.top - bh - 8;
    if (y < 8) y = r.bottom + 8; // flip below when no room above
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    b.style.visibility = '';
    requestAnimationFrame(() => b.classList.add('show'));
    openBubble = b;
    document.addEventListener('keydown', onKey, true);
    // auto-dismiss after 6s so stale bubbles never linger
    openTimer = setTimeout(close, 6000);
  }

  function arm(dot, text) {
    let t = null;
    const start = () => {
      cancel();
      t = setTimeout(() => show(dot, text), HOLD_MS);
    };
    const cancel = () => {
      if (t) { clearTimeout(t); t = null; }
    };
    dot.addEventListener('pointerenter', start);
    dot.addEventListener('pointerleave', () => { cancel(); });
    dot.addEventListener('focus', start);
    dot.addEventListener('blur', () => { cancel(); close(); });
    dot.addEventListener('click', (e) => {
      // click toggles instantly (touch users get no hover)
      e.stopPropagation();
      if (openBubble) close();
      else show(dot, text);
    });
  }

  function attachAll(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-info]:not([data-info-bound])').forEach((el) => {
      el.setAttribute('data-info-bound', '1');
      // wrap: dot sits right after the labeled control
      const dot = document.createElement('button');
      dot.className = 'info-dot';
      dot.textContent = 'i';
      dot.setAttribute('aria-label', 'About this control');
      dot.setAttribute('title', 'Hold to learn more');
      el.appendChild(dot);
      arm(dot, el.getAttribute('data-info'));
    });
    document.addEventListener('click', (e) => {
      if (openBubble && !openBubble.contains(e.target)) close();
    }, { once: false });
  }

  window.InfoDots = { attachAll, close };
})();
