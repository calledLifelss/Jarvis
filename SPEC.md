# Jarvis Chatroom — working notes

Electron desktop chatroom fronting agent backends, Hermes first. Reactive
orb for agent state, status line under it, chat box with file attach +
push-to-talk at the bottom. Minimizing docks a mini-orb to the corner.
Replies can be spoken aloud.

## Stack

- Electron (main + preload + vanilla renderer, no framework)
- Canvas 2D orb, plain HTML/CSS/JS
- Node 26, npm 11
- STT: cloud transcription, key in settings (never hardcoded)
- TTS: Edge TTS, voice picker + mute; offline fallback later
- Backend: mock → Hermes via `hermes serve` JSON-RPC/WS on 9119. Note:
  `hermes proxy` only serves OAuth upstreams, not custom providers.

## Commands

- `npm install`, `npm start`
- `node --check` on anything edited
- `npm run release` for installers

## Files

- `main.js` → windows, IPC, keyring
- `preload.js` → bridge
- `renderer/index.html` → messages + orb + status + composer + settings
- `renderer/styles.css` → theming via CSS vars
- `renderer/orb.js` → orb renderer + states
- `renderer/app.js` → chat, backends, mini-orb
- `renderer/voice.js` → mic bars, MediaRecorder, STT/TTS hooks

## Style

Vanilla JS, small functions. CSS vars for theming, orb reads them.
`setOrbState('searching', 'Searching...', 'Searching the Web...')`.

## Checks

- `npm start`, send a message, orb cycles, reply streams
- mock works offline; Hermes option detects `hermes serve` on 9119
- record → bars animate → transcript lands in composer

## Rules

- `node --check` after edits, secrets never in source
- adding npm deps or changing the Hermes connection: think twice first
- never hardcode keys, never break offline mock mode
