#!/usr/bin/env bash
# torii-quest/install/lib/docker.sh — optional Docker-based install (advanced).
#
# Sourced by install.sh only when --docker is passed. This brings up the
# full Docker Compose stack (game + multiplayer + a strfry Nostr relay
# sidecar) on a single origin. It is NOT the recommended path — bare-metal
# (lib/bare-metal.sh) is the default. Docker is offered for operators who
# prefer container isolation or already run a Docker host.
#
# Requires lib/ui.sh + lib/run.sh sourced first.
# Reads: DOMAIN_IN EMAIL_IN NPUB_IN ASSUME_YES DRY_RUN ROOT (set by install.sh)
# Exposes: run_docker_install

run_docker_install() {
  # Docker + Compose v2 — install via get.docker.com if missing.
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

  # Build the image (CSP is templated into the Caddyfile at image build time
  # via __CSP_HEADER__ — see Dockerfile — so it can never drift from the build).
  run_stage "Building game + multiplayer images" docker compose build --pull
  run_stage "Starting the stack" docker compose up -d --remove-orphans

  ui_info "Waiting for the game to answer over loopback (HTTPS cert issuance can take ~10-30s)..."
  local ok=0
  for _ in $(seq 1 30); do
    if curl -ksf --max-time 3 "https://127.0.0.1" -H "Host: $DOMAIN_IN" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 2
  done
  if [[ $ok -eq 1 ]]; then
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
}
