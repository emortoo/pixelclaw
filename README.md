# PixelClaw

Pixel art office where your [OpenClaw](https://github.com/openclaw) agents come to life as animated characters. Watch them code, search, and think in real time.

Fork of [Pixel Agents](https://github.com/pablodelucca/pixel-agents) — rewired to monitor OpenClaw agents instead of Claude Code terminals.

## How It Works

PixelClaw watches `~/.openclaw/agents/` for active agent sessions. Each agent gets a character that walks to a desk, types when running tools, reads when searching files, and idles when waiting for input.

## Two Modes

### Standalone Web App (recommended)

```sh
npm install && cd webview-ui && npm install && cd ..
npm start
```

Opens at **http://localhost:3847**. Works in any browser, including mobile via Tailscale.

### VS Code Extension

Press **F5** to launch the Extension Development Host. The panel appears in the bottom bar alongside the terminal.

## What You See

- Characters animate based on tool usage (typing for edits, reading for searches)
- Speech bubbles show when an agent is waiting or needs permission
- Sound notification when an agent finishes a turn
- Full office layout editor (floors, walls, furniture)

## Build

```sh
npm install
cd webview-ui && npm install && cd ..
npm run build          # Full build (extension + webview)
npm run server:build   # Standalone server only
```

## Project Structure

```
src/                           Extension backend
  openclawParser.ts            OpenClaw JSONL → webview messages
  openclawAgentDiscovery.ts    Filesystem agent scanning
  openclawController.ts        Shared controller (VS Code + standalone)
  PixelClawViewProvider.ts     VS Code WebviewViewProvider
  extension.ts                 VS Code entry point

server/                        Standalone web app
  index.ts                     Express + WebSocket server

webview-ui/src/                React + Canvas game engine
  office/engine/               Character FSM, rendering, game loop
  office/layout/               Furniture, pathfinding, serialization
  office/editor/               Layout editor tools
```

## Data Paths

| Path | Purpose |
|------|---------|
| `~/.openclaw/agents/` | OpenClaw agent sessions (read-only) |
| `~/.pixelclaw/layout.json` | Office layout |
| `~/.pixelclaw/agents.json` | Agent-to-character mapping |

## License

MIT
