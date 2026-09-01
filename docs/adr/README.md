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
| [0001](./0001-state-fsm-seam.md) | State FSM seam — `state.phase` writes confined to `state.js` | Accepted |
| [0002](./0002-event-bus-registry.md) | Event bus — every `EV.<NAME>` must be registered in `events.js` | Accepted |
| [0003](./0003-csp-as-http-header.md) | CSP delivered as HTTP header (no `<meta>` CSP); nonce-free strict-dynamic + inline sha256 | Accepted |
| [0004](./0004-draco-vendored.md) | Draco decoder vendored at `/draco/` (never gstatic) | Accepted |
| [0005](./0005-sw-deploy-base-contract.md) | Service-worker registration and precache are deploy-base aware | Accepted |
| [0006](./0006-mp-hit-authority.md) | Server-authoritative HIT resolution; no client-HIT rebroadcast | Accepted |
| [0007](./0007-mp-damage-table-parity.md) | Server↔client damage-table constants are locked (head=9, body=3) | Accepted |
| [0008](./0008-leaderboard-read-path.md) | Leaderboard reads only `kind:30078#d=torii-quest` + `kind:1#t=torii-quest-score` | Accepted |
| [0009](./0009-spa-zone-fallback.md) | `index.html` SPA fallback for `/zone/*` deep-links | Accepted |
| [0010](./0010-crosshair-esc-pointerlock-baseline.md) | Crosshair, ESC, and pointer-lock baseline is v0.2.605 | Accepted |
| [0011](./0011-combat-classifier-bot-tactics-lod-hysteresis.md) | Combat classifier, bot tactics, and LOD hysteresis (v0.2.608 forward-port) | Accepted |
| [0012](./0012-stuck-key-guard-and-quality-tier-no-shadow-toggle.md) | Stuck-key guard and quality-tier no-shadow-toggle (v0.2.612 forward-port) | Accepted |
| [0013](./0013-bot-identity-and-diagnostics.md) | Bot identity (dwarf names) + [SHOT]/[KILL]/[RESPAWN] diagnostics layer | Accepted |
| [0014](./0014-trigger-fire-diagnostics.md) | Per-trigger [FIRE] diagnostic log line | Accepted |
| [0015](./0015-mp-hit-reg-alive-window.md) | MP hit-reg alive-window fix (wasAlive ‖ isAlive gate) | Accepted |
| [0016](./0016-client-bot-state-sync.md) | Client bot state sync (nameplate lifecycle + dead-bot LOD) | Accepted |
| [0017](./0017-server-zone-in-bot-hit.md) | Plumb zone from server BOT_HIT into client applyBotHit | Accepted |
| [0059](./0059-auction-panel-header-hardening.md) | Harden the auction panel renderer (no `innerHTML` of untrusted data) | Accepted |
| [0060](./0060-homepage-panel-smoked-glass-restoration.md) | Restore real smoked-glass blur on the homepage panel with a true edge fade | Accepted |
| [0088](./0088-in-world-raycast-sticker-placement.md) | Character Forge — in-world raycast sticker placement (self-view slice parked) | Accepted |
| [0089](./0089-live-generator-clients-broker-seam.md) | Live generator clients / executor broker seam (inert by default) | Accepted |
| [0090](./0090-ugc-sticker-system.md) | UGC sticker system — any-surface decals, Nostr-published library, multiplayer sync | Accepted |
| [0095](./0095-settings-click-propagation-fix.md) | Settings panel action buttons were dead — removed the card's `stopPropagation` | Accepted |

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
