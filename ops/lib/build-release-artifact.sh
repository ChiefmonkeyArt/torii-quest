#!/usr/bin/env bash
#
# Torii Quest — release artifact builder (SB-10 artifact-path migration).
#
# WHY THIS EXISTS
# ---------------
# Every Quest deploy used to clone the repo on the VPS, run `npm install` +
# `npm run build` on the box (dashboard build + vite + esbuild server bundle),
# and retain that build toolchain + node_modules in the work tree. That is the
# source-build path the SB-10 audit flags: ~393 MB of dev material per work
# tree, plus a network- and CPU-bound build repeated on every redeploy.
#
# This script performs that work ONCE, in CI, on a clean checkout of an exact
# tag, and packages the result into a single tarball a Suite host can download,
# verify, and promote in seconds. It is the single source of truth for "what a
# Quest release artifact contains"; it mirrors torii-continuum's
# ops/lib/build-release-artifact.sh so the two fast paths stay consistent.
#
# WHAT GOES IN THE ARTIFACT
# --------------------------
#   dist/                 the built SPA (vite, base=/quest/) PLUS the bundled
#                         authoritative multiplayer server
#                         (dist/server/arena-ws.cjs) and its runtime manifest
#                         (dist/package.json) — already built, never rebuilt on
#                         the host.
#   worlds/               the committed world templates (default/,
#                         chiefmonkey-template/, gateway-blank/) that
#                         install-quest.sh seeds persistent worlds from on
#                         first install.
#   VERSION               the exact tag this artifact was built for.
#   MANIFEST.json         non-secret build provenance: tag, git commit SHA,
#                         commit-time timestamp, builder platform/node/npm, and
#                         the sha256 of each top-level component (computed over
#                         RELATIVE paths so a rebuild of the same commit
#                         reproduces them).
#
# WHAT NEVER GOES IN
# -------------------
# No secret, credential, or live state. This script only reads from a clean CI
# checkout of the exact tag, and re-verifies the staged tree contains no
# secret-/backup-shaped file before writing the tarball.
#
# USAGE
#   build-release-artifact.sh <repo-checkout-dir> <tag> <output-dir>
#
# Produces in <output-dir>:
#   torii-quest-<tag>.tar.gz
#   torii-quest-<tag>.tar.gz.sha256
#   torii-quest-<tag>.manifest.json
#
# Exits non-zero on any failure (fail closed). Idempotent on re-run.

set -euo pipefail

log() { printf '[build-release-artifact] %s\n' "$*"; }
die() { printf '[build-release-artifact] FATAL: %s\n' "$*" >&2; exit 1; }

REPO_DIR="${1:?usage: build-release-artifact.sh <repo-dir> <tag> <output-dir>}"
TAG="${2:?usage: build-release-artifact.sh <repo-dir> <tag> <output-dir>}"
OUT_DIR="${3:?usage: build-release-artifact.sh <repo-dir> <tag> <output-dir>}"

readonly TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
[[ "$TAG" =~ $TAG_RE ]] || die "tag '${TAG}' is not a valid v<semver> release tag."

[[ -d "$REPO_DIR" ]] || die "repo dir '${REPO_DIR}' does not exist."
[[ -f "${REPO_DIR}/package.json" ]] || die "'${REPO_DIR}' does not look like a torii-quest checkout (no package.json)."
[[ -f "${REPO_DIR}/vite.config.js" ]] || die "'${REPO_DIR}/vite.config.js' missing."

command -v node >/dev/null || die "node not found."
command -v npm  >/dev/null || die "npm not found."
command -v tar  >/dev/null || die "tar not found."
command -v sha256sum >/dev/null || die "sha256sum not found."

mkdir -p "$OUT_DIR"

# ── 1. Version alignment gate (fail closed BEFORE any build work) ────────────
# package.json version == tag. The SPA's runtime VERSION (src/config.js) must
# also match, so the shipped bundle self-reports the tag it was built for.
root_version="$(node -p "require('${REPO_DIR}/package.json').version")"
tag_version="${TAG#v}"

[[ "$root_version" == "$tag_version" ]] \
  || die "package.json version (${root_version}) != tag ${TAG} (expected ${tag_version})."

# src/config.js VERSION is a JS const, not JSON — parse defensively.
if grep -qE "export const VERSION[[:space:]]*=[[:space:]]*'${TAG}'" "${REPO_DIR}/src/config.js"; then
  log "version alignment OK: ${TAG} == package.json + src/config.js VERSION"
else
  die "src/config.js VERSION does not equal tag ${TAG}."
fi

# ── 2. Patch vite base to /quest/ (canonical Suite sub-path mount) ────────────
# Mirrors install-quest.sh: inject `base: '/quest/'` into defineConfig so the
# built SPA resolves absolute asset URLs under the /quest/ sub-path. Idempotent.
CONFIG_FILE="${REPO_DIR}/vite.config.js"
if grep -qE "base:[[:space:]]*['\"]/?quest/?['\"]" "$CONFIG_FILE"; then
  log "vite.config.js already has base: '/quest/'"
