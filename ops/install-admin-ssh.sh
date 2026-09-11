#!/usr/bin/env bash
# ADR-0102: install the admin-scoped SSH key + sudoers allowlist on a VPS.
#
# Idempotent. Safe to re-run. Prints the public key at the end so the maintainer
# can paste it into the GitHub repo secret TORII_ADMIN_SSH_KEY (and the matching
# TORII_ADMIN_HOST secret is set to this box's SSH hostname).
#
# The privileged dispatcher is a committed, tested file (ops/torii-admin-run.sh,
# "fixed-operation edition" v2 — see the Torii Suite Code & Storage Audit). This
# installer copies those bytes verbatim (no heredoc) and pins their sha256, so
# the shipped dispatcher is always the tested dispatcher.
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

# Infra-only change (per ADR-0102): the dispatcher carries its own version and
# is tracked at `main` (no app version tag). Pin the exact committed bytes.
REPO="ChiefmonkeyArt/torii-quest"
REF="${TORII_QUEST_ADMIN_REF:-main}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${REF}"
DISPATCHER_SHA256="c5ddfbcd0bd0f656a3f0b006b7b5dabdb39d8025e70b18be9075608ced5764d1"

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

echo "==> Installing the dispatcher (ops/torii-admin-run.sh, hash-pinned)"
# Prefer a sibling copy from a checkout; otherwise fetch the committed bytes.
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]] \
   && [[ -f "$(dirname "${BASH_SOURCE[0]}")/torii-admin-run.sh" ]]; then
  DISPATCHER_SRC="$(dirname "${BASH_SOURCE[0]}")/torii-admin-run.sh"
else
  DISPATCHER_SRC="$(mktemp)"
  curl -fsSL "${RAW_BASE}/ops/torii-admin-run.sh" -o "$DISPATCHER_SRC"
fi
SUM="$(sha256sum "$DISPATCHER_SRC" | awk '{print $1}')"
if [[ "$SUM" != "$DISPATCHER_SHA256" ]]; then
  echo "dispatcher sha256 mismatch: got $SUM, want $DISPATCHER_SHA256" >&2
  exit 1
fi
install -m 0755 -o root -g root "$DISPATCHER_SRC" /usr/local/sbin/torii-admin-run

echo "==> Writing $SUDOERS (validated before commit)"
TMP=$(mktemp)
# sudoers does not accept wildcards in command ARGUMENTS. Sudoers grants
# NOPASSWD only to the /usr/local/sbin/torii-admin-run dispatcher, which now
# enforces fixed operations + resolved-path allow/deny + a frozen unit list.
cat > "$TMP" <<'SUDOERS_EOF'
# torii-admin: AI-driven infra diagnosis + repair (ADR-0102). Sudoers grants
# NOPASSWD only to the /usr/local/sbin/torii-admin-run dispatcher, which
# enforces per-verb path and unit allowlists in shell.
torii-admin ALL=(root) NOPASSWD: /usr/local/sbin/torii-admin-run
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