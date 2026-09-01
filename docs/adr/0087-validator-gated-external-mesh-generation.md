# ADR-0087: Character Forge — validator-gated external mesh generation

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** chiefmonkey
- **Related:** ADR-0091 (Character Forge), [`freedom-tech-stack`](concepts/freedom-tech-stack), `routstr-local-inference`

## Context

ADR-0091's pipeline orchestrates third-party generators (Meshy, Tripo,
Hunyuan3D) rather than building one in-house, and routes every generation
through routstr/Cashu. The groundwork (canonical skeleton + auto-rig assessment
+ manifest validator) is already in place as `skeleton.js`, `rigAssessment.js`,
and `characterManifest.js`.

The missing piece is the **orchestration seam that gates the generator's
output**: before any externally generated mesh may enter the pipeline (be
seated, published as a character event, charged for), it must clear BOTH the
manifest validator AND the auto-rig assessment. That gate is pure, testable, and
shippable now — independently of the live generator clients and the payment
path, which are host concerns.

## Decision

1. **Model the generators + gate, not the clients.** Add
   `src/engine/character/meshGeneration.js`: a swappable `GENERATION_BACKENDS`
   registry (Meshy / Tripo / Hunyuan3D, all `requiresPayment: true`), a
   prompt-bounded `buildGenerationRequest`, an inert `planGeneration` (routes
   through `routstr`, always `performed:false`), and `validateGeneratedMesh()`.

2. **The gate is fail-closed by construction.** `validateGeneratedMesh({
   manifest, boneNames })` accepts only when `validateCharacterManifest` is
   valid AND `assessRig(boneNames).verdict === 'riggable'`. Any manifest error
   or any rig verdict other than `riggable` (no-bones / partial /
   unknown-convention) rejects, with human-readable reasons.

3. **No network, no payment, no signing.** This slice is the seam the host calls
   *after* a generator returns. The live generator clients + routstr/Cashu
   executor are a later host slice.

## Consequences

- **Enables:** any generator's output can be judged by a single, testable gate
  before it costs sats or pollutes the pipeline; the validator-first contract is
  now executable, not just documented.
- **Forecloses:** a generator-free shortcut — every external mesh path is gated;
  an unriggable (bone-less) mesh can never be seated, per ADR-0091 v1 scope.
- **Trade-offs:** shippable seam without live generation; the actual
  text/image→mesh call is deferred to the host/routstr executor.
- **Enforcement:** `tests/character-mesh-generation.test.js` (backend registry,
  prompt bounds, inert plan, accept/reject verdicts against a full Mixamo rig,
  partial + no-bones + empty-input fail-closed); SDK exposure at the
  experimental tier.

## Alternatives considered

- **Wire a live generator client now** — rejected: needs routstr/Cashu payment
  infra and vendor auth before it can be exercised safely; the gate is the
  durable, risk-free value.
- **Accept any well-formed manifest without the rig check** — rejected: that is
  exactly the "it generated, therefore it works" trap ADR-0091 exists to avoid.

## Notes

- `validateGeneratedMesh` reuses `validateCharacterManifest` and `assessRig`
  unchanged — the gate is a composition of the two existing validators, not a
  third source of truth.
- A full Mixamo bone list is the reference "riggable" fixture in tests.