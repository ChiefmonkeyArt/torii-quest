// engine/character/liveMeshGeneration.js — client-side wrappers around the
// paid character-creation endpoints (v0.2.785-alpha). Two-phase:
//   requestMeshGeneration(prompt) → { requirePayment, invoice, amountSats, generationId }
//                                   when the server requires payment, else { ok, glbUrl }.
//   confirmMeshGeneration(generationId) → { ok, glbUrl } once the invoice has settled.
//
// The browser sends a prompt / a generation id; the server runs Meshy
// (text-to-3d → refine → auto-rig) against the OPERATOR's key only after settlement,
// and returns the rigged GLB download URL. The browser then downloads the GLB and
// feeds it into the existing validator-first upload pipeline (glbInspect →
// assessRig → Blossom NIP-98), exactly like a .glb upload.
//
// The Meshy key and the operator's lightning address never reach the browser.
// Pure at the edges (fetch, sessionStorage) but every edge is INJECTABLE, so this
// stays unit-testable with fakes. Never throws.

import { resolveMpHttpBase, getStoredToken } from '../multiplayer/sessionAuth.js';
import { MAX_PROMPT_LENGTH } from './meshGeneration.js';

/**
 * requestMeshGeneration(prompt, opts) → Promise<{
 *   requirePayment, generationId, invoice, amountSats, ok, glbUrl, error, detail
 * }>
 *
 * When the server is operator-paid (price 0/unset) it returns `{ ok, glbUrl }`.
 * When the operator charges, it returns `{ requirePayment:true, generationId,
 * invoice, amountSats }` and NO generation is performed until confirm.
 */
export async function requestMeshGeneration(prompt, opts = {}) {
  const out = {
    ok: false, requirePayment: false, glbUrl: null,
    generationId: null, invoice: null, amountSats: null, error: null, detail: null,
  };

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

  // Paid path: the server minted an invoice and is waiting on the client to pay.
  if (body && body.requirePayment === true) {
    out.requirePayment = true;
    out.generationId = (typeof body.generationId === 'string') ? body.generationId : null;
    out.invoice = (typeof body.invoice === 'string') ? body.invoice : null;
    out.amountSats = (typeof body.amountSats === 'number') ? body.amountSats : null;
    return out;
  }

  const glbUrl = body && typeof body.glbUrl === 'string' ? body.glbUrl : null;
  if (!glbUrl) { out.error = 'no-glb-url'; return out; }
  out.ok = true;
  out.glbUrl = glbUrl;
  return out;
}

/**
 * confirmMeshGeneration(generationId, opts) → Promise<{ ok, glbUrl, error, detail }>
 *
 * Asks the server to verify settlement of the previously minted invoice and, if
 * paid, run the generation for the held prompt. Fail-closed: an unpaid/expired/
 * unknown generation yields a non-ok result and no GLB URL.
 */
export async function confirmMeshGeneration(generationId, opts = {}) {
  const out = { ok: false, glbUrl: null, error: null, detail: null };

  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof fetchImpl !== 'function') { out.error = 'fetch-unavailable'; return out; }

  const gid = (typeof generationId === 'string') ? generationId.trim() : '';
  if (!gid) { out.error = 'generation-id-required'; return out; }

  const httpBase = typeof opts.httpBase === 'string' && opts.httpBase
    ? opts.httpBase
    : resolveMpHttpBase();
  if (typeof httpBase !== 'string' || !httpBase) { out.error = 'no-http-base'; return out; }

  const token = typeof opts.token === 'string' && opts.token ? opts.token : getStoredToken();
  if (typeof token !== 'string' || !token) { out.error = 'no-session-token'; return out; }

  let res;
  try {
    res = await fetchImpl(`${httpBase}/mesh/generate/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ generationId: gid }),
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