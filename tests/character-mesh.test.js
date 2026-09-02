// tests/character-mesh.test.js — locks the Blossom mesh-URL resolution
// (src/engine/character/characterMesh.js): turning a manifest's content-addressed
// mesh hash into a fetchable https URL for the avatar renderer. Pure module →
// fully node-testable.
import { describe, it, expect } from 'vitest';
import {
  blossomMeshUrl, resolveCharacterMeshUrl, DEFAULT_BLOSSOM_SERVER,
} from '../src/engine/character/characterMesh.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'a'.repeat(64);

describe('blossomMeshUrl', () => {
  it('resolves a valid hash to a Blossom URL', () => {
    expect(blossomMeshUrl(SHA)).toBe(`${DEFAULT_BLOSSOM_SERVER}/${SHA}`);
    expect(blossomMeshUrl(SHA, 'https://blossom.example/')).toBe(`https://blossom.example/${SHA}`);
  });

  it('rejects a non-sha256 hash', () => {
    expect(blossomMeshUrl('not-a-hash')).toBe(null);
    expect(blossomMeshUrl('')).toBe(null);
    expect(blossomMeshUrl(null)).toBe(null);
  });

  it('rejects a non-https server', () => {
    expect(blossomMeshUrl(SHA, 'http://blossom.example')).toBe(null);
    expect(blossomMeshUrl(SHA, '')).toBe(null);
  });
});

describe('resolveCharacterMeshUrl', () => {
  it('resolves a manifest with a mesh', () => {
    const url = resolveCharacterMeshUrl({ mesh: { hash: SHA, name: 'x.glb' } });
    expect(url).toBe(`${DEFAULT_BLOSSOM_SERVER}/${SHA}`);
  });

  it('returns null when the manifest has no valid mesh', () => {
    expect(resolveCharacterMeshUrl(null)).toBe(null);
    expect(resolveCharacterMeshUrl({})).toBe(null);
    expect(resolveCharacterMeshUrl({ mesh: null })).toBe(null);
    expect(resolveCharacterMeshUrl({ mesh: { hash: 'bad' } })).toBe(null);
  });

  it('honours a server override', () => {
    const url = resolveCharacterMeshUrl({ mesh: { hash: SHA } }, { server: 'https://cdn.example' });
    expect(url).toBe(`https://cdn.example/${SHA}`);
  });
});

describe('SDK exposure', () => {
  it('re-exports characterMesh at the experimental tier', () => {
    expect(SDK.characterMesh.blossomMeshUrl).toBe(blossomMeshUrl);
    expect(SDK.SDK_SURFACE.characterMesh.tier).toBe('experimental');
  });
});
