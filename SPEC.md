# Spec: Jarvis Chatroom

## Objective
Standalone desktop chatroom app (Electron) that fronts AI agent backends,
Hermes first. A Jarvis-style reactive orb shows agent state; below it a
detailed status line; at the bottom a chat box with file attach + push-to-talk
voice. Minimized mode docks a mini-orb to the screen corner. Agent replies can
be spoken aloud (TTS). This is a full chatroom, not just an orb widget.

## Tech Stack
- Electron ^36 (main + preload + vanilla renderer, no framework)
- Plain HTML/CSS/JS + Canvas 2D orb (no three.js in v1 — keep it light)
- Node 26, npm 11
- STT: cloud transcription (sync short-form + async long-form), key in OS keyring via keytar (fallback: settings file, never hardcoded)
- TTS: Edge TTS free default (edge-tts style endpoint), voice picker + mute toggle; offline Piper fallback later
- Backend v1: mock brain → Hermes via `hermes serve` JSON-RPC/WebSocket (port 9119). NOTE: `hermes proxy` only serves OAuth upstreams (nous/xai), NOT custom providers — so proxy is NOT the pipe.

## Commands
- Install: `npm install`
- Run: `npm start`
- Lint: `node --check main.js && node --check preload.js`

## Project Structure
- `main.js` → Electron main: windows (main + mini-orb), IPC, keyring
- `preload.js` → safe bridge (ipcRenderer expose)
- `renderer/index.html` → layout: messages + orb + status + composer + settings modal
- `renderer/styles.css` → themes via CSS vars (`[data-theme]`)
- `renderer/orb.js` → canvas orb renderer + states
- `renderer/app.js` → chat state, mock brain, backend abstraction, mini-orb
- `renderer/voice.js` → mic bars, MediaRecorder, cloud STT hookup, Edge TTS hookup

## Code Style
Vanilla JS, small functions, no build step. CSS vars for theming, never hardcoded colors in JS (orb reads vars).
Example: `setOrbState('searching', 'Searching...', 'Searching the Web...')`.

## Testing Strategy
- `node --check` on main/preload/renderer JS
- Manual: `npm start`, send message, see orb cycle idle→thinking→searching→answering→idle, mock reply streams
- Voice slice: record → bars animate → mock transcript lands in composer

## Boundaries
- Always: run node --check after edits; keep secrets out of source
- Ask first: adding npm deps, changing Hermes connection strategy
- Never: hardcode API keys; commit secrets; break mock-brain offline mode

## Success Criteria
- [ ] `npm install && npm start` opens chatroom, orb spins idle blue
- [ ] Sending chat triggers orb state cycle + streamed mock reply
- [ ] Clip attaches files/images as chips; voice button shows recording pill with live bars
- [ ] Settings modal has Voice / Themes / Backends tabs
- [ ] Hermes backend option detects `hermes serve` on 9119 (status dot)

## Open Questions
- Hermes serve RPC auth shape (inspect `hermes serve` web UI calls) — slice 4
- keytar build on this box vs settings-file fallback — slice 4
