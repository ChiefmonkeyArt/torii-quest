#!/usr/bin/env bash
# torii-quest/install.sh — one-command standalone install.
#
# Run on a fresh Ubuntu/Debian VPS, from a clone of this repo:
#   git clone https://github.com/ChiefmonkeyArt/torii-quest.git
#   cd torii-quest
#   sudo ./install.sh
#
# What it does:
#   1. Preflight — OS check, root/sudo check, ports 80/443 free, Docker present
#      (installs it if missing), DNS sanity check against this box's public IP.
#   2. Prompts — domain, Let's Encrypt email, admin npub (optional), multiplayer
#      tuning (optional, sane defaults). Writes .env.
#   3. Builds the image and brings up the stack (game + multiplayer + relay)
#      with `docker compose up -d --build`.
#   4. Verifies — waits for the container to report healthy, curls the site
#      over loopback, checks the admin-npub startup log line if one was set.
#   5. Prints a summary box with the live URL and next steps.
#
# This installer is entirely self-contained inside this repo: it does not
# touch or depend on torii-suite, and does not register with any shared
# sidecar. A fresh `git clone` of torii-quest is fully sufficient to run it.
#
# Non-interactive / scripted use: pre-populate .env yourself (see
# .env.example) and pass --yes to skip every prompt. Safe to re-run — an
# existing .env is detected and offered as defaults rather than overwritten
# blind.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# shellcheck source=install/lib/ui.sh
source "$ROOT/install/lib/ui.sh"
# shellcheck source=install/lib/run.sh
source "$ROOT/install/lib/run.sh"

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      echo "Usage: sudo ./install.sh [-y|--yes]"
      echo "  -y, --yes   Skip confirmation prompts (still asks for domain/email/npub"
      echo "              unless .env already sets them)."
      exit 0
      ;;
  esac
done

TOTAL_STAGES=5

ui_banner "one-command install"

# --------------------------------------------------------------------------- #
# Stage 1/5 — Preflight                                                       #
# --------------------------------------------------------------------------- #
ui_stage 1 "$TOTAL_STAGES" "Preflight checks"

if [[ "$(id -u)" -ne 0 ]]; then
  ui_die "Run as root or with sudo:  sudo ./install.sh"
fi

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    ui_warn "Detected OS: ${PRETTY_NAME:-unknown}. This installer targets Ubuntu/Debian."
    ui_warn "It may still work (Docker is the only real OS dependency), continuing..."
  else
    ui_ok "OS: ${PRETTY_NAME:-$ID}"
  fi
else
  ui_warn "Could not detect OS (no /etc/os-release) — continuing anyway."
fi

# Ports 80/443 must be free for Caddy to bind them.
for p in 80 443; do
  if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$p )" 2>/dev/null | grep -q ":$p"; then
    ui_die "Port $p is already in use. Stop whatever's listening on it (another web server?) and re-run."
  fi
done
ui_ok "Ports 80 and 443 are free"

# Docker + Compose v2 — install via get.docker.com if missing (same script
# deploy/server-harden.sh uses, kept in sync deliberately).
if ! command -v docker >/dev/null 2>&1; then
  ui_info "Docker not found — installing (this takes a minute)..."
  run_stage "Installing Docker" bash -c "curl -fsSL https://get.docker.com | sh"
  systemctl enable --now docker >/dev/null 2>&1 || true
else
  ui_ok "Docker already installed: $(docker --version)"
fi
if ! docker compose version >/dev/null 2>&1; then
  ui_die "Docker Compose v2 plugin not found even after Docker install. See https://docs.docker.com/compose/install/"
fi
ui_ok "Docker Compose: $(docker compose version --short 2>/dev/null || echo present)"

# --------------------------------------------------------------------------- #
# Stage 2/5 — Configuration                                                   #
# --------------------------------------------------------------------------- #
ui_stage 2 "$TOTAL_STAGES" "Configuration"

EXISTING_DOMAIN="" EXISTING_EMAIL="" EXISTING_NPUB=""
if [[ -f .env ]]; then
  ui_info "Found an existing .env — its values are offered as defaults below."
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  EXISTING_DOMAIN="${DOMAIN:-}"; EXISTING_EMAIL="${ACME_EMAIL:-}"; EXISTING_NPUB="${QUEST_ADMIN_NPUB:-}"
fi

DOMAIN_IN="" EMAIL_IN="" NPUB_IN=""
if [[ "$ASSUME_YES" -eq 1 && -n "$EXISTING_DOMAIN" && -n "$EXISTING_EMAIL" ]]; then
  # -y with a fully-populated existing .env: reuse it untouched, no prompts.
  DOMAIN_IN="$EXISTING_DOMAIN"; EMAIL_IN="$EXISTING_EMAIL"; NPUB_IN="$EXISTING_NPUB"
  ui_ok "Using existing .env (DOMAIN=$DOMAIN_IN) — skipping prompts (-y)"
