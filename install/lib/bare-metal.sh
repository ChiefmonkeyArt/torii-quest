#!/usr/bin/env bash
# torii-quest/install/lib/bare-metal.sh — bare-metal (systemd + Caddy) install.
#
# Sourced by install.sh when no --docker flag is given. This is the DEFAULT
# and RECOMMENDED install path: a fresh Ubuntu/Debian VPS with nothing but
# SSH access ends up serving the live game over HTTPS with multiplayer,
# decoupled from torii-suite, mirroring VPS_INSTALL.md §§1–16.
#
# Layout (matches the reference production install, not the generic doc example):
#   /var/www/torii-quest/releases/<ts>-<sha>/   built dist/ bundle
#   /var/www/torii-quest/current               symlink → newest release (atomic flip)
#   /opt/torii-quest/mp/arena-ws.cjs            bundled multiplayer server
#   /etc/systemd/system/torii-arena-ws.service  supervised unit (User=torii-quest)
#   /etc/caddy/Caddyfile                        site block with /mp proxy + managed CSP
#
# Nostr: the bare-metal path does NOT run a local strfry relay. The game
# connects to public Nostr relays (damus.io, nos.lol, …) by default, which the
# shipped CSP connect-src already permits. A local relay is a Docker-only
# sidecar; adding one on bare metal is out of scope here.
#
# Requires lib/ui.sh + lib/run.sh sourced first.
# Reads: DOMAIN_IN EMAIL_IN NPUB_IN ASSUME_YES DRY_RUN ROOT (set by install.sh)
# Exposes: run_bare_metal_install

