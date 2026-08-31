// engine/character/characterMesh.js — resolve a character's mesh to a fetchable
// Blossom URL. Pure, node-safe.
//
// The manifest references a mesh by content-addressed Blossom sha256. To actually
// LOAD that mesh into the avatar renderer (player or peer path), the runtime
// resolves the hash to a Blossom server URL (`<server>/<sha256>`) and hands it to
// the GLTFLoader. This module owns that resolution + its safety checks (hash
// shape, https-only). It is the foundation of the "automatic character mesh
// loading" slice — the read/validate seam already extracts the hash; this turns
// it into a URL the renderer can fetch.

import { isSha256 } from './characterManifest.js';

export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

// blossomMeshUrl(hash, server) → the Blossom URL for a content-addressed blob,
// or null when the hash is not a valid sha256 or the server is not https.
export function blossomMeshUrl(hash, server = DEFAULT_BLOSSOM_SERVER) {
  if (!isSha256(hash)) return null;
  const base = typeof server === 'string' ? server.trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\//i.test(base)) return null;
  return `${base}/${hash}`;
}

// resolveCharacterMeshUrl(manifest, opts) → the Blossom URL for the character's
// mesh, or null when the manifest carries no valid mesh (so the caller falls
// back to the local default avatar). `opts.server` overrides the default.
export function resolveCharacterMeshUrl(manifest, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const m = (manifest && typeof manifest === 'object') ? manifest : {};
  if (!m.mesh || typeof m.mesh !== 'object' || !m.mesh.hash) return null;
  return blossomMeshUrl(m.mesh.hash, o.server);
}
