// tests/meshy-client.test.js — the server-side Meshy client (server/character/
// meshyClient.js) exercised against a scripted mock fetch. No network.

import { describe, it, expect } from 'vitest';
import {
  createTextTo3D,
  getTask,
  createRigTask,
  waitForTask,
  riggedGlbUrl,
  generateCharacterGlb,
  MESHY_API_BASE,
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
  it('orchestrates preview → refine → rig and returns the rigged GLB URL', async () => {
    const log = [];
    const url = await generateCharacterGlb(
      { apiKey: 'k', fetch: scriptedFetch(fullHappyRoutes(), log), sleep: noSleep },
      'a cartoon astronaut',
      { heightMeters: 1.7 },
    );
    expect(url).toBe('https://assets.meshy.ai/rigged.glb');
    // sequence: preview POST → preview GET → refine POST → refine GET → rig POST → rig GET
    const steps = log.map((c) => `${c.method} ${c.path}`);
    expect(steps).toEqual([
      'POST /v2/text-to-3d', 'GET /v2/text-to-3d/preview-1',
      'POST /v2/text-to-3d', 'GET /v2/text-to-3d/refine-1',
      'POST /v1/rigging', 'GET /v1/rigging/rig-1',
    ]);
    // refine call carries the preview task id (snake_case on the wire); rig call carries refine id
    const refineBody = JSON.parse(log[2].body);
    expect(refineBody.preview_task_id).toBe('preview-1');
    const rigBody = JSON.parse(log[4].body);
    expect(rigBody.input_task_id).toBe('refine-1');
    expect(rigBody.height_meters).toBe(1.7);
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
});

describe('MESHY_API_BASE', () => {
  it('points at the OpenAPI root', () => {
    expect(MESHY_API_BASE).toBe('https://api.meshy.ai/openapi');
  });
});