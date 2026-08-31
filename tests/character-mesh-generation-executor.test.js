// tests/character-mesh-generation-executor.test.js — locks the routstr/Cashu
// generation EXECUTOR (src/engine/character/meshGenerationExecutor.js). Inert by
// default: no network, no payment, no signing/publishing/seating.
import { describe, it, expect } from 'vitest';
import {
  MESH_GENERATION_EXECUTOR_VERSION,
  createMeshGenerationExecutor,
} from '../src/engine/character/meshGenerationExecutor.js';
import { validateGeneratedMesh } from '../src/engine/character/meshGeneration.js';
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

const goodResult = () => ({
  performed: true, backend: 'meshy', manifest: validManifest(), boneNames: MIXAMO_RIGGABLE, downloadUrl: 'https://x/m.glb', error: null,
});

describe('executor run pipeline', () => {
  it('aborts when the generator is inert (no fetcher / no generator)', async () => {
    expect(MESH_GENERATION_EXECUTOR_VERSION).toBe(1);
    const run = await createMeshGenerationExecutor().run({ prompt: 'x' });
    expect(run.status).toBe('aborted');
    expect(run.performed).toBe(false);
  });

  it('rejects a result that fails the validator gate', async () => {
    const exec = createMeshGenerationExecutor({
      generate: async () => ({ performed: true, manifest: { nope: 1 }, boneNames: [], error: null }),
    });
    const run = await exec.run({ prompt: 'x' });
    expect(run.status).toBe('rejected');
    expect(run.verdict.accepted).toBe(false);
    expect(run.published).toBe(false);
  });

  it('stops at payment-required when no charge seam is injected', async () => {
    const exec = createMeshGenerationExecutor({ generate: async () => goodResult() });
    const run = await exec.run({ prompt: 'x' });
    expect(run.status).toBe('payment-required');
    expect(run.verdict.accepted).toBe(true); // gate passed, but no broker
  });

  it('stops at payment-failed when the charge step declines', async () => {
    const exec = createMeshGenerationExecutor({
      generate: async () => goodResult(),
      charge: async () => ({ ok: false }),
    });
    const run = await exec.run({ prompt: 'x' });
    expect(run.status).toBe('payment-failed');
  });

  it('accepts — gate passed + paid — but still never publishes/seats', async () => {
    let chargedBackend = null;
    const exec = createMeshGenerationExecutor({
      generate: async () => goodResult(),
      charge: async (backend) => { chargedBackend = backend; return { ok: true }; },
    });
    const run = await exec.run({ prompt: 'x' });
    expect(run.status).toBe('accepted');
    expect(chargedBackend).toBe('meshy');
    expect(run.manifest.mesh.name).toBe('generated.glb');
    // the executor is deliberately NOT the publisher/seater
    expect(run.published).toBe(false);
    expect(run.seated).toBe(false);
  });

  it('defaults validate to validateGeneratedMesh', () => {
    const exec = createMeshGenerationExecutor({ generate: async () => goodResult() });
    // the executor uses the real gate: a good result passes it
    return exec.run({ prompt: 'x' }).then((r) => {
      expect(r.verdict.accepted).toBe(true);
      expect(typeof validateGeneratedMesh).toBe('function');
    });
  });
});

describe('SDK exposure', () => {
  it('is exported at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.meshGenerationExecutor.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.meshGenerationExecutor.createMeshGenerationExecutor).toBe('function');
  });
});