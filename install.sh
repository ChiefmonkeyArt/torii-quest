#!/usr/bin/env bash
# torii-quest/install.sh — one-command install.
#
# Run on a fresh Ubuntu/Debian VPS, from a clone of this repo:
#   git clone https://github.com/ChiefmonkeyArt/torii-quest.git
#   cd torii-quest
#   sudo ./install.sh
#
# DEFAULT PATH — bare-metal (recommended):
#   Installs Node 20 + Caddy directly on this box, builds the game, publishes
#   it into a versioned release folder with an atomic symlink flip, runs the
#   multiplayer server under systemd as a dedicated `torii-quest` user, and
#   configures Caddy (managed block, auto-HTTPS) with a `/mp` reverse proxy.
#   No Docker, no torii-suite dependency. The ONLY prompts are domain,
#   Let's Encrypt email, and your admin npub — everything else is automatic.
#
# ADVANCED / OPTIONAL — Docker:
#   sudo ./install.sh --docker
#   Brings up the same stack (game + multiplayer + a strfry Nostr relay
#   sidecar) as Docker Compose containers instead. Useful if you prefer
#   container isolation or already run a Docker host. Not the recommended
#   path for most self-hosters — see VPS_INSTALL.md §0.
#
# Both paths are entirely self-contained inside this repo: neither touches
# or depends on torii-suite, and neither registers with any shared sidecar.
# A fresh `git clone` of torii-quest is fully sufficient to run either.
#
# Flags:
#   --docker            Use the Docker Compose path instead of bare-metal.
#   --domain <domain>   Pre-fill the domain prompt (non-interactive use).
#   --email <email>     Pre-fill the Let's Encrypt email prompt.
#   --admin-npub <npub> Pre-fill the admin npub prompt (optional identity).
#   -y, --yes           Skip confirmation prompts (still asks for
#                        domain/email/npub unless already supplied above or
#                        via an existing .env).
#   --dry-run           Parse args, resolve config, run the DNS sanity check,
#                        and print what would happen — no system changes.
#   -h, --help           Show this usage.
#
# Non-interactive / scripted use: pass --domain/--email/--admin-npub (or
# pre-populate .env yourself — see .env.example) and add -y. Safe to re-run —
# an existing .env is detected and offered as defaults rather than
# overwritten blind.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# shellcheck source=install/lib/ui.sh
source "$ROOT/install/lib/ui.sh"
# shellcheck source=install/lib/run.sh
source "$ROOT/install/lib/run.sh"

# --------------------------------------------------------------------------- #
# Arg parsing (shared by both install paths)                                  #
# --------------------------------------------------------------------------- #
ASSUME_YES=0
DRY_RUN=0
USE_DOCKER=0
DOMAIN_ARG="" EMAIL_ARG="" NPUB_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --docker) USE_DOCKER=1; shift ;;
    --domain) DOMAIN_ARG="${2:-}"; shift 2 ;;
    --email) EMAIL_ARG="${2:-}"; shift 2 ;;
    --admin-npub) NPUB_ARG="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: sudo ./install.sh [options]"
      echo ""
      echo "  (no flags)          Bare-metal install — the recommended default."
      echo "  --docker            Use Docker Compose instead (advanced/optional)."
      echo "  --domain <domain>   Pre-fill the domain prompt."
      echo "  --email <email>     Pre-fill the Let's Encrypt email prompt."
      echo "  --admin-npub <npub> Pre-fill the admin npub prompt (optional)."
      echo "  -y, --yes           Skip confirmation prompts."
      echo "  --dry-run           Resolve config and exit — no system changes."
      echo "  -h, --help          Show this help."
      exit 0
      ;;
    *)
      ui_die "Unknown option: $1 (see --help)"
      ;;
  esac
done

TOTAL_STAGES=5

ui_banner "one-command install"

