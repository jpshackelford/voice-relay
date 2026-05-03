# Server Inventory: chorecraft.net (74.50.50.116)

This document describes the domains and services hosted on the chorecraft server, how to manage them, and how to add new services.

## Server Overview

| Property | Value |
|----------|-------|
| **IP Address** | 74.50.50.116 |
| **Provider** | RimuHosting |
| **OS** | Ubuntu 22.04.4 LTS |
| **Disk** | 7GB (6.8GB usable) |
| **Hostname** | jpshackelford.info |

### SSH Access

```bash
# As jpshack (main working account)
ssh -i ~/.ssh/chorecraft jpshack@74.50.50.116

# As root (use password)
ssh root@74.50.50.116
```

---

## Hosted Domains

### vr.chorecraft.net (Voice Relay)

| Property | Value |
|----------|-------|
| **URL** | https://vr.chorecraft.net |
| **App Type** | Node.js (Express + WebSocket) |
| **Source** | [jpshackelford/voice-relay](https://github.com/jpshackelford/voice-relay) |
| **Port** | 3002 |
| **Service** | `voice-relay.service` |
| **Document Root** | `/var/www/vr.chorecraft.net/app/client/dist` |
| **App Directory** | `/var/www/vr.chorecraft.net/app` |

**Deployment:** Automatic via GitHub Actions on push to `main`.

```bash
# Manual operations
sudo systemctl status voice-relay
sudo systemctl restart voice-relay
journalctl -u voice-relay -f

# Manual deploy
cd /var/www/vr.chorecraft.net/app
git pull origin main
npm ci && npm run build
sudo systemctl restart voice-relay
```

### ja.chorecraft.net / ja.shackelford.org

| Property | Value |
|----------|-------|
| **URL** | https://ja.chorecraft.net |
| **App Type** | Static HTML + Node.js API |
| **Port** | 3000 (API proxy at /api) |
| **Service** | `number-game-api.service` |
| **Document Root** | `/var/www/ja.chorecraft.net/public_html` |
| **App Directory** | `/var/www/ja.chorecraft.net/app/number-game-api` |

```bash
sudo systemctl status number-game-api
sudo systemctl restart number-game-api
```

### chorecraft.net

| Property | Value |
|----------|-------|
| **URL** | https://chorecraft.net |
| **Type** | Static HTML |
| **Document Root** | `/var/www/chorecraft.net/public_html` |

---

## System Services

### Apache (Web Server)

```bash
# Status and control
sudo systemctl status apache2
sudo systemctl reload apache2    # Reload config without dropping connections
sudo systemctl restart apache2   # Full restart

# Test configuration
sudo apachectl configtest

# List enabled sites
ls -la /etc/apache2/sites-enabled/

# View virtual hosts
sudo apachectl -S
```

### MySQL

```bash
sudo systemctl status mysql
sudo mysql -u root -p
```

### Node.js

Node.js is installed per-user (not system-wide):

| User | Node Path | Version |
|------|-----------|---------|
| jpshack | `/home/jpshack/bin/node/bin/node` | v20.18.3 |
| jashack | `/home/jashack/bin/node/bin/node` | v18.18.1 |

---

## SSL Certificates

Managed by Let's Encrypt via certbot. Auto-renewal is configured.

```bash
# Check certificate status
sudo certbot certificates

# Renew all certificates (dry run)
sudo certbot renew --dry-run

# Renew all certificates
sudo certbot renew
```

---

## Adding a New Service

### 1. Create Directory Structure

```bash
sudo mkdir -p /var/www/DOMAIN/public_html
sudo mkdir -p /var/www/DOMAIN/logs
sudo mkdir -p /var/www/DOMAIN/app  # If Node.js app
sudo chown -R jpshack:jpshack /var/www/DOMAIN
```

### 2. Clone/Deploy Application

```bash
cd /var/www/DOMAIN/app
git clone git@github.com:jpshackelford/REPO.git .
export PATH=$HOME/bin/node/bin:$PATH
npm install
npm run build
```

### 3. Create Systemd Service (for Node.js apps)

Create `/etc/systemd/system/APP_NAME.service`:

```ini
[Unit]
Description=APP_NAME Node.js Application
After=syslog.target network.target

[Service]
Type=simple
User=jpshack
WorkingDirectory=/var/www/DOMAIN/app
Environment=NODE_ENV=production
Environment=PORT=300X
Environment=PATH=/home/jpshack/bin/node/bin
ExecStart=/home/jpshack/bin/node/bin/node server/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable APP_NAME
sudo systemctl start APP_NAME
```

### 4. Create Apache Virtual Host

Create `/etc/apache2/sites-available/DOMAIN.conf`:

```apache
<VirtualHost *:80>
    ServerName DOMAIN
    DocumentRoot /var/www/DOMAIN/public_html
    ServerAdmin jpshack@gmail.com

    ErrorLog /var/www/DOMAIN/logs/error.log
    CustomLog /var/www/DOMAIN/logs/access.log combined

    <Directory /var/www/DOMAIN/public_html>
        Options None
        Require all granted
    </Directory>

    # If proxying to Node.js app:
    ProxyRequests Off
    ProxyPreserveHost On
    ProxyPass /api http://127.0.0.1:300X/api
    ProxyPassReverse /api http://127.0.0.1:300X/api

    # If using WebSocket:
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws(.*) ws://127.0.0.1:300X/ws$1 [P,L]
    ProxyPass /ws ws://127.0.0.1:300X/ws
    ProxyPassReverse /ws ws://127.0.0.1:300X/ws
</VirtualHost>
```

Enable the site:

```bash
sudo a2ensite DOMAIN.conf
sudo apachectl configtest
sudo systemctl reload apache2
```

### 5. Get SSL Certificate

```bash
sudo certbot --apache -d DOMAIN --non-interactive --agree-tos -m jpshack@gmail.com
```

### 6. Set Up GitHub Actions (Optional)

Add these secrets to the GitHub repo:
- `DEPLOY_HOST`: `74.50.50.116`
- `DEPLOY_USER`: `jpshack`
- `DEPLOY_SSH_KEY`: (SSH private key - generate new or reuse)

Add sudoers rule for passwordless service restart:

```bash
echo "jpshack ALL=(ALL) NOPASSWD: /bin/systemctl restart APP_NAME" | sudo tee /etc/sudoers.d/APP_NAME
sudo chmod 440 /etc/sudoers.d/APP_NAME
```

Create `.github/workflows/deploy.yml` in the repo (see voice-relay for example).

---

## Port Allocation

| Port | Service |
|------|---------|
| 80 | Apache (HTTP) |
| 443 | Apache (HTTPS) |
| 3000 | number-game-api |
| 3002 | voice-relay |
| 3306 | MySQL |

**Next available port:** 3003

---

## Maintenance

### Disk Space

```bash
# Check usage
df -h

# Find large directories
sudo du -sh /var/* | sort -rh | head -10

# Clean apt cache (if needed)
sudo apt-get clean

# Remove old snap versions
snap list --all | grep disabled
sudo snap remove PACKAGE --revision=REV
```

### Log Rotation

Logs are managed by logrotate. Check `/etc/logrotate.d/` for configs.

```bash
# Force rotation
sudo logrotate -f /etc/logrotate.conf

# Check journal size
sudo journalctl --disk-usage
```

### Updates

```bash
sudo apt-get update
sudo apt-get upgrade
```

---

## Troubleshooting

### Service won't start

```bash
# Check logs
journalctl -u SERVICE_NAME -n 50

# Check if port is in use
sudo netstat -tulpn | grep PORT
```

### Apache errors

```bash
# Check syntax
sudo apachectl configtest

# Check error logs
tail -f /var/log/apache2/error.log
tail -f /var/www/DOMAIN/logs/error.log
```

### SSL certificate issues

```bash
# Check expiration
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal
```
