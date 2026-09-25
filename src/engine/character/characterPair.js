import { assetUrl } from '../../assetUrl.js';
import { blossomMeshUrl } from './characterMesh.js';

// Content identity, never a display name or an operator-wide avatar default.
// These exact full GLBs already ship with Quest. Their FP variants are derived
// from those bytes by tools/headless-glb.mjs; no remote availability is required.
export const BUNDLED_CHARACTER_PAIRS = Object.freeze({
  '7aecefff9ded689a1fce5afeb8b85fd954885ad422708e2d62f51c41a14d8cc3': Object.freeze({
    full: '/models/chiefmonkey7.glb', headless: '/chiefmonkey-headless.glb',
  }),
  '0de4f645a45b5ff5a0ca334d3a905e81e1185b3554bebe5f40fdb32ea194c7c5': Object.freeze({
    full: '/models/animation-library.glb', headless: '/animation-library-headless.glb',
  }),
});

export function bundledCharacterPair(hash) {
  const pair = Object.hasOwn(BUNDLED_CHARACTER_PAIRS, hash) ? BUNDLED_CHARACTER_PAIRS[hash] : null;
  return pair ? { meshHash: hash, meshUrl: assetUrl(pair.full), headlessUrl: assetUrl(pair.headless) } : null;
}

// Resolve both views together. A failed derivative never means another
// character's feet. Legacy custom meshes retain full-body rendering while
// headless authoring is retried on the next character resolution.
export async function resolveOwnCharacterPair(manifest, { authorHeadless } = {}) {
  const hash = manifest?.mesh?.hash;
  const bundled = bundledCharacterPair(hash);
  if (bundled) return bundled;
  const meshUrl = blossomMeshUrl(hash);
  if (!meshUrl) return { meshHash: null, meshUrl: null, headlessUrl: null };
  let headlessUrl = blossomMeshUrl(manifest.mesh.headlessHash);
  if (!headlessUrl && authorHeadless) {
    try {
      const result = await authorHeadless({ meshUrl });
      if (result?.ok) headlessUrl = result.url || null;
    } catch { /* no mismatched built-in substitute */ }
  }
  return { meshHash: hash, meshUrl, headlessUrl };
}

// The upload and AI paths use the SAME input file for the full upload and
// derivative creation. Do not publish a new character with only half a pair.
export async function uploadCharacterPair(file, { authorHeadless, upload }) {
  const derived = await authorHeadless(file);
  if (!derived?.ok || !derived.blob) {
    return { ok: false, error: derived?.error || 'headless-authoring-failed' };
  }
  const full = await upload(file);
  if (!full?.ok) return { ok: false, error: full?.error || 'mesh-upload-failed' };
  const headless = await upload(derived.blob);
  if (!headless?.ok || headless.sha256 !== derived.sha256) {
    return { ok: false, error: headless?.error || 'headless-upload-failed' };
  }
  return { ok: true, mesh: { hash: full.sha256, name: file.name || 'custom.glb', headlessHash: headless.sha256 } };
}
