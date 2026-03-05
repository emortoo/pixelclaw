#!/bin/bash
set -e

echo "╔══════════════════════════════════════╗"
echo "║     PixelClaw Production Server      ║"
echo "╚══════════════════════════════════════╝"

# ── Configure OpenClaw ──────────────────────────────────
echo "[entrypoint] Configuring OpenClaw..."

# Set exec host to gateway and full tool profile
openclaw config set tools.profile full 2>/dev/null || true
openclaw config set tools.exec.host gateway 2>/dev/null || true

# Auto-approve all exec commands for the main agent
openclaw approvals allowlist add --agent main "**" 2>/dev/null || true
openclaw approvals allowlist add --agent "*" "**" 2>/dev/null || true

# ── Start OpenClaw Gateway ──────────────────────────────
echo "[entrypoint] Starting OpenClaw Gateway on :18789..."
openclaw gateway run --bind loopback --port 18789 &
GATEWAY_PID=$!

# Wait for gateway to be ready
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:18789/ >/dev/null 2>&1 || ss -tlnp | grep -q 18789; then
        echo "[entrypoint] Gateway ready (attempt $i)"
        break
    fi
    sleep 1
done

# ── Start PixelClaw Server ──────────────────────────────
echo "[entrypoint] Starting PixelClaw on :3847..."
node /app/dist/server.js &
PIXELCLAW_PID=$!

echo "[entrypoint] All services running."
echo "  Gateway PID:   $GATEWAY_PID"
echo "  PixelClaw PID: $PIXELCLAW_PID"

# ── Graceful shutdown ───────────────────────────────────
trap "echo '[entrypoint] Shutting down...'; kill $PIXELCLAW_PID $GATEWAY_PID 2>/dev/null; wait" SIGTERM SIGINT

# Wait for either process to exit
wait -n
EXIT_CODE=$?
echo "[entrypoint] Process exited with code $EXIT_CODE, shutting down..."
kill $PIXELCLAW_PID $GATEWAY_PID 2>/dev/null
wait
exit $EXIT_CODE
