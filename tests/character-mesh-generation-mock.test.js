// tests/character-mesh-generation-mock.test.js — locks the local "Create with
// AI" mock (src/engine/character/meshGenerationMock.js). Pure → node-safe.
import { describe, it, expect } from 'vitest';
import {
  MESH_GENERATION_MOCK_VERSION,
  MOCK_BACKEND,
  MOCK_BONE_NAMES,
  mockSha256,
  mockNameForPrompt,
  mockManifestForPrompt,
  mockGenerationResult,
  runMockGeneration,
} from '../src/engine/character/meshGenerationMock.js';

describe('meshGenerationMock', () => {
  it('is a versioned, frozen mock module with a riggable generic fixture', () => {
    expect(MESH_GENERATION_MOCK_VERSION).toBe(1);
    expect(MOCK_BACKEND).toBe('meshy');
    expect(Object.isFrozen(MOCK_BONE_NAMES)).toBe(true);
    expect(MOCK_BONE_NAMES).toContain('Hips');
    expect(MOCK_BONE_NAMES).toContain('neck');
    expect(MOCK_BONE_NAMES).toContain('LeftForeArm');
    expect(MOCK_BONE_NAMES).toContain('RightToeBase');
  });

  it('derives a deterministic 64-hex fixture id from a prompt', () => {
    const a = mockSha256('a hero knight');
    const b = mockSha256('a hero knight');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);               // same prompt → same id
    expect(mockSha256('a different knight')).not.toBe(a);
    // empty/absent prompts still return a stable shape (never throw)
    expect(mockSha256('')).toMatch(/^[0-9a-f]{64}$/);
    expect(mockSha256(null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives a short, safe name from a prompt with a generic fallback', () => {
    expect(mockNameForPrompt('a low-poly fox knight in silver armour')).toContain('fox');
    expect(mockNameForPrompt('')).toBe('AI Character');
    expect(mockNameForPrompt('x'.repeat(200)).length).toBeLessThanOrEqual(28);
  });

  it('builds a valid manifest with a deterministic mesh hash', () => {
    const m = mockManifestForPrompt('hero knight');
    expect(m.version).toBe(1);
    expect(m.mesh.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.mesh.name).toBe('mock-ai-character.glb');
    expect(m.name).toContain('hero knight');
    expect(mockManifestForPrompt('hero', { name: 'Custom' }).name).toBe('Custom');
  });

  it('returns a canned riggable fixture result with no error', () => {
    const r = mockGenerationResult('hero');
    expect(r.backend).toBe('meshy');
    expect(r.error).toBe(null);
    expect(Array.isArray(r.boneNames)).toBe(true);
    expect(r.downloadUrl).toBe('mock://ai-character.glb');
  });

  it('runs the full loop and ACCEPTS a valid prompt (rem she is riggable)', () => {
    const out = runMockGeneration('a low-poly fox knight');
    expect(out.planned).toBe(true);
    expect(out.mode).toBe('mock');
    expect(out.request.backend).toBe('meshy');
    expect(out.verdict.accepted).toBe(true);
    expect(out.verdict.rigVerdict).toBe('riggable');
    expect(out.verdict.rigConvention).toBe('generic');
    expect(out.verdict.rigBoneCount).toBe(MOCK_BONE_NAMES.length);
  });

  it('rejects an empty/overlong prompt or unknown backend without running the gate', () => {
    expect(runMockGeneration('').planned).toBe(false);
    expect(runMockGeneration('   ').planned).toBe(false);
    expect(runMockGeneration('x'.repeat(401)).planned).toBe(false);
    expect(runMockGeneration('hero', { backend: 'nope' }).planned).toBe(false);
    expect(runMockGeneration('').reason).toBe('invalid-request');
  });

  it('fails closed when the fixture rig is unriggable (validator gate exercised)', () => {
    const out = runMockGeneration('a static sculpture', { fixtureBoneNames: [] });
    expect(out.planned).toBe(true);
    expect(out.verdict.accepted).toBe(false);
    expect(out.verdict.rigVerdict).toBe('no-bones');
  });

  it('fails closed when the fixture manifest is invalid', () => {
    const out = runMockGeneration('hero', { fixtureManifest: { version: 1 } });
    expect(out.planned).toBe(true);
    expect(out.verdict.accepted).toBe(false);
    expect(out.verdict.reasons.some((r) => r.startsWith('manifest:'))).toBe(true);
  });
});