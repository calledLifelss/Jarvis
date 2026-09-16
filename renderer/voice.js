// Push-to-talk pill with live mic bars.
//
// Dictation runs entirely on-device: the clip is decoded in the renderer,
// mixed down to mono and handed to the sherpa-onnx whisper model in main
// (the stt-transcribe IPC op). No API key, no account, no model download —
// the ONNX model ships inside the package, so this works on a stranger's
// machine with no setup at all.
//
// Chromium's own SpeechRecognition is deliberately NOT used: inside Electron
// it dies with error:network on every platform (probed against the exact
// Electron 40.10.2 this app ships), which reads to the user as "dictation is
// broken" with nothing they can do about it.
(function () {
  const btnMic = document.getElementById('btn-mic');
  const recPill = document.getElementById('rec-pill');
  const micCanvas = document.getElementById('micbars');
  const recTime = document.getElementById('rec-time');
  const recCancel = document.getElementById('rec-cancel');
  const recSend = document.getElementById('rec-send');
  const mctx = micCanvas.getContext('2d');

  let mediaRecorder = null, audioChunks = [], analyser = null, audioCtx = null;
  let rafId = null, startedAt = 0, stream = null;
  let busy = false;

  const BARS = 32;
  let levels = new Array(BARS).fill(0.08);

  function drawBars(live) {
    const W = micCanvas.width, H = micCanvas.height;
    mctx.clearRect(0, 0, W, H);
    const bw = W / BARS;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38bdf8';
    if (live && analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < BARS; i++) {
        const v = data[Math.floor(i * data.length / BARS / 1.5)] / 255;
        levels[i] += (v - levels[i]) * 0.4;
      }
    } else {
      levels = levels.map((l) => l * 0.9 + 0.05 * 0.1);
    }
    for (let i = 0; i < BARS; i++) {
      const h = Math.max(3, levels[i] * H);
      const x = i * bw + bw * 0.2, w = bw * 0.6, y = (H - h) / 2;
      mctx.fillStyle = accent;
      mctx.globalAlpha = 0.65 + levels[i] * 0.35;
      mctx.beginPath();
      mctx.roundRect(x, y, w, h, 3);
      mctx.fill();
    }
    mctx.globalAlpha = 1;
    rafId = requestAnimationFrame(() => drawBars(live && !!analyser));
  }

  function tickClock() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    recTime.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (!recPill.classList.contains('hidden')) setTimeout(tickClock, 500);
  }

  // Which language the user is speaking. Whisper is multilingual, but it needs
  // to be told: left on English, Persian comes back transliterated into Latin
  // nonsense instead of script.
  function sttLang() {
    const sel = document.getElementById('stt-lang');
    const picked = sel && sel.value;
    if (picked && picked !== 'auto') return picked;
    const nav = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return nav === 'fa' ? 'fa' : 'en';
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      window.setOrbState('error', 'Mic blocked', 'Microphone permission denied.');
      setTimeout(() => window.setOrbState('idle', 'Idle', 'Ready.'), 2500);
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    src.connect(analyser);

    const mimePick = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
      .find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m))) || '';
    try {
      mediaRecorder = new MediaRecorder(stream, mimePick ? { mimeType: mimePick } : undefined);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
      mediaRecorder.start();
    } catch {
      mediaRecorder = null;
      window.setOrbState('error', 'Cannot record', 'This build has no audio recorder.');
      if (stream) stream.getTracks().forEach((t) => t.stop());
      return;
    }

    recPill.classList.remove('hidden');
    btnMic.classList.add('recording');
    startedAt = Date.now();
    tickClock();
    drawBars(true);
    window.setOrbState('listening', 'Listening…', 'Speak — hit ✓ when you are done.');
  }

  // Resolves only once the recorder has flushed its final chunk, otherwise the
  // last syllable of every clip is silently missing.
  function stopRecording(cancelled) {
    return new Promise((resolve) => {
      cancelAnimationFrame(rafId);
      const finish = () => {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (audioCtx) { try { audioCtx.close(); } catch {} }
        analyser = null;
        recPill.classList.add('hidden');
        btnMic.classList.remove('recording');
        if (cancelled) {
          audioChunks = [];
          window.setOrbState('idle', 'Idle', 'Ready.');
          resolve(null);
          return;
        }
        resolve(new Blob(audioChunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' }));
      };
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = finish;
        try { mediaRecorder.stop(); } catch { finish(); }
      } else {
        finish();
      }
    });
  }

  // Decode in the page (Chromium already knows opus/webm), mix to mono, and let
  // main do the 16 kHz resample the model wants.
  async function transcribeBlob(blob) {
    const raw = await blob.arrayBuffer();
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await ac.decodeAudioData(raw);
    } finally {
      try { ac.close(); } catch {}
    }
    const n = decoded.length;
    const chans = decoded.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < chans; c++) {
      const d = decoded.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i];
    }
    if (chans > 1) for (let i = 0; i < n; i++) mono[i] /= chans;
    return window.jarvis.sttTranscribe(mono, decoded.sampleRate, sttLang());
  }

  function addSys(msg) {
    try {
      const log = document.getElementById('chat-log') || document.getElementById('messages');
      if (!log) return;
      const d = document.createElement('div');
      d.className = 'msg sys';
      d.textContent = msg;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    } catch {}
  }

  btnMic.addEventListener('click', () => {
    if (recPill.classList.contains('hidden')) startRecording();
    else stopRecording(true); // toggle off cancels
  });
  recCancel.addEventListener('click', () => stopRecording(true));

  recSend.addEventListener('click', async () => {
    if (busy) return;
    const blob = await stopRecording(false);
    const input = document.getElementById('chat-input');
    if (!blob || !blob.size) {
      window.setOrbState('idle', 'Idle', 'Nothing recorded.');
      return;
    }
    busy = true;
    window.setOrbState('thinking', 'Transcribing…', 'On-device whisper');
    try {
      const res = await transcribeBlob(blob);
      const text = String((res && res.text) || '').trim();
      if (!text) {
        window.setOrbState('error', 'Heard nothing', 'Try again a little closer to the mic.');
        setTimeout(() => window.setOrbState('idle', 'Idle', 'Ready.'), 3000);
        return;
      }
      input.value = (input.value ? input.value + ' ' : '') + text;
      input.focus();
      window.setOrbState('idle', 'Idle', 'Transcript ready — edit, then Send.');
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      addSys('\ud83c\udf99 On-device transcription failed: ' + msg);
      window.setOrbState('error', 'Dictation failed', msg);
      setTimeout(() => window.setOrbState('idle', 'Idle', 'Ready.'), 3000);
    } finally {
      busy = false;
    }
  });
})();