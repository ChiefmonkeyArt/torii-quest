#!/usr/bin/env bash
# ADR-0102: install the admin-scoped SSH key + sudoers allowlist on a VPS.
#
# Idempotent. Safe to re-run. Prints the public key at the end so the maintainer
# can paste it into the GitHub repo secret TORII_ADMIN_SSH_KEY (and the matching
# TORII_ADMIN_HOST secret is set to this box's SSH hostname).
#
# Usage on the VPS:  curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/torii-quest/main/ops/install-admin-ssh.sh | sudo bash
# Or from a checkout: sudo bash ops/install-admin-ssh.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root (use sudo)." >&2
  exit 1
fi

USER=torii-admin
HOME_DIR=/home/$USER
SUDOERS=/etc/sudoers.d/torii-admin

echo "==> Ensuring user $USER exists"
if ! id -u "$USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$USER"
fi

echo "==> Preparing ~/.ssh"
install -d -m 700 -o "$USER" -g "$USER" "$HOME_DIR/.ssh"

echo "==> Generating admin key if missing"
KEY=$HOME_DIR/.ssh/id_ed25519
if [ ! -f "$KEY" ]; then
  sudo -u "$USER" ssh-keygen -t ed25519 -f "$KEY" -N "" -C "torii-admin@github-actions"
fi

echo "==> Installing authorized_keys (no forced-command; sudoers gates access)"
AUTH=$HOME_DIR/.ssh/authorized_keys
install -m 600 -o "$USER" -g "$USER" /dev/null "$AUTH"
cat "$KEY.pub" > "$AUTH"
chown "$USER:$USER" "$AUTH"
chmod 600 "$AUTH"

echo "==> Writing $SUDOERS (validated before commit)"
TMP=$(mktemp)
cat > "$TMP" <<'SUDOERS_EOF'
# torii-admin: AI-driven infra diagnosis + repair. See ADR-0102.
# Read-only diagnostics: unlimited.
torii-admin ALL=(root) NOPASSWD: /usr/bin/cat, /usr/bin/less, /usr/bin/head, /usr/bin/tail, /usr/bin/grep, /usr/bin/find, /usr/bin/ls, /usr/bin/stat, /usr/bin/readlink, /usr/bin/file, /usr/bin/du, /usr/bin/df
torii-admin ALL=(root) NOPASSWD: /bin/systemctl status *, /bin/systemctl show *
torii-admin ALL=(root) NOPASSWD: /bin/journalctl *
torii-admin ALL=(root) NOPASSWD: /usr/sbin/nginx -T, /usr/sbin/nginx -t

# Targeted writes: project-owned paths only.
torii-admin ALL=(root) NOPASSWD: /usr/bin/tee /etc/nginx/sites-available/*, /usr/bin/tee /etc/nginx/conf.d/*, /usr/bin/tee /etc/systemd/system/torii-*.service, /usr/bin/tee /etc/systemd/system/torii-*.timer, /usr/bin/tee /var/www/torii.quest/*, /usr/bin/tee /opt/torii-quest/*
torii-admin ALL=(root) NOPASSWD: /bin/ln -sf /var/www/torii.quest/releases/*, /bin/mv /var/www/torii.quest/*, /bin/mkdir -p /var/www/torii.quest/*, /bin/mkdir -p /opt/torii-quest/*, /bin/rm /etc/nginx/sites-enabled/*, /bin/ln -s /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*

# Service control: allowlisted units only.
torii-admin ALL=(root) NOPASSWD: /bin/systemctl start torii-*, /bin/systemctl stop torii-*, /bin/systemctl restart torii-*, /bin/systemctl reload nginx, /bin/systemctl restart nginx, /bin/systemctl daemon-reload
torii-admin ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload

# Explicit deny list (defense in depth).
torii-admin ALL=(root) NOPASSWD: !/bin/rm -rf /*, !/bin/dd, !/sbin/mkfs*, !/sbin/shutdown, !/sbin/reboot, !/sbin/halt, !/usr/sbin/useradd, !/usr/sbin/userdel, !/usr/sbin/usermod, !/usr/bin/passwd, !/usr/bin/chage, !/usr/bin/apt*, !/usr/bin/dpkg*, !/usr/bin/tee /root/*, !/usr/bin/tee /etc/passwd, !/usr/bin/tee /etc/shadow, !/usr/bin/tee /etc/sudoers*, !/usr/bin/tee /home/*/.ssh/*
SUDOERS_EOF

if ! visudo -c -f "$TMP" >/dev/null; then
  echo "sudoers validation FAILED. Not installing." >&2
  cat "$TMP" >&2
  rm -f "$TMP"
  exit 2
fi
install -o root -g root -m 0440 "$TMP" "$SUDOERS"
rm -f "$TMP"

echo
echo "======================================================================"
echo " torii-admin installed."
echo
echo " NEXT STEPS (do these on your laptop, not on the VPS):"
echo "   1. Copy the PRIVATE key below into repo secret TORII_ADMIN_SSH_KEY."
echo "   2. Set repo secret TORII_ADMIN_HOST to this box's SSH hostname."
echo "   3. Then DELETE the private key from this VPS:"
echo "        sudo rm $KEY"
echo
echo " Private key (paste as TORII_ADMIN_SSH_KEY):"
echo "----------------------------------------------------------------------"
cat "$KEY"
echo "----------------------------------------------------------------------"
echo
echo " Public key fingerprint (for reference):"
ssh-keygen -lf "$KEY.pub"
echo "======================================================================"
