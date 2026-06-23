# Torii Quest — v0.2.133-alpha Report (GAMEOVER edge · raycast cleanup · first reference component)

> Batch report for v0.2.133-alpha. This version was **reconciled onto the
> published v0.2.132 commit** (`e833c25`) so no v0.2.132 work is dropped — see
> §5 (Release-history reconciliation) for the git detail.

---

## 1. Summary

Three foundation slices, all behaviour-preserving for live gameplay:

1. **ARS-4 — real `GAMEOVER` edge.** `src/state.js` gains `GAME_EVENT.END`
   (PLAYING/DEAD → terminal GAMEOVER) plus a thin `endRun()` helper
   (`transition(END)`). GAMEOVER stays terminal (no outgoing edges). No live call
   site fires `END`, so the endless die→respawn flow is unchanged — the edge +
   helper are the named entry point for a future end-of-run screen.
2. **ARS-3 — final raycast cleanup.** The last direct `castRay` consumer, the
   read-only reticle preview (`src/targetReticle.js`), migrates to
   `raycastService.ray(...)` (collider forwarded as the `exclude` arg;
   behaviour-identical — the default service wraps the same `raycast.js`). No
   module imports `castRay` outside the service now. Injected-fake-world ray/LOS
   contract tests added.
3. **CMP-8 — first reference component.** Pure, node-safe
   `src/engine/components/toriiGateway.js` — `createToriiGateway(config)`, a
   default `toriiGateway` instance, and `GATEWAY_VERSION`, built on the v0.2.132
   `defineComponent` contract. Surfaced via the SDK `toriiGateway` namespace
   (experimental tier).

---

## 2. Changes by file

| File | Change |
|---|---|
| `src/config.js` | `VERSION` → `v0.2.133-alpha`. |
| `index.html` | `#version-label` + `#ver` → `v0.2.133-alpha`. |
| `tools/regression-check.mjs` | header + `EXPECTED_VERSION` → `v0.2.133-alpha`; stale-version guard now flags `v0.2.132-alpha`. |
| `src/state.js` | `GAME_EVENT.END`; TRANSITIONS PLAYING/DEAD gain `END:GAMEOVER`; `endRun()` helper. (v0.2.132 `isReloading`/`tickReload` preserved.) |
| `tests/state.test.js` | `endRun`/`END` GAMEOVER-edge cases. |
| `src/targetReticle.js` | reticle preview ray migrated to `raycastService.ray(...)`. |
| `tests/raycast-service.test.js` | injected-fake-world ray/LOS contract block. |
| `src/engine/components/toriiGateway.js` | NEW — reference Torii gateway skeleton component. |
| `tests/torii-gateway.test.js` | NEW — contract validity, manifest, config flow, idempotent lifecycle, SDK exposure. |
| `src/sdk/index.js` | `toriiGateway` namespace re-export + `SDK_SURFACE` entry (experimental). |
| `CODE_INDEX.md`, `COMPONENTS.md`, `HANDOFF.md`, `progress.md`, `strategy.md`, `todo.md` | v0.2.133 doc upkeep. |

---

## 3. The Torii gateway component (CMP-8)

`createToriiGateway({ npub, relay, target, position })` → a contract-valid
component (via `defineComponent`). Manifest:

- `id: 'torii.gateway'`, `name: 'Torii Gateway'`, `version: GATEWAY_VERSION`
  (`0.1.0`, independent of game VERSION).
- `author: { npub }` (provenance; a placeholder npub default so the skeleton
  satisfies the contract), `mountTarget: 'scene'`, `contract:
  COMPONENT_CONTRACT_VERSION`, `kind: 'gateway'`.
- `gateway: { npub, relay, target, position }` — the destination/placement block
  the host/loader will use once the handoff is built; per-mount `options`
  override placement at mount time.

Lifecycle is a **symmetric no-op SKELETON** — `defineComponent` tracks the
`mounted` flag and enforces idempotency, so `mount(scene, options)` / `unmount()`
stay a safe, reversible pair. **Not yet built (documented TODOs):** the
torii-gate portal mesh at `options.position`, and the n2n handoff (crossing the
gate hands the player's identity off to the destination node via `npub`/`relay`,
wiring `src/world/handoff.js`). Depends on the loader (CMP-7).

---

## 4. Verification

- `npm run build` — clean.
- `npm run check` — all 11 regression guardrails GREEN (`[5]` version markers ==
  `v0.2.133-alpha`; `[11]` 17 test files).
- `npm test` — **200 passed / 17 files**.

---

## 5. Release-history reconciliation

The local workspace HEAD was detached at `55702e7` (v0.2.131) with the v0.2.133
work uncommitted, while the published `v0.2.132` commit (`e833c25`) existed at
FETCH_HEAD but not in the working tree. To avoid dropping v0.2.132 work:

1. The original v0.2.131-based v0.2.133 work was committed to a preservation
   branch (`v0.2.133-wip`).
2. A fresh `v0.2.133` branch was created **from the published `e833c25`
   (v0.2.132)**, and only the unique v0.2.133 changes were reapplied on top.
3. Where the earlier draft diverged from v0.2.132's published API (an alternate
   component contract + a parallel COMPONENTS approach), the **v0.2.132 published
   versions were kept** (`src/engine/components/contract.js`, `COMPONENTS.md`,
   `tests/component.test.js`, `torii-v0.2.132-infrastructure-report.md`); the
   gateway component + tests were rewritten against v0.2.132's `defineComponent`
   API. This supersede is intentional and documented (see `COMPONENTS.md`).

Result: the `v0.2.133` branch has parent `e833c25`, so all v0.2.132 work is
retained in history, and the final version is `v0.2.133-alpha`.

---

## 6. Next

- Manual smoke test on real hardware (TQ-MANUAL-113), then publish — a separate
  manual maintainer/main-agent step. **No deploy/publish/push/upload performed by
  this task.**
- CMP-8 continuation: portal mesh + n2n handoff (depends on the loader, CMP-7).
- ARS-4 continuation: fire `endRun()` from an actual end-of-run screen.
