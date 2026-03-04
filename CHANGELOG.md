# Changelog

## v0.1.0

Initial release of PixelClaw — fork of Pixel Agents rewired for OpenClaw.

- OpenClaw agent discovery via `~/.openclaw/agents/` filesystem scanning
- OpenClaw JSONL parser with FIFO tool matching
- Standalone web app mode (Express + WebSocket at localhost:3847)
- Dual-mode webview transport (VS Code postMessage or WebSocket)
- Agent idle timeout detection (30s)
- WebSocket auto-reconnect with exponential backoff
- Rebranded from pixel-agents to pixelclaw