# --------------------------------------------------------------------------- #
# Stage 1/5 — Preflight                                                       #
# --------------------------------------------------------------------------- #
ui_stage 1 "$TOTAL_STAGES" "Preflight checks"

if [[ "$DRY_RUN" -eq 1 ]]; then
  ui_info "Dry run — root check skipped."
elif [[ "$(id -u)" -ne 0 ]]; then
  ui_die "Run as root or with sudo:  sudo ./install.sh"
fi

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    ui_warn "Detected OS: ${PRETTY_NAME:-unknown}. This installer targets Ubuntu/Debian."
    ui_warn "It may still work, continuing..."
  else
    ui_ok "OS: ${PRETTY_NAME:-$ID}"
  fi
else
  ui_warn "Could not detect OS (no /etc/os-release) — continuing anyway."
fi

if [[ "$DRY_RUN" -ne 1 ]]; then
  # Ports 80/443 must be free for Caddy (bare-metal) or the web container
  # (Docker) to bind them. In bare-metal mode the installer reuses the host's
  # systemd-managed Caddy, so an existing caddy.service holding 80/443 is
  # expected and allowed — only foreign listeners (nginx, apache, a stray
  # non-systemd caddy, etc.) abort. Docker mode always requires free ports
  # because the web container binds them itself. (ADR-0073)
  for p in 80 443; do
    if ! command -v ss >/dev/null 2>&1; then
      break
    fi
    if ! ss -ltn "( sport = :$p )" 2>/dev/null | grep -q ":$p"; then
      continue
    fi
    # Something is listening on $p.
    if [[ "$USE_DOCKER" -eq 1 ]]; then
      ui_die "Port $p is already in use. Stop whatever's listening on it (another web server?) and re-run."
    fi
    # Bare-metal: allow only the host's own systemd-managed Caddy.
    if ss -ltnp "( sport = :$p )" 2>/dev/null | grep -q 'users:(("caddy' && systemctl is-active --quiet caddy; then
      ui_ok "Port $p held by the system Caddy (caddy.service) — installer will reuse it"
      continue
    fi
    ui_die "Port $p is already in use by a process other than the system Caddy. Stop it (another web server?) and re-run."
  done
  ui_ok "Ports 80 and 443 are free (or held by the reusable system Caddy)"
fi

if [[ "$USE_DOCKER" -eq 1 ]]; then
  ui_info "Install mode: Docker (advanced/optional — see --help)"
else
  ui_info "Install mode: bare-metal (recommended default)"
fi

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
# --domain/--email/--admin-npub (if given) take priority over .env defaults.
[[ -n "$DOMAIN_ARG" ]] && EXISTING_DOMAIN="$DOMAIN_ARG"
[[ -n "$EMAIL_ARG" ]] && EXISTING_EMAIL="$EMAIL_ARG"
[[ -n "$NPUB_ARG" ]] && EXISTING_NPUB="$NPUB_ARG"

DOMAIN_IN="" EMAIL_IN="" NPUB_IN=""
if [[ ( "$ASSUME_YES" -eq 1 || "$DRY_RUN" -eq 1 ) && -n "$EXISTING_DOMAIN" && -n "$EXISTING_EMAIL" ]]; then
  # -y/--dry-run with a fully-populated config: reuse it untouched, no prompts.
  DOMAIN_IN="$EXISTING_DOMAIN"; EMAIL_IN="$EXISTING_EMAIL"; NPUB_IN="$EXISTING_NPUB"
  ui_ok "Using supplied config (DOMAIN=$DOMAIN_IN) — skipping prompts"
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
    ui_warn "Fix the A record before continuing, or the HTTPS certificate request will fail."
    if [[ "$ASSUME_YES" -ne 1 && "$DRY_RUN" -ne 1 ]] && ! ui_confirm "Continue anyway?"; then
      ui_die "Aborted — fix DNS and re-run."
    fi
  else
    ui_warn "$DOMAIN_IN did not resolve yet. If you just changed DNS, this can take a few minutes."
    if [[ "$ASSUME_YES" -ne 1 && "$DRY_RUN" -ne 1 ]] && ! ui_confirm "Continue anyway?"; then
      ui_die "Aborted — wait for DNS to propagate and re-run."
    fi
  fi
