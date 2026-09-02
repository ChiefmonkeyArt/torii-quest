# Architecture Decision Records (ADRs)

This directory holds the load-bearing architectural decisions for Torii Quest.
Each ADR captures **one** decision, its context, and its consequences. ADRs
are immutable once **Accepted** — to change a decision, write a new ADR that
**Supersedes** the old one and link them both ways.

## Rules

1. **No code change to an area covered by an ADR** without either following
   that ADR or first writing (and getting operator approval on) a superseding
   ADR. This exists because unlogged "while I'm here" edits to pointer-lock,
   ESC, CSP, SW, and boot flow between v0.2.606–v0.2.620 broke the game and
   forced a hard reset to v0.2.605 as v0.2.621.
2. **One decision per file.** If it needs two decisions, it needs two ADRs.
3. **Immutable.** Never edit an Accepted ADR to change its meaning. Fix
   typos in place; change decisions by writing a successor.
4. **Numbered sequentially**, four-digit, zero-padded: `0001-*.md`.
5. **Status transitions:** Proposed → Accepted → (later) Superseded by ADR-NNNN.
6. **Cross-link supersession** in BOTH files (old ADR's Status field points
   forward; new ADR's Context section points back).
7. **Numbers are claimed by merge, not booked in advance.** A number is held
   only by its file existing on `main`. With several tracks drafting ADRs in
   parallel, two branches can pick the same next number; the first to merge
   keeps it, and any later collider renumbers to the next unused number before
   it merges — updating its own title, filename, and every cross-reference
   (including the index above). Always take the next number from the highest
   merged file on `main`, not from a local branch, and re-check just before
   opening a PR.

## Template

See [`TEMPLATE.md`](./TEMPLATE.md).

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-state-fsm-seam.md) | State FSM seam — `state.phase` writes confined to `src/state.js` | Accepted |
| [0002](./0002-event-bus-registry.md) | Event bus — every `EV.<NAME>` must be registered in `src/events.js` | Accepted |
| [0003](./0003-csp-as-http-header.md) | CSP delivered as HTTP header — nonce-free, strict-dynamic disabled, inline bootstrap sha256 | Accepted |
| [0004](./0004-draco-vendored.md) | Draco decoder vendored at `/draco/` — never gstatic | Accepted |
| [0005](./0005-sw-deploy-base-contract.md) | Service worker registration and precache are deploy-base aware | Accepted |
| [0006](./0006-mp-hit-authority.md) | Server-authoritative HIT resolution — no client-HIT rebroadcast | Accepted |
| [0007](./0007-mp-damage-table-parity.md) | Server↔client damage-table constants are locked (head=9, body=3) | Accepted |
| [0008](./0008-leaderboard-read-path.md) | Leaderboard reads only `kind:30078#d=torii-quest` + `kind:1#t=torii-quest-score` | Accepted |
| [0009](./0009-spa-zone-fallback.md) | `index.html` SPA fallback for `/zone/*` deep-links | Accepted |
| [0010](./0010-crosshair-esc-pointerlock-baseline.md) | Crosshair, ESC, and pointer-lock baseline is v0.2.605 | Accepted |
| [0011](./0011-combat-classifier-bot-tactics-lod-hysteresis.md) | Combat classifier, bot tactics, and LOD hysteresis baseline (v0.2.608 forward-port) | Accepted |
| [0012](./0012-stuck-key-guard-and-quality-tier-no-shadow-toggle.md) | Stuck-key guard and quality-tier no-shadow-toggle (v0.2.612 forward-port) | Accepted |
| [0013](./0013-bot-identity-and-diagnostics.md) | Bot identity (dwarves) + always-on floating labels + shot diagnostics | Accepted |
| [0014](./0014-trigger-fire-diagnostics.md) | Trigger-fire diagnostics (log every shot, not just resolved hits) | Accepted |
| [0015](./0015-mp-hit-reg-alive-window.md) | Fix MP hit-reg alive-window (accept rewound-alive shots) | Accepted |
| [0016](./0016-client-bot-state-sync.md) | Client Bot State Sync: Nameplate Lifecycle + Dead-Bot LOD | Accepted |
| [0017](./0017-server-zone-in-bot-hit.md) | Plumb `zone` from BOT_HIT into client `applyBotHit` | Accepted |
| [0018](./0018-controlled-test-environment.md) | Controlled test environment (env-driven bot roster override) | Accepted |
| [0019](./0019-stale-bot-cleanup-test-mode.md) | Stale-bot cleanup + TEST_MODE instant respawn | Accepted |
| [0020](./0020-complete-stale-bot-cleanup.md) | Complete stale-bot cleanup (clear wrapper array + colliders) | Accepted |
| [0021](./0021-mp-authoritative-local-roster.md) | MP is authoritative: never render the local bot roster | Accepted |
| [0022](./0022-mp-model-attach.md) | MP must attach its own GLB models to authoritative rows | Accepted |
| [0023](./0023-miss-geometry-diagnostics.md) | Miss-geometry diagnostics for player→bot shots | Accepted |
| [0024](./0024-lag-comp-round-trip.md) | Lag compensation must count the round trip, not one way | Accepted |
| [0025](./0025-kami-mode-sealed-ema.md) | Kami Mode: the owner's sealed in-world note-taking surface | Accepted |
| [0026](./0026-spatial-marketplace-plebeian-client.md) | Spatial Marketplace: Quest as a watch-only Plebeian client | Accepted |
| [0027](./0027-kami-ema-input-isolation.md) | Kami ema input isolation: the note owns its keystrokes while open | Accepted |
| [0028](./0028-floating-overlays-not-in-phase-hidden-screens.md) | Floating overlays must not nest inside phase-hidden screens | Accepted |
| [0029](./0029-kami-mode-state-machine.md) | Kami Mode state machine: NORMAL ⇄ KAMI ⇄ EMA_OPEN | Accepted |
| [0030](./0030-kami-mode-visibility-smoked-rack-badge.md) | Kami Mode visibility: smoked-glass rack body + KAMI MODE badge | Accepted |
| [0031](./0031-kami-hotkey-bare-k.md) | Kami Mode Hotkey Moved to Bare K (from Ctrl/Cmd+E) | Accepted |
| [0032](./0032-kami-server-authoritative-invincibility.md) | Kami Mode Invincibility Made Server-Authoritative | Accepted |
| [0033](./0033-emagake-spelling-correction.md) | Ema Rack Renamed "emagake" (Corrected Romanization) | Accepted |
| [0034](./0034-kami-mode-visual-unification.md) | Kami Mode visual unification — no darkened modal, world stays fully visible | Accepted |
| [0035](./0035-product-auction-boards.md) | Product/Auction boards — three separate NAP-zone boards, owner-scoped, Nostr NIP-99/NIP-15-family sourced | Accepted |
| [0036](./0036-product-panel-click-trigger.md) | Product Panel Click Trigger, Decoupled From Kami Mode | Accepted |
| [0037](./0037-reopen-boards-on-every-trigger.md) | Reopen All Boards on Every Trigger Press | Accepted |
| [0038](./0038-rotate-kami-key-ai-read-path.md) | Rotate the Kami Key + Wire the AI Read Path | Accepted |
| [0039](./0039-2-way-ema-replies-channel.md) | 2-Way Ema Comms — AI Replies in the Emagake Rack | Accepted |
| [0040](./0040-nostr-native-kami-chat-bridge.md) | Nostr-native Kami chat bridge (staged) | Accepted |
| [0041](./0041-playtest-kami-exit-and-hit-feedback.md) | Playtest UX: reliable Kami exit + visible hit feedback | Accepted |
| [0042](./0042-instant-ema-post-and-bot-hit-feedback.md) | Instant Ema Post on Enter + Visible Bot Hit Feedback | Accepted |
| [0043](./0043-hp-le-zero-dead-invariant.md) | hp ≤ 0 ⇒ dead invariant (bots-wont-die fix) | Accepted |
| [0044](./0044-bot-nameplate-dwarf-name.md) | Bot nameplate shows the dwarf name, not "regular" | Accepted |
| [0045](./0045-bot-render-state-ema-diagnostic.md) | Bot render-state ema diagnostic (v0.2.666-alpha) | Accepted |
| [0046](./0046-sent-ray-diagnostic.md) | Sent-ray diagnostic — prove camera-vs-muzzle on miss (v0.2.667-alpha) | Accepted |
| [0047](./0047-rendered-bot-position-diagnostic.md) | Rendered bot-position diagnostic — expose the client/server desync (v0.2.668-alpha) | Accepted |
| [0048](./0048-bot-state-ingest-rate-diagnostic.md) | BOT_STATE ingest-rate diagnostic — find why client bots are ~12m stale (v0.2.670-alpha) | Accepted |
| [0049](./0049-connection-heartbeat-diagnostic.md) | WebSocket open/close + main-thread heartbeat diagnostic — split the BOT_STATE stall cause (v0.2.671-alpha) | Accepted |
| [0050](./0050-bot-state-kami-gate-fix.md) | Decouple BOT_STATE broadcast from the Kami Mode roster gate (v0.2.672-alpha) | Accepted |
| [0051](./0051-yaw-wrap-fix.md) | Wrap the pointer-lock yaw to [-π, π] before it reaches the wire (v0.2.673-alpha) | Accepted |
| [0052](./0052-kami-state-snapshot-diagnostic.md) | Capture Kami Mode client state in the ema snapshot (v0.2.675-alpha) | Accepted |
| [0053](./0053-gateway-liveness-filter.md) | Filter stale and handshake records from the gateway directory (v0.2.676-alpha) | Accepted |
| [0054](./0054-gateway-screen-redesign.md) | Redesign the gateway screen — in-place smoked glass, three columns (v0.2.676-alpha) | Accepted |
| [0055](./0055-ema-auto-capture-diagnostic.md) | Ema Auto-Capture Diagnostic (1Hz Rolling Ring) | Accepted |
| [0056](./0056-recording-indicator.md) | Recording indicator + dashboard surfacing | Accepted |
| [0057](./0057-napplet-surface-shell-scaffold.md) | Napplet world-surface shell scaffold | Accepted |
| [0058](./0058-product-panel-napplet-conversion.md) | Convert the product panel into the first live `nap-torii-world` napplet | Accepted |
| [0059](./0059-auction-panel-header-hardening.md) | Harden the auction panel renderer (no `innerHTML` of untrusted data) | Accepted |
| [0060](./0060-homepage-panel-smoked-glass-restoration.md) | Restore real smoked-glass blur on the homepage panel with a true edge fade | Accepted |
| [0061](./0061-auction-panel-skipbody-empty-state-fix.md) | Fix the product napplet's body ownership: skip-body guard + clear static placeholder on mount | Accepted |
| [0062](./0062-service-worker-get-only-interception.md) | Service worker only intercepts GET requests | Accepted |
| [0063](./0063-four-cleanups-gateway-qtoggle-timer-pointerlock.md) | Four console-noise / UX cleanups (Gateway auto-open, Q-toggle, Clock→Timer, pointer-lock rejection) | Accepted |
| [0064](./0064-remove-minimap-single-k-opens-note.md) | Remove the in-game minimap, and make a single K press open the ema note input | Accepted |
| [0065](./0065-one-command-docker-installer.md) | One-command Docker installer for Torii Quest (MP included by default) | Accepted |
| [0066](./0066-bare-metal-default-installer.md) | Bare-metal one-command installer (default/recommended path; Docker demoted to optional) | Accepted |
| [0067](./0067-leaderboard-relay-trim.md) | Trim broken Nostr relays from the gamestr leaderboard and profile-read sets | Accepted |
| [0068](./0068-boot-overlay-recolored-to-torii-theme.md) | Boot Loading Overlay Recolored to Torii Sunset Theme | Accepted |
| [0069](./0069-pause-modal-recolored-to-torii-theme.md) | Pause Modal Recolored to Torii Sunset Theme | Accepted |
| [0070](./0070-admin-only-loggedin-badge-on-owner-caption.md) | Admin-Only "Logged In" Badge on the Owner Caption | Accepted |
| [0071](./0071-admin-loggedin-caption-reworded-to-greeting.md) | Admin Logged-In Caption Reworded to "Welcome <name>, you are logged in" | Accepted |
| [0072](./0072-admin-greeting-colour-split-name-orange-loggedin-green.md) | Split greeting colours: only the name orange, "logged in" green | Accepted |
| [0073](./0073-installer-allow-existing-system-caddy-and-fix-caddyfile-email-directive.md) | Installer: allow existing system Caddy on ports 80/443 + fix invalid Caddyfile `email` directive | Accepted |
| [0074](./0074-installer-idempotent-caddy-rerun-and-mixed-listener-check.md) | Installer: idempotent Caddy managed-block rerun + strict mixed-listener port check | Accepted |
| [0075](./0075-arena-server-version-constant-bumped-by-bump-ver.md) | Arena server: SERVER_VERSION constant bumped by bump-ver.sh | Accepted |
| [0076](./0076-trusted-torii-starter-relays-as-default-node-relay-set.md) | Trusted Torii Starter Relays as Default Node-Relay Set | Accepted |
| [0077](./0077-heartbeat-auto-on-first-publish-on-owner-login.md) | Heartbeat Auto-On — First Publish Fires on Owner Login | Accepted |
| [0078](./0078-restore-access-settings-tab.md) | Restore the Access settings tab (re-surface signed kind:30078 access controls) | Accepted |
| [0079](./0079-one-command-vps-bootstrap.md) | One-command `curl | sudo bash` VPS bootstrap | Accepted |
| [0080](./0080-remove-pubkey-fragment-from-login-status.md) | Remove the Nostr pubkey fragment from the login status line | Accepted |
| [0081](./0081-single-unified-relay-list.md) | Single Unified Relay List (Connection, Not Consent) | Accepted |
| [0082](./0082-napplet-game-host-scaffold.md) | Napplet game-host shell scaffold | Accepted |
| [0083](./0083-napplet-avatar-shell-scaffold.md) | Napplet avatar shell scaffold | Accepted |
| [0084](./0084-arena-as-game-napplet-wiring.md) | Arena as game napplet (wiring-only) | Accepted |
| [0085](./0085-sticker-studio-as-avatar-napplet-wiring.md) | Sticker studio as avatar napplet (wiring-only) | Accepted |
| [0086](./0086-sticker-placement-model-and-editor.md) | Character Forge — sticker placement model + editor | Accepted |
| [0087](./0087-validator-gated-external-mesh-generation.md) | Character Forge — validator-gated external mesh generation | Accepted |
| [0088](./0088-in-world-raycast-sticker-placement.md) | Character Forge — in-world raycast sticker placement | Accepted |
| [0089](./0089-live-generator-clients-broker-seam.md) | Character Forge — live generator clients + broker seam | Accepted |
| [0090](./0090-ugc-sticker-system.md) | UGC sticker system — any-surface decals, Nostr-published library, multiplayer sync | Accepted |
| [0091](./0091-character-forge-validator-first.md) | Character Forge — validator-first character pipeline with auto-rig groundwork | Accepted |
| [0092](./0092-arena-full-sandboxing.md) | Arena full sandboxing (Three + Rapier inside the napplet iframe) | Proposed |
| [0093](./0093-sticker-studio-full-sandboxing.md) | Sticker studio full sandboxing (SkinnedMesh raycast inside the napplet iframe) | Deferred |
| [0094](./0094-server-always-on-presence-beacon.md) | Server-Side Always-On Presence Beacon | Accepted |
| [0095](./0095-settings-click-propagation-fix.md) | Settings Panel Action Buttons Were Dead (Click-Propagation Fix) | Accepted |
| [0096](./0096-settings-visual-redesign.md) | Settings Panel — Neutral Visual System + Character Select/Create Redesign | Accepted |
| [0097](./0097-settings-polish-v0.2.739.md) | Settings polish v0.2.739 (opacity + font + Character preview + toast + micro-interactions) | Accepted |
| [0098](./0098-home-button-client-suspend.md) | Home button client-suspend on perpetual-world model (no teardown, silence + park local client, MP socket stays open) | Accepted |
| [0099](./0099-kami-mode-dev-menu.md) | Kami-mode dev menu — owner-only runtime toggles surface (starting with sticker RENDER-MODE A/B), gate enforced in code | Accepted |
| [0100](./0100-recording-ring-toggle.md) | Recording-ring toggle — owner-controlled pause for the ADR-0055 1Hz auto-capture, registered on the ADR-0099 dev-menu shell | Accepted |
| [0101](./0101-auto-deploy-on-tag.md) | Auto-deploy to VPS on tag push — deploy-only SSH key with forced-command + GitHub Actions workflow, so `main HEAD == latest tag == VPS` becomes automatic | Accepted |
| [0102](./0102-admin-ssh-access.md) | Admin-scoped SSH key for AI-driven infra diagnosis + repair — dispatcher-gated, `workflow_dispatch`-only, audited via GitHub Actions | Accepted |
| [0103](./0103-mixamo-colon-bone-names.md) | Character rig accepts Mixamo colon-form bone names (`mixamorig:X`, `Armature:mixamorig:X`) via pure `normalizeBoneName()` in the skeleton mapper | Accepted |
| [0104](./0104-beacon-relay-coverage-refresh.md) | Refresh `DEFAULT_NODE_RELAYS` to a writable-verified 5-relay set; remove two silently-rejecting relays surfaced by `tools/relay-probe.mjs` | Accepted |

## Workflow for a new decision

1. Copy `TEMPLATE.md` to `docs/adr/NNNN-short-slug.md` (next unused number — taken from the highest merged file on `main`, per rule 7).
2. Fill in Context, Decision, Consequences.
3. Set Status: **Proposed**.
4. Show the operator. On approval, set Status: **Accepted** and commit.
5. Only THEN write the code implementing the decision.

## Workflow for changing an existing decision

1. Copy `TEMPLATE.md` to a new numbered file.
2. In its Context, link the ADR it replaces and summarise why the old
   decision no longer holds.
3. Set Status: **Proposed**. Show operator.
4. On approval:
   - Set new ADR Status: **Accepted**.
   - Set old ADR Status: **Superseded by ADR-NNNN** (with a link).
   - Update the index table above.
5. Only THEN write the code.
