#!/usr/bin/env bash
# Corre en la instancia EC2 (Ubuntu 24.04), desde ~/urbansafe con el código y el .env ya copiados.
# Uso: bash deploy/setup.sh "2026-11-21 04:59:00"   (fecha de apagado en UTC)
set -euo pipefail
SHUTDOWN_AT_UTC="$1"
APP_DIR="$HOME/urbansafe"

# Node 22 + pnpm (la versión exacta la fija packageManager en package.json).
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable
cd "$APP_DIR"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
pnpm --filter @urbansafe/web build

# API como servicio: arranca con la máquina y se reinicia si se cae.
sudo tee /etc/systemd/system/urbansafe.service >/dev/null <<UNIT
[Unit]
Description=UrbanSafe API + web
After=network-online.target
Wants=network-online.target
[Service]
User=$USER
WorkingDirectory=$APP_DIR
Environment=WEB_DIR=apps/web/dist
Environment=COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ExecStart=/usr/bin/pnpm --filter @urbansafe/api start
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now urbansafe
sudo systemctl restart urbansafe

# Caddy: HTTPS automático (Let's Encrypt) en <ip-con-guiones>.sslip.io; WebSocket pasa sin configurar.
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update && sudo apt-get install -y caddy
fi
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)
HOST="${PUBLIC_IP//./-}.sslip.io"
echo "$HOST {
  reverse_proxy localhost:3000
}" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl restart caddy

# Apagado programado. La instancia se lanza con shutdown-behavior=terminate: apagarla la borra.
sudo tee /etc/systemd/system/urbansafe-shutdown.service >/dev/null <<UNIT
[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -h now
UNIT
sudo tee /etc/systemd/system/urbansafe-shutdown.timer >/dev/null <<UNIT
[Timer]
OnCalendar=$SHUTDOWN_AT_UTC UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now urbansafe-shutdown.timer

echo "Listo: https://$HOST"
systemctl list-timers urbansafe-shutdown.timer --no-pager
