// engine/character/meshGenerationMock.js — the LOCAL mock "generator" for the
// "Create with AI" flow (Step B of the character-creation plan). Pure, node-safe.
//
// This is the mock-it-out slice: it proves the full create-with-AI UI loop
// (prompt → generate → validate → verdict) with ZERO network, payment, or
// signing. It composes the REAL seams — planGeneration() builds/validates the
// request, then validateGeneratedMesh() gates a canned fixture result — so the
// only thing "mocked" is the external generator's returned mesh + bone list.
// When Step C lands (a real Meshy/Tripo fetcher + routstr/Cashu charge), this
// module is deleted and the host injects a real generator client instead.
//
// The canned fixture is a generic-humanoid (Meshy-style) rig — the same
// convention emitted by Meshy auto-rig output and the Unreal Mannequin — plus a
// manifest whose mesh.hash is a DETERMINISTIC 64-hex string derived from the
// prompt (NOT a real Blossom sha256; clearly a fixture). It passes the gate, so
// the demo shows the "accepted" path; tests pass `fixtureBoneNames` /
// `fixtureManifest` overrides to exercise the rejected path deterministically.

import { planGeneration, validateGeneratedMesh } from './meshGeneration.js';

export const MESH_GENERATION_MOCK_VERSION = 1;

// Default mock backend — text-to-3D direct (the recommended cheaper v1 path;
// Meshy is the text-to-3d vendor).
export const MOCK_BACKEND = 'meshy';

// The canned riggable fixture: the generic-humanoid / Meshy-style bone list,
// which maps every required Torii role (see skeleton.js GENERIC_HUMANOID_BONE_MAP).
export const MOCK_BONE_NAMES = Object.freeze([
  'Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head',
  'LeftShoulder', 'RightShoulder',
  'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
  'LeftHand', 'RightHand',
  'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
  'LeftFoot', 'RightFoot',
  'LeftToeBase', 'RightToeBase',
]);

// _fnv1a(str) — a tiny deterministic 32-bit string hash (FNV-1a). Not crypto —
// used only to derive a stable, testable 64-hex fixture id from a prompt.
function _fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// mockSha256(prompt) → a deterministic 64-hex string (NOT a real sha256 — a
// fixture). 8 salted FNV-1a passes → 8 × 8 hex = 64 hex chars, so it satisfies
// the manifest validator's isSha256() shape check while being clearly synthetic.
export function mockSha256(prompt) {
  const p = typeof prompt === 'string' ? prompt : '';
  const parts = [];
  for (let i = 0; i < 8; i += 1) {
    parts.push(_fnv1a(`${i}:${p}`).toString(16).padStart(8, '0'));
  }
  return parts.join('');
}

// mockNameForPrompt(prompt) → a short, safe character name derived from the
// prompt (up to ~4 words / 28 chars). Falls back to a generic label.
export function mockNameForPrompt(prompt) {
  const p = typeof prompt === 'string' ? prompt.trim() : '';
  if (!p) return 'AI Character';
  const words = p.split(/\s+/);
  const label = words.length <= 4 ? p : `${words.slice(0, 4).join(' ')}…`;
  return label.length <= 28 ? label : `${label.slice(0, 27).trimEnd()}…`;
}

// mockManifestForPrompt(prompt, opts) → a valid-shaped `torii.character`
// manifest whose mesh.hash is the deterministic fixture id. opts.name overrides.
export function mockManifestForPrompt(prompt, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  return {
    version: 1,
    mesh: { hash: mockSha256(prompt), name: 'mock-ai-character.glb' },
    clips: [],
    stickers: [],
    name: (typeof o.name === 'string' && o.name) ? o.name : mockNameForPrompt(prompt),
    colors: [],
    contrib: [],
  };
}

// mockGenerationResult(prompt, opts) → the canned "generator returned" normalised
// result (the shape a real createGeneratorClient would produce). opts.fixtureBoneNames
// / opts.fixtureManifest override the defaults so tests can force a rejection.
export function mockGenerationResult(prompt, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  return {
    backend: MOCK_BACKEND,
    manifest: (o.fixtureManifest && typeof o.fixtureManifest === 'object')
      ? o.fixtureManifest
      : mockManifestForPrompt(prompt, opts),
    boneNames: Array.isArray(o.fixtureBoneNames) ? o.fixtureBoneNames : MOCK_BONE_NAMES,
    downloadUrl: 'mock://ai-character.glb',
    error: null,
  };
}

// runMockGeneration(prompt, opts) → the full local mock loop. planGeneration()
// validates the prompt/backend (REAL), then a canned fixture result is gated by
// validateGeneratedMesh() (REAL). Returns either:
//   { planned:false, reason:'invalid-request', mode:'mock', verdict:null, request:null, result:null }
// or
//   { planned:true, mode:'mock', request, result, verdict }
// No network, no payment, no signing. opts.backend selects the (mock) vendor.
export function runMockGeneration(prompt, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const plan = planGeneration(prompt, { ...o, backend: o.backend || MOCK_BACKEND });
  if (!plan.planned) {
    return {
      planned: false, reason: plan.reason, mode: 'mock', request: null, result: null, verdict: null,
    };
  }
  const result = mockGenerationResult(prompt, o);
  const verdict = validateGeneratedMesh({ manifest: result.manifest, boneNames: result.boneNames });
  return { planned: true, mode: 'mock', request: plan.request, result, verdict };
}