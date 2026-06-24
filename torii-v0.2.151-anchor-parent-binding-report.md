# Torii Quest — v0.2.151-alpha report

## Slice: anchor↔scene-graph parent binding for the display-only proof-surface boards

Makes the in-world proof-surface board mounting (added in v0.2.150) **explicit,
discoverable, and testable**, with **zero gameplay change** and **no visual change**.

---

## What changed

### New — pure binding contract (node-testable, no THREE/DOM)
`src/engine/world/proofSurfaceParentBinding.js`
- `PARENT_BINDING_BADGE = 'PARENT-BINDING · SCENE-GRAPH · NO RENDER'`
- `PROOF_SURFACE_GROUP = 'proof-surfaces'` (the root group name)
- `PARENT_NODE_NAMES` — frozen map of parent hint → live scene-graph node name
  (`torii-gate` → `torii-gate`, `nap-zone-floor` → `nap-zone-floor`)
- `parentNodeName(parent)` → live node name or `null`
- `parentGroupName(parent)` → `proof-surfaces::<parent>` (per-parent subgroup name)
- `resolveParentBindings(plan)` → groups each panel under its `parent` hint
  (falling back to the anchor registry via `getAnchor` when a panel omits `parent`),
  lists any `unbound` panels, returns
  `{ badge, group, count, ok, groups, unbound, rendered:false, actionable:false }`.
  Deterministic, JSON-serialisable. Imports only `getAnchor` from
  `anchorTransforms.js` — no THREE, no DOM, no renderer.

### Modified — render plan is now self-describing
`src/engine/world/proofSurfaceRenderPlan.js`
- Each panel now carries `parent` (the scene-graph parent hint), alongside `anchor`.

### Modified — mesh adapter mounts boards into named subgroups
`src/engine/world/proofSurfaceMeshes.js`
- Builds one **named `THREE.Group` subgroup per parent** under the `proof-surfaces`
  root and mounts each board into its parent's subgroup.
- **Boards keep their WORLD positions**; subgroups sit at identity. This is a
  **structural / discoverability change only — no visual change.**
- `surfaceRender()` state now includes a `parents[]` breakdown.

### Modified — live nodes are named for discoverability
`src/arena.js`
- `napFloor.name = 'nap-zone-floor'`, and `torii-gate` on both the fallback gate and
  the async-loaded GLB gate, so `scene.getObjectByName(...)` can find them.

### Modified — read-only debug shell
`src/engine/debug/toriiDebug.js`
- Added `ToriiDebug.shells.surfaceBindings()` →
  `resolveParentBindings(buildProofSurfaceRenderPlan(opts))`. Read-only, safe.

---

## Critical safety decision

Boards are **NOT physically re-parented** onto the live nodes. The `nap-zone-floor`
is rotated −π/2 on X and the `torii-gate` GLB loads asynchronously; re-parenting the
boards onto either would rotate/break them or race the load. Instead the binding is a
**structural contract** (named per-parent subgroups under a `proof-surfaces` root,
boards keep world positions) plus **named live nodes** for discoverability. This keeps
the change surgical and preserves current game behavior exactly.

---

## Safety / constraints honored
- godMode = `false`; no new `setTimeout` (allowlist unchanged).
- No new `Vector3`/`Matrix4` in hot paths; subgroup creation is setup-time only.
- Boards remain **display-only / inert**: no click handlers, no raycast interactions,
  no navigation, no payments, no Nostr signing/publishing, no live fetch/WebSocket.
- Current game behavior preserved; no visual change.
- `ToriiDebug.shells.surfaceBindings()` is read-only and pure.

---

## Tests & checks
- New `tests/proof-surface-parent-binding.test.js` (9 tests): name maps, live-plan
  binding into `torii-gate` + `nap-zone-floor` in order, id partition, determinism +
  JSON + no forbidden keys, anchor-registry fallback, and safe degradation
  (unknown anchor → unbound; null/empty plan no throw).
- `tests/proof-surface-render-plan.test.js`: asserts every panel carries `parent`.
- **`npm test` GREEN — 445 tests / 40 files.**
- **`npm run check` GREEN — 11/11 guardrails** (after build, dist markers verified).

---

## Files touched
- `src/engine/world/proofSurfaceParentBinding.js` (new)
- `src/engine/world/proofSurfaceRenderPlan.js`
- `src/engine/world/proofSurfaceMeshes.js`
- `src/engine/debug/toriiDebug.js`
- `src/arena.js`
- `tests/proof-surface-parent-binding.test.js` (new)
- `tests/proof-surface-render-plan.test.js`
- version markers: `src/config.js`, `package.json`, `index.html`, `tools/regression-check.mjs`
- docs: `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`

## Next safe slice (suggested)
Fold `surfaceRender().ok` / `surfaceBindings().ok` into the promotion-review checklist
and `tools/regression-check.mjs`; only once promotion is sanctioned, the first live
proof-surface read.

---

*Committed locally on branch `v0.2.151` with a `feat(v0.2.151): ...` message.
NOT pushed/published — parent agent will verify, security review, deploy, publish,
push, and sync docs.*
