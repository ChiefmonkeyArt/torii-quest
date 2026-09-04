#!/usr/bin/env bash
# ADR-0101 (path-corrected): install the deploy-only SSH key + forced-command
# hook + sudoers on a VPS. Run as root:  sudo bash ops/install-deploy-ssh.sh
#
# The hook writes an empty update request into the torii-suite runner's REAL
# trigger directory — /apps/quest/mp/update-requests (APPS_ROOT=/apps) — NOT the
# stale /opt/torii-quest path. A path mismatch here is silent: the runner simply
# reports "no pending request" and no deploy happens (observed 2026-09-05).
#
# SECURITY MODEL (unchanged from ADR-0101): the key's authorized_keys entry uses
# a forced-command, and sudoers narrows the deploy user to exactly three verbs
# (mkdir on the request dir, tee, systemctl start torii-quest-update.service).
# No shell, no other paths, no other services.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must run as root (use sudo)." >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"                 # matches deploy-manual.yml (ubuntu@)
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
REQ_DIR="/apps/quest/mp/update-requests"
HOOK="/usr/local/bin/torii-deploy-hook"
SUDOERS="/etc/sudoers.d/torii-deploy"

echo "==> Deploy user: $DEPLOY_USER (home $DEPLOY_HOME)"
echo "==> Request dir: $REQ_DIR"

# 1. Keypair (idempotent).
KEY="$DEPLOY_HOME/.ssh/torii-deploy"
if [[ ! -f "$KEY" ]]; then
  echo "==> Generating ed25519 deploy key"
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -f "$KEY" -C "torii-quest-deploy@github-actions" -N ""
fi
chmod 600 "$KEY"

# 2. authorized_keys forced-command entry (idempotent: re-key the hook line).
AUTH_KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
mkdir -p "$(dirname "$AUTH_KEYS")"
PUB="$(cat "$KEY.pub")"
# Drop any prior torii-deploy-hook line, then append the current one.
if [[ -f "$AUTH_KEYS" ]]; then
  grep -v 'torii-deploy-hook' "$AUTH_KEYS" > "$AUTH_KEYS.tmp" || true
  mv "$AUTH_KEYS.tmp" "$AUTH_KEYS"
fi
printf 'command="%s",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty %s\n' \
  "$HOOK" "$PUB" >> "$AUTH_KEYS"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

# 3. The hook — 6 lines, root-owned, correct request path.
install -m 0755 -o root -g root /dev/null "$HOOK"
cat > "$HOOK" <<HOOK_EOF
#!/usr/bin/env bash
set -euo pipefail
sudo mkdir -p "$REQ_DIR"
ts=\$(date +%s)
echo '{}' | sudo tee "$REQ_DIR/manual-\${ts}.json" > /dev/null
sudo systemctl start torii-quest-update.service
sudo journalctl -u torii-quest-update.service --since "10 seconds ago" -n 200 --no-pager
HOOK_EOF

# 4. sudoers — narrow to exactly the verbs the hook needs, scoped to REQ_DIR.
TMP="$(mktemp)"
cat > "$TMP" <<SUDO_EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/mkdir -p $REQ_DIR, /usr/bin/tee $REQ_DIR/*, /usr/bin/systemctl start torii-quest-update.service, /usr/bin/journalctl -u torii-quest-update.service
SUDO_EOF
if ! visudo -c -f "$TMP" >/dev/null 2>&1; then
  echo "sudoers validation FAILED. Not installing." >&2
  rm -f "$TMP"
  exit 1
fi
chmod 0440 "$TMP"
chown root:root "$TMP"
mv "$TMP" "$SUDOERS"

echo ""
echo "Done. Next steps:"
echo "  1. cat $KEY" 
echo "     → copy the PRIVATE key into the TORII_DEPLOY_SSH_KEY repo secret, then delete it from the VPS."
echo "  2. TORII_DEPLOY_HOST = chiefmonkey.art"
echo "  3. Test:  gh workflow run deploy-manual.yml -f tag=<tag>"