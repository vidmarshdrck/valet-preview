#!/bin/sh
# Install Valet as a systemd service on the machine where this repo lives.
# Run as root from anywhere:
#   VALET_OWNER_PASSWORD='…' ./deploy/install.sh
# Optional:
#   VALET_DOMAIN='dns name that points at this host'   (writes a Caddy site if caddy exists)
#   VALET_INSTALL_DIR=/opt/valet
#   VALET_DATA_DIR=/var/lib/valet
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

password=${VALET_OWNER_PASSWORD:-}
if [ "${#password}" -lt 10 ]; then
  echo "Set VALET_OWNER_PASSWORD to 10 or more characters." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
default_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
install_dir=${VALET_INSTALL_DIR:-$default_root}
data_dir=${VALET_DATA_DIR:-/var/lib/valet}

node_bin=$(command -v node || true)
if [ -z "$node_bin" ]; then
  echo "Node.js 22 or newer is required and was not found." >&2
  exit 1
fi
major=$("$node_bin" -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 22 ]; then
  echo "Node.js 22 or newer is required. This machine has $("$node_bin" -v)." >&2
  exit 1
fi

if ! id valet >/dev/null 2>&1; then
  useradd --system --home "$install_dir" --shell /usr/sbin/nologin valet
fi

cd "$install_dir"
npm ci --omit=dev
mkdir -p "$data_dir"
chown -R valet:valet "$data_dir"
chmod -R a+rX "$install_dir"

umask 077
cat > /etc/valet.env << EOF
VALET_OWNER_PASSWORD=$password
VALET_DATA_DIR=$data_dir
VALET_HOST=127.0.0.1
VALET_PORT=8787
EOF
chmod 600 /etc/valet.env

sed \
  -e "s#WorkingDirectory=.*#WorkingDirectory=$install_dir#" \
  -e "s#ExecStart=.*#ExecStart=$node_bin server/index.js#" \
  -e "s#ReadWritePaths=.*#ReadWritePaths=$data_dir#" \
  "$script_dir/valet.service" > /etc/systemd/system/valet.service

systemctl daemon-reload
systemctl enable valet
systemctl restart valet

if [ -n "${VALET_DOMAIN:-}" ] && command -v caddy >/dev/null 2>&1; then
  mkdir -p /etc/caddy
  cat > /etc/caddy/valet.caddy << EOF
${VALET_DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
EOF
  if ! grep -q 'valet.caddy' /etc/caddy/Caddyfile 2>/dev/null; then
    printf '\nimport /etc/caddy/valet.caddy\n' >> /etc/caddy/Caddyfile
  fi
  systemctl reload caddy || systemctl restart caddy
  echo "Caddy site written for ${VALET_DOMAIN}."
else
  echo "Valet is on 127.0.0.1:8787. HTTPS is not configured by this run."
  echo "Use deploy/Caddyfile or deploy/nginx-valet.conf at the site root, then open the proxied origin."
fi

curl -fsS http://127.0.0.1:8787/health
echo
echo "valet is running. Health is above. No public URL was chosen by this script."