else
  log "patching vite.config.js for base: '/quest/'"
  sed -i "0,/defineConfig({/s||defineConfig({\n  base: '/quest/',|" "$CONFIG_FILE"
  sed -i "s|/assets/torii-entry\.js|/quest/assets/torii-entry.js|g" "$CONFIG_FILE"
fi

# ── 3. Build (dashboard + vite + esbuild server) once, in CI ─────────────────
STAGE="$(mktemp -d)"
trap 'rm -rf -- "$STAGE"' EXIT

log "installing deps (npm ci)"
( cd "$REPO_DIR" && npm ci --no-audit --no-fund )

log "building (npm run build)"
( cd "$REPO_DIR" && npm run build )

[[ -d "${REPO_DIR}/dist" ]] || die "build did not produce dist/."
[[ -f "${REPO_DIR}/dist/index.html" ]] || die "dist/index.html missing after build."
[[ -f "${REPO_DIR}/dist/server/arena-ws.cjs" ]] || die "dist/server/arena-ws.cjs missing — build:server did not emit the MP server."
[[ -f "${REPO_DIR}/dist/package.json" ]] || die "dist/package.json (arena-ws runtime manifest) missing after build."

# ── 4. Assemble the staged artifact tree ──────────────────────────────────────
stage_root="${STAGE}/torii-quest-${TAG}"
mkdir -p "$stage_root"

log "staging dist/ (SPA + arena-ws server + runtime manifest)"
cp -a "${REPO_DIR}/dist/." "${stage_root}/dist/"

log "staging worlds/ (committed world templates)"
if [[ -d "${REPO_DIR}/worlds" ]]; then
  cp -a "${REPO_DIR}/worlds/." "${stage_root}/worlds/"
fi

printf '%s\n' "$TAG" > "${stage_root}/VERSION"

# Fail closed on any secret-/state-shaped file in the staged tree.
secret_hit="$(find "$stage_root" -type f \( -name '.env' -o -name '.env.*' \
    -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \
    -o -name 'id_rsa' -o -name 'id_ed25519*' -o -name 'id_ecdsa*' \
    -o -name '*.bak' -o -name '*.orig' -o -name '*~' \) -print -quit 2>/dev/null || true)"
[[ -z "$secret_hit" ]] || die "refusing to package: secret-shaped file in staged tree: ${secret_hit}"

# ── 5. Manifest — non-secret, deterministic build provenance ────────────────
commit_sha="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
build_time="$(git -C "$REPO_DIR" show -s --format=%cI HEAD 2>/dev/null || echo 1970-01-01T00:00:00Z)"
node_version="$(node --version)"
npm_version="$(npm --version)"
platform="$(uname -s)-$(uname -m)"

# Relative-path hashes so a rebuild of the same commit reproduces the digests
# independent of the random staging path (mktemp -d).
dist_hash="$(cd "${stage_root}/dist" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
worlds_hash="$(cd "${stage_root}/worlds" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"

cat > "${stage_root}/MANIFEST.json" <<JSON
{
  "tag": "${TAG}",
  "version": "${root_version}",
  "commit": "${commit_sha}",
  "built_at": "${build_time}",
  "builder": {
    "platform": "${platform}",
    "node": "${node_version}",
    "npm": "${npm_version}"
  },
  "components": {
    "dist_sha256": "${dist_hash}",
    "worlds_sha256": "${worlds_hash}"
  }
}
JSON
log "wrote MANIFEST.json (commit=${commit_sha})"

# ── 6. Deterministic tarball + checksum ─────────────────────────────────────
artifact_name="torii-quest-${TAG}.tar.gz"
artifact_path="${OUT_DIR}/${artifact_name}"

( cd "$STAGE" && \
  tar --sort=name \
      --mtime='UTC 2020-01-01' \
      --owner=0 --group=0 --numeric-owner \
      -czf "$artifact_path" "torii-quest-${TAG}" )

[[ -s "$artifact_path" ]] || die "tarball ${artifact_path} was not created or is empty."

( cd "$OUT_DIR" && sha256sum "$artifact_name" > "${artifact_name}.sha256" )
cp "${stage_root}/MANIFEST.json" "${OUT_DIR}/torii-quest-${TAG}.manifest.json"

log "artifact ready: ${artifact_path}"
log "checksum:       ${artifact_path}.sha256 ($(cut -d' ' -f1 "${artifact_path}.sha256"))"
log "manifest:       ${OUT_DIR}/torii-quest-${TAG}.manifest.json"
du -h "$artifact_path" | awk '{print "[build-release-artifact] size: " $1}'