run_bare_metal_install() {
  # ----- 1. Dependencies --------------------------------------------------- #
  ui_section "Installing system dependencies"

  # Node 20 LTS via NodeSource (the repo's floor — see VPS_INSTALL.md §4).
  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -dv -f2 | cut -d. -f1)" -lt 20 ]]; then
    run_stage "Adding NodeSource Node 20 repo" bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
    run_stage "Installing Node 20" apt-get install -y nodejs
  else
    ui_ok "Node $(node -v) already installed"
  fi
  ui_ok "Node: $(node -v), npm $(npm -v)"

  # Build tools + Caddy (official stable apt repo — VPS_INSTALL.md §6a).
  run_stage "Installing build tools + Caddy" apt-get install -y \
    git curl ca-certificates rsync build-essential \
    debian-keyring debian-archive-keyring apt-transport-https
  if ! command -v caddy >/dev/null 2>&1; then
    run_stage "Adding Caddy apt repo" bash -c "
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      apt-get update
    "
    run_stage "Installing Caddy" apt-get install -y caddy
  else
    ui_ok "Caddy already installed: $(caddy version 2>&1 | head -1)"
  fi

  # ----- 2. Build the game (as SUDO_USER, never root) ---------------------- #
  ui_section "Building Torii Quest"

  BUILD_USER="${SUDO_USER:-$USER}"
  # A root-owned clone makes later non-root deploys fail — guard against it.
  if [[ "$(id -u)" -eq 0 && "$BUILD_USER" == "root" ]]; then
    ui_warn "Running as root with no SUDO_USER — the clone will be root-owned."
    ui_warn "Re-run as 'sudo -u <youruser> ./install.sh' (or a normal sudo) for a non-root-owned tree."
  fi
  ui_ok "Building as user: $BUILD_USER"

  if [[ ! -d "$ROOT/.git" ]]; then
    ui_die "install.sh must be run from inside a clone of the repo (no .git found at $ROOT)."
  fi

  run_stage "Installing JS dependencies (npm ci)" sudo -u "$BUILD_USER" -H npm ci --no-audit --no-fund
  run_stage "Building game + multiplayer bundle" sudo -u "$BUILD_USER" -H npm run build

  # ----- 3. Publish a versioned release + atomic symlink flip --------------- #
  ui_section "Publishing release"

  RELEASES_ROOT="/var/www/torii-quest/releases"
  CURRENT_LINK="/var/www/torii-quest/current"
  TS="$(date -u +%Y%m%d%H%M%S)"
  SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  REL_DIR="$RELEASES_ROOT/$TS-$SHA"

  run_stage "Publishing bundle to $REL_DIR" bash -c "
    install -d -m 0755 '$RELEASES_ROOT'
    install -d -m 0755 '$REL_DIR'
    cp -a '$ROOT/dist/.' '$REL_DIR/'
  "
  # Atomic flip — re-pointing one symlink is the whole update/rollback surface.
  run_stage "Flipping current symlink" ln -sfn "$REL_DIR" "$CURRENT_LINK"
  ui_ok "Live bundle → $CURRENT_LINK → $REL_DIR"

  # Prune old releases (keep the 3 newest + the current target). Never delete
  # the one `current` points at.
  ui_step "Pruning old releases (keeping newest 3)"
  local target_real
  target_real="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  local kept=0
  while IFS= read -r old; do
    [[ -z "$old" ]] && continue
    if [[ "$target_real" == "$(readlink -f "$old" 2>/dev/null || echo X)" ]]; then
      continue # never prune the live release
    fi
    if [[ $kept -ge 3 ]]; then
      rm -rf -- "$old" 2>/dev/null && ui_step "pruned $(basename "$old")"
    else
      kept=$((kept + 1))
    fi
  done < <(ls -1d "$RELEASES_ROOT"/*/ 2>/dev/null | sort -r)

  # ----- 4. Multiplayer server (torii-quest system user + systemd) -------- #
  ui_section "Installing multiplayer server"

  MP_DIR="/opt/torii-quest/mp"
  run_stage "Creating torii-quest system user" bash -c "
    if ! id -u torii-quest >/dev/null 2>&1; then
      useradd --system --shell /usr/sbin/nologin --home-dir /opt/torii-quest --create-home torii-quest
    fi
    install -d -m 0755 -o torii-quest -g torii-quest /opt/torii-quest
    install -d -m 0755 -o torii-quest -g torii-quest '$MP_DIR'
  "

  run_stage "Copying arena-ws bundle into $MP_DIR" bash -c "
    cp '$ROOT/dist/server/arena-ws.cjs' '$MP_DIR/arena-ws.cjs'
    # A minimal package.json so npm install --omit=dev can resolve 'ws'.
    cat > '$MP_DIR/package.json' <<'PKG'
{ \"name\": \"torii-quest-arena-ws\", \"version\": \"1.0.0\", \"private\": true, \"type\": \"commonjs\", \"dependencies\": { \"ws\": \"^8.18.0\" } }
PKG
    chown torii-quest:torii-quest '$MP_DIR/arena-ws.cjs' '$MP_DIR/package.json'
  "
  run_stage "Installing runtime deps (ws only)" bash -c "cd '$MP_DIR' && sudo -u torii-quest -H npm install --omit=dev --no-audit --no-fund"

  # systemd unit — mirrors VPS_INSTALL.md §16.2 + the production install-quest.sh.
  UNIT_FILE="/etc/systemd/system/torii-arena-ws.service"
  run_stage "Writing systemd unit" bash -c "cat > '$UNIT_FILE' <<'UNIT'
[Unit]
Description=Torii Quest Arena WebSocket server (MP-1)
After=network.target

[Service]
Type=simple
User=torii-quest
Group=torii-quest
WorkingDirectory=$MP_DIR
ExecStart=/usr/bin/node $MP_DIR/arena-ws.cjs
Restart=on-failure
RestartSec=2

Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=MAX_PEERS=${MAX_PEERS:-32}
Environment=MP_MODE=${MP_MODE:-authoritative}
Environment=SCORE_ENABLED=${SCORE_ENABLED:-true}
Environment=LOG_LEVEL=${LOG_LEVEL:-info}
Environment=QUEST_ADMIN_NPUB=$NPUB_IN

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/torii-quest
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
UNIT
"
  run_stage "Enabling + starting multiplayer service" bash -c "
    systemctl daemon-reload
    systemctl enable --now torii-arena-ws.service
  "

  # ----- 5. Caddy site block (managed, never clobber an existing Caddyfile) #
  ui_section "Configuring Caddy reverse proxy"

  CADDYFILE="/etc/caddy/Caddyfile"
  [[ -f "$CADDYFILE" ]] || { install -d -m 0755 "$(dirname "$CADDYFILE")"; : > "$CADDYFILE"; }

  # Extract the real, per-build CSP from the bundle we just published — never
  # hand-copy a CSP string (it drifts the moment the inline bootstrap sha changes).
  CSP_RAW="$(grep -m1 'Content-Security-Policy' "$REL_DIR/_headers" 2>/dev/null | sed 's/^Content-Security-Policy:[[:space:]]*//' || true)"
  if [[ -z "$CSP_RAW" ]]; then
    ui_warn "Couldn't read CSP from dist/_headers — Caddy will serve without a CSP header."
    CSP_RAW=""
  else
    # Add wss://<domain> to connect-src so the browser may open the MP socket
    # back to this origin (VPS_INSTALL.md §16.1 note). Idempotent.
    if ! echo "$CSP_RAW" | grep -q "wss://$DOMAIN_IN"; then
      CSP_RAW="${CSP_RAW/ connect-src / connect-src wss://$DOMAIN_IN }"
      # connect-src may be the first connect-src token (no leading space) — handle that too.
      CSP_RAW="$(echo "$CSP_RAW" | sed -E "s/(connect-src 'self')/\\1 wss:\/\/$DOMAIN_IN/g")"
    fi
    ui_ok "CSP extracted from build (connect-src includes wss://$DOMAIN_IN)"
  fi

  # Write/update only our managed site block, delimited by markers — anything
  # else in the Caddyfile (other sites, global options) is left untouched.
  write_caddy_site_block() {
    local tmp
    tmp="$(mktemp)"
    # Back up the existing Caddyfile before mutating it — safety net for
    # multi-site VPS where other (unrelated) sites share this file. (ADR-0073)
    if [[ -f "$CADDYFILE" ]]; then
      cp -p "$CADDYFILE" "${CADDYFILE}.bak.$(date +%s)" 2>/dev/null || true
    fi
    # Strip any prior managed block, then append the fresh one. The markers
    # are a prefix match (^# TORII QUEST MANAGED START/END) so the long-form
    # START line we actually emit is caught. A mangled Caddyfile (START with
    # no matching END) is NOT safely auto-recoverable — we cannot tell
    # whether the content after a dangling START belongs to the broken block
    # or is an unrelated site that landed there after a bad edit, so guessing
    # risks silently corrupting the file. We hard-abort before writing
    # anything and ask for a manual fix instead. (ADR-0073)
    if [[ -f "$CADDYFILE" ]]; then
      local starts ends
      starts=$(grep -c '^# TORII QUEST MANAGED START' "$CADDYFILE" || true)
      ends=$(grep -c '^# TORII QUEST MANAGED END' "$CADDYFILE" || true)
      if [[ "$starts" -ne "$ends" ]]; then
        ui_die "$CADDYFILE has an unbalanced TORII QUEST MANAGED block ($starts START / $ends END) — fix or remove it by hand before re-running (backup saved alongside the Caddyfile)."
      fi
      awk '
        /^# TORII QUEST MANAGED START/ {skip=1; next}
        /^# TORII QUEST MANAGED END/ {skip=0; next}
        !skip {print}
      ' "$CADDYFILE" > "$tmp"
    fi
    {
      echo ""
      echo "# TORII QUEST MANAGED START — managed by torii-quest install.sh. Do not edit by hand;"
      echo "# re-run the installer to update. Remove the block (and the service) to uninstall."
      echo "$DOMAIN_IN {"
      echo "    tls $EMAIL_IN"
      echo "    root * $CURRENT_LINK"
      echo "    encode zstd gzip"
      echo ""
      echo "    handle /mp {"
      echo "        reverse_proxy 127.0.0.1:8787"
      echo "    }"
      echo ""
      echo "    file_server"
      echo "    try_files {path} /index.html"
      echo ""
      echo "    @wasm path *.wasm"
      echo "    header @wasm Content-Type application/wasm"
      echo ""
      echo "    @assets path /assets/*"
      echo "    header @assets Cache-Control \"public, max-age=31536000, immutable\""
      echo "    header /index.html Cache-Control \"no-cache\""
      if [[ -n "$CSP_RAW" ]]; then
        echo "    header Content-Security-Policy \"$CSP_RAW\""
      fi
      echo "}"
      echo "# TORII QUEST MANAGED END"
    } >> "$tmp"
    cat "$tmp" > "$CADDYFILE"
    rm -f -- "$tmp"
  }
  run_stage "Writing managed Caddy site block" write_caddy_site_block

  # Validate the Caddyfile before reloading — never reload a broken config.
  if caddy validate --config "$CADDYFILE" >/dev/null 2>&1; then
    ui_ok "Caddyfile validates"
    run_stage "Reloading Caddy" systemctl reload caddy
  else
    ui_warn "Caddyfile failed validation — not reloading. Check: caddy validate --config $CADDYFILE"
    caddy validate --config "$CADDYFILE" 2>&1 | head -20 >&2 || true
  fi

  # ----- 6. Verify -------------------------------------------------------- #
  ui_section "Verifying"

  ui_info "Waiting for Caddy to answer over HTTPS (cert issuance can take ~10-30s)..."
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
    ui_warn "Game isn't answering yet — often just slow cert issuance. Check: journalctl -u caddy -f"
  fi

  if systemctl is-active --quiet torii-arena-ws.service; then
    ui_ok "Multiplayer server is active"
    if [[ -n "$NPUB_IN" ]]; then
      sleep 1
      if journalctl -u torii-arena-ws -n 20 --no-pager 2>/dev/null | grep -qi "admin"; then
        ui_ok "Multiplayer server acknowledged the admin npub at startup"
      else
        ui_warn "Couldn't confirm the admin-npub log line yet — check: journalctl -u torii-arena-ws -n 20"
      fi
    fi
  else
    ui_warn "Multiplayer service not active — check: systemctl status torii-arena-ws"
  fi
}
