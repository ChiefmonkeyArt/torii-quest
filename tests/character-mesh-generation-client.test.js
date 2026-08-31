// tests/character-mesh-generation-client.test.js — locks the live generator
// client adapters (src/engine/character/meshGenerationClient.js). Pure, inert:
// no network — only an injected fetcher can actually issue a backend request.
import { describe, it, expect } from 'vitest';
import {
  MESH_GENERATION_CLIENT_VERSION,
  buildBackendRequest,
  normalizeBackendResponse,
  createGeneratorClient,
  clientAcceptsResult,
} from '../src/engine/character/meshGenerationClient.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'd'.repeat(64);
const validManifest = () => ({
  version: 1,
  mesh: { hash: SHA, name: 'generated.glb' },
  clips: [], stickers: [], name: 'Generated', colors: [], contrib: [],
});
const MIXAMO_RIGGABLE = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftArm', 'mixamorigRightArm', 'mixamorigLeftForeArm', 'mixamorigRightForeArm',
  'mixamorigLeftHand', 'mixamorigRightHand', 'mixamorigLeftLeg', 'mixamorigRightLeg',
  'mixamorigLeftUpLeg', 'mixamorigRightUpLeg', 'mixamorigLeftFoot', 'mixamorigRightFoot',
  'mixamorigLeftToeBase', 'mixamorigRightToeBase',
];

describe('backend request builder', () => {
  it('builds a plain backend-keyed request without fetching', () => {
    expect(MESH_GENERATION_CLIENT_VERSION).toBe(1);
    const req = buildBackendRequest('meshy', { prompt: '  a knight  ' });
    expect(req.backend).toBe('meshy');
    expect(req.kind).toBe('text-to-3d');
    expect(req.body.prompt).toBe('a knight');
    expect(req.body.image).toBeUndefined();
    expect(buildBackendRequest('nope', { prompt: 'x' })).toBe(null);
    expect(buildBackendRequest('meshy', { prompt: '   ' })).toBe(null);
    expect(buildBackendRequest('meshy', null)).toBe(null);
  });

  it('carries image/style hints through for the right backends', () => {
    const req = buildBackendRequest('tripo', { prompt: 'x', image: 'https://x/i.png', style: 'low-poly' });
    expect(req.body.image).toBe('https://x/i.png');
    expect(req.body.style).toBe('low-poly');
  });
});

describe('response normaliser', () => {
  it('normalises a vendor response into the validator shape', () => {
    const n = normalizeBackendResponse('meshy', { manifest: validManifest(), boneNames: MIXAMO_RIGGABLE, downloadUrl: 'https://x/m.glb' });
    expect(n.backend).toBe('meshy');
    expect(n.manifest.mesh.hash).toBe(SHA);
    expect(n.downloadUrl).toBe('https://x/m.glb');
    expect(n.error).toBe(null);
  });

  it('degrades empty/malformed payloads to an error instead of throwing', () => {
    expect(normalizeBackendResponse('meshy', null).error).toBe('empty-response');
    expect(normalizeBackendResponse('meshy', {}).error).toBe('empty-response');
    expect(normalizeBackendResponse('meshy', { error: 'boom' }).error).toBe('boom');
  });
});

describe('generator client', () => {
  it('is inert without a fetcher — never issues a request', async () => {
    const client = createGeneratorClient({ backend: 'meshy' });
    const res = await client.generate({ prompt: 'a knight' });
    expect(res.performed).toBe(false);
    expect(res.reason).toBe('no-fetcher');
  });

  it('issues the request through the injected fetcher and normalises', async () => {
    let called = null;
    const client = createGeneratorClient({
      backend: 'meshy',
      fetcher: async (req) => {
        called = req;
        return { manifest: validManifest(), boneNames: MIXAMO_RIGGABLE, downloadUrl: 'https://x/m.glb' };
      },
    });
    const res = await client.generate({ prompt: 'a knight' });
    expect(res.performed).toBe(true);
    expect(res.error).toBe(null);
    expect(res.manifest.mesh.name).toBe('generated.glb');
    expect(called.backend).toBe('meshy');
  });

  it('traps fetcher throws into an error result', async () => {
    const client = createGeneratorClient({ backend: 'meshy', fetcher: async () => { throw new Error('net'); } });
    const res = await client.generate({ prompt: 'x' });
    expect(res.performed).toBe(true);
    expect(res.error).toBe('net');
  });
});

describe('gate helper + SDK', () => {
  it('clientAcceptsResult re-runs the validator gate', () => {
    const ok = { backend: 'meshy', manifest: validManifest(), boneNames: MIXAMO_RIGGABLE, error: null };
    expect(clientAcceptsResult(ok)).toBe(true);
    expect(clientAcceptsResult({ error: 'x' })).toBe(false);
    expect(clientAcceptsResult({ manifest: { nope: 1 }, boneNames: [] })).toBe(false);
  });

  it('is exported at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.meshGenerationClient.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.meshGenerationClient.createGeneratorClient).toBe('function');
  });
});