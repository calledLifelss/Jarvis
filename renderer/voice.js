// Voice module: push-to-talk recording pill with live mic bars,
// cloud STT hookup point + Edge TTS speak() hookup point.
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

    // prefer MIME types the transcription API handles reliably
    const mimePick = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
      .find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m))) || '';
    mediaRecorder = new MediaRecorder(stream, mimePick ? { mimeType: mimePick } : undefined);
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.start();

    recPill.classList.remove('hidden');
    btnMic.classList.add('recording');
    startedAt = Date.now();
    tickClock();
    drawBars(true);
    window.setOrbState('listening', 'Listening…', 'Recording — hit ✓ Transcribe when done.');
  }

  function stopRecording(cancelled) {
    cancelAnimationFrame(rafId);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close();
    analyser = null;
    recPill.classList.add('hidden');
    btnMic.classList.remove('recording');
    if (cancelled) {
      audioChunks = [];
      window.setOrbState('idle', 'Idle', 'Ready.');
      return null;
    }
    return new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
  }

  btnMic.addEventListener('click', () => {
    if (recPill.classList.contains('hidden')) startRecording();
    else stopRecording(true); // toggle off cancels
  });
  recCancel.addEventListener('click', () => stopRecording(true));
  recSend.addEventListener('click', async () => {
    const blob = stopRecording(false);
    if (blob) await window.transcribeAudio(blob);
  });

  // STT hookup (slice 4 fills the real cloud transcription call; mock for now).
  window.transcribeAudio = async function (blob) {
    window.setOrbState('thinking', 'Transcribing…', 'Sending audio to transcription…');
    // TODO(slice-4): POST blob to transcription API (sync API <120s, else async upload+poll).
    await new Promise((r) => setTimeout(r, 900));
    const input = document.getElementById('chat-input');
    input.value = '[mock transcript — cloud STT wiring lands in slice 4]';
    input.focus();
    window.setOrbState('idle', 'Idle', 'Transcript ready — edit, then Send.');
  };

  // TTS hookup (slice 4 fills the real Edge TTS call).
  window.speakText = async function (text) {
    if (!window.voiceOn) return;
    window.setOrbState('speaking', 'Speaking…', text.slice(0, 80));
    // Prefer built-in speechSynthesis as an instant fallback voice.
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 400));
      u.onend = () => { if (window.getOrbState() === 'speaking') window.setOrbState('idle', 'Idle', 'Ready.'); };
      speechSynthesis.speak(u);
    } catch { /* no TTS available */ }
    // TODO(slice-4): Edge TTS fetch → audio element playback (Jarvis voice).
  };
})();
