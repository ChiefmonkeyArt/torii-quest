#!/usr/bin/env bash
# torii-quest/install-remote.sh — one-command VPS bootstrap.
#
# The single line that brings up (or updates) a Torii Quest node. Fetch + run:
#
#   curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/torii-quest/<tag>/install-remote.sh \
#     | sudo bash -s -- -y
#
# Pin the tag you trust — e.g. v0.2.714-alpha — so the script you review is the
# script that runs. (Same `curl | sudo bash` model as rustup / get.docker: only
# run installers from a source you trust. This one runs as root.)
#
# What it does:
#   1. Ensures `git` + `ca-certificates` are present (needed before the repo can
#      exist — install.sh itself only installs git as part of its dep stage,
#      which is too late for the clone).
#   2. DISCOVERS an existing torii-quest clone (so your existing .env — domain,
#      email, admin npub — is preserved, not clobbered) OR clones fresh to
#      /opt/torii-quest-src. NOTE: the source clone is NOT /opt/torii-quest —
#      that path is the runtime systemd-user home + multiplayer bundle owned by
#      install.sh; using it for the source tree would collide.
#   3. Fetches tags + checks out the target version (default: latest v* release
#      tag; override with --version).
#   4. Hands off to install.sh. Because this runs under `sudo`, SUDO_USER is set,
#      so install.sh builds as YOU (npm ci / npm run build run as the normal user)
#      — the repo tree stays non-root-owned + node_modules is writable.
#
# Git ops run as SUDO_USER when available; if invoked from a root shell with no
# SUDO_USER, they run as root + install.sh will warn (matching install.sh's own
# bare-metal.sh:58 guard). The recommended invocation is `curl | sudo bash`
# from a normal user, which always sets SUDO_USER.
#
# All git operations run as SUDO_USER when available (never root when a normal
# user invoked sudo); from a root shell they run as root + install.sh warns.
#
# Args consumed here:
#   --version <ver>   Pin a release tag (default: latest v* tag on origin).
#   --repo-dir <path> Use this existing clone instead of discovering/cloning.
#   -h, --help        Show this help + exit (no system changes).
# Everything else is forwarded verbatim to install.sh:
#   --domain <domain>   --email <email>   --admin-npub <npub>
#   -y / --yes          --docker          --dry-run        (see install.sh --help)
set -euo pipefail

# The git remote to clone from. Override TORII_REMOTE_URL for a mirror / air-gapped
# / test remote (defaults to the canonical GitHub repo).
REMOTE_URL="${TORII_REMOTE_URL:-https://github.com/ChiefmonkeyArt/torii-quest.git}"
DEFAULT_SRC_DIR="/opt/torii-quest-src"

VERSION=""
REPO_DIR=""
INSTALL_ARGS=()
SHOW_HELP=0

