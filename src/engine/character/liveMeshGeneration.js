// engine/character/liveMeshGeneration.js — client-side wrapper around the
// POST /mp/mesh/generate endpoint (v0.2.784-alpha, Step C of ADR-0091). This is
// the REAL text-to-3d path: the browser sends a prompt, the server runs Meshy
// (text-to-3d → refine → auto-rig) against the OPERATOR's key, and returns the
// rigged GLB download URL. The browser then downloads the GLB and feeds it into
// the existing validator-first upload pipeline (glbInspect → assessRig → Blossom
// NIP-98), exactly like a .glb upload.
//
// The Meshy key never reaches the browser. Pure at the edges (fetch,
// sessionStorage) but every edge is INJECTABLE, so this stays unit-testable with
// fakes. Never throws.

import { resolveMpHttpBase, getStoredToken } from '../multiplayer/sessionAuth.js';
import { MAX_PROMPT_LENGTH } from './meshGeneration.js';

/**
 * requestMeshGeneration(prompt, opts) → Promise<{ok, glbUrl, error, detail}>
 *
 * @param {string} prompt — the character description (non-empty, ≤ MAX_PROMPT_LENGTH).
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]   default globalThis.fetch
 * @param {string}       [opts.httpBase]    override the WS-derived base
 * @param {string}       [opts.token]       override the stored session bearer
 */
export async function requestMeshGeneration(prompt, opts = {}) {
  const out = { ok: false, glbUrl: null, error: null, detail: null };

  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof fetchImpl !== 'function') { out.error = 'fetch-unavailable'; return out; }

  const p = typeof prompt === 'string' ? prompt.trim() : '';
  if (!p) { out.error = 'prompt-required'; return out; }
  if (p.length > MAX_PROMPT_LENGTH) { out.error = 'prompt-too-long'; return out; }

  const httpBase = typeof opts.httpBase === 'string' && opts.httpBase
    ? opts.httpBase
    : resolveMpHttpBase();
  if (typeof httpBase !== 'string' || !httpBase) { out.error = 'no-http-base'; return out; }

  const token = typeof opts.token === 'string' && opts.token ? opts.token : getStoredToken();
  if (typeof token !== 'string' || !token) { out.error = 'no-session-token'; return out; }

  let res;
  try {
    res = await fetchImpl(`${httpBase}/mesh/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: p }),
    });
  } catch { out.error = 'network-failed'; return out; }
  if (!res) { out.error = 'no-response'; return out; }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON — leave null */ }

  if (!res.ok) {
    out.error = (body && body.error) || `http-${res.status}`;
    out.detail = (body && body.detail) || null;
    return out;
  }

  const glbUrl = body && typeof body.glbUrl === 'string' ? body.glbUrl : null;
  if (!glbUrl) { out.error = 'no-glb-url'; return out; }
  out.ok = true;
  out.glbUrl = glbUrl;
  return out;
}