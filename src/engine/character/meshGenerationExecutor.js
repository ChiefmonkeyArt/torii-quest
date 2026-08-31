// engine/character/meshGenerationExecutor.js — the routstr/Cashu-brokered
// generation EXECUTOR: generator client → validator gate → (optional) payment →
// seat/publish plan. Pure, node-safe, INERT by default.
//
// This is the "live generation" seam: it composes the pieces from ADR-0087 (the
// gate) and ADR-0089 (the clients) into one run() that NEVER signs, publishes,
// seats, or relays — it returns a verdict + plan, and the host acts on an
// `accepted` result through its own sign/publish seams. Payment (routstr NIP-60 /
// Cashu) is an injected `charge` step; without it the run stops at
// `payment-required` rather than inventing a charge.

import { validateGeneratedMesh } from './meshGeneration.js';

export const MESH_GENERATION_EXECUTOR_VERSION = 1;

// createMeshGenerationExecutor({
//   generate,       // (request) → Promise<normalised generator result> (injected)
//   validate,       // (result) → gate verdict           (defaults to validateGeneratedMesh)
//   charge,         // (backend) → Promise<{ ok:boolean }> (routstr/Cashu, injected)
// }) → { run(request) }
export function createMeshGenerationExecutor({
  generate,
  validate = validateGeneratedMesh,
  charge,
} = {}) {
  const gen = typeof generate === 'function'
    ? generate
    : async () => ({ performed: false, reason: 'no-generator' });
  const val = typeof validate === 'function' ? validate : validateGeneratedMesh;

  return {
    async run(request) {
      const result = await gen(request);
      if (!result || result.performed === false) {
        return { status: 'aborted', reason: (result && result.reason) || 'generator-inert', performed: false, published: false, seated: false };
      }

      const verdict = val(result);

      if (!verdict.accepted) {
        return { status: 'rejected', verdict, performed: true, published: false, seated: false };
      }

      if (typeof charge !== 'function') {
        return { status: 'payment-required', verdict, performed: true, published: false, seated: false };
      }

      const billing = await charge(result.backend);
      if (!billing || billing.ok !== true) {
        return { status: 'payment-failed', verdict, performed: true, published: false, seated: false };
      }

      return {
        status: 'accepted',
        verdict,
        backend: result.backend,
        manifest: result.manifest,
        boneNames: result.boneNames,
        downloadUrl: result.downloadUrl,
        performed: true,
        published: false,   // host publishes through its own sign seam
        seated: false,      // host seats through its own mesh-loading seam
      };
    },
  };
}