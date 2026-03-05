#!/bin/bash
# PixelClaw Raspberry Pi Dev Setup
# Usage: bash scripts/setup-pi.sh
#
# Installs systemd user services so OpenClaw Gateway and PixelClaw
# auto-start on boot and auto-restart on crash. No more tmux.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════╗"
echo "║   PixelClaw Pi Dev Setup             ║"
echo "╚══════════════════════════════════════╝"

# ── Enable lingering (services run without active login) ─
echo "[1/5] Enabling user lingering..."
sudo loginctl enable-linger "$USER"

# ── Create systemd user dir ─────────────────────────────
echo "[2/5] Installing systemd services..."
mkdir -p ~/.config/systemd/user

cp "$INFRA_DIR/systemd/openclaw-gateway.service" ~/.config/systemd/user/
cp "$INFRA_DIR/systemd/pixelclaw.service" ~/.config/systemd/user/

# ── Configure OpenClaw for auto-approve ─────────────────
echo "[3/5] Configuring OpenClaw exec permissions..."
openclaw config set tools.profile full 2>/dev/null || true
openclaw config set tools.exec.host gateway 2>/dev/null || true
openclaw approvals allowlist add --agent main "**" 2>/dev/null || true

# ── Enable and start services ───────────────────────────
echo "[4/5] Enabling services..."
systemctl --user daemon-reload
systemctl --user enable openclaw-gateway pixelclaw
systemctl --user start openclaw-gateway
sleep 5
systemctl --user start pixelclaw

# ── Kill any leftover tmux sessions ─────────────────────
echo "[5/5] Cleaning up old tmux sessions..."
tmux kill-session -t gateway 2>/dev/null || true
tmux kill-session -t pixelclaw 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Pi dev environment ready!          ║"
echo "║                                      ║"
echo "║   http://$(hostname -I | awk '{print $1}'):3847"
echo "║                                      ║"
echo "║   Services auto-start on boot.       ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Useful commands:"
echo "  systemctl --user status openclaw-gateway  # Gateway status"
echo "  systemctl --user status pixelclaw          # PixelClaw status"
echo "  journalctl --user -u pixelclaw -f          # Live logs"
echo "  systemctl --user restart pixelclaw         # Restart"
