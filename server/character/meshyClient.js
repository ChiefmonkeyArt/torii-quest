// server/character/meshyClient.js — the Meshy REST client for the server-side
// "Create with AI" proxy (Step C of the character-creation plan, ADR-0091).
//
// Replaces the LOCAL mock (meshGenerationMock.js) with a real live generator:
//   text-to-3d (preview → refine) → rigging (auto-rig) → rigged GLB URL.
// The client is PURE and injectable (fetch + sleep are passed in as opts) so the
// orchestration is unit-testable with a mock fetch — no network in tests.
//
// The key is NEVER sent to the browser: the host reads MESHY_API_KEY server-side
// and this module runs only in the Node WS/HTTP server (server/arena-ws.js).

export const MESHY_API_BASE = 'https://api.meshy.ai/openapi';

export const CREATED_STATUSES = { SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELED: 'CANCELED' };

const BACKOFF_BASE = 2000;

// _normOpts(opts) → a resolved client options object with sane defaults.
// opts.fetch — injectable fetch (default globalThis.fetch); opts.sleep — injectable
// delay (default Promise-based timeout); opts.apiKey — required; opts.baseUrl.
function _normOpts(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('Meshy client opts are required');
  if (!opts.apiKey) throw new Error('Meshy client requires opts.apiKey');
  return {
    apiKey: opts.apiKey,
    fetch: opts.fetch || (typeof fetch === 'function' ? fetch : undefined),
    sleep: opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    baseUrl: (opts.baseUrl || MESHY_API_BASE).replace(/\/+$/, ''),
  };
}

// _request(opts, path, init?) → parsed JSON body (throws on non-2xx).
async function _request(opts, path, init = {}) {
  if (!opts.fetch) throw new Error('Meshy client requires opts.fetch (no global fetch)');
  const res = await opts.fetch(`${opts.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const txt = await res.text();
  let body = null;
  if (txt) { try { body = JSON.parse(txt); } catch { body = null; } }
  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || txt.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`Meshy ${res.status}: ${msg}`);
  }
  return body;
}

// createTextTo3D(opts, { mode, prompt, previewTaskId, ...fields }) → the task id.
// mode 'preview' needs prompt; mode 'refine' needs previewTaskId (mapped to the
// snake_case preview_task_id Meshy expects).
export async function createTextTo3D(opts, { mode, prompt, previewTaskId, ...fields }) {
  const o = _normOpts(opts);
  if (mode !== 'preview' && mode !== 'refine') throw new Error('createTextTo3D requires mode preview|refine');
  if (mode === 'preview' && !prompt) throw new Error('createTextTo3D requires a prompt for preview mode');
  const body = { mode, target_formats: ['glb'], ...fields };
  if (mode === 'preview') body.prompt = prompt;
  if (mode === 'refine') body.preview_task_id = previewTaskId;
  const res = await _request(o, '/v2/text-to-3d', { method: 'POST', body: JSON.stringify(body) });
  return (res && res.result) || null;
}

// getTask(opts, id) → the polled task object (status + model_urls when done).
export async function getTask(opts, id) {
  const o = _normOpts(opts);
  if (!id) throw new Error('getTask requires a task id');
  return _request(o, `/v2/text-to-3d/${encodeURIComponent(id)}`);
}

// createRigTask(opts, { inputTaskId, heightMeters }) → the rigging task id.
// inputTaskId is a SUCCEEDED, TEXTURED text-to-3d task (the refine task).
export async function createRigTask(opts, { inputTaskId, heightMeters = 1.8 } = {}) {
  const o = _normOpts(opts);
  if (!inputTaskId) throw new Error('createRigTask requires inputTaskId');
  const body = await _request(o, '/v1/rigging', {
    method: 'POST',
    body: JSON.stringify({ input_task_id: inputTaskId, height_meters: heightMeters }),
  });
  return (body && body.result) || null;
}

// getRigTask(opts, id) → the polled rigging task object.
export async function getRigTask(opts, id) {
  const o = _normOpts(opts);
  if (!id) throw new Error('getRigTask requires a task id');
  return _request(o, `/v1/rigging/${encodeURIComponent(id)}`);
}

// waitForTask(opts, get, id, {timeoutMs, intervalMs}) → the terminal task object.
// `get` is getTask or getRigTask. Throws on timeout or FAILED/CANCELED. Bounds
// are explicit (a hung upstream task must not wedge the server request forever).
export async function waitForTask(opts, get, id, { timeoutMs = 180000, intervalMs = 3000 } = {}) {
  const o = _normOpts(opts);
  const deadline = Date.now() + timeoutMs;
  let delay = intervalMs;
  while (Date.now() < deadline) {
    const task = await get(o, id);
    const s = task && task.status;
    if (s === 'SUCCEEDED') return task;
    if (s === 'FAILED' || s === 'CANCELED') {
      const msg = (task && task.task_error && task.task_error.message) || s;
      throw new Error(`Meshy task ${s}: ${msg}`);
    }
    await o.sleep(delay);
    delay = Math.min(delay + BACKOFF_BASE, 15000);
  }
  throw new Error('Meshy task timed out');
}

// riggedGlbUrl(task) → the rigged GLB download URL from a SUCCEEDED rigging task,
// or null. Tolerant of Meshy's evolving field naming (model_urls.glb is canonical;
// rigged_character_glb appears in some wrapper/aggregator schemas).
export function riggedGlbUrl(task) {
  if (!task || typeof task !== 'object') return null;
  const urls = task.model_urls || {};
  const cand = urls.glb || urls.rigged_character_glb || task.rigged_model_urls?.glb
    || (typeof task.rigged_character_glb === 'string' ? task.rigged_character_glb : null);
  return cand || null;
}

// generateCharacterGlb(opts, prompt, { heightMeters }) → the rigged-GLB URL for a
// HUMAN character from a prompt. Orchestrates preview → refine → rig, polling each
// to completion. This is the single seam the route calls.
export async function generateCharacterGlb(opts, prompt, { heightMeters = 1.8 } = {}) {
  const o = _normOpts(opts);

  const previewId = await createTextTo3D(o, { mode: 'preview', prompt });
  if (!previewId) throw new Error('Meshy preview did not return a task id');
  await waitForTask(opts, getTask, previewId);

  const refineId = await createTextTo3D(o, { mode: 'refine', previewTaskId: previewId });
  if (!refineId) throw new Error('Meshy refine did not return a task id');
  await waitForTask(opts, getTask, refineId);

  const rigId = await createRigTask(o, { inputTaskId: refineId, heightMeters });
  if (!rigId) throw new Error('Meshy rigging did not return a task id');
  const rigTask = await waitForTask(opts, getRigTask, rigId);

  const url = riggedGlbUrl(rigTask);
  if (!url) throw new Error('Meshy rigging succeeded but returned no rigged GLB URL');
  return url;
}