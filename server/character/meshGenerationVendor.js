// server/character/meshGenerationVendor.js — the REAL Meshy/Tripo generator
// clients (Step C of the character-creation plan). SERVER-SIDE ONLY: these
// fetch adapters carry vendor API keys as Bearer tokens, so they must never
// run in the browser (ADR-0091 reserves the key for the host/VPS). Node-safe:
// the actual network call crosses an injected `fetchFn` (default: globalThis.fetch),
// and the API key is injected per adapter — never hardcoded and never shipped
// in client bundles. Each adapter returns the normalised shape
// { manifest, boneNames, downloadUrl, error } that validateGeneratedMesh()
// + meshGenerationExecutor consume (see meshGenerationClient.js).
//
// Endpoint grounding (verified against vendor docs, 2026-09):
//   Meshy  — POST https://api.meshy.ai/openapi/v2/text-to-3d , auth
//            `Authorization: Bearer <key>`, two-step (preview → refine),
//            `target_formats:["glb"]`, optional `pose_mode:"a-pose"`.
//   Tripo  — base https://openapi.tripo3d.ai/v3 , create-task → poll-task.
//
// NOTE: the exact Tripo task-path strings and Meshy poll path are parameterised
// as constants below so they can be corrected in one place against the vendor's
// current API surface (which changes) without touching call sites.

export const MESH_GENERATION_VENDOR_VERSION = 1;

// ── configurable endpoint surface (one place to correct against vendor docs) ──
export const VENDOR_ENDPOINTS = Object.freeze({
  meshy: Object.freeze({
    base: 'https://api.meshy.ai',
    create: '/openapi/v2/text-to-3d',
    task:   '/openapi/v2/text-to-3d/{id}',   // poll / fetch a task by id
  }),
  tripo: Object.freeze({
    base: 'https://openapi.tripo3d.ai/v3',
    create: '/task',
    task:   '/task/{id}',                     // poll task status / result
  }),
});

// authorize(headers, apiKey) — attach the vendor Bearer token. Meshy keys are
// prefixed `msy_`; Tripo keys are raw. Both use the same Bearer scheme.
function _authorize(headers, apiKey) {
  const h = { ...(headers || {}), Authorization: `Bearer ${apiKey}` };
  return h;
}

// _json(res) / _text(res) — small safe response readers.
async function _json(res) { try { return await res.json(); } catch { return {}; } }
async function _text(res) { try { return await res.text(); } catch { return ''; } }

// pollTask({ fetchFn, url, headers, isDone, readResult }) → non-throwing poll
// loop that waits for the vendor's async generation task to finish. Bounded:
// maxAttempts × pollDelayMs, so a stuck task never hangs the caller.
async function _pollTask({ fetchFn, url, headers, isDone, readResult, pollDelayMs = 2000, maxAttempts = 90 }) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await fetchFn(url, { method: 'GET', headers });
    if (!res || !res.ok) {
      const body = res ? await _text(res) : '';
      return { error: `task-poll-failed (${res ? res.status : 'n/a'}) ${body.slice(0, 200)}`.trim() };
    }
    const data = await _json(res);
    if (isDone(data)) return readResult(data);
    await new Promise((r) => setTimeout(r, pollDelayMs));
  }
  return { error: 'task-timeout' };
}

// isCompleted(obj) — helper for `status`-driven vendor shapes (SUCCEEDED etc).
function _statusDone(status) {
  return status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'SUCCESS'
    || status === 'FINISHED' || status === 'DONE';
}
function _statusFailed(status) {
  return status === 'FAILED' || status === 'FAILURE' || status === 'ERROR' || status === 'CANCELLED';
}

