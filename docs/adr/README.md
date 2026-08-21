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

## Workflow for a new decision

1. Copy `TEMPLATE.md` to `docs/adr/NNNN-short-slug.md` (next unused number).
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