else
  ui_warn "Couldn't determine this server's public IP (offline or blocked) — skipping DNS check."
fi

# Write .env (preserve MP tuning vars from .env.example if not already set).
# Both install paths use this as the shared, idempotent config record.
# Skipped on --dry-run so the run truly makes no changes.
if [[ "$DRY_RUN" -ne 1 ]]; then
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
  chmod 600 .env 2>/dev/null || true
  ui_ok "Wrote .env"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  ui_section "Dry run — stopping here"
  ui_box_top
  ui_box_line "${UI_BOLD}Dry run complete — no changes made${UI_RESET}"
  ui_box_rule
  ui_box_line "Mode:    $([[ $USE_DOCKER -eq 1 ]] && echo docker || echo bare-metal)"
  ui_box_line "Domain:  $DOMAIN_IN"
  ui_box_line "Email:   $EMAIL_IN"
  NPUB_DISPLAY="$NPUB_IN"
  [[ ${#NPUB_DISPLAY} -gt 24 ]] && NPUB_DISPLAY="${NPUB_IN:0:22}..."
  ui_box_line "Npub:    ${NPUB_DISPLAY:-(none)}"
  ui_box_bottom
  exit 0
fi

# --------------------------------------------------------------------------- #
# Stages 3-5 — Build, launch, verify (path-specific)                          #
# --------------------------------------------------------------------------- #
if [[ "$USE_DOCKER" -eq 1 ]]; then
  # shellcheck source=install/lib/docker.sh
  source "$ROOT/install/lib/docker.sh"

  ui_stage 3 "$TOTAL_STAGES" "Build (Docker)"
  ui_stage 4 "$TOTAL_STAGES" "Launch (Docker)"
  ui_stage 5 "$TOTAL_STAGES" "Verify"
  run_docker_install

  ui_section "Done"
  ui_box_top
  ui_box_line "${UI_BOLD}Torii Quest is live (Docker)${UI_RESET}"
  ui_box_rule
  ui_box_line "Game:   ${UI_CYAN2}https://${DOMAIN_IN}${UI_RESET}"
  ui_box_line "Relay:  wss://${DOMAIN_IN}/relay"
  ui_box_line "MP:     wss://${DOMAIN_IN}/mp"
  ui_box_rule
  ui_box_line "Logs:    docker compose logs -f"
  ui_box_line "Update:  ./deploy/deploy.sh"
  ui_box_line "Harden:  sudo bash deploy/server-harden.sh"
  ui_box_bottom
else
  # shellcheck source=install/lib/bare-metal.sh
  source "$ROOT/install/lib/bare-metal.sh"

  ui_stage 3 "$TOTAL_STAGES" "Build"
  ui_stage 4 "$TOTAL_STAGES" "Deploy"
  ui_stage 5 "$TOTAL_STAGES" "Verify"
  run_bare_metal_install

  ui_section "Done"
  ui_box_top
  ui_box_line "${UI_BOLD}Torii Quest is live${UI_RESET}"
  ui_box_rule
  ui_box_line "Game:   ${UI_CYAN2}https://${DOMAIN_IN}${UI_RESET}"
  ui_box_line "MP:     wss://${DOMAIN_IN}/mp"
  ui_box_rule
  ui_box_line "Logs:    journalctl -u torii-arena-ws -f   |   journalctl -u caddy -f"
  ui_box_line "Update:  see VPS_INSTALL.md §7 (git pull, npm ci, npm run build, re-run)"
  ui_box_line "Rollback: re-point /var/www/torii-quest/current (see VPS_INSTALL.md §8)"
  ui_box_bottom
fi

echo ""
ui_rainbow "  welcome to the federated metaverse"
echo ""
