// Safe IPC bridge. No Node in the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  enterMiniMode: () => ipcRenderer.send('enter-mini-mode'),
  exitMiniMode: () => ipcRenderer.send('exit-mini-mode'),
  miniCloseOrb: () => ipcRenderer.send('mini-close-orb'),
  ttsSpeak: (text, voice, opts) => ipcRenderer.invoke('tts-speak', { text, voice, ...(opts || {}) }),
  sttTranscribe: (samples, sampleRate, language) => ipcRenderer.invoke('stt-transcribe', { samples, sampleRate, language }),
  providers: (op, args) => ipcRenderer.invoke('providers-call', op, args || {}),
  cli: (op, args) => ipcRenderer.invoke('hermes-cli', op, args || {}),
  hermesPorts: () => ipcRenderer.invoke('hermes-ports'),
  hermesEnsure: () => ipcRenderer.invoke('hermes-ensure'),
  updates: (op, args) => ipcRenderer.invoke('jarvis-updates', op, args || {}),
  onUpdateProgress: (fn) => {
    ipcRenderer.on('jarvis-update-progress', (_e, pct) => { try { fn(pct); } catch {} });
  },
});
