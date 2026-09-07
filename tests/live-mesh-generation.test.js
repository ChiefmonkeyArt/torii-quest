// tests/live-mesh-generation.test.js — the client-side Meshy proxy wrapper
// (src/engine/character/liveMeshGeneration.js) exercised with an injected fetch.
// No network, no sessionStorage.

import { describe, it, expect } from 'vitest';
import { requestMeshGeneration } from '../src/engine/character/liveMeshGeneration.js';
import { MAX_PROMPT_LENGTH } from '../src/engine/character/meshGeneration.js';

const okJson = (obj, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => obj,
});

describe('requestMeshGeneration', () => {
  it('POSTs the prompt with the session bearer and returns the glbUrl', async () => {
    const log = [];
    const fetchImpl = async (url, init = {}) => {
      log.push({ url, init });
      return okJson({ ok: true, glbUrl: 'https://assets.meshy.ai/rigged.glb' });
    };
    const out = await requestMeshGeneration('  a fox knight  ', {
      fetchImpl, httpBase: 'https://game.example/mp', token: 'tok123',
    });
    expect(out.ok).toBe(true);
    expect(out.glbUrl).toBe('https://assets.meshy.ai/rigged.glb');
    expect(log[0].url).toBe('https://game.example/mp/mesh/generate');
    expect(log[0].init.method).toBe('POST');
    expect(log[0].init.headers.Authorization).toBe('Bearer tok123');
    expect(JSON.parse(log[0].init.body)).toEqual({ prompt: 'a fox knight' }); // trimmed
  });

  it('rejects an empty prompt before any fetch', async () => {
    let called = false;
    const out = await requestMeshGeneration('   ', {
      fetchImpl: async () => { called = true; return okJson({}); },
      httpBase: 'https://x/mp', token: 't',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('prompt-required');
    expect(called).toBe(false);
  });

  it('rejects an over-long prompt', async () => {
    const out = await requestMeshGeneration('x'.repeat(MAX_PROMPT_LENGTH + 1), {
      fetchImpl: async () => okJson({}), httpBase: 'https://x/mp', token: 't',
    });
    expect(out.error).toBe('prompt-too-long');
  });

  it('fails with no-session-token when neither injected nor stored', async () => {
    const out = await requestMeshGeneration('a fox', {
      fetchImpl: async () => okJson({}), httpBase: 'https://x/mp',
    });
    expect(out.error).toBe('no-session-token');
  });

  it('surfaces a server error message on a non-2xx response', async () => {
    const out = await requestMeshGeneration('a fox', {
      fetchImpl: async () => okJson({ ok: false, error: 'generator unavailable', detail: 'no key' }, 503),
      httpBase: 'https://x/mp', token: 't',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('generator unavailable');
    expect(out.detail).toBe('no key');
  });

  it('fails with no-glb-url when a 200 body omits the URL', async () => {
    const out = await requestMeshGeneration('a fox', {
      fetchImpl: async () => okJson({ ok: true }),
      httpBase: 'https://x/mp', token: 't',
    });
    expect(out.error).toBe('no-glb-url');
  });
});