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
# sudoers does not accept wildcards in command ARGUMENTS. The clean fix is a
# small setuid-style dispatcher: /usr/local/sbin/torii-admin-run gates the
# actual verbs (path-prefix checks, unit-name checks, deny-list) in shell,
# and sudoers just grants NOPASSWD access to that one dispatcher script.
install -m 0755 -o root -g root /dev/null /usr/local/sbin/torii-admin-run
cat > /usr/local/sbin/torii-admin-run <<'DISPATCH_EOF'
#!/usr/bin/env bash
# ADR-0102 privileged dispatcher. Runs allowlisted verbs on allowlisted paths.
# Argv:  <verb> [args...]
set -euo pipefail

verb=${1:-}
shift || true

die() { echo "torii-admin-run: $*" >&2; exit 2; }

# ---- path predicates -------------------------------------------------------
is_project_path() {
  case $1 in
    /etc/nginx/sites-available/*|/etc/nginx/conf.d/*) return 0 ;;
    /etc/nginx/sites-enabled/*)                       return 0 ;;
    /etc/systemd/system/torii-*.service)              return 0 ;;
    /etc/systemd/system/torii-*.timer)                return 0 ;;
    /var/www/torii.quest/*)                           return 0 ;;
    /opt/torii-quest/*)                               return 0 ;;
  esac
  return 1
}
is_denied_path() {
  case $1 in
    /root|/root/*|/etc/passwd|/etc/shadow|/etc/sudoers|/etc/sudoers.d|/etc/sudoers.d/*) return 0 ;;
    /home/*/.ssh|/home/*/.ssh/*) return 0 ;;
    /etc/ssh|/etc/ssh/*) return 0 ;;
  esac
  return 1
}
is_torii_unit() {
  case $1 in torii-*|nginx) return 0 ;; esac
  return 1
}

case "$verb" in
  # read verbs — pass through, any path, no writes
  cat|less|head|tail|grep|find|ls|stat|readlink|file|du|df)
    exec /usr/bin/env "$verb" "$@"
    ;;
  # systemd status/show/journal — read-only
  systemctl-status)  exec /bin/systemctl status  "$@" ;;
  systemctl-show)    exec /bin/systemctl show    "$@" ;;
  journalctl)        exec /bin/journalctl        "$@" ;;
  # nginx read + reload
  nginx-T)   exec /usr/sbin/nginx -T ;;
  nginx-t)   exec /usr/sbin/nginx -t ;;
  nginx-reload) exec /usr/sbin/nginx -s reload ;;
  # systemd write — allowlisted units only
  systemctl-start|systemctl-stop|systemctl-restart|systemctl-reload)
    unit=${1:-}
    is_torii_unit "$unit" || die "unit not in allowlist: $unit"
    action=${verb#systemctl-}
    exec /bin/systemctl "$action" "$unit"
    ;;
  systemctl-daemon-reload)
    exec /bin/systemctl daemon-reload
    ;;
  # write file (stdin -> path). project paths only, deny sensitive paths.
  write-file)
    path=${1:-}; [ -n "$path" ] || die "write-file needs a path"
    is_denied_path "$path" && die "denied path: $path"
    is_project_path "$path" || die "path not in allowlist: $path"
    exec /usr/bin/tee "$path" >/dev/null
    ;;
  # mkdir, mv, ln, rm — project paths only
  mkdir-p)
    path=${1:-}; is_denied_path "$path" && die "denied path: $path"
    is_project_path "$path" || die "path not in allowlist: $path"
    exec /bin/mkdir -p "$path"
    ;;
  mv)
    src=${1:-}; dst=${2:-}
    is_denied_path "$src" && die "denied path: $src"
    is_denied_path "$dst" && die "denied path: $dst"
    is_project_path "$src" || die "src not in allowlist: $src"
    is_project_path "$dst" || die "dst not in allowlist: $dst"
    exec /bin/mv "$src" "$dst"
    ;;
  ln-sf)
    src=${1:-}; dst=${2:-}
    is_denied_path "$dst" && die "denied path: $dst"
    is_project_path "$dst" || die "dst not in allowlist: $dst"
    exec /bin/ln -sf "$src" "$dst"
    ;;
  rm-file)
    path=${1:-}
    is_denied_path "$path" && die "denied path: $path"
    case $path in
      /etc/nginx/sites-enabled/*) exec /bin/rm "$path" ;;
      *) die "rm scope is /etc/nginx/sites-enabled only, got: $path" ;;
    esac
    ;;
  *)
    die "unknown verb: $verb"
    ;;
esac
DISPATCH_EOF
chmod 0755 /usr/local/sbin/torii-admin-run
chown root:root /usr/local/sbin/torii-admin-run

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
