// Canvas orb. setOrbState(state, coreText, subText), getOrbState().
(function () {
  const canvas = document.getElementById('orb');
  const coreEl = document.getElementById('orb-core-text');
  const subEl = document.getElementById('orb-sub');
  const wrap = document.getElementById('orb-wrap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const HOUSE_COLORS = {
    idle: '#9aa3b2', thinking: '#c9a227', searching: '#22d3ee',
    coding: '#4ade80', speaking: '#ffb300', error: '#ef4444',
    listening: '#f472b6',
  };
  // Per-pack orb stories: idle follows the pack scene; hot states keep
  // cross-pack meaning where it matters (error stays red everywhere).
  const PACK_COLORS = {
    'jarvis-dark': { idle: '#9aa3b2', thinking: '#c9a227', searching: '#22d3ee', coding: '#4ade80', speaking: '#e5a021', listening: '#f472b6', error: '#ef4444' },
    'jarvis-blue': { idle: '#6b88a0', thinking: '#41c4f2', searching: '#41c4f2', coding: '#7fe3ff', speaking: '#41c4f2', listening: '#9fd8f2', error: '#f0565e' },
    'midnight': { idle: '#5a6390', thinking: '#8b95f5', searching: '#b9c0ff', coding: '#8b95f5', speaking: '#8b95f5', listening: '#c9a2ff', error: '#f0566e' },
    'crimson': { idle: '#8a6a64', thinking: '#ff6a3d', searching: '#ffb03d', coding: '#ff6a3d', speaking: '#ff6a3d', listening: '#ff9a8a', error: '#ff2222' },
    'forest': { idle: '#5a7a63', thinking: '#54e37f', searching: '#a5ffb8', coding: '#54e37f', speaking: '#54e37f', listening: '#d0ffe0', error: '#f0565e' },
    'sand': { idle: '#8a7a5c', thinking: '#ffd166', searching: '#ffe9a8', coding: '#ffd166', speaking: '#ffd166', listening: '#fff0c9', error: '#ff6b5c' },
    'light': { idle: '#8a8474', thinking: '#b07208', searching: '#0e7c86', coding: '#2e8f66', speaking: '#b07208', listening: '#7a5206', error: '#c93a3e' },
    'violet': { idle: '#7a6490', thinking: '#cb7fff', searching: '#e8c9ff', coding: '#cb7fff', speaking: '#cb7fff', listening: '#f0dfff', error: '#ff5c7a' },
    'minecraft': { idle: '#7a8a4a', thinking: '#7fc93f', searching: '#c8ff5e', coding: '#7fc93f', speaking: '#7fc93f', listening: '#e2ff9e', error: '#e5484d' },
    'sakura': { idle: '#8a6a7a', thinking: '#ff8fbf', searching: '#ffc9e0', coding: '#ff8fbf', speaking: '#ff8fbf', listening: '#ffe0ee', error: '#ff5252' },
    'ocean': { idle: '#4a6a75', thinking: '#2fd4c4', searching: '#9ef2e8', coding: '#2fd4c4', speaking: '#2fd4c4', listening: '#d0fff9', error: '#ff6b6b' },
    'ember': { idle: '#8a6a4a', thinking: '#ff9a3d', searching: '#ffd08a', coding: '#ff9a3d', speaking: '#ff9a3d', listening: '#ffe3c2', error: '#ff4444' },
    'royal': { idle: '#7a6a8a', thinking: '#e8c34a', searching: '#ffedb0', coding: '#e8c34a', speaking: '#e8c34a', listening: '#fff3d0', error: '#f0566e' },
    'noir': { idle: '#6a6a6a', thinking: '#f0f0f0', searching: '#ffffff', coding: '#f0f0f0', speaking: '#f0f0f0', listening: '#ffffff', error: '#e5484d' },
    'desert': { idle: '#8a7a55', thinking: '#e07b39', searching: '#ffc48a', coding: '#e07b39', speaking: '#e07b39', listening: '#ffdfba', error: '#d64545' },
    'ghost': { idle: '#7a8a93', thinking: '#0e7c86', searching: '#33c4d0', coding: '#0e7c86', speaking: '#0e7c86', listening: '#5cc9d4', error: '#c93a3e' },
  };
  let state = 'idle';
  let angle = 0, pulse = 0, mx = 0, my = 0, ripple = 0;
  // orb breathes by state: gray + small when idle, big + hot when working.
  // The app is NAMED after this thing, so the hot states own the room.
  const SIZES = {
    idle: 0.30, thinking: 0.52, searching: 0.72, coding: 0.72,
    speaking: 0.95, listening: 1.0, error: 0.62,
  };
  // how hard the shell pumps while in this state (0 = calm breathing)
  const PUMP = {
    idle: 0.03, thinking: 0.10, searching: 0.14, coding: 0.14,
    speaking: 0.22, listening: 0.30, error: 0.08,
  };
  let curSize = SIZES.idle;
  let pump = 0;          // 0..1 energy, eased toward the state's target
  let shock = 0;         // one-shot burst fired when a hot state begins

  if (wrap) {
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      mx = (e.clientX - r.left - r.width / 2) / r.width;
      my = (e.clientY - r.top - r.height / 2) / r.height;
    });
    wrap.addEventListener('pointerleave', () => { mx = 0; my = 0; });
    wrap.addEventListener('pointerdown', () => { ripple = 1; });
  }

  function hexRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function alpha(hex, a) {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function accent() {
    // layer override orb=house: the house story on any pack scene
    const root = document.documentElement;
    const houseOrb = root.dataset && root.dataset.layerOrb === 'house';
    if (!houseOrb) {
      const pack = root.dataset ? root.dataset.theme : null;
      const story = pack && PACK_COLORS[pack];
      if (story && story[state]) return story[state];
    }
    if (HOUSE_COLORS[state]) return HOUSE_COLORS[state];
    const v = getComputedStyle(root).getPropertyValue('--accent').trim();
    return v || '#ffb300';
  }
  function rand(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // --- precomputed particle shell (Fibonacci sphere + jitter) ---
  const SHELL_N = 850;
  const shell = [];
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SHELL_N; i++) {
    const y = 1 - (i / (SHELL_N - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = GA * i;
    const j = 0.97 + rand(i * 1.3) * 0.06;
    shell.push({ x: Math.cos(th) * rad * j, y: y * j, z: Math.sin(th) * rad * j, s: rand(i * 7.7) });
  }
  // sparse outer fragments (sparser toward edges)
  const OUTER_N = 170;
  const outer = [];
  for (let i = 0; i < OUTER_N; i++) {
    const y = 1 - rand(i * 3.1) * 2;
    const th = rand(i * 9.4) * Math.PI * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const rr = 1.06 + Math.pow(rand(i * 5.5), 1.6) * 0.4;
    outer.push({ x: Math.cos(th) * rad * rr, y: y * rr, z: Math.sin(th) * rad * rr, s: rand(i * 3.3) });
  }
  // background dust motes
  const MOTES = 46;
  const motes = [];
  for (let i = 0; i < MOTES; i++) {
    motes.push({ x: rand(i * 11.1), y: rand(i * 17.3), z: rand(i * 23.7), sp: 0.0004 + rand(i * 29.1) * 0.0012 });
  }
  // fragmented panel patches
  const PANELS = 16;
  const panels = [];
  for (let i = 0; i < PANELS; i++) {
    panels.push({
      lane: 0.68 + rand(i * 13.7) * 0.42,
      a0: rand(i * 31.3) * Math.PI * 2,
      len: 0.25 + rand(i * 47.9) * 0.7,
      tilt: (rand(i * 53.1) - 0.5) * 0.5,
      sp: (rand(i * 61.7) > 0.5 ? 1 : -1) * (0.15 + rand(i * 71.3) * 0.4),
    });
  }
  // light trails escaping the sphere
  const TRAILS = 10;
  const trails = [];
  for (let i = 0; i < TRAILS; i++) {
    trails.push({
      a: rand(i * 83.3) * Math.PI * 2,
      tilt: (rand(i * 91.7) - 0.5) * 0.9,
      len: 26 + rand(i * 97.1) * 46,
      sp: 0.1 + rand(i * 101.3) * 0.35,
      w: 0.8 + rand(i * 107.7) * 1.2,
    });
  }

  function project(px, py, pz, cx, cy, R, rotY, tilt) {
    // rotate around Y, then tilt around X
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const x1 = px * cosY + pz * sinY;
    const z1 = -px * sinY + pz * cosY;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const y2 = py * cosT - z1 * sinT;
    const z2 = py * sinT + z1 * cosT;
    return { x: cx + x1 * R, y: cy + y2 * R, z: z2 };
  }

  function drawTickRing(cx, cy, r, color, rot) {
    const ticks = 72;
    for (let i = 0; i < ticks; i++) {
      const a = rot + (i / ticks) * Math.PI * 2;
      const major = i % 6 === 0;
      const len = major ? 8 : 3.5;
      ctx.beginPath();
      ctx.strokeStyle = alpha(color, major ? 0.8 : 0.32);
      ctx.lineWidth = major ? 1.8 : 1;
      ctx.moveTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
  }

  function draw() {
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const color = accent();
    const speed = state === 'idle' ? 1 : 2.2;
    angle += 0.009 * speed;
    pulse += 0.045 * speed;
    const S = W / 300;
    curSize += ((SIZES[state] || 1) - curSize) * 0.06;
    // energy ramps fast into a hot state and drains slowly out of it
    const want = PUMP[state] || 0.05;
    pump += (want - pump) * (want > pump ? 0.08 : 0.025);
    if (shock > 0) shock = Math.max(0, shock - 0.022);
    // the beat: a slow thump with a sharp attack, doubled on listening
    const beatRate = state === 'listening' ? 3.1 : state === 'speaking' ? 2.2 : 1.5;
    const raw = (Math.sin(pulse * beatRate) + 1) / 2;
    const beat = Math.pow(raw, 3.2);              // sharp attack, soft tail
    const breathe = Math.sin(pulse * 0.42) * 0.5 + 0.5;
    const swell = 1 + pump * (beat * 0.42 + breathe * 0.10) + shock * 0.35;
    const R = 86 * S * curSize * swell;
    // rings fly outward on the beat while hot
    if (pump > 0.12 && beat > 0.93) ripple = Math.max(ripple, pump * 0.55);
    const px = mx * 8 * S, py = my * 8 * S;
    const rotY = angle * 0.9;
    const tilt = 0.38 + Math.sin(pulse * 0.3) * 0.05;
    // holo flicker
    const flick = 0.9 + Math.sin(pulse * 6.3) * 0.04 + (rand(Math.floor(pulse * 9)) - 0.5) * 0.05;

    ctx.clearRect(0, 0, W, H);

    // --- backdrop: warm volumetric glow on dark navy ---
    let bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, R * 2.2);
    bg.addColorStop(0, alpha(color, 0.20 * flick));
    bg.addColorStop(0.45, alpha(color, 0.07));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // faint floor grid (command-center feel)
    ctx.save();
    ctx.strokeStyle = 'rgba(120,160,220,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const gy = cy + R * (0.9 + i * 0.28);
      ctx.beginPath();
      ctx.moveTo(cx - R * 1.9, gy);
      ctx.lineTo(cx + R * 1.9, gy);
      ctx.stroke();
    }
    ctx.restore();

    // --- background dust ---
    ctx.save();
    for (let i = 0; i < MOTES; i++) {
      const m = motes[i];
      m.y -= m.sp;
      if (m.y < -0.05) m.y = 1.05;
      const x = m.x * W, y = m.y * H;
      ctx.globalAlpha = 0.12 + m.z * 0.25;
      ctx.fillStyle = '#ffd98a';
      ctx.fillRect(x, y, 1.4 * S, 1.4 * S);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    const ox = cx + px, oy = cy + py;

    // --- particle shell (dense, translucent, depth-shaded) ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < SHELL_N; i++) {
      const p = shell[i];
      const q = project(p.x, p.y, p.z, ox, oy, R, rotY, tilt);
      const depth = (q.z + 1) / 2; // 0 back .. 1 front
      const tw = 0.55 + 0.45 * Math.sin(pulse * 3 + p.s * 20);
      ctx.globalAlpha = (0.10 + depth * 0.75) * tw * flick;
      ctx.fillStyle = p.s > 0.93 ? '#fff6dd' : color;
      const sz = (p.s > 0.93 ? 2 : 1.3) * S * (0.6 + depth * 0.7);
      ctx.fillRect(q.x, q.y, sz, sz);
    }
    // sparse outer fragments
    for (let i = 0; i < OUTER_N; i++) {
      const p = outer[i];
      const q = project(p.x, p.y, p.z, ox, oy, R, rotY * 0.7, tilt);
      const depth = (q.z + 1) / 2;
      ctx.globalAlpha = (0.06 + depth * 0.4) * flick;
      ctx.fillStyle = color;
      ctx.fillRect(q.x, q.y, 1.2 * S, 1.2 * S);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // --- wireframe lat/long lines ---
    ctx.save();
    ctx.strokeStyle = alpha(color, 0.28 * flick);
    ctx.lineWidth = 1 * S;
    for (const lat of [-60, -30, 0, 30, 60]) {
      const lr = Math.cos(lat * Math.PI / 180);
      const rr = R * lr;
      const yy = oy + Math.sin(lat * Math.PI / 180) * R * Math.cos(tilt);
      ctx.beginPath();
      ctx.ellipse(ox, yy, rr, Math.max(1, rr * 0.36), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let k = 0; k < 3; k++) {
      const a = rotY + (k / 3) * Math.PI;
      const rx = Math.max(2, Math.abs(Math.cos(a)) * R);
      ctx.beginPath();
      ctx.ellipse(ox, oy, rx, R, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.16 + 0.14 * Math.abs(Math.sin(a));
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // --- sphere silhouette ---
    ctx.beginPath();
    ctx.strokeStyle = alpha(color, 0.5 * flick);
    ctx.lineWidth = 1.4 * S;
    ctx.arc(ox, oy, R, 0, Math.PI * 2);
    ctx.stroke();

    // --- fragmented geometric panels ---
    ctx.save();
    for (let i = 0; i < PANELS; i++) {
      const p = panels[i];
      const rr = R * p.lane;
      const a0 = p.a0 + angle * p.sp;
      const sweep = p.len;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(p.tilt);
      // panel body: short bright arc
      ctx.beginPath();
      ctx.strokeStyle = alpha(color, 0.75 * flick);
      ctx.lineWidth = 3 * S;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.arc(0, 0, rr, a0, a0 + sweep);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // node dots at ends
      for (const ae of [a0, a0 + sweep]) {
        ctx.beginPath();
        ctx.fillStyle = '#fff3d0';
        ctx.arc(Math.cos(ae) * rr, Math.sin(ae) * rr, 2 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      // HUD ticks along the panel
      ctx.strokeStyle = alpha(color, 0.5);
      ctx.lineWidth = 1 * S;
      const n = 3 + (i % 3);
      for (let k = 1; k <= n; k++) {
        const ae = a0 + (sweep * k) / (n + 1);
        ctx.beginPath();
        ctx.moveTo(Math.cos(ae) * (rr - 5 * S), Math.sin(ae) * (rr - 5 * S));
        ctx.lineTo(Math.cos(ae) * (rr + 1 * S), Math.sin(ae) * (rr + 1 * S));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // --- concentric translucent gyro rings ---
    const gyro = [
      { r: R + 26 * S, tiltA: 0.5, rot: angle * 0.7, dash: [14 * S, 9 * S] },
      { r: R + 40 * S, tiltA: -0.35, rot: -angle * 0.5 + 1, dash: [6 * S, 12 * S] },
    ];
    for (const gr of gyro) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(gr.tiltA);
      ctx.scale(1, 0.42);
      ctx.setLineDash(gr.dash);
      ctx.lineDashOffset = gr.rot * 40 * S;
      ctx.beginPath();
      ctx.strokeStyle = alpha(color, 0.55 * flick);
      ctx.lineWidth = 1.6 * S;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.arc(0, 0, gr.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);

    // --- HUD tick dial ---
    drawTickRing(ox, oy, R + 58 * S, color, angle * 0.2);

    // --- orbiting data blocks ---
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const a = -angle * (0.5 + i * 0.12) + i * 1.26;
      const rr = R + (48 + (i % 2) * 14) * S;
      const x = ox + Math.cos(a) * rr, y = oy + Math.sin(a) * rr * 0.5;
      ctx.fillStyle = alpha(color, 0.7 * flick);
      ctx.fillRect(x, y, (4 + (i % 3) * 3) * S, 2.4 * S);
      ctx.strokeStyle = alpha(color, 0.4);
      ctx.lineWidth = 1 * S;
      ctx.beginPath();
      ctx.moveTo(x - 12 * S, y + 1 * S);
      ctx.lineTo(x, y + 1 * S);
      ctx.stroke();
    }
    ctx.restore();

    // --- light trails escaping the sphere ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < TRAILS; i++) {
      const t = trails[i];
      const a = t.a + angle * t.sp;
      const x0 = ox + Math.cos(a) * R * 0.95;
      const y0 = oy + Math.sin(a) * R * 0.95;
      const x1 = ox + Math.cos(a + t.tilt * 0.4) * (R + t.len * 0.5 * S);
      const y1 = oy + Math.sin(a + t.tilt * 0.4) * (R + t.len * 0.5 * S);
      const x2 = ox + Math.cos(a + t.tilt) * (R + t.len * S);
      const y2 = oy + Math.sin(a + t.tilt) * (R + t.len * S);
      const grad = ctx.createLinearGradient(x0, y0, x2, y2);
      grad.addColorStop(0, alpha('#ffe9a8', 0.8 * flick));
      grad.addColorStop(0.4, alpha(color, 0.45 * flick));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.strokeStyle = grad;
      ctx.lineWidth = t.w * S;
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x1, y1, x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // --- scanline sweep (holo feel) ---
    const scanY = oy - R + ((pulse * 24) % (R * 2));
    const sg = ctx.createLinearGradient(0, scanY - 8 * S, 0, scanY + 8 * S);
    sg.addColorStop(0, 'rgba(255,233,168,0)');
    sg.addColorStop(0.5, alpha('#ffe9a8', 0.20 * flick));
    sg.addColorStop(1, 'rgba(255,233,168,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(ox - R, scanY - 8 * S, R * 2, 16 * S);

    // --- hot golden core with bloom ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const coreR = R * 0.34 * (1 + Math.sin(pulse * 2.2) * 0.06);
    let cg = ctx.createRadialGradient(ox, oy, 1, ox, oy, R * 1.05);
    cg.addColorStop(0, `rgba(255,252,240,${0.95 * flick})`);
    cg.addColorStop(0.18, alpha('#ffe9a8', 0.85 * flick));
    cg.addColorStop(0.42, alpha(color, 0.5 * flick));
    cg.addColorStop(0.75, alpha(color, 0.12));
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(ox, oy, R * 1.05, 0, Math.PI * 2);
    ctx.fill();
    // overexposed center
    ctx.shadowColor = '#fff3d0';
    ctx.shadowBlur = 30 * flick;
    ctx.fillStyle = `rgba(255,255,248,${0.9 * flick})`;
    ctx.beginPath();
    ctx.arc(ox, oy, coreR * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- specular glass highlight ---
    ctx.save();
    ctx.translate(ox - R * 0.32, oy - R * 0.42);
    ctx.rotate(-0.5);
    const hg = ctx.createRadialGradient(0, 0, 1, 0, 0, R * 0.3);
    hg.addColorStop(0, 'rgba(255,255,255,0.55)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.3, R * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- click shockwave ---
    if (ripple > 0) {
      const rr = R + (1 - ripple) * 70 * S;
      ctx.beginPath();
      ctx.strokeStyle = alpha(color, ripple);
      ctx.lineWidth = 2.5 * S;
      ctx.arc(ox, oy, rr, 0, Math.PI * 2);
      ctx.stroke();
      ripple -= 0.025;
    }

    requestAnimationFrame(draw);
  }

  // states where the orb takes over the panel instead of sitting in the strip
  const BIG_STATES = ['listening', 'speaking'];

  window.setOrbState = function (s, coreText, subText) {
    const changed = s !== state;
    state = s;
    if (changed && (BIG_STATES.includes(s) || s === 'thinking' || s === 'error')) shock = 0.85;
    // state hooks for the strip: working -> sweep bar, error -> red readout.
    const layer = document.getElementById('orb-layer');
    if (layer) {
      layer.classList.toggle('working', ['thinking', 'searching', 'coding', 'speaking', 'listening'].includes(s));
      layer.classList.toggle('error', s === 'error');
      layer.dataset.orbState = s;
      layer.classList.toggle('big', BIG_STATES.includes(s));
    }
    if (coreEl && coreText !== undefined) {
      coreEl.setAttribute('data-text', coreText);
      coreEl.textContent = '';
    }
    if (subEl && subText !== undefined) subEl.textContent = subText;
  };
  window.getOrbState = () => state;
  draw();
})();
