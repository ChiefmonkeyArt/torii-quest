// tests/character-mesh-generation.test.js — locks the validator-gated external
// mesh generation seam (src/engine/character/meshGeneration.js). Pure → node-safe.
import { describe, it, expect } from 'vitest';
import {
  MESH_GENERATION_VERSION,
  MAX_PROMPT_LENGTH,
  GENERATION_BACKENDS,
  getGenerationBackend,
  buildGenerationRequest,
  planGeneration,
  validateGeneratedMesh,
  canAcceptMesh,
} from '../src/engine/character/meshGeneration.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'd'.repeat(64);

// A full Mixamo bone list → auto-riggable onto the canonical skeleton.
const MIXAMO_RIGGABLE = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder', 'mixamorigRightShoulder',
  'mixamorigLeftArm', 'mixamorigRightArm',
  'mixamorigLeftForeArm', 'mixamorigRightForeArm',
  'mixamorigLeftHand', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigRightUpLeg',
  'mixamorigLeftLeg', 'mixamorigRightLeg',
  'mixamorigLeftFoot', 'mixamorigRightFoot',
  'mixamorigLeftToeBase', 'mixamorigRightToeBase',
];

const validManifest = () => ({
  version: 1,
  mesh: { hash: SHA, name: 'generated.glb' },
  clips: [],
  stickers: [],
  name: 'Generated',
  colors: [],
  contrib: [],
});

describe('backends', () => {
  it('registers the three orchestrated generators, all payment-gated', () => {
    expect(MESH_GENERATION_VERSION).toBe(1);
    expect(Object.isFrozen(GENERATION_BACKENDS)).toBe(true);
    const ids = GENERATION_BACKENDS.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['meshy', 'tripo', 'hunyuan3d']));
    expect(GENERATION_BACKENDS.every((b) => b.requiresPayment)).toBe(true);
    expect(getGenerationBackend('meshy').label).toBe('Meshy');
    expect(getGenerationBackend('nope')).toBe(null);
    expect(getGenerationBackend(null)).toBe(null);
  });
});

describe('request + plan', () => {
  it('builds a normalised request for a known backend', () => {
    const r = buildGenerationRequest('  a hero knight  ', { backend: 'meshy', style: 'low-poly' });
    expect(r.prompt).toBe('a hero knight');
    expect(r.backend).toBe('meshy');
    expect(r.kind).toBe('text-to-3d');
    expect(r.style).toBe('low-poly');
  });

  it('rejects empty/overlong prompts and unknown backends', () => {
    expect(buildGenerationRequest('   ', { backend: 'meshy' })).toBe(null);
    expect(buildGenerationRequest('x'.repeat(MAX_PROMPT_LENGTH + 1), { backend: 'meshy' })).toBe(null);
    expect(buildGenerationRequest('hero', { backend: 'nope' })).toBe(null);
  });

  it('plans inertly — never performed', () => {
    const plan = planGeneration('hero', { backend: 'tripo' });
    expect(plan.planned).toBe(true);
    expect(plan.performed).toBe(false);
    expect(plan.route).toBe('routstr');
    expect(plan.gate).toBe('validator');
    expect(planGeneration('', { backend: 'meshy' }).planned).toBe(false);
  });
});

describe('validator gate', () => {
  it('accepts a valid manifest + riggable rig', () => {
    const verdict = validateGeneratedMesh({ manifest: validManifest(), boneNames: MIXAMO_RIGGABLE });
    expect(verdict.accepted).toBe(true);
    expect(verdict.manifestValid).toBe(true);
    expect(verdict.rigVerdict).toBe('riggable');
    expect(canAcceptMesh({ manifest: validManifest(), boneNames: MIXAMO_RIGGABLE })).toBe(true);
  });

  it('rejects an invalid manifest even with a riggable rig', () => {
    const verdict = validateGeneratedMesh({ manifest: { version: 1 }, boneNames: MIXAMO_RIGGABLE });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.some((r) => r.startsWith('manifest:'))).toBe(true);
  });

  it('rejects an unriggable rig even with a valid manifest', () => {
    const verdict = validateGeneratedMesh({ manifest: validManifest(), boneNames: [] });
    expect(verdict.accepted).toBe(false);
    expect(verdict.rigVerdict).toBe('no-bones');
  });

  it('rejects a partial/unknown-convention rig', () => {
    const partial = validateGeneratedMesh({ manifest: validManifest(), boneNames: ['mixamorigHips'] });
    expect(partial.accepted).toBe(false);
    expect(['partial', 'unknown-convention']).toContain(partial.rigVerdict);
  });

  it('fails closed on empty/absent input', () => {
    expect(validateGeneratedMesh({}).accepted).toBe(false);
    expect(validateGeneratedMesh(null).accepted).toBe(false);
  });
});

describe('SDK exposure', () => {
  it('is exported at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.meshGeneration.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.meshGeneration.validateGeneratedMesh).toBe('function');
    expect(typeof SDK.meshGeneration.planGeneration).toBe('function');
  });
});