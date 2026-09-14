#!/usr/bin/env bash
# Tests for ops/lib/build-release-artifact.sh (SB-10 Quest artifact path).
#
# Static assertions always run (hermetic, no build). When the environment
# provides ARTIFACT_DIR + ARTIFACT_TAG (as the release-artifact CI job does),
# the pre-built tarball/manifest are also validated end-to-end: extract, VERSION,
# manifest parse, relative-path component digests, and secret-shaped scan.
#
# Run (static):        bash ops/test/quest-release-artifact.test.sh
# Run (validating):    ARTIFACT_DIR=/tmp/out ARTIFACT_TAG=v0.2.843-alpha bash ops/test/quest-release-artifact.test.sh

set -uo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd -P)"
BUILDER="${REPO_ROOT}/ops/lib/build-release-artifact.sh"

pass=0; fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  FAIL %s\n' "$1" >&2; fail=$((fail+1)); }

[[ -f "$BUILDER" ]] || { bad "missing $BUILDER"; exit 1; }
bash -n "$BUILDER" && ok "builder parses cleanly" || bad "builder failed bash -n"

# ── static: the builder must mirror the established Suite /quest/ contract ───
grep -qF "base: '/quest/'" "$BUILDER" \
  && ok "builder injects base='/quest/' before the SPA build" || bad "builder does not inject the /quest/ base"
grep -qF 'cd "${stage_root}/dist" && find .' "$BUILDER" \
  && ok "builder hashes dist over relative paths (deterministic)" || bad "builder dist hash not relative"
grep -qF 'show -s --format=%cI HEAD' "$BUILDER" \
  && ok "builder pins built_at to commit date" || bad "builder uses a fresh wall-clock timestamp"
grep -qF -- '--sort=name' "$BUILDER" && grep -qF -- '--mtime=' "$BUILDER" \
  && ok "builder emits a deterministic tarball (sort + pinned mtime)" || bad "builder tarball not deterministic"
grep -qF 'refusing to package: secret-shaped file' "$BUILDER" \
  && ok "builder fails closed on secret-shaped files" || bad "builder missing secret-shaped-file guard"

# ── validate a pre-built artifact when the CI env is present ──────────────────
if [[ -n "${ARTIFACT_DIR:-}" && -n "${ARTIFACT_TAG:-}" ]]; then
  TARBALL="${ARTIFACT_DIR}/torii-quest-${ARTIFACT_TAG}.tar.gz"
  SUMFILE="${ARTIFACT_DIR}/torii-quest-${ARTIFACT_TAG}.tar.gz.sha256"
  MANIFEST="${ARTIFACT_DIR}/torii-quest-${ARTIFACT_TAG}.manifest.json"

  [[ -f "$TARBALL" && -f "$SUMFILE" && -f "$MANIFEST" ]] \
    && ok "artifact tarball + checksum + manifest present" \
    || { bad "artifact files missing in ${ARTIFACT_DIR}"; echo; echo "quest-release-artifact.test.sh: ${pass} passed, ${fail} failed"; exit 1; }

  # checksum
  ( cd "$ARTIFACT_DIR" && sha256sum -c --strict "$(basename "$SUMFILE")" >/dev/null 2>&1 ) \
    && ok "artifact checksum verifies" || bad "artifact checksum mismatch"

  # extract + required members
  EXTRACT="$(mktemp -d)"
  trap 'rm -rf "$EXTRACT"' EXIT
  tar -xzf "$TARBALL" -C "$EXTRACT"
  ROOT="$(find "$EXTRACT" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  for member in dist/index.html dist/server/arena-ws.cjs dist/package.json worlds/default/world.json VERSION MANIFEST.json; do
    [[ -e "${ROOT}/${member}" ]] \
      && ok "artifact contains ${member}" || bad "artifact missing ${member}"
  done

  # VERSION + manifest tag match
  [[ "$(cat "${ROOT}/VERSION")" == "$ARTIFACT_TAG" ]] \
    && ok "artifact VERSION == tag" || bad "artifact VERSION != tag"
  mtag="$(node -e 'try{const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.tag||"")}catch(e){process.stdout.write("")}' "${ROOT}/MANIFEST.json")"
  [[ "$mtag" == "$ARTIFACT_TAG" ]] \
    && ok "manifest tag == tag" || bad "manifest tag '${mtag}' != '${ARTIFACT_TAG}'"

  # component digests recompute (relative paths, as the builder computes them)
  exp_dist="$(node -e 'try{const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((m.components&&m.components.dist_sha256)||"")}catch(e){process.stdout.write("")}' "${ROOT}/MANIFEST.json")"
  got_dist="$(cd "${ROOT}/dist" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
  [[ -n "$exp_dist" && "$got_dist" == "$exp_dist" ]] \
    && ok "dist digest recomputes identically" || bad "dist digest mismatch (manifest vs recomputed)"

  # secret-shaped scan on the extracted artifact
  if find "$ROOT" -type f \( -name '.env*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name '*.bak' \) -print -quit | grep -q .; then
    bad "extracted artifact contains a secret-shaped file"
  else
    ok "extracted artifact is free of secret-shaped files"
  fi
else
  echo "  (skip artifact validation — set ARTIFACT_DIR + ARTIFACT_TAG to validate a pre-built artifact)"
fi

echo
echo "quest-release-artifact.test.sh: ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]