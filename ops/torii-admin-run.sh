#!/usr/bin/env bash
# ADR-0102 privileged dispatcher — fixed-operation edition (v2).
#
# Replaces the argv-passthrough dispatcher where "read" verbs were raw command
# names (`find -exec`, `less` shell escape) and `write-file` + `daemon-reload`
# + `start` could run an attacker-supplied unit body as root.
#
# Security contract (see ADR-0102 and the Torii Suite Code & Storage Audit):
#   1. Every verb is a fixed, named subcommand. No user-controlled argument is
#      ever spliced into a command's action flags.
#   2. Paths are realpath-canonicalized; allow/deny is boundary-aware on the
#      RESOLVED path (prefix + next char is '/' or end-of-string), so a
#      symlink to a denied target is caught. The final write component is
#      rejected if it is itself a symlink (no-follow).
#   3. The unit set is a FIXED, versioned enumeration (below), not a `torii-*`
#      namespace glob.
#   4. `config-write systemd-unit <name>` validates the body before any reload:
#      rejects `User=root`/`User=0`, rejects `Exec*=` binaries outside an
#      explicit allowlist, and runs `systemd-analyze verify`.
#
# Sudoers grants NOPASSWD to ONLY this script; everything else a
# `torii-admin` session can do is unprivileged.
#
# Invocation:  torii-admin-run <op> [args...]
#               (for config-write/systemd-unit the body is read on stdin)
#
# This file is the tested, shipped bytes. install-admin-ssh.sh copies it
# verbatim (no heredoc) and pins its sha256.

set -euo pipefail

DISPATCHER_VERSION=2

