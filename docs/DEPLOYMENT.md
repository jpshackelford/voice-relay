# Deployment Guide

> **Note:** This document describes the legacy deployment on `chorecraft.net`. 
> The production app is now served at **`app.no-hands.dev`** with different infrastructure.
> Server-specific paths (systemd configs, Apache settings) below are historical reference only.

This documents the legacy production deployment of Voice Relay on `chorecraft.net`.

## Server Overview

| Component | Details |
|-----------|---------|
| Host | `chorecraft.net` (74.50.50.116) |
| OS | Ubuntu 22.04 |
| User | `jpshack` |
| Domain | `vr.chorecraft.net` (legacy) |
| SSL | Let's Encrypt (via Certbot) |

## Directory Structure

```
/var/www/vr.chorecraft.net/
└── app/                          # Git repository root
    ├── .env                      # Environment secrets (not in git)
    ├── client/dist/              # Built frontend
    ├── server/dist/              # Built backend
    ├── data/
    │   └── messages.db           # SQLite database
    └── node_modules/
```

## SSH Access

```bash
ssh -i ~/.ssh/chorecraft jpshack@chorecraft.net
```

## Node.js

Node.js is installed in the user's home directory:

```
/home/jpshack/bin/node/bin/node   # v20.18.3
/home/jpshack/bin/node/bin/npm
```

## Systemd Service

**File:** `/etc/systemd/system/voice-relay.service`

```ini
[Unit]
Description=voice-relay Node.js Application
After=syslog.target network.target

[Service]
Type=simple
User=jpshack
WorkingDirectory=/var/www/vr.chorecraft.net/app
Environment=NODE_ENV=production
Environment=PORT=3002
Environment=STORE_DRIVER=sqlite
Environment=SQLITE_PATH=/var/www/vr.chorecraft.net/app/data/messages.db
EnvironmentFile=/var/www/vr.chorecraft.net/app/.env
Environment=PATH=/home/jpshack/bin/node/bin
ExecStart=/home/jpshack/bin/node/bin/node server/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Service Commands

```bash
# View status and recent logs
sudo systemctl status voice-relay

# Restart after code changes
sudo systemctl restart voice-relay

# View full logs
journalctl -u voice-relay -f        # Follow live
journalctl -u voice-relay -n 100    # Last 100 lines

# Reload systemd after editing service file
sudo systemctl daemon-reload
```

## Apache Reverse Proxy

Apache proxies HTTPS traffic to the Node.js backend on port 3002.

**Config files:**
- `/etc/apache2/sites-available/vr.chorecraft.net.conf` (HTTP → HTTPS redirect)
- `/etc/apache2/sites-available/vr.chorecraft.net-le-ssl.conf` (HTTPS config)

### SSL Config (`vr.chorecraft.net-le-ssl.conf`)

```apache
<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName vr.chorecraft.net
    ServerAdmin jpshack@gmail.com

    ErrorLog /var/www/vr.chorecraft.net/logs/error.log
    CustomLog /var/www/vr.chorecraft.net/logs/access.log combined

    # Proxy settings
    ProxyRequests Off
    ProxyPreserveHost On

    # Proxy WebSocket (must come first)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws(.*) ws://127.0.0.1:3002/ws$1 [P,L]

    ProxyPass /ws ws://127.0.0.1:3002/ws
    ProxyPassReverse /ws ws://127.0.0.1:3002/ws

    # Proxy everything to Node.js - it handles static files and SPA routing
    ProxyPass / http://127.0.0.1:3002/
    ProxyPassReverse / http://127.0.0.1:3002/

