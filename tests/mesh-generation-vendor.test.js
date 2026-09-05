// tests/mesh-generation-vendor.test.js — the real Meshy/Tripo vendor fetch
// adapters (Step C). Proves the adapters build the correct Bearer-auth requests,
// poll the async task to completion, and normalise a download URL — all against
// an injected fake fetch (no network). Also locks the fail-closed key gate and
// the unknown-backend path.
import { describe, it, expect } from 'vitest';
import { meshyFetcher, tripoFetcher, createVendorFetcher, VENDOR_ENDPOINTS } from '../server/character/meshGenerationVendor.js';

// fakeFetch(routes) → a fetch stub keyed by `${method} ${pathname}`. Returns a
// { ok, status, json } object; records full request (url/headers/body) per call.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${(init.method || 'GET').toUpperCase()} ${u.pathname}`;
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body || '' });
    const r = routes[key];
    if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      json: async () => (r.json === undefined ? {} : r.json),
      text: async () => (r.text || ''),
    };
  };
  fn.calls = calls;
  return fn;
}

describe('meshyFetcher — text-to-3D adapter', () => {
  it('fails closed with a missing API key', async () => {
    const f = await meshyFetcher({ apiKey: '' })({ body: { prompt: 'fox' } });
    expect(f.error).toBe('meshy:missing-api-key');
    expect(f.downloadUrl).toBeNull();
  });

  it('issues a Bearer-auth preview task, polls, and returns the GLB url', async () => {
    const fetch = fakeFetch({
      'POST /openapi/v2/text-to-3d': { json: { result: 'task-1' } },
      'GET /openapi/v2/text-to-3d/task-1': { json: { status: 'SUCCEEDED', model_url: 'https://cdn.meshy.ai/x.glb' } },
    });
    const f = await meshyFetcher({ apiKey: 'msy_test', fetchFn: fetch })({ body: { prompt: 'a fox knight' } });

    expect(f.error).toBeNull();
    expect(f.downloadUrl).toBe('https://cdn.meshy.ai/x.glb');
    const create = fetch.calls.find((c) => c.method === 'POST');
    expect(create.headers.Authorization).toBe('Bearer msy_test');
    const body = JSON.parse(create.body);
    expect(body.mode).toBe('preview');
    expect(body.prompt).toBe('a fox knight');
    expect(body.target_formats).toEqual(['glb']);
  });

  it('surfaces a FAILED task status as an error', async () => {
    const fetch = fakeFetch({
      'POST /openapi/v2/text-to-3d': { json: { result: 't' } },
      'GET /openapi/v2/text-to-3d/t': { json: { status: 'FAILED' } },
    });
    const f = await meshyFetcher({ apiKey: 'k', fetchFn: fetch })({ body: { prompt: 'x' } });
    expect(f.error).toBe('meshy:task-FAILED');
  });
});

describe('tripoFetcher — image/text-to-3D adapter', () => {
  it('uses image_to_model when an image url is supplied', async () => {
    const fetch = fakeFetch({
      'POST /v3/task': { json: { task_id: 't2' } },
      'GET /v3/task/t2': { json: { status: 'SUCCESS', model_url: 'https://cdn.tripo.ai/y.glb' } },
    });
    const f = await tripoFetcher({ apiKey: 'tk', fetchFn: fetch })({ body: { prompt: 'x', image: 'https://img/x.png' } });
    expect(f.downloadUrl).toBe('https://cdn.tripo.ai/y.glb');
    const body = JSON.parse(fetch.calls[0].body);
    expect(body.type).toBe('image_to_model');
  });

  it('falls back to text_to_model without an image', async () => {
    const fetch = fakeFetch({
      'POST /v3/task': { json: { task_id: 't3' } },
      'GET /v3/task/t3': { json: { status: 'SUCCEEDED', model_url: 'https://cdn.tripo.ai/z.glb' } },
    });
    const f = await tripoFetcher({ apiKey: 'tk', fetchFn: fetch })({ body: { prompt: 'an owl' } });
    expect(JSON.parse(fetch.calls[0].body).type).toBe('text_to_model');
    expect(f.downloadUrl).toBe('https://cdn.tripo.ai/z.glb');
  });

  it('fails closed with a missing API key', async () => {
    const f = await tripoFetcher({ apiKey: null })({ body: { prompt: 'x' } });
    expect(f.error).toBe('tripo:missing-api-key');
  });
});

describe('createVendorFetcher — dispatch', () => {
  it('routes meshy/tripo and rejects unknown backends', async () => {
    const m = await createVendorFetcher('meshy', { apiKey: '' })({ body: { prompt: 'x' } });
    const t = await createVendorFetcher('tripo', { apiKey: '' })({ body: { prompt: 'x' } });
    const u = await createVendorFetcher('nope', { apiKey: 'x' })({ body: { prompt: 'x' } });
    expect(m.backend).toBe(undefined); // shapeless — assert error text instead
    expect(m.error).toContain('meshy');
    expect(t.error).toContain('tripo');
    expect(u.error).toBe('unknown-backend:nope');
  });

  it('exposes grounded endpoint constants', () => {
    expect(VENDOR_ENDPOINTS.meshy.base).toBe('https://api.meshy.ai');
    expect(VENDOR_ENDPOINTS.tripo.base).toBe('https://openapi.tripo3d.ai/v3');
  });
});