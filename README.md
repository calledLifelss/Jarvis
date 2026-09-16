# Jarvis

Desktop chatroom for talking to AI agent backends. Hermes first — Mock, Claude Code, and custom providers work too. A reactive orb shows what the agent is up to, chat streams underneath, and replies can be read aloud in English and Persian.

## What it does

- Reactive orb: idle / thinking / searching / coding / speaking / error / listening, with the current task in its core and a detail line below
- Chat with streaming replies, markdown + code blocks with copy buttons, file/image attachments
- Push-to-talk mic: recording pill with live level bars. Dictation runs on-device: a bundled whisper-tiny ONNX model (sherpa-onnx) transcribes locally, so it is free, keyless and works offline, with no python, no account and nothing to install. English and Persian are selectable in Settings → Voice; the transcript lands in the box for editing before send
- Voice-out: free TTS, no key, no python — Edge over a plain WebSocket. Persian script is detected per sentence and switches voices mid-reply. Speed + pitch settings, speech starts while later sentences are still synthesizing (~1s warm)
- Mini mode: minimizing docks the orb bottom-left, always on top, with a chat box
- 16 theme packs (palette + fonts + icons + orb), including Minecraft. Each pack has layer toggles for which parts follow it
- Providers tab: add your own API provider, test keys live, map backends to providers. Keys stay in the OS-side vault, the UI only ever sees masked values
- Skills + Schedules: install Hermes skills from the hub, create cron jobs that fire on the gateway ticker
- Self-update: Settings → Updates → Check → Update, pulls from GitHub releases

## Install

Off the [releases page](../../releases) — pick your file:

| File | For |
|---|---|
| `Jarvis-1.0.0.x86_64.rpm` | Fedora / RHEL / openSUSE |
| `Jarvis_1.0.0_amd64.deb` | Debian / Ubuntu / Mint / Pop!_OS |
| `Jarvis-1.0.0-x86_64.pkg.tar.zst` | Arch / CachyOS / EndeavourOS / Manjaro |
| `Jarvis-1.0.0-linux.AppImage` | Anything else — `chmod +x` and run |
| `Jarvis-1.0.0-win-portable.exe` | Windows 10/11 |
| `Jarvis-1.0.0-win-portable.zip` | Windows, unzip and run `Jarvis.exe` |

`sha256sum -c SHA256SUMS.txt` to verify.

## Backends

- **Mock** (built in) — no setup, good for trying the UI
- **Hermes** — WebSocket JSON-RPC to `hermes serve` on `:9119`, per-chat model switch
- **Claude Code** — v2
- **Custom** — anything OpenAI/Anthropic/Codex-shaped, via the Providers tab

## From source

```bash
npm install
npm start
```

## Building installers

```bash
npm run release
```

Needs node 26. Linux targets build natively, Windows cross-compiles (portable exe/zip need no wine).

## Layout

```
main.js              windows (main + mini-orb), IPC
preload.js           invoke-only bridge, page gets no Node
updater.js           release check → download → install
edge_tts_native.js   Edge TTS over plain WebSocket, no python
renderer/
  app.js             chat, backends, settings wiring
  orb.js             canvas orb
  voice.js           mic pill, level bars, dictation
  edge-tts.js        voice-out (language detect, cleanup, knobs)
  providers.js       provider CRUD + backend mapping
  skills.js, cron.js skills hub, scheduled jobs
  packs.js           theme packs
  updates.js         updates tab
```

Vanilla JS throughout, no framework, no build step for the renderer. Every IPC handler validates the op against an allowlist. TTS ships as JS so user machines need nothing beyond the installer. Updates poll GitHub releases — no server.

## License

MIT
