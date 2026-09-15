# ADR-0114 — Seamless single-domain travel (the "never logout" metaverse)

- **Status:** Accepted (adopted 2026-09-15; bridge = Option B in progress — single-instance shipped v0.2.846-alpha/ADR-0115, signed travel token v0.2.847-alpha/ADR-0116)
- **Related:** ADR-0115 (single-instance npub session), ADR-0116 (signed travel token)

## Context

Player feedback (2026-09-15) on the node-to-node hop, framed as five observations:

1. **Node directory identity** — the gate showed a hex-npub "serial"; should show the operator's Nostr display name + profile pic, and "less is more". *(Shipped as v0.2.845-alpha — GATEWAY-DISPLAY.)*
2. **Seamless hop** — clicking a name should land the player in the destination world, not redirect to another site + force a re-login. "In the metaverse you login and you stay logged in."
3. **The address bar is the gate** — "my domain is my torii gate … you go world to world and your domain name does not change." Never logout.
4. **Animation config parity** — a remote player's avatar ran in place; it had not picked up the same animation set as the local player.
5. **Smoothness** — the sim is persistently "sticky"; the goal is "smooth as fuck".

This ADR records the decision for **items 2 + 3** (the travel seam). Items 1 (shipped), 4, and 5 are tracked separately in the Quest todo/progress/handoff.

## Current behaviour

`_gwOpenVisit` (main.js) resolves the destination heartbeat → `world.website` → `buildVisitUrl` → `window.location.href = <hardened url>?torii-traveller=<hex64>`. That is a **top-level cross-origin navigation**: a fresh page load on the *destination's* domain, a fresh NIP-07 sign-in there, and an address bar that switches to the destination host. The single-character semantics are already correct — the exiting world calls `stopMultiplayer('travel')` before navigating, so the player holds one live socket / one roster slot at a time (their npub is the sole instance; now also server-enforced by ADR-0115).

## The vision (what "metaverse" means here)

One persistent shell. The player signs in once, on their own domain. That domain is their standing gate. Crossing a torii gate swaps *which world they are standing in* — not *which website they are on*. The address bar never changes, the session never drops, and the player's character is always exactly one instance (it leaves world A the moment it enters world B), so their genuine web-of-trust / social graph accumulates in one place.

## Options

**A — World-as-data (portal client).** The shell stays on its own domain and renders the *destination* by fetching that world's scene/state cross-origin (world manifest, spawn transform, multiplayer `wsEndpoint` — all of which the heartbeat already advertises) and connecting to the destination's arena-ws relay directly. "Entering Bekka's world" = loading her data + joining her relay, in the same tab. This is the true end state, but it is the largest lift: today a "world" is a self-contained site/build, not a remotely-addressable data surface, so it needs a cross-origin world-manifest + CORS boundary + a shared client/renderer contract that any world author can honor (the gateway protocol's "component vs protocol" split extended to scene data).

**B — Fullscreen iframe handoff.** The shell embeds the destination's `world.website` in a fullscreen same-tab iframe and forwards the already-signed identity via `postMessage` (`?torii-traveller=` → an auto-auth handshake), so the destination mounts the player with **no fresh NIP-07 prompt** while the address bar stays on the player's own domain. Character handoff = close socket A → open socket B (already the existing code path). This is the pragmatic bridge: it reuses every world's existing build unchanged, but it carries iframe costs (pointer-lock / mouse-look inside a cross-origin iframe is finicky for a 3D arena, and it still downloads the destination's whole bundle).

**C — One shared world-server / relay.** Route all worlds through a single always-on host so "worlds" are just rooms/namespaces on one socket. **Rejected** — it contradicts the sovereign self-hosted model (each world is an independently-operated VPS) and reintroduces a central rulemaker / trust root the freedom stack deliberately avoids.

## Decision

1. **A is the target, B is the bridge.** Commit to the single-shell, single-domain, never-logout model. Do not "fix" travel by merely smoothing re-authentication across navigations — that would still change the address bar and still feel like leaving the metaverse.
2. **Single character instance is non-negotiable and now server-enforced.** Close-socket-A-before-join-B is preserved, and the server additionally refuses a duplicate authed session per npub (ADR-0115, v0.2.846-alpha) so two machines cannot render the same character twice.
3. **Arrival is a first-class moment.** On landing in a destination world there is a soft "shop door bell" cue and the player appears walking out of that world's torii gate (spawn transform from the destination's gate), not teleporting into the void.
4. **Ordering:** bridge B first (iframe + `postMessage` auto-auth), then fold in A (world-as-data) as the renderer/world contract matures. Slice 1 of B — the signed travel token (identity carry) — is ADR-0116; slice 2 (iframe + `postMessage`) and slice 3 (spawn-at-gate arrival) follow.

## Rationale

- Identity is already the npub and already travels (`?torii-traveller=`), so the friction is purely the cross-origin reload + re-sign and the URL change — both addressable without inventing a new identity layer.
- The discovery model is already right: `world.website` is only a hint, the npub + heartbeat is the durable record. World-as-data simply makes `world.website` optional rather than the hop target.

## Status

Adopted. Slice 1 (signed travel token, ADR-0116) shipped v0.2.847-alpha. Item 1 shipped v0.2.845-alpha. Items 4 (animation parity) and 5 (smoothness) are separate, tracked in the Quest continuity docs.