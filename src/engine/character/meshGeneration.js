// engine/character/meshGeneration.js — the validator-gated external mesh
// generation orchestration seam. Pure, node-safe.
//
// ADR-0082 committed to a validator-first pipeline: we do NOT build a generator,
// we orchestrate external ones (Meshy/Tripo/Hunyuan3D) and gate their output.
// This module is the "gate" slice of that: it models the generators we
// orchestrate, builds a generation request/plan, and — the critical part —
// VALIDATES a returned mesh before it may enter the pipeline. A generated mesh
// only passes when BOTH the `torii.character` manifest is structurally valid AND
// the skeleton's bone names are auto-riggable onto the canonical Torii skeleton
// (rigAssessment.js).
//
// Deliberately NOT here: network calls, payment (routstr/Cashu), signing, and
// the live generator clients — those are host concerns. This is the seam the
// host calls after a generator returns: validateGeneratedMesh() is the gate.
// See ADR-0087.

import { validateCharacterManifest } from './characterManifest.js';
import { assessRig } from './rigAssessment.js';

export const MESH_GENERATION_VERSION = 1;

// The external generators we orchestrate (swappable — this is the whole point
// of the validator-first contract). `requiresPayment: true` reflects that every
// call routes through routstr + cashu.me rather than a free tier.
export const GENERATION_BACKENDS = Object.freeze([
  Object.freeze({ id: 'meshy',    label: 'Meshy',    kind: 'text-to-3d',  requiresPayment: true }),
  Object.freeze({ id: 'tripo',    label: 'Tripo',    kind: 'image-to-3d', requiresPayment: true }),
  Object.freeze({ id: 'hunyuan3d', label: 'Hunyuan3D', kind: 'text-to-3d', requiresPayment: true }),
]);

// Long prompts risk prompt-injection + runaway cost; cap them at build time.
export const MAX_PROMPT_LENGTH = 400;

// getGenerationBackend(id) → the backend descriptor, or null.
export function getGenerationBackend(id) {
  return (typeof id === 'string' && GENERATION_BACKENDS.find((b) => b.id === id)) || null;
}

// buildGenerationRequest(prompt, opts) → a normalised request, or null when the
// prompt is empty/too long or the backend is unknown. `opts.image` (an https
// source URL for image-to-3d backends) and `opts.style` are optional hints.
export function buildGenerationRequest(prompt, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const p = typeof prompt === 'string' ? prompt.trim() : '';
  if (!p) return null;
  if (p.length > MAX_PROMPT_LENGTH) return null;
  const backend = getGenerationBackend(o.backend);
  if (!backend) return null;
  return {
    version: MESH_GENERATION_VERSION,
    prompt: p,
    backend: backend.id,
    backendLabel: backend.label,
    kind: backend.kind,
    image: typeof o.image === 'string' ? o.image : null,
    style: typeof o.style === 'string' ? o.style : null,
    options: (o.options && typeof o.options === 'object') ? o.options : {},
  };
}

// planGeneration(prompt, opts) → an INERT plan (never acts). Records that the
// generation runs through routstr (payment) and that validateGeneratedMesh()
// must accept the result before it can be seated. `performed:false` always.
export function planGeneration(prompt, opts = {}) {
  const request = buildGenerationRequest(prompt, opts);
  if (!request) return { planned: false, reason: 'invalid-request' };
  return {
    planned: true,
    request,
    route: 'routstr',           // executor + payment — host concern
    requiresPayment: true,
    gate: 'validator',          // validateGeneratedMesh() must accept the mesh
    performed: false,
  };
}

// validateGeneratedMesh(input) → the VALIDATOR GATE verdict. `input.manifest`
// is the generated `torii.character` manifest; `input.boneNames` is the
// generated mesh's bone-name list (read from the GLB). `accepted:true` requires
// BOTH a structurally valid manifest AND an auto-riggable rig. Everything else
// fails closed with reasons.
export function validateGeneratedMesh(input = {}) {
  const i = (input && typeof input === 'object') ? input : {};
  const manifest = (i.manifest && typeof i.manifest === 'object') ? i.manifest : {};
  const boneNames = Array.isArray(i.boneNames) ? i.boneNames : [];

  const man = validateCharacterManifest(manifest);
  const rig = assessRig(boneNames);

  const reasons = [];
  for (const e of man.errors) reasons.push(`manifest: ${e}`);
  for (const n of rig.notes) reasons.push(`rig: ${n}`);

  return {
    accepted: man.valid && rig.verdict === 'riggable',
    manifestValid: man.valid,
    manifestErrors: man.errors,
    rigVerdict: rig.verdict,
    rigConvention: rig.convention,
    rigBoneCount: rig.boneCount,
    reasons,
  };
}

// canAcceptMesh(input) → boolean convenience.
export function canAcceptMesh(input) {
  return validateGeneratedMesh(input).accepted;
}