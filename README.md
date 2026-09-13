# Jarvis

A **Jarvis-style desktop chatroom** for talking to AI agent backends — Hermes first, with Mock, Claude Code and custom providers pluggable. A reactive orb shows what the agent is doing (thinking, searching, coding, speaking…), chat streams below it, and the app speaks replies aloud in English *and* Persian.

![platforms](https://img.shields.io/badge/linux-rpm%20%C2%B7%20deb%20%C2%B7%20pacman%20%C2%B7%20AppImage-blue) ![windows](https://img.shields.io/badge/windows-exe%20%C2%B7%20portable-blue) ![updates](https://img.shields.io/badge/updates-in--app-green)

## ✨ What it does

- 🔵 **Reactive orb** — idle / thinking / searching / coding / speaking / error / listening, with the live task written in its core and a detail line underneath
- 💬 **Full chatroom** — streaming replies, markdown + code blocks with copy buttons, file/image attach chips
- 🎙️ **Push-to-talk mic** — recording pill with live level bars → cloud transcription → text lands in the chat box, editable before send
- 🔊 **Voice-out (bilingual)** — Edge TTS, free, no key. Auto-detects Persian script per sentence and switches voices mid-reply (Dilara/Farid 🇮🇷 + English shelf). Speed + pitch knobs, pipelined so speech starts while later sentences still synthesize (~1.1s warm)
- 📌 **Mini mode** — minimize and the orb docks bottom-left, always on top, with a chat box
- 🎨 **16 theme packs** — full scenes (palette + fonts + icons + orb story), incl. Minecraft. Per-pack layer dropdowns pick which parts follow the pack
- 🔑 **Providers tab** — add your own API provider (base URL + key + models), live-test keys, map each backend to a provider. Keys live in the OS-side vault, never in source
- 🛠️ **Skills + Schedules** — browse/install Hermes skills from the hub, create cron jobs that fire on the gateway ticker
- 🔄 **In-app updates** — Settings → Updates → Check → Update. New builds install on restart (pkexec prompt on Linux, installer on Windows)

## 📥 Install

Grab the latest release — 6 files, pick yours:

| File | For |
|---|---|
| `Jarvis-1.0.0.x86_64.rpm` | Fedora / RHEL / openSUSE |
| `Jarvis_1.0.0_amd64.deb` | Debian / Ubuntu / Mint / Pop!_OS |
| `Jarvis-1.0.0-x86_64.pkg.tar.zst` | Arch / CachyOS / EndeavourOS / Manjaro |
| `Jarvis-1.0.0-linux.AppImage` | Any other Linux — `chmod +x` and run |
| `Jarvis-1.0.0-win-portable.exe` | Windows 10/11 — double-click |
| `Jarvis-1.0.0-win-portable.zip` | Windows — unzip anywhere, run `Jarvis.exe` |

No python, no terminal, no setup. Verify with `sha256sum -c SHA256SUMS.txt`.

## 🧠 Backends

- **Mock** (built-in) — works with zero setup, great for trying the UI
- **Hermes** — live WebSocket JSON-RPC to `hermes serve` on `:9119`, per-chat model switch (`--session`)
- **Claude Code** — v2 hookup
- **Custom** — any OpenAI/Anthropic/Codex-shaped API via the Providers tab

## 🛠️ Run from source

```bash
npm install
npm start
```

## 📦 Build installers

```bash
npm run release   # all targets → release/out/ + checksums + Desktop drop
```

Requires node 26. Linux targets build natively; Windows builds cross-compile (portable exe/zip need no wine).

## 🗺️ Fundamentals / architecture

```
main.js              Electron main: windows (main + mini-orb), IPC allowlists
preload.js           Safe bridge — renderer gets invoke-only handles, no Node
updater.js           Self-update: GitHub releases check → download → install
edge_tts_native.js   Edge TTS over raw WebSocket, pure JS (no python anywhere)
renderer/
  app.js             Chat state, backends, settings wiring
  orb.js             Canvas orb renderer + states
  voice.js           Mic recording pill, live bars
  edge-tts.js        Voice-out layer (fa/en detect, quality cleanup, knobs)
  providers.js       Provider CRUD + backend mapping (via keyman bridge)
  skills.js / cron.js  Hermes skills hub + scheduled jobs
  packs.js           16 theme packs engine
  updates.js         Updates tab UI
```

Key decisions:
- **Vanilla JS, no framework, no build step** — the renderer is plain HTML/CSS/JS so anyone can read and hack it
- **Strict IPC allowlists** — every `ipcMain.handle` validates the op; the renderer never sees raw keys (only masked) and never touches config directly
- **Zero python on user machines** — TTS and providers go through bundled JS; the keyman bridge only matters for dev setups
- **Updates without a server** — GitHub releases is the host, the app polls it

## 📄 License

MIT