SSLCertificateFile /etc/letsencrypt/live/vr.chorecraft.net/fullchain.pem
SSLCertificateKeyFile /etc/letsencrypt/live/vr.chorecraft.net/privkey.pem
Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
</IfModule>
```

**Important:** Do NOT use `DocumentRoot` or serve static files from Apache. Node.js handles:
- Static file serving (`client/dist/`)
- SPA fallback routing (`/login`, `/dashboard`, etc. → `index.html`)
- API routes (`/api/*`)
- Auth routes (`/auth/*`)
- WebSocket upgrades (`/ws`)

### Apache Commands

```bash
# Test config
sudo apache2ctl configtest

# Reload after config changes
sudo systemctl reload apache2

# Check enabled modules (proxy, proxy_http, proxy_wstunnel, rewrite required)
apache2ctl -M | grep -E "proxy|rewrite"
```

## Environment Variables

Secrets are stored in `/var/www/vr.chorecraft.net/app/.env` (chmod 600).

See `.env.example` for required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `BASE_URL` | `https://app.no-hands.dev` (for OAuth callbacks) |
| `OPENHANDS_CLOUD_API_KEY` | OpenHands AI integration |

## Deployment

### Automated (GitHub Actions)

Push to `main` triggers automatic deployment via `.github/workflows/deploy.yml`.

Manual actions available at: **Actions → Server Operations → Run workflow**
- `deploy` - Pull latest, build, restart
- `restart` - Just restart the service
- `status` - Show service status
- `logs` - Show recent logs
- `nuke-db` - Reset database (caution!)

### Manual Deployment

```bash
ssh -i ~/.ssh/chorecraft jpshack@chorecraft.net
cd /var/www/vr.chorecraft.net/app

# Pull latest code
git pull origin main

# Install dependencies and build
export PATH=$HOME/bin/node/bin:$PATH
npm ci
npm run build

# Restart service
sudo systemctl restart voice-relay

# Verify
sudo systemctl status voice-relay
curl -I https://app.no-hands.dev/health
```

## GitHub OAuth Setup

1. Go to https://github.com/settings/developers
2. Click **OAuth Apps** → **New OAuth App**
3. Fill in:
   - **Application name:** Voice Relay
   - **Homepage URL:** `https://app.no-hands.dev`
   - **Authorization callback URL:** `https://app.no-hands.dev/auth/github/callback`
4. Copy Client ID and generate Client Secret
5. Add to `/var/www/vr.chorecraft.net/app/.env`:
   ```
   GITHUB_CLIENT_ID=Iv23li...
   GITHUB_CLIENT_SECRET=...
   ```
6. Restart: `sudo systemctl restart voice-relay`

## Push Notifications (ntfy.sh)

The deployment workflow sends push notifications via [ntfy.sh](https://ntfy.sh) when failures occur.

### Notification Types

| Scenario | Priority | Description |
|----------|----------|-------------|
| Deployment failure | High | Smoke tests failed after deploy; rollback initiated |
| Rollback failure | Urgent | Rollback failed; manual intervention required |

### Subscribing to Alerts

1. Install the ntfy app:
   - [iOS App Store](https://apps.apple.com/app/ntfy/id1625396347)
   - [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
   - [Web UI](https://ntfy.sh) (for desktop notifications)

2. Subscribe to the topic:
   - Open the app or web UI
   - Tap/click **Subscribe to topic**
   - Enter the topic name (same value as the `NTFY_TOPIC` secret)

3. Configure notification settings:
   - Enable notifications in your device settings
   - For critical alerts, consider enabling "persistent" or "priority" notification mode

### Secret Setup

To enable ntfy notifications, add the `NTFY_TOPIC` secret to the repository:

1. Go to **Repository Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `NTFY_TOPIC`
4. Value: A unique, hard-to-guess topic name (e.g., `voice-relay-prod-alerts-a7b3c9`)

> **Note:** The topic name acts as a password. Anyone who knows the topic can subscribe to (or send) messages. Use a unique, random string.

### Testing Notifications

To verify ntfy is working:

```bash
# Send a test message (replace with your topic)
curl -d "Test notification from voice-relay" ntfy.sh/YOUR_TOPIC_NAME
```

## Troubleshooting

### Auth returns 404

Check that auth routes are loading:
```bash
journalctl -u voice-relay -n 20 | grep Auth
# Should see: [Auth] GitHub OAuth enabled
```

If you see "auth disabled", check `.env` has all required variables.

### WebSocket not connecting

Check Apache WebSocket proxy modules:
```bash
sudo a2enmod proxy_wstunnel
sudo systemctl reload apache2
```

### Permission denied on .env

```bash
chmod 600 /var/www/vr.chorecraft.net/app/.env
chown jpshack:jpshack /var/www/vr.chorecraft.net/app/.env
```

### Database locked

```bash
# Stop service, check for stale locks
sudo systemctl stop voice-relay
ls -la /var/www/vr.chorecraft.net/app/data/
sudo systemctl start voice-relay
```
