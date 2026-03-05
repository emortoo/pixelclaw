#!/bin/bash
# PixelClaw VPS Bootstrap
# Usage: curl -sSL https://raw.githubusercontent.com/emortoo/pixelclaw/main/scripts/bootstrap-vps.sh | bash -s -- yourdomain.com
#
# Prerequisites:
# - Fresh Ubuntu 22.04+ or Debian 12+ VPS
# - DNS A record pointing your domain to this server's IP
# - Run as root or with sudo

set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/emortoo/pixelclaw.git"
DEPLOY_DIR="/opt/pixelclaw"

# ── Validation ──────────────────────────────────────────
if [ -z "$DOMAIN" ]; then
    echo "Usage: $0 <domain>"
    echo "Example: $0 pixelclaw.example.com"
    exit 1
fi

echo "╔══════════════════════════════════════╗"
echo "║   PixelClaw VPS Bootstrap            ║"
echo "║   Domain: $DOMAIN"
echo "╚══════════════════════════════════════╝"

# ── System packages ─────────────────────────────────────
echo "[1/6] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git ufw

# ── Docker ──────────────────────────────────────────────
echo "[2/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Install Docker Compose plugin if not present
if ! docker compose version &>/dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi

# ── Firewall ────────────────────────────────────────────
echo "[3/6] Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy redirect)
ufw allow 443/tcp   # HTTPS
ufw allow 443/udp   # HTTP/3
ufw --force enable

# ── Clone repo ──────────────────────────────────────────
echo "[4/6] Cloning PixelClaw..."
if [ -d "$DEPLOY_DIR" ]; then
    cd "$DEPLOY_DIR" && git pull
else
    git clone "$REPO" "$DEPLOY_DIR"
fi
cd "$DEPLOY_DIR"

# ── Configure ───────────────────────────────────────────
echo "[5/6] Configuring environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    sed -i "s/DOMAIN=.*/DOMAIN=$DOMAIN/" .env
    echo ""
    echo "  ⚠️  Edit .env to add your MODEL_API_KEY if needed:"
    echo "  nano $DEPLOY_DIR/.env"
    echo ""
fi

# ── Launch ──────────────────────────────────────────────
echo "[6/6] Starting services..."
docker compose up -d --build

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   PixelClaw is live!                 ║"
echo "║                                      ║"
echo "║   https://$DOMAIN"
echo "║                                      ║"
echo "║   SSL will provision automatically   ║"
echo "║   (may take 1-2 minutes)             ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f          # View logs"
echo "  docker compose restart          # Restart services"
echo "  docker compose down             # Stop everything"
echo "  docker compose pull && up -d    # Manual update"
