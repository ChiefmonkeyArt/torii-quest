#!/usr/bin/env bash
# Behavior tests for the fixed-operation dispatcher (ADR-0102 v2).
#
# Exercises the REAL ops/torii-admin-run.sh (no live VPS, no `sudo`, no systemd
# or nginx process is ever launched). Assertions target the security contract:
# deny/traversal/symlink rejection, fixed unit enumeration, unit-body injection
# rejection, and no accidental interactive-reader path.
#
# Run:  bash ops/test-admin-dispatcher.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd -P)"
DISPATCHER="${REPO_ROOT}/ops/torii-admin-run.sh"

[[ -f "$DISPATCHER" ]] || { echo "dispatcher not found: $DISPATCHER" >&2; exit 1; }

pass=0; fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  FAIL %s\n' "$1" >&2; fail=$((fail+1)); }

# run the dispatcher, capture exit code
rc() { bash "${DISPATCHER}" "$@" >/dev/null 2>&1; echo $?; }

# --- reader: allow / deny / traversal / symlink resolution -----------------
readable="$(find /var/log -maxdepth 1 -type f -readable -print -quit 2>/dev/null)"
if [[ -n "$readable" ]]; then
  if bash "${DISPATCHER}" reader "$readable" >/dev/null 2>&1; then
    ok "reader: allowed in-root path exits 0"
  else
    bad "reader: allowed in-root path was rejected (${readable})"
  fi
else
  bad "reader: no readable /var/log file available to test the allow path"
fi

[[ "$(rc reader /etc/shadow)" -ne 0 ]] && ok "reader: /etc/shadow denied" || bad "reader: /etc/shadow NOT denied"

[[ "$(rc reader /etc/nginx/../../etc/./shadow)" -ne 0 ]] && ok "reader: .././ traversal resolves and is denied" || bad "reader: traversal NOT denied"

[[ "$(rc reader /home/anyone/.ssh/authorized_keys)" -ne 0 ]] && ok "reader: /home/*/.ssh denied" || bad "reader: /home/*/.ssh NOT denied"

# a symlink living inside /var/log whose target resolves OUTSIDE the allowed
# roots must be rejected on the resolved path (if such a link exists)
for l in /var/log/README; do
  if [[ -L "$l" ]]; then
    [[ "$(rc reader "$l")" -ne 0 ]] && ok "reader: in-root symlink resolved outside roots is rejected" || bad "reader: symlink target escape accepted"
    break
  fi
done

# --- search: fixed action, no injection -----------------------------------
[[ "$(rc search /opt '-name')" -ne 0 ]] && ok "search: leading-dash pattern rejected" || bad "search: leading-dash accepted"

[[ "$(rc search /tmp xyz)" -ne 0 ]] && ok "search: out-of-read-roots dir rejected" || bad "search: out-of-roots dir accepted"

# --- unit enumeration: no namespace glob ----------------------------------
[[ "$(rc unit-start torii-evil.service)" -ne 0 ]] && ok "unit: torii-evil.service (not in fixed enum) rejected" || bad "unit: arbitrary torii-* name accepted"

[[ "$(rc unit-start)" -ne 0 ]] && ok "unit: missing name rejected" || bad "unit: missing name accepted"

# --- unknown op + help/version ---------------------------------------------
[[ "$(rc frobnicate)" -ne 0 ]] && ok "unknown op rejected" || bad "unknown op accepted"

bash "${DISPATCHER}" --help >/dev/null 2>&1 && ok "--help exits 0" || bad "--help failed"
bash "${DISPATCHER}" --version >/dev/null 2>&1 && ok "--version exits 0" || bad "--version failed"

# --- config-write systemd-unit: body injection ----------------------------
[[ "$(printf 'x\n' | bash "${DISPATCHER}" config-write systemd-unit torii-evil.service >/dev/null 2>&1; echo $?)" -ne 0 ]] \
  && ok "config-write: out-of-enumeration unit name rejected" || bad "config-write: out-of-enum unit accepted"

body_root='[Unit]
Description=x
[Service]
User=root
ExecStart=/usr/bin/node /tmp/x.js
'
[[ "$(printf '%s\n' "$body_root" | bash "${DISPATCHER}" config-write systemd-unit torii-arena-ws.service >/dev/null 2>&1; echo $?)" -ne 0 ]] \
  && ok "config-write: User=root body rejected" || bad "config-write: User=root body accepted"

body_exec='[Unit]
Description=x
[Service]
ExecStart=/bin/sh -c "id"
'
[[ "$(printf '%s\n' "$body_exec" | bash "${DISPATCHER}" config-write systemd-unit torii-arena-ws.service >/dev/null 2>&1; echo $?)" -ne 0 ]] \
  && ok "config-write: non-allowlisted ExecStart binary rejected" || bad "config-write: arbitrary ExecStart accepted"

# --- config-remove: symlink-only ------------------------------------------
[[ "$(rc config-remove does-not-exist)" -ne 0 ]] && ok "config-remove: non-symlink/absent target rejected" || bad "config-remove: absent target accepted"

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[[ "${fail}" -eq 0 ]]