# ---- arg parsing (consumes --version/--repo-dir/--help; forwards the rest) ---- #
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || { echo "install-remote: --version needs a value" >&2; exit 2; }
      VERSION="$2"; shift 2 ;;
    --repo-dir)
      [[ $# -ge 2 ]] || { echo "install-remote: --repo-dir needs a value" >&2; exit 2; }
      REPO_DIR="$2"; shift 2 ;;
    -h|--help)
      SHOW_HELP=1; shift ;;
    --)
      shift; while [[ $# -gt 0 ]]; do INSTALL_ARGS+=("$1"); shift; done ;;
    *)
      INSTALL_ARGS+=("$1"); shift ;;
  esac
done

if [[ "$SHOW_HELP" -eq 1 ]]; then
  cat <<'HELP'
install-remote.sh — one-command Torii Quest VPS bootstrap.

Usage (pinned to a tag you trust):
  curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/torii-quest/<tag>/install-remote.sh \
    | sudo bash -s -- [options]

Bootstrap options (consumed here, NOT passed to install.sh):
  --version <ver>      Pin a release tag (default: latest v* tag on origin).
  --repo-dir <path>   Use this existing clone instead of discovering/cloning.
  -h, --help           Show this help + exit (no system changes).

Forwarded to install.sh (see `install.sh --help`):
  --domain <domain>    Pre-fill the domain prompt.
  --email <email>      Pre-fill the Let's Encrypt email prompt.
  --admin-npub <npub>  Pre-fill the admin npub prompt.
  -y, --yes            Skip confirmation prompts.
  --docker             Use Docker Compose instead of bare-metal.
  --dry-run            Resolve config + exit — no system changes.

Behaviour:
  - Source clone lives at /opt/torii-quest-src (NOT /opt/torii-quest — that is
    the runtime systemd-user home + multiplayer bundle owned by install.sh).
  - Discovers an existing clone first (preserves your .env); clones fresh only
    if none is found.
  - Git ops run as SUDO_USER (you) when available; from a root shell they run
    as root + install.sh will warn. The tree stays non-root-owned in the normal
    `curl | sudo bash` path so npm ci can write node_modules.
  - Hands off to install.sh, which inherits SUDO_USER + builds as you.
HELP
  exit 0
fi

# ---- we must run as root (sudo) so apt-get / install.sh's system stages work ---- #
if [[ "$(id -u)" -ne 0 ]]; then
  echo "install-remote: must run as root — re-run with 'sudo bash' (or 'curl | sudo bash')." >&2
  exit 2
fi

# The user who invoked sudo — install.sh builds as this user (never root).
BUILD_USER="${SUDO_USER:-root}"

run_as_build_user() {
  if [[ "$BUILD_USER" == "root" ]]; then "$@"; else sudo -u "$BUILD_USER" -H "$@"; fi
}

# ---- 1. ensure git + ca-certificates (needed before the repo can exist) ------ #
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "install-remote: installing git + ca-certificates (needed to clone)…"
  apt-get update -y
  apt-get install -y git ca-certificates curl
fi

# ---- 2. locate or create the source clone ----------------------------------- #
# Selection order: explicit --repo-dir > discovered clone WITH .env > discovered
# clone without .env > fresh clone to /opt/torii-quest-src.
if [[ -n "$REPO_DIR" ]]; then
  : # explicit — trust the caller
else
  # Discover an existing clone: a dir containing install.sh + .git whose origin
  # remote points at ChiefmonkeyArt/torii-quest. Bounded depth so it stays fast.
  WITH_ENV=""
  WITHOUT_ENV=""
  while IFS= read -r d; do
    [[ -n "$d" && -d "$d/.git" && -f "$d/install.sh" ]] || continue
    origin="$(git -C "$d" config --get remote.origin.url 2>/dev/null || true)"
    [[ "$origin" == *"ChiefmonkeyArt/torii-quest"* ]] || continue
    if [[ -f "$d/.env" ]]; then WITH_ENV="$d"; break; else [[ -z "$WITHOUT_ENV" ]] && WITHOUT_ENV="$d"; fi
  done < <(find /home /opt /srv /root -maxdepth 5 -type f -name install.sh 2>/dev/null | while IFS= read -r f; do dirname "$f"; done)
  REPO_DIR="${WITH_ENV:-$WITHOUT_ENV}"
  if [[ -n "$REPO_DIR" ]]; then
    echo "install-remote: discovered existing clone at $REPO_DIR (reusing — .env preserved)."
  fi
fi

if [[ -z "$REPO_DIR" ]]; then
  echo "install-remote: no existing clone found — cloning to $DEFAULT_SRC_DIR…"
  REPO_DIR="$DEFAULT_SRC_DIR"
  # /opt is root-owned — a normal SUDO_USER can't create /opt/torii-quest-src.
  # Pre-create the dir owned by the build user so `git clone` (run as that user)
  # can write into it. `install -d` is idempotent + safe on an existing dir.
  if [[ "$BUILD_USER" != "root" ]]; then
    BUILD_GROUP="$(id -gn "$BUILD_USER" 2>/dev/null || echo "$BUILD_USER")"
    install -d -m 0755 -o "$BUILD_USER" -g "$BUILD_GROUP" "$REPO_DIR"
  fi
  run_as_build_user git clone "$REMOTE_URL" "$REPO_DIR"
elif [[ ! -d "$REPO_DIR/.git" || ! -f "$REPO_DIR/install.sh" ]]; then
  echo "install-remote: --repo-dir $REPO_DIR is not a torii-quest clone (no .git/install.sh)." >&2
  exit 2
fi

# ---- 3. fetch tags + resolve + checkout the target version ------------------ #
echo "install-remote: fetching tags…"
run_as_build_user git -C "$REPO_DIR" fetch --tags --quiet

if [[ -z "$VERSION" ]]; then
  VERSION="$(git -C "$REPO_DIR" tag --sort=-v:refname 2>/dev/null \
              | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [[ -z "$VERSION" ]]; then
    echo "install-remote: no release tags found — checking out origin/main." >&2
    VERSION="origin/main"
  fi
fi
echo "install-remote: checking out $VERSION…"
run_as_build_user git -C "$REPO_DIR" checkout "$VERSION" --quiet

# ---- 4. hand off to install.sh (inherits SUDO_USER → builds as you) ---------- #
echo "install-remote: handing off to install.sh with ${#INSTALL_ARGS[@]} forwarded arg(s)…"
cd "$REPO_DIR"
exec bash install.sh "${INSTALL_ARGS[@]}"