die() { echo "torii-admin-run: $*" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Versioned enumeration of the units this role may operate on.
# Freeze date 2026-09-11 against the live chiefmonkey.art inventory; adding a
# unit here is an explicit, reviewed change. (This replaced the `torii-*`
# namespace, which let any future torii-* unit be controlled implicitly.)
# ---------------------------------------------------------------------------
KNOWN_UNITS='
nginx.service
torii-arena-ws.service
torii-base-sidecar.service
torii-nap-bridge.service
torii-quest-update.path
torii-quest-update.service
torii-relay.service
'

# Read-only roots the reader/search verbs may traverse. Broad enough for
# diagnosis; sensitive trees are denied below on the resolved path.
READ_ROOTS='
/etc/nginx
/etc/systemd/system
/var/www/torii.quest
/var/log
/apps
/opt
'

# Sensitive trees denied on the RESOLVED path (catches symlink escapes).
is_subpath() { [[ "$2" == "$1" || "$2" == "$1"/* ]]; }

denied_path() {
  local p="$1"
  is_subpath /root        "$p" && return 0
  is_subpath /etc/shadow  "$p" && return 0
  is_subpath /etc/sudoers "$p" && return 0
  is_subpath /etc/sudoers.d "$p" && return 0
  is_subpath /etc/ssh     "$p" && return 0
  # /home/<user>/.ssh and anything below it, without glob-matching a prefix.
  [[ "$p" == /home/*/.ssh || "$p" == /home/*/.ssh/* ]] && return 0
  return 1
}

in_roots() { # in_roots <resolved-path> <newline-list>
  local p="$1" root
  while IFS= read -r root; do
    [[ -z "$root" ]] && continue
    is_subpath "$root" "$p" && return 0
  done <<< "$2"
  return 1
}

known_unit() {
  local u
  while IFS= read -r u; do [[ -z "$u" ]] && continue; [[ "$u" == "$1" ]] && return 0; done <<< "$KNOWN_UNITS"
  return 1
}

plain_name() { # reject path separators / leading dash / non-filename chars
  [[ "$1" != */* && "$1" != -* ]] && return 0
  return 1
}

# Exec* binaries permitted inside a systemd-unit body (frozen to the binaries
# actually used by the enumerated units on chiefmonkey.art, 2026-09-11).
EXEC_ALLOWLIST='
/usr/bin/node
/usr/local/sbin/torii-quest-update-runner
/opt/torii/relay/strfry
/usr/sbin/nginx
'

exec_allowed() {
  local bin b
  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    [[ "$1" == "$b" ]] && return 0
  done <<< "$EXEC_ALLOWLIST"
  return 1
}

validate_unit_body() {
  local body="$1" tmp line rest bin
  tmp="$(mktemp "${TMPDIR:-/tmp}/torii-admin-unit.XXXXXX.service")" || die "cannot make temp unit file"
  trap 'rm -f "$tmp"' RETURN
  printf '%s\n' "$body" > "$tmp"

  # Reject an explicit root/uid-0 run identity.
  if grep -Eq '^[[:space:]]*User=[[:space:]]*(root|0)([[:space:]]|#|$)' "$tmp"; then
    echo "torii-admin-run: unit body sets User=root (rejected)" >&2
    return 1
  fi
  # Every Exec* line's binary must be in the fixed allowlist.
  while IFS= read -r line; do
    [[ "$line" == Exec* ]] || continue
    rest="${line#Exec*=}"
    # strip the leading -@+!:~ prefixes systemd allows before the binary
    while [[ "$rest" == [-@+:~!]* ]]; do rest="${rest:1}"; done
    bin="${rest%% *}"
    if ! exec_allowed "$bin"; then
      echo "torii-admin-run: unit Exec* binary not in allowlist: $bin" >&2
      return 1
    fi
  done < <(grep -E '^Exec' "$tmp")

  # Final structural check via systemd's own verifier.
  if ! systemd-analyze verify "$tmp" >/dev/null 2>&1; then
    echo "torii-admin-run: systemd-analyze verify failed on unit body" >&2
    return 1
  fi
  return 0
}

# resolve a path to its canonical form; return 0, echoing the resolved path
canon() { readlink -f -- "$1"; }

# ---------------------------------------------------------------------------
op="${1:-}"; shift || true

help_text() {
  cat <<'EOF'
torii-admin-run <op> [args...]

Read ops (reason-limited):
  reader <path>                cat ONE canonicalized, allowed, non-denied path
  search <dir> <name-pattern>  find <dir> -name <pattern> (fixed action; no -exec)
  journal <unit>               journalctl -u <unit> --no-pager -n 500
  unit-status <unit>           systemctl status (fixed unit enumeration)
  unit-show <unit>             systemctl show   (fixed unit enumeration)

Unit ops (fixed enumeration only):
  unit-start|unit-stop|unit-restart|unit-reload <unit>
  daemon-reload

nginx ops:
  nginx-test                   nginx -t
  nginx-reload                 nginx -s reload

Config write/remove:
  config-write nginx-site <name>       stdin -> /etc/nginx/sites-available/<name>
  config-write nginx-conf <name>       stdin -> /etc/nginx/conf.d/<name>
  config-write systemd-unit <name>     stdin -> /etc/systemd/system/<name>
                                       (name must be in the fixed enumeration;
                                        body validated: User=root and non-allowlisted
                                        Exec* rejected + systemd-analyze verify)
  config-remove <name>                 remove /etc/nginx/sites-enabled/<name>

Sensitive trees (/root, /etc/shadow, /etc/sudoers*, /etc/ssh, /home/*/.ssh)
are denied on the RESOLVED path for every verb.
EOF
}

case "$op" in
  --help|-h|help) help_text; exit 0 ;;
  --version) echo "torii-admin-run v$DISPATCHER_VERSION"; exit 0 ;;

  reader)
    [[ $# -ge 1 ]] || die "reader needs a path"
    p="$(canon "$1")"
    denied_path "$p" && die "denied path: $1"
    in_roots "$p" "$READ_ROOTS" || die "path not in read roots: $1"
    exec /bin/cat -- "$p"
    ;;
  search)
    [[ $# -ge 2 ]] || die "search needs <dir> <name-pattern>"
    d="$(canon "$1")"; pat="$2"
    [[ "$pat" != -* ]] || die "pattern may not start with '-'"
    denied_path "$d" && die "denied dir: $1"
    in_roots "$d" "$READ_ROOTS" || die "dir not in read roots: $1"
    exec /usr/bin/find -- "$d" -name "$pat"
    ;;
  journal)
    [[ $# -eq 1 ]] || die "journal needs exactly one unit name"
    known_unit "$1" || die "unit not in fixed enumeration: $1"
    exec /bin/journalctl -u "$1" --no-pager -n 500
    ;;
  unit-status)
    [[ $# -eq 1 ]] || die "unit-status needs exactly one unit name"
    known_unit "$1" || die "unit not in fixed enumeration: $1"
    exec /bin/systemctl status --no-pager -- "$1"
    ;;
  unit-show)
    [[ $# -eq 1 ]] || die "unit-show needs exactly one unit name"
    known_unit "$1" || die "unit not in fixed enumeration: $1"
    exec /bin/systemctl show -- "$1"
    ;;
  unit-start|unit-stop|unit-restart|unit-reload)
    [[ $# -eq 1 ]] || die "$op needs exactly one unit name"
    known_unit "$1" || die "unit not in fixed enumeration: $1"
    exec /bin/systemctl "${op#unit-}" "$1"
    ;;
  daemon-reload)
    [[ $# -eq 0 ]] || die "daemon-reload takes no arguments"
    exec /bin/systemctl daemon-reload
    ;;
  nginx-test)   [[ $# -eq 0 ]] || die "nginx-test takes no arguments"; exec /usr/sbin/nginx -t ;;
  nginx-reload) [[ $# -eq 0 ]] || die "nginx-reload takes no arguments"; exec /usr/sbin/nginx -s reload ;;

  config-write)
    [[ $# -eq 2 ]] || die "config-write needs <kind> <name>"
    kind="$1"; name="$2"
    plain_name "$name" || die "invalid name: $name (must be a plain filename)"
    case "$kind" in
      nginx-site)   dir="$(canon /etc/nginx/sites-available)"; token="nginx-site" ;;
      nginx-conf)   dir="$(canon /etc/nginx/conf.d)";        token="nginx-conf" ;;
      systemd-unit) known_unit "$name" || die "unit not in fixed enumeration: $name"
                    dir="$(canon /etc/systemd/system)";      token="systemd-unit" ;;
      *) die "config-write kind must be nginx-site|nginx-conf|systemd-unit" ;;
    esac
    target="${dir}/${name}"
    [[ -L "$target" ]] && die "refusing to write through a symlink (no-follow): $target"
    denied_path "$target" && die "denied path: $target"
    body="$(cat)"
    if [[ "$token" == systemd-unit ]]; then
      validate_unit_body "$body" || die "unit body rejected on validation"
    fi
    # write atomically, root-owned 0644, no symlink follow
    tmpf="$(mktemp "${dir}/.torii-admin.XXXXXX")" || die "cannot make temp file in $dir"
    cat > "$tmpf" <<< "$body"
    chmod 0644 "$tmpf"; chown root:root "$tmpf"
    mv -f "$tmpf" "$target"
    ;;
  config-remove)
    [[ $# -eq 1 ]] || die "config-remove needs <name>"
    name="$1"; plain_name "$name" || die "invalid name: $name"
    dir="$(canon /etc/nginx/sites-enabled)"
    target="${dir}/${name}"
    [[ -L "$target" ]] || die "config-remove only removes symlinks under $dir"
    denied_path "$target" && die "denied path: $target"
    rm -f "$target"
    ;;

  *) die "unknown op: $op (see --help)" ;;
esac

exit 0