else
  ui_ask "Domain (A record must already point at this server's IP)" DOMAIN_IN "$EXISTING_DOMAIN"
  [[ -n "$DOMAIN_IN" ]] || ui_die "A domain is required — Caddy needs it to request an HTTPS certificate."

  ui_ask "Email for Let's Encrypt renewal notices" EMAIL_IN "$EXISTING_EMAIL"
  [[ -n "$EMAIL_IN" ]] || ui_die "An email is required by Let's Encrypt."

  echo ""
  ui_info "Admin npub: the ONE Nostr identity that gets admin powers on this instance"
  ui_info "(never paste an nsec — that's a private key. npub only, or leave blank for no admin)."
  ui_ask "Admin npub (optional)" NPUB_IN "$EXISTING_NPUB"
  if [[ -n "$NPUB_IN" && "$NPUB_IN" != npub1* ]]; then
    ui_warn "That doesn't look like an npub (should start with 'npub1') — saving it anyway,"
    ui_warn "but arena-ws will ignore it and log a warning if it's not valid at startup."
  fi
fi

# DNS sanity check — best-effort, never blocks the install (may be running
# behind NAT, or DNS may still be propagating).
ui_section "DNS check"
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
if [[ -n "$PUBLIC_IP" ]]; then
  ui_step "This server's public IP: $PUBLIC_IP"
  RESOLVED_IP="$(getent ahostsv4 "$DOMAIN_IN" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [[ -n "$RESOLVED_IP" && "$RESOLVED_IP" == "$PUBLIC_IP" ]]; then
    ui_ok "$DOMAIN_IN resolves to this server"
  elif [[ -n "$RESOLVED_IP" ]]; then
    ui_warn "$DOMAIN_IN resolves to $RESOLVED_IP, not this server ($PUBLIC_IP)."
    ui_warn "Fix the A record before continuing, or Caddy's certificate request will fail."
    if [[ "$ASSUME_YES" -ne 1 ]] && ! ui_confirm "Continue anyway?"; then
      ui_die "Aborted — fix DNS and re-run."
    fi
  else
    ui_warn "$DOMAIN_IN did not resolve yet. If you just changed DNS, this can take a few minutes."
    if [[ "$ASSUME_YES" -ne 1 ]] && ! ui_confirm "Continue anyway?"; then
      ui_die "Aborted — wait for DNS to propagate and re-run."
    fi
  fi
else
  ui_warn "Couldn't determine this server's public IP (offline or blocked) — skipping DNS check."
fi

# Write .env (preserve MP tuning vars from .env.example if not already set).
{
  echo "DOMAIN=$DOMAIN_IN"
  echo "ACME_EMAIL=$EMAIL_IN"
  echo "QUEST_ADMIN_NPUB=$NPUB_IN"
  echo "MAX_PEERS=${MAX_PEERS:-32}"
  echo "MP_MODE=${MP_MODE:-authoritative}"
  echo "LAG_COMP_MS=${LAG_COMP_MS:-}"
  echo "HP_MAX=${HP_MAX:-}"
  echo "RESPAWN_MS=${RESPAWN_MS:-}"
  echo "SCORE_ENABLED=${SCORE_ENABLED:-true}"
  echo "LOG_LEVEL=${LOG_LEVEL:-info}"
} > .env
chmod 600 .env
ui_ok "Wrote .env"

# --------------------------------------------------------------------------- #
# Stage 3/5 — Build                                                           #
# --------------------------------------------------------------------------- #
ui_stage 3 "$TOTAL_STAGES" "Build"

run_stage "Building game + multiplayer images" docker compose build --pull

# --------------------------------------------------------------------------- #
# Stage 4/5 — Launch                                                          #
# --------------------------------------------------------------------------- #
ui_stage 4 "$TOTAL_STAGES" "Launch"

run_stage "Starting the stack" docker compose up -d --remove-orphans

# --------------------------------------------------------------------------- #
# Stage 5/5 — Verify                                                          #
# --------------------------------------------------------------------------- #
ui_stage 5 "$TOTAL_STAGES" "Verify"

ui_info "Waiting for the game to answer over loopback (HTTPS cert issuance can take ~10-30s)..."
ok=0
for _ in $(seq 1 30); do
  if curl -ksf --max-time 3 "https://127.0.0.1" -H "Host: $DOMAIN_IN" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done
if [[ "$ok" -eq 1 ]]; then
  ui_ok "Game responds over HTTPS"
else
  ui_warn "Game isn't answering yet. This is often just slow cert issuance — check:"
  ui_warn "  docker compose logs -f web"
fi

if docker compose ps arena-ws 2>/dev/null | grep -q "Up\|running"; then
  ui_ok "Multiplayer server is running"
  if [[ -n "$NPUB_IN" ]]; then
    sleep 1
    if docker compose logs arena-ws 2>/dev/null | grep -qi "admin"; then
      ui_ok "Multiplayer server acknowledged the admin npub at startup"
    else
      ui_warn "Couldn't confirm the admin-npub log line yet — check: docker compose logs arena-ws"
    fi
  fi
else
  ui_warn "Multiplayer container doesn't look up — check: docker compose logs arena-ws"
fi

ui_section "Done"
ui_box_top
ui_box_line "${UI_BOLD}Torii Quest is live${UI_RESET}"
ui_box_rule
ui_box_line "Game:   ${UI_CYAN2}https://${DOMAIN_IN}${UI_RESET}"
ui_box_line "Relay:  wss://${DOMAIN_IN}/relay"
ui_box_line "MP:     wss://${DOMAIN_IN}/mp"
ui_box_rule
ui_box_line "Logs:    docker compose logs -f"
ui_box_line "Update:  ./deploy/deploy.sh"
ui_box_line "Harden:  sudo bash deploy/server-harden.sh"
ui_box_bottom
echo ""
ui_rainbow "  welcome to the federated metaverse"
echo ""
