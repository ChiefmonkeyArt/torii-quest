// tests/meshy-client.test.js — the server-side Meshy client (server/character/
// meshyClient.js) exercised against a scripted mock fetch. No network.

import { describe, it, expect } from 'vitest';
import {
  createTextTo3D,
  getTask,
  createRigTask,
  createRemeshTask,
  getRemeshTask,
  waitForTask,
  riggedGlbUrl,
  generateCharacterGlb,
  MESHY_API_BASE,
  REMESH_TARGET_POLYCOUNT,
} from '../server/character/meshyClient.js';

// scriptedFetch(routes, log) → a mock fetch. `routes` is a list of
// { match: (method, path) => bool, respond: object|fn, status?: int }.
// `log` (optional array) records every call {method, path, headers, body}.
function scriptedFetch(routes, log) {
  const calls = log || [];
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/openapi(?=\/)/, '');
    calls.push({ method, path, headers: init.headers || {}, body: init.body });
    const route = routes.find((r) => r.match(method, path, init));
    if (!route) {
      return { ok: false, status: 404, text: async () => '{"message":"not found"}' };
    }
    const body = (typeof route.respond === 'function')
      ? route.respond(method, path, init)
      : route.respond;
    const status = route.status || 200;
    return {
      ok: status < 400,
      status,
      text: async () => (body == null ? '' : JSON.stringify(body)),
    };
  };
}

const noSleep = () => Promise.resolve();

