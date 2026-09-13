// Voice-out: persistent edge-tts daemon via main (no per-chunk spawn).
// - English + Persian voices, AUTO language detect per chunk (fa script ->
//   fa voice, else en voice). Mixed replies switch mid-stream.
// - Quality: markdown/code stripped (never spoken), URLs/emails spelled
//   sanely, breathing pauses at sentence ends, loudness normalized.
// - Speed: rate/pitch/volume knobs persisted; daemon keeps one warm WS.
(function () {
  const VOICES = [
    // English — Jarvis shelf
    { id: 'en-US-GuyNeural', label: 'Guy (US male, Jarvis-ish)', lang: 'English (US)', group: 'en' },
    { id: 'en-US-ChristopherNeural', label: 'Christopher (US male)', lang: 'English (US)', group: 'en' },
    { id: 'en-US-EricNeural', label: 'Eric (US male)', lang: 'English (US)', group: 'en' },
    { id: 'en-US-RogerNeural', label: 'Roger (US male)', lang: 'English (US)', group: 'en' },
    { id: 'en-US-SteffanNeural', label: 'Steffan (US male)', lang: 'English (US)', group: 'en' },
    { id: 'en-GB-RyanNeural', label: 'Ryan (British male)', lang: 'English (UK)', group: 'en' },
    { id: 'en-GB-ThomasNeural', label: 'Thomas (British male)', lang: 'English (UK)', group: 'en' },
    { id: 'en-GB-SoniaNeural', label: 'Sonia (British female)', lang: 'English (UK)', group: 'en' },
    { id: 'en-US-JennyNeural', label: 'Jenny (US female)', lang: 'English (US)', group: 'en' },
    { id: 'en-US-AriaNeural', label: 'Aria (US female)', lang: 'English (US)', group: 'en' },
    // Persian — Dilara (female) + Farid (male)
    { id: 'fa-IR-DilaraNeural', label: 'Dilara (Persian female)', lang: 'Persian', group: 'fa' },
    { id: 'fa-IR-FaridNeural', label: 'Farid (Persian male)', lang: 'Persian', group: 'fa' },
  ];

  const FA_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

  let currentAudio = null;
  let lastVoice = localStorage.getItem('jarvis-tts-voice') || 'en-US-GuyNeural';
  let lastFaVoice = localStorage.getItem('jarvis-tts-voice-fa') || 'fa-IR-DilaraNeural';
  let langMode = localStorage.getItem('jarvis-tts-langmode') || 'auto'; // auto|en|fa
  let rate = localStorage.getItem('jarvis-tts-rate') || '+10%';
  let pitch = localStorage.getItem('jarvis-tts-pitch') || '+0Hz';
  let volume = localStorage.getItem('jarvis-tts-volume') || '+0%';
  let gen = 0;

  function getVoice() { return lastVoice; }
  function setVoice(v) {
    const known = VOICES.find((x) => x.id === v);
    if (known && known.group === 'fa') { lastFaVoice = v; localStorage.setItem('jarvis-tts-voice-fa', v); }
    else { lastVoice = v; localStorage.setItem('jarvis-tts-voice', v); }
  }
  function getFaVoice() { return lastFaVoice; }
  function getLangMode() { return langMode; }
  function setLangMode(m) { langMode = m; localStorage.setItem('jarvis-tts-langmode', m); }
  function getRate() { return rate; }
  function setRate(r) { rate = r; localStorage.setItem('jarvis-tts-rate', r); }
  function getPitch() { return pitch; }
  function setPitch(p) { pitch = p; localStorage.setItem('jarvis-tts-pitch', p); }
  function getVolume() { return volume; }
  function setVolume(v) { volume = v; localStorage.setItem('jarvis-tts-volume', v); }

  function isFa(text) {
    if (langMode === 'fa') return true;
    if (langMode === 'en') return false;
    return FA_RE.test(text || '');
  }
  function voiceFor(text) {
    return isFa(text) ? lastFaVoice : lastVoice;
  }

  // Quality cleanup: strip everything the ear hates, keep speakable text.
  function cleanForSpeech(text) {
    let t = String(text || '');
    t = t.replace(/```[\s\S]*?```/g, ' ');          // code fences: drop entirely
    t = t.replace(/`([^`]+)`/g, '$1');               // inline code -> words
    t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');  // images -> alt
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');   // links -> text
    t = t.replace(/^#{1,6}\s+/gm, '');               // headers
    t = t.replace(/[*_~>]+/g, '');                   // emphasis/quotes
    t = t.replace(/https?:\/\/[^\s]+/g, (u) => {     // URLs -> domain words
      try {
        const host = new URL(u).hostname.replace(/^www\./, '').replace(/\./g, ' dot ');
        return host;
      } catch { return 'link'; }
    });
    t = t.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1 at $2');
    t = t.replace(/[|\\{}[\]]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function speak(text, voice, opts) {
    voice = voice || voiceFor(text);
    stop();
    const myGen = gen;
    return new Promise((resolve, reject) => {
      const clean = cleanForSpeech(text).slice(0, 2000).trim();
      if (!clean || myGen !== gen) { resolve(); return; }
      if (!window.jarvis || !window.jarvis.ttsSpeak) {
        reject(new Error('TTS bridge unavailable'));
        return;
      }
      const o = opts || {};
      window.jarvis.ttsSpeak(clean, voice, {
        rate: o.rate || rate, pitch: o.pitch || pitch, volume: o.volume || volume,
      }).then((r) => {
        if (myGen !== gen) { resolve(); return; }
        if (!r || !r.ok || !r.audio) { reject(new Error((r && r.error) || 'tts failed')); return; }
        const bin = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bin], { type: 'audio/mpeg' }));
        const audio = new Audio(url);
        audio.volume = 1;
        // gentle fade-out on stop instead of a hard cut
        audio._jarvisFade = false;
        currentAudio = audio;
        audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve(); };
        audio.onerror = () => reject(new Error('audio playback failed'));
        const p = audio.play();
        if (p && p.catch) p.catch(reject);
      }).catch(reject);
    });
  }

  function stop() {
    gen++;
    try {
      if (currentAudio) {
        const a = currentAudio;
        currentAudio = null;
        // 120ms fade beats a click-cut
        try {
          const fade = setInterval(() => {
            try {
              a.volume = Math.max(0, a.volume - 0.25);
              if (a.volume <= 0) { clearInterval(fade); a.pause(); }
            } catch { clearInterval(fade); try { a.pause(); } catch {} }
          }, 30);
          setTimeout(() => { try { clearInterval(fade); a.pause(); } catch {} }, 400);
        } catch { try { a.pause(); } catch {} }
      }
    } catch {}
    try { speechSynthesis.cancel(); } catch {}
  }

  window.EdgeTTS = {
    VOICES, speak, stop, getVoice, setVoice,
    getFaVoice, getLangMode, setLangMode,
    getRate, setRate, getPitch, setPitch, getVolume, setVolume,
    isFa, voiceFor, cleanForSpeech,
  };
})();
