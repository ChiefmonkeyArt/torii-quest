# ADR-0089: Character Forge — live generator clients + broker seam

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** chiefmonkey
- **Related:** ADR-0087 (validator-gated external mesh generation), [`freedom-tech-stack`](concepts/freedom-tech-stack)

## Context

ADR-0087 shipped the validator gate but deliberately left the *callers* inert:
`planGeneration` returns `performed:false` and there is no client that speaks to
Meshy/Tripo/Hunyuan3D, nor an executor that sequences generator → gate →
payment. The player needs the live path — but a live path that fetches or pays
unprompted is exactly the failure mode we must never ship (runaway API cost +
NIP-60/Cashu spends).

The repo's established pattern for "live but safe by default" is the
**injected fetcher**: `githubReleaseSource` and `liveUpdateCheck` never fetch
unless a fetcher is handed in. The same seam applies to generation.

## Decision

1. **Clients build + normalise, never fetch.** Add
   `src/engine/character/meshGenerationClient.js`: `buildBackendRequest` maps a
   normalised request onto a plain backend-keyed body (per-backend
   text-to-3d / image-to-3d shapes), `normalizeBackendResponse` maps a vendor
   response onto `{ manifest, boneNames, downloadUrl, error }`, and
   `createGeneratorClient({ fetcher, backend })` exposes `generate(request)` that
   is **inert without a fetcher** (`{ performed:false }`) and issues the request
   through the injected fetcher when one is present.

2. **One executor, validation-gated, payment-injected.** Add
   `src/engine/character/meshGenerationExecutor.js`:
   `createMeshGenerationExecutor({ generate, validate, charge })` → `run(request)`
   sequences client → `validateGeneratedMesh` gate → injected `charge` (routstr
   NIP-60 / Cashu) → plan. It **never signs, publishes, or seats** — those remain
   host seams; without a `charge` step it stops at `payment-required` rather than
   inventing one.

3. **Inert by default everywhere.** No fetcher → `aborted`; no charge →
   `payment-required`. A live generation is only issued when the host injects
   both, and even then the executor only returns a plan.

## Consequences

- Live clients are real and unit-tested; no network or payment is possible in
  tests or by default.
- Routing payment through `charge` keeps routstr/Cashu an injected, swappable
  concern (validator-first stays the gate).