const fullHappyRoutes = () => [
  { match: (m, p, init) => m === 'POST' && p === '/v2/text-to-3d' && JSON.parse(init.body).mode === 'preview',
    respond: { result: 'preview-1' } },
  { match: (m, p) => m === 'GET' && p === '/v2/text-to-3d/preview-1',
    respond: { id: 'preview-1', status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/p.glb' } } },
  { match: (m, p, init) => m === 'POST' && p === '/v2/text-to-3d' && JSON.parse(init.body).mode === 'refine',
    respond: { result: 'refine-1' } },
  { match: (m, p) => m === 'GET' && p === '/v2/text-to-3d/refine-1',
    respond: { id: 'refine-1', status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/r.glb' } } },
  { match: (m, p) => m === 'POST' && p === '/v1/remesh',
    respond: { result: 'remesh-1' } },
  { match: (m, p) => m === 'GET' && p === '/v1/remesh/remesh-1',
    respond: { id: 'remesh-1', status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/remeshed.glb' } } },
  { match: (m, p) => m === 'POST' && p === '/v1/rigging',
    respond: { result: 'rig-1' } },
  { match: (m, p) => m === 'GET' && p === '/v1/rigging/rig-1',
    respond: { id: 'rig-1', status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/rigged.glb' } } },
];

describe('createTextTo3D / getTask / createRigTask', () => {
  it('sends the Bearer auth header and returns the task id', async () => {
    const log = [];
    await createTextTo3D({ apiKey: 'k123', fetch: scriptedFetch([
      { match: (m, p) => m === 'POST' && p === '/v2/text-to-3d', respond: { result: 'abc' } },
    ], log), sleep: noSleep }, { mode: 'preview', prompt: 'a frog knight' });

    expect(log[0].headers.Authorization).toBe('Bearer k123');
    expect(log[0].headers['Content-Type']).toBe('application/json');
    const sent = JSON.parse(log[0].body);
    expect(sent.mode).toBe('preview');
    expect(sent.prompt).toBe('a frog knight');
    expect(sent.target_formats).toEqual(['glb']);
  });

  it('throws on a non-2xx response', async () => {
    const client = { apiKey: 'k', fetch: scriptedFetch([
      { match: (m) => m === 'POST', respond: { message: 'bad key' }, status: 401 },
    ]), sleep: noSleep };
    await expect(createTextTo3D(client, { mode: 'preview', prompt: 'x' }))
      .rejects.toThrow(/Meshy 401/);
  });

  it('requires an api key', async () => {
    await expect(createTextTo3D({}, { mode: 'preview', prompt: 'x' })).rejects.toThrow(/apiKey/);
  });
});

describe('createRigTask', () => {
  it('posts input_task_id + height_meters', async () => {
    const log = [];
    const id = await createRigTask({ apiKey: 'k', fetch: scriptedFetch([
      { match: (m, p) => m === 'POST' && p === '/v1/rigging', respond: { result: 'rig-9' } },
    ], log), sleep: noSleep }, { inputTaskId: 'refine-1', heightMeters: 2.0 });
    expect(id).toBe('rig-9');
    const sent = JSON.parse(log[0].body);
    expect(sent.input_task_id).toBe('refine-1');
    expect(sent.height_meters).toBe(2.0);
  });
});

describe('createRemeshTask', () => {
  it('posts input_task_id + target_polycount (defaults to the roster budget)', async () => {
    const log = [];
    const id = await createRemeshTask({ apiKey: 'k', fetch: scriptedFetch([
      { match: (m, p) => m === 'POST' && p === '/v1/remesh', respond: { result: 'remesh-9' } },
    ], log), sleep: noSleep }, { inputTaskId: 'refine-1' });
    expect(id).toBe('remesh-9');
    const sent = JSON.parse(log[0].body);
    expect(sent.input_task_id).toBe('refine-1');
    expect(sent.target_polycount).toBe(REMESH_TARGET_POLYCOUNT);
    expect(REMESH_TARGET_POLYCOUNT).toBe(90000);
  });

  it('honours an explicit targetPolycount (and stays under the 320k rig ceiling)', async () => {
    const log = [];
    await createRemeshTask({ apiKey: 'k', fetch: scriptedFetch([
      { match: (m, p) => m === 'POST' && p === '/v1/remesh', respond: { result: 'remesh-9' } },
    ], log), sleep: noSleep }, { inputTaskId: 'refine-1', targetPolycount: 150000 });
    const sent = JSON.parse(log[0].body);
    expect(sent.target_polycount).toBe(150000);
    expect(sent.target_polycount).toBeLessThan(320000);
  });

  it('requires an input task id', async () => {
    await expect(createRemeshTask({ apiKey: 'k', fetch: scriptedFetch([]), sleep: noSleep }, {}))
      .rejects.toThrow(/inputTaskId/);
  });
});

describe('waitForTask', () => {
  it('returns the SUCCEEDED task, polling IN_PROGRESS first', async () => {
    let n = 0;
    const fetchImpl = scriptedFetch([
      { match: (m) => m === 'GET', respond: () => (
        (n += 1) < 2 ? { status: 'IN_PROGRESS' } : { status: 'SUCCEEDED', model_urls: { glb: 'u' } }) },
    ]);
    const task = await waitForTask({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep }, getTask, 'x', { timeoutMs: 5000, intervalMs: 1 });
    expect(task.status).toBe('SUCCEEDED');
    expect(n).toBe(2);
  });

  it('throws on FAILED with the task error message', async () => {
    const fetchImpl = scriptedFetch([
      { match: (m) => m === 'GET', respond: { status: 'FAILED', task_error: { message: 'pose estimation failed' } } },
    ]);
    await expect(waitForTask({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep }, getTask, 'x'))
      .rejects.toThrow(/pose estimation failed/);
  });
});

describe('riggedGlbUrl', () => {
  it('reads model_urls.glb', () => {
    expect(riggedGlbUrl({ model_urls: { glb: 'https://a/rigged.glb' } })).toBe('https://a/rigged.glb');
  });
  it('tolerates rigged_character_glb (wrapper schemas)', () => {
    expect(riggedGlbUrl({ model_urls: { rigged_character_glb: 'https://b/r.glb' } })).toBe('https://b/r.glb');
    expect(riggedGlbUrl({ rigged_character_glb: 'https://c/r.glb' })).toBe('https://c/r.glb');
  });
  it('returns null when absent', () => {
    expect(riggedGlbUrl({ model_urls: {} })).toBe(null);
    expect(riggedGlbUrl(null)).toBe(null);
  });
});

describe('generateCharacterGlb', () => {
  it('orchestrates preview → refine → remesh → rig and returns the rigged GLB URL', async () => {
    const log = [];
    const url = await generateCharacterGlb(
      { apiKey: 'k', fetch: scriptedFetch(fullHappyRoutes(), log), sleep: noSleep },
      'a cartoon astronaut',
      { heightMeters: 1.7 },
    );
    expect(url).toBe('https://assets.meshy.ai/rigged.glb');
    // sequence: preview → refine → REMESH → rig (each POST then GET)
    const steps = log.map((c) => `${c.method} ${c.path}`);
    expect(steps).toEqual([
      'POST /v2/text-to-3d', 'GET /v2/text-to-3d/preview-1',
      'POST /v2/text-to-3d', 'GET /v2/text-to-3d/refine-1',
      'POST /v1/remesh', 'GET /v1/remesh/remesh-1',
      'POST /v1/rigging', 'GET /v1/rigging/rig-1',
    ]);
    // refine carries the preview id; remesh carries the refine id and the roster
    // poly budget; rig carries the remesh id (NOT the refine id — the decimated model).
    const refineBody = JSON.parse(log[2].body);
    expect(refineBody.preview_task_id).toBe('preview-1');
    const remeshBody = JSON.parse(log[4].body);
    expect(remeshBody.input_task_id).toBe('refine-1');
    expect(remeshBody.target_polycount).toBe(REMESH_TARGET_POLYCOUNT);
    const rigBody = JSON.parse(log[6].body);
    expect(rigBody.input_task_id).toBe('remesh-1');
    expect(rigBody.height_meters).toBe(1.7);
  });

  it('reports each stage through the injected onStage callback', async () => {
    const stages = [];
    await generateCharacterGlb(
      { apiKey: 'k', fetch: scriptedFetch(fullHappyRoutes()), sleep: noSleep },
      'a cartoon astronaut',
      { onStage: (s) => stages.push(s) },
    );
    expect(stages).toEqual(['preview', 'refine', 'remesh', 'rig', 'done']);
  });

  it('throws when rigging succeeds but returns no GLB URL', async () => {
    const routes = fullHappyRoutes().map((r) => (
      r.match('GET', '/v1/rigging/rig-1')
        ? { ...r, respond: { id: 'rig-1', status: 'SUCCEEDED', model_urls: {} } }
        : r
    ));
    await expect(generateCharacterGlb(
      { apiKey: 'k', fetch: scriptedFetch(routes), sleep: noSleep }, 'x',
    )).rejects.toThrow(/no rigged GLB URL/);
  });

  it('throws (fail-closed) when remesh returns no task id', async () => {
    const routes = fullHappyRoutes().map((r) => (
      r.match('POST', '/v1/remesh')
        ? { ...r, respond: {} }
        : r
    ));
    await expect(generateCharacterGlb(
      { apiKey: 'k', fetch: scriptedFetch(routes), sleep: noSleep }, 'x',
    )).rejects.toThrow(/remesh did not return a task id/);
  });
});

describe('MESHY_API_BASE', () => {
  it('points at the OpenAPI root', () => {
    expect(MESHY_API_BASE).toBe('https://api.meshy.ai/openapi');
  });
});

describe('F08b — a hung request aborts (AbortSignal)', () => {
  it('rejects with "Meshy request timed out" instead of hanging forever', async () => {
    const hungFetch = (_url, init = {}) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    await expect(
      getTask({ apiKey: 'k', fetch: hungFetch, requestTimeoutMs: 30 }, 'x'),
    ).rejects.toThrow('Meshy request timed out');
  });

  it('passes an AbortSignal to fetch on every request', async () => {
    let seenSignal;
    const fetch = async (_url, init = {}) => { seenSignal = init.signal; return { ok: true, status: 200, text: async () => 'null' }; };
    await getTask({ apiKey: 'k', fetch }, 'x');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });
});