// ── Meshy ────────────────────────────────────────────────────────────────────
// meshyFetcher({ apiKey, fetchFn, endpoints }) → (req) => Promise<normalised>
// Composes with createGeneratorClient({ fetcher, backend:'meshy' }). `req` is
// buildBackendRequest('meshy', request) → { backend, kind, body:{prompt,image?} }.
export function meshyFetcher({ apiKey, fetchFn = globalThis.fetch, endpoints = VENDOR_ENDPOINTS.meshy } = {}) {
  if (typeof apiKey !== 'string' || !apiKey) {
    return async () => ({ manifest: null, boneNames: [], downloadUrl: null, error: 'meshy:missing-api-key' });
  }
  return async function (req) {
    const prompt = (req && req.body && typeof req.body.prompt === 'string') ? req.body.prompt.trim() : '';
    if (!prompt) return { manifest: null, boneNames: [], downloadUrl: null, error: 'invalid-prompt' };

    const headers = _authorize({ 'Content-Type': 'application/json' }, apiKey);
    const createUrl = endpoints.base + endpoints.create;
    // Text-to-3D two-step: preview (geometry) → refine (texture). For a v1 we
    // fire the preview and, on success, request the refine for a textured GLB.
    const mkBody = (mode) => ({
      mode,
      prompt,
      ...(mode === 'refine' ? {} : { should_remesh: true, pose_mode: 'a-pose', target_formats: ['glb'] }),
    });

    let res = await fetchFn(createUrl, { method: 'POST', headers, body: JSON.stringify(mkBody('preview')) });
    if (!res || !res.ok) {
      const b = res ? await _text(res) : '';
      return { manifest: null, boneNames: [], downloadUrl: null, error: `meshy:create-${res ? res.status : 'n/a'} ${b.slice(0, 200)}`.trim() };
    }
    let data = await _json(res);
    // Meshy returns { result: task_id } (task id to poll).
    let taskId = data && (data.result || data.task_id || data.id);
    if (!taskId) return { manifest: null, boneNames: [], downloadUrl: null, error: 'meshy:no-task-id' };

    const poll = await _pollTask({
      fetchFn,
      url: endpoints.base + endpoints.task.replace('{id}', String(taskId)),
      headers,
      isDone: (d) => _statusDone(d.status) || _statusFailed(d.status),
      readResult: (d) => (_statusFailed(d.status) ? { error: `meshy:task-${d.status}` } : { taskId, data: d }),
    });
    if (poll.error) return { manifest: null, boneNames: [], downloadUrl: null, error: poll.error };
    else data = poll.data;

    const urlOf = data && (data.model_url || data.glb_url || (data.result && (data.result.model_url || data.result.glb_url)));
    // Bone names aren't returned by the text-to-3D endpoint; the host resolves
    // them after downloading the GLB (torii asset pipeline). The validator's
    // auto-rig path reads them from the real mesh, not this adapter.
    return { manifest: null, boneNames: [], downloadUrl: (typeof urlOf === 'string' && urlOf) ? urlOf : null, error: null };
  };
}

// ── Tripo ────────────────────────────────────────────────────────────────────
// tripoFetcher({ apiKey, fetchFn, endpoints }) → (req) => Promise<normalised>
// Tripo is the image-to-3D (and text-to-3D) vendor. `req.body.image` may be an
// https URL or a `file_token` (uploaded via the File Upload API first). For a v1
// we accept the https URL form (the common case for the character forge).
export function tripoFetcher({ apiKey, fetchFn = globalThis.fetch, endpoints = VENDOR_ENDPOINTS.tripo } = {}) {
  if (typeof apiKey !== 'string' || !apiKey) {
    return async () => ({ manifest: null, boneNames: [], downloadUrl: null, error: 'tripo:missing-api-key' });
  }
  return async function (req) {
    const prompt = (req && req.body && typeof req.body.prompt === 'string') ? req.body.prompt.trim() : '';
    const image = req && req.body && typeof req.body.image === 'string' ? req.body.image : null;
    const type = image ? 'image_to_model' : 'text_to_model';
    const headers = _authorize({ 'Content-Type': 'application/json' }, apiKey);

    const payload = image ? { type, file: { type: 'url', url: image } } : { type, prompt };
    let res = await fetchFn(endpoints.base + endpoints.create, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res || !res.ok) {
      const b = res ? await _text(res) : '';
      return { manifest: null, boneNames: [], downloadUrl: null, error: `tripo:create-${res ? res.status : 'n/a'} ${b.slice(0, 200)}`.trim() };
    }
    const data = await _json(res);
    const taskId = data && (data.task_id || data.data || data.id);
    if (!taskId) return { manifest: null, boneNames: [], downloadUrl: null, error: 'tripo:no-task-id' };

    const poll = await _pollTask({
      fetchFn,
      url: endpoints.base + endpoints.task.replace('{id}', String(taskId)),
      headers,
      isDone: (d) => _statusDone(d.status) || _statusFailed(d.status),
      readResult: (d) => (_statusFailed(d.status) ? { error: `tripo:task-${d.status}` } : { taskId, data: d }),
    });
    if (poll.error) return { manifest: null, boneNames: [], downloadUrl: null, error: poll.error };
    const d = poll.data;
    const urlOf = d && (d.model_url || d.glb_url || (d.result && (d.result.model_url || d.result.glb_url)));
    return { manifest: null, boneNames: [], downloadUrl: (typeof urlOf === 'string' && urlOf) ? urlOf : null, error: null };
  };
}

// createVendorFetcher(backendId, opts) — pick the adapter by id. Convenience the
// host uses to wire the right vendor without importing each adapter directly.
export function createVendorFetcher(backendId, opts = {}) {
  if (backendId === 'meshy') return meshyFetcher(opts);
  if (backendId === 'tripo') return tripoFetcher(opts);
  return async () => ({ manifest: null, boneNames: [], downloadUrl: null, error: `unknown-backend:${backendId}` });
}