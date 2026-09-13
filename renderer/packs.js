// Theme packs: 16 full scenes. Each pack = palette (themes.css) + type
// (pack-fonts.css) + icon voice (packs.css) + orb color story (orb.js).
// Layers (icons/fonts/shape/orb) can each fall back to the house look via
// data-layer-* attributes — the per-pack dropdowns in the gallery.
// Persists: jarvis-pack + jarvis-pack-layers in localStorage.
(function () {
  const PACKS = [
    { id: 'jarvis-dark', name: 'Jarvis Dark', vibe: 'The house console. Amber on graphite.', fonts: 'Inter + JetBrains Mono', icons: 'Lucide outline' },
    { id: 'jarvis-blue', name: 'Ops Deck', vibe: 'Cold blue operations bridge.', fonts: 'Chakra Petch + Space Mono', icons: 'Plug-zap / alarm / crosshair' },
    { id: 'midnight', name: 'Midnight', vibe: 'Deep indigo night ops.', fonts: 'Space Grotesk + IBM Plex Mono', icons: 'Timer / squares / heavy round' },
    { id: 'crimson', name: 'Red Alert', vibe: 'Engineering under klaxon light.', fonts: 'Bebas Neue + Roboto Mono', icons: 'Rocket send / zap / stencil' },
    { id: 'forest', name: 'Phosphor', vibe: 'Green-screen terminal, lovingly.', fonts: 'Ubuntu Mono everywhere', icons: 'Thin phosphor terminal' },
    { id: 'sand', name: 'Dune Paper', vibe: 'Warm paper console, soft corners.', fonts: 'Quicksand + Courier Prime', icons: 'Calendar / soft circles' },
    { id: 'light', name: 'Daylight', vibe: 'Paper whites for bright rooms.', fonts: 'Lora serif + PT Mono', icons: 'House voice' },
    { id: 'violet', name: 'Ultraviolet', vibe: 'Lab glow, violet tubes.', fonts: 'Rajdhani + Fira Mono', icons: 'Sparkles / wand / heart' },
    { id: 'minecraft', name: 'Overworld', vibe: 'Blocky grass-and-dirt console. No rounded corners survived.', fonts: 'Silkscreen + VT323', icons: 'Chunky blocks' },
    { id: 'sakura', name: 'Sakura', vibe: 'Late-night tokyo terminal, pink neon rain.', fonts: 'DotGothic + Nanum Coding', icons: 'Heart dock / sparkles' },
    { id: 'ocean', name: 'Trench', vibe: 'Abyssal teal, pressure-proof.', fonts: 'Oswald + Overpass Mono', icons: 'Anchor dock / sailboat send' },
    { id: 'ember', name: 'Forge', vibe: 'Embossed serif, forge-room heat.', fonts: 'Cinzel + Cutive Mono', icons: 'Hammer / rocket / alarm' },
    { id: 'royal', name: 'Velvet Room', vibe: 'Gold on velvet, command with manners.', fonts: 'Cormorant + Major Mono', icons: 'Crown / gem dock' },
    { id: 'noir', name: 'Noir Desk', vibe: 'Black, white, and a typewriter.', fonts: 'Special Elite everywhere', icons: 'Stamp blocks' },
    { id: 'desert', name: 'Field Kit', vibe: 'Sun-bleached expedition hardware.', fonts: 'Bebas + Nova Mono', icons: 'Sunrise cron / mountain dock' },
    { id: 'ghost', name: 'Signal Station', vibe: 'Pale daylight console, teal signal.', fonts: 'Spline Sans + Red Hat Mono', icons: 'Radio tower / ghost dock' },
  ];

  const LAYERS = [
    { key: 'icons', label: 'Icons', house: 'House Lucide', pack: 'Pack voice' },
    { key: 'fonts', label: 'Fonts', house: 'House type', pack: 'Pack type' },
    { key: 'shape', label: 'Corners', house: 'House 3px', pack: 'Pack shape' },
    { key: 'orb', label: 'Orb', house: 'House amber', pack: 'Pack story' },
  ];

  function getPack() {
    return localStorage.getItem('jarvis-pack') || 'jarvis-dark';
  }
  function getLayers() {
    try { return JSON.parse(localStorage.getItem('jarvis-pack-layers') || '{}'); } catch { return {}; }
  }
  function setLayers(l) {
    localStorage.setItem('jarvis-pack-layers', JSON.stringify(l));
  }

  function apply() {
    const pack = getPack();
    const layers = getLayers();
    const root = document.documentElement;
    root.dataset.theme = pack;
    for (const L of LAYERS) {
      const attr = 'layer' + L.key[0].toUpperCase() + L.key.slice(1);
      if (layers[L.key] === 'house') root.dataset[attr] = 'house';
      else delete root.dataset[attr];
    }
    try { localStorage.setItem('jarvis-theme', pack); } catch {}
  }

  function setPack(id) {
    localStorage.setItem('jarvis-pack', id);
    apply();
    render();
  }

  function setLayer(packId, layerKey, value) {
    const layers = getLayers();
    if (value === 'house') layers[layerKey] = 'house';
    else delete layers[layerKey];
    // layers are global (one console, one taste) — pack stays, layer flips
    setLayers(layers);
    apply();
    render();
  }

  function render() {
    const host = document.getElementById('pack-gallery');
    if (!host) return;
    const cur = getPack();
    const layers = getLayers();
    host.innerHTML = '';
    const count = document.getElementById('pack-count');
    if (count) count.textContent = PACKS.length + ' scenes';
    for (const p of PACKS) {
      const card = document.createElement('div');
      card.className = 'pack-card' + (p.id === cur ? ' active' : '');
      card.dataset.pack = p.id;

      const swatch = document.createElement('button');
      swatch.className = 'pack-swatch';
      swatch.title = 'Activate ' + p.name;
      // mini scene preview: three tonal blocks painted from the pack vars
      swatch.innerHTML = `<span class="pack-chip" data-chip="${p.id}"></span>
        <span class="pack-names"><b></b><i></i></span>
        <span class="pack-state"></span>`;
      swatch.querySelector('b').textContent = p.name;
      swatch.querySelector('i').textContent = p.vibe;
      swatch.querySelector('.pack-state').textContent = p.id === cur ? '● active' : '○';
      swatch.addEventListener('click', () => setPack(p.id));
      card.appendChild(swatch);

      // proper activate button: full-width, unambiguous
      const act = document.createElement('button');
      act.className = 'btn sm pack-activate' + (p.id === cur ? ' primary' : ' ghost');
      act.textContent = p.id === cur ? '✓ Active' : 'Activate';
      act.disabled = p.id === cur;
      act.addEventListener('click', () => setPack(p.id));
      card.appendChild(act);

      // per-layer dropdowns: what of this pack shows
      const layersEl = document.createElement('div');
      layersEl.className = 'pack-layers';
      for (const L of LAYERS) {
        const lab = document.createElement('label');
        lab.className = 'pack-layer';
        const nm = document.createElement('span');
        nm.textContent = L.label;
        const sel = document.createElement('select');
        sel.dataset.pack = p.id;
        sel.dataset.layer = L.key;
        const oPack = document.createElement('option');
        oPack.value = 'pack';
        oPack.textContent = L.pack;
        const oHouse = document.createElement('option');
        oHouse.value = 'house';
        oHouse.textContent = L.house;
        sel.appendChild(oPack);
        sel.appendChild(oHouse);
        // layers are global: show current global value on every card
        sel.value = layers[L.key] === 'house' ? 'house' : 'pack';
        sel.addEventListener('change', () => setLayer(p.id, L.key, sel.value));
        lab.appendChild(nm);
        lab.appendChild(sel);
        layersEl.appendChild(lab);
      }
      const fonts = document.createElement('div');
      fonts.className = 'hint';
      fonts.textContent = p.fonts + ' · ' + p.icons;
      card.appendChild(fonts);
      card.appendChild(layersEl);
      host.appendChild(card);
    }
    paintChips();
  }

  // Paint each card's chip from the pack's real vars (temporary data-theme hop).
  function paintChips() {
    const root = document.documentElement;
    const keep = root.dataset.theme;
    for (const chip of document.querySelectorAll('.pack-chip[data-chip]')) {
      const id = chip.dataset.chip;
      root.dataset.theme = id;
      const cs = getComputedStyle(root);
      const bg = cs.getPropertyValue('--panel').trim() || '#000';
      const ac = cs.getPropertyValue('--accent').trim() || '#fff';
      const tx = cs.getPropertyValue('--text').trim() || '#fff';
      chip.style.background = `linear-gradient(135deg, ${bg} 0 55%, ${ac} 55% 72%, ${tx} 72% 74%, ${bg} 74% 100%)`;
      chip.style.borderColor = ac;
    }
    root.dataset.theme = keep;
  }

  function init() {
    // migrate legacy jarvis-theme to pack key when it names a pack
    try {
      const legacy = localStorage.getItem('jarvis-theme');
      if (legacy && PACKS.some((p) => p.id === legacy) && !localStorage.getItem('jarvis-pack')) {
        localStorage.setItem('jarvis-pack', legacy);
      }
    } catch {}
    apply();
  }

  window.Packs = { init, render, apply, setPack, setLayer, PACKS };
})();
