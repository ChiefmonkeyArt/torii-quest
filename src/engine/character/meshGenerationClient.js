// engine/character/meshGenerationClient.js — injectable, inert-by-default client
// adapters for the external mesh generators (ADR-0089). Pure, node-safe: NO
// network — each adapter only BUILDS the backend-specific request and NORMALISES
// a backend response into the shape validateGeneratedMesh() consumes. The fetch
// itself crosses an injected `fetcher` (mirrors githubReleaseSource / liveUpdateCheck:
// a client never auto-fetches; without a fetcher it returns an inert result).
//
// This is the "live generator clients" start: the adapters are real and testable
// even though the actual vendor API calls are deferred to an injected fetcher +
// the host's routstr/Cashu credential path.

import { getGenerationBackend } from './meshGeneration.js';
import { validateGeneratedMesh } from './meshGeneration.js';

export const MESH_GENERATION_CLIENT_VERSION = 1;

// buildBackendRequest(backendId, request) → a plain backend-specific request
// descriptor, or null for an unknown backend / empty prompt. Never fetches.
export function buildBackendRequest(backendId, request) {
  const backend = getGenerationBackend(backendId);
  const req = (request && typeof request === 'object') ? request : null;
  if (!backend || !req || typeof req.prompt !== 'string' || !req.prompt.trim()) return null;
  const body = { prompt: req.prompt.trim() };
  if (typeof req.image === 'string' && req.image) body.image = req.image; // image-to-3d backends
  if (typeof req.style === 'string' && req.style) body.style = req.style;
  return { backend: backendId, kind: backend.kind, body };
}

// normalizeBackendResponse(backendId, payload) → a normalised generator result:
// { manifest, boneNames, downloadUrl, error } — exactly what validateGeneratedMesh
// + the executor consume. Empty/malformed payloads degrade to { error } rather
// than throw.
export function normalizeBackendResponse(backendId, payload) {
  const p = (payload && typeof payload === 'object') ? payload : {};
  const hasSomething = (p.manifest && typeof p.manifest === 'object')
    || Array.isArray(p.boneNames) || (typeof p.downloadUrl === 'string' && p.downloadUrl);
  return {
    backend: backendId,
    manifest: (p.manifest && typeof p.manifest === 'object') ? p.manifest : null,
    boneNames: Array.isArray(p.boneNames) ? p.boneNames : [],
    downloadUrl: (typeof p.downloadUrl === 'string' && p.downloadUrl) ? p.downloadUrl : null,
    error: (typeof p.error === 'string' && p.error) ? p.error : (hasSomething ? null : 'empty-response'),
  };
}

// createGeneratorClient({ fetcher, backend }) → { generate(request) }.
// With an injected `fetcher`, generate() issues the backend request and
// normalises the response; without one it returns { performed:false } (inert).
export function createGeneratorClient({ fetcher, backend } = {}) {
  return {
    async generate(request) {
      const req = buildBackendRequest(backend, request);
      if (!req) return { performed: false, reason: 'invalid-request' };
      if (typeof fetcher !== 'function') return { performed: false, reason: 'no-fetcher', request: req };
      try {
        const raw = await fetcher(req);
        return { performed: true, ...normalizeBackendResponse(backend, raw) };
      } catch (err) {
        return {
          performed: true,
          backend,
          manifest: null,
          boneNames: [],
          downloadUrl: null,
          error: String((err && err.message) || err),
        };
      }
    },
  };
}

// clientAcceptsResult(result, validator = validateGeneratedMesh) → whether a
// normalised generator result would pass the validator gate. Convenience for
// the executor + tests.
export function clientAcceptsResult(result, validator = validateGeneratedMesh) {
  const r = (result && typeof result === 'object') ? result : {};
  if (r.error) return false;
  return validator({ manifest: r.manifest, boneNames: r.boneNames }).accepted;
}