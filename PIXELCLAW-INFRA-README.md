# PixelClaw Infrastructure

Deploy PixelClaw to a Pi (dev) and VPS (prod) with auto-SSL, CI/CD, and mobile PWA.

## Architecture

```
┌─ Dev (Raspberry Pi) ─────────────────┐    ┌─ Prod (Hetzner VPS) ──────────────────────┐
│                                       │    │                                             │
│ systemd: openclaw-gateway (:18789)    │    │ Caddy (auto-SSL, reverse proxy)             │
│ systemd: pixelclaw (:3847)            │    │   ├── PixelClaw + OpenClaw (Docker)         │
│                                       │    │   └── Watchtower (auto-deploy from GHCR)    │
│ LAN access: http://10.0.0.26:3847    │    │                                             │
└───────────────────────────────────────┘    │ Public: https://YOURDOMAIN.com              │
                                             └─────────────────────────────────────────────┘

┌─ CI/CD ──────────────────────────────────────────────────────────────────────────────────┐
│ Push to main → GitHub Actions → Build Docker image → Push to GHCR → Watchtower pulls    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Option A: Pi Dev Environment

```bash
# On your Raspberry Pi
git clone https://github.com/emortoo/pixelclaw.git
cd pixelclaw
npm install && npm run server:build
bash scripts/setup-pi.sh
```

Services auto-start on boot. Access at `http://<pi-ip>:3847`.

### Option B: VPS Production

**1. Provision a VPS** (recommended: Hetzner CAX11, $4.50/mo ARM)

**2. Point DNS** — Add an A record for your domain to the VPS IP

**3. Bootstrap**
```bash
ssh root@your-vps-ip
curl -sSL https://raw.githubusercontent.com/emortoo/pixelclaw/main/scripts/bootstrap-vps.sh | bash -s -- yourdomain.com
```

**4. Configure** (if using a paid LLM)
```bash
cd /opt/pixelclaw
nano .env  # Add MODEL_API_KEY
docker compose restart
```

That's it. SSL provisions automatically via Let's Encrypt.

## File Structure

```
pixelclaw/
├── docker/
│   ├── Dockerfile           # Multi-stage build (builder → production)
│   └── entrypoint.sh        # Starts Gateway + PixelClaw, handles shutdown
├── docker-compose.yml       # Caddy + PixelClaw + Watchtower
├── Caddyfile                # Auto-SSL reverse proxy config
├── .env.example             # Environment template
├── .github/workflows/
│   └── deploy.yml           # Build + push to GHCR on push to main
├── scripts/
│   ├── bootstrap-vps.sh     # One-command VPS setup
│   └── setup-pi.sh          # Pi systemd service installer
├── systemd/
│   ├── openclaw-gateway.service
│   └── pixelclaw.service
└── pwa/
    ├── manifest.json         # PWA manifest for mobile install
    └── sw.js                 # Service worker for offline/caching
```

## Mobile PWA Install

After deploying to VPS:

1. Open `https://yourdomain.com` on your phone
2. **iOS**: Tap Share → Add to Home Screen
3. **Android**: Tap the browser menu → Install App

The PWA runs fullscreen like a native app.

## Day-to-Day Operations

### View logs
```bash
# VPS
docker compose logs -f
docker compose logs pixelclaw -f

# Pi
journalctl --user -u pixelclaw -f
journalctl --user -u openclaw-gateway -f
```

### Restart services
```bash
# VPS
docker compose restart

# Pi
systemctl --user restart pixelclaw openclaw-gateway
```

### Deploy manually
```bash
# VPS (normally automatic via Watchtower)
cd /opt/pixelclaw
git pull
docker compose up -d --build
```

### Update Pi after code changes
```bash
cd ~/pixelclaw
git pull
npm run server:build
systemctl --user restart pixelclaw
```

## CI/CD Flow

1. Push code to `main` branch
2. GitHub Actions builds Docker image
3. Image pushed to `ghcr.io/emortoo/pixelclaw:latest`
4. Watchtower on VPS detects new image within 5 minutes
5. Watchtower pulls and restarts the container (zero-downtime)

## OpenClaw Exec Approval

The entrypoint auto-configures:
- `tools.profile = full`
- `tools.exec.host = gateway`
- Allowlist `**` for all agents

If exec still requires approval, SSH into the container:
```bash
docker compose exec pixelclaw openclaw approvals get
docker compose exec pixelclaw openclaw approvals allowlist add --agent main "**"
```

## Costs

| Component | Cost |
|-----------|------|
| Hetzner CAX11 (2 ARM vCPUs, 4GB RAM) | $4.50/mo |
| Domain | ~$10/yr |
| Cloudflare DNS (free tier) | $0 |
| Let's Encrypt SSL | $0 |
| GitHub Actions (free for public repos) | $0 |
| GHCR (free for public repos) | $0 |
| **Total** | **~$5.30/mo** |

## Future: NullClaw Migration

When ready to support multiple users, replace OpenClaw with NullClaw:
- Swap `openclaw` in Dockerfile for NullClaw binary (~678KB)
- Memory per agent drops from ~200-500MB to ~1MB
- Same VPS supports 2,000+ concurrent agents
- PixelClaw parser already handles the JSONL format
