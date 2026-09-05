// tests/headless-glb-core.test.js — locks the server/character/headlessGlb.js
// authoring core (v0.2.767-alpha). The core is a pure buffer-in/buffer-out
// function reused by tools/headless-glb.mjs AND the POST /mp/character/headless
// endpoint, so any regression here would silently break BOTH paths — the CLI
// build of the shipped -headless.glb files AND the auto-generated headless
// variant for uploaded / Create-with-AI meshes.
//
// Master GLBs shipped in-repo drive the happy path (removes verts, keeps 3
// clips, byte-count reduces). Malformed / no-mesh / no-head-joint inputs drive
// the graceful-error branches.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  authorHeadlessGlb, DEFAULT_KEEP_ANIMS, DEFAULT_HEAD_JOINTS,
} from '../server/character/headlessGlb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

async function loadMaster(name) {
  return readFile(resolve(REPO_ROOT, 'public', 'models', name));
}

describe('authorHeadlessGlb — happy path (master GLBs)', () => {
  it('authors a valid headless variant from guest-master.glb', async () => {
    const buf = await loadMaster('guest-master.glb');
    const res = await authorHeadlessGlb(buf);
    expect(res.ok).toBe(true);
    expect(res.buffer).toBeInstanceOf(Uint8Array);
    // First 4 bytes = "glTF" magic.
    expect(String.fromCharCode(res.buffer[0], res.buffer[1], res.buffer[2], res.buffer[3])).toBe('glTF');
    // Head removal must have removed at least SOME verts.
    expect(res.stats.removedVerts).toBeGreaterThan(0);
    // The three master clips are preserved.
    expect(res.stats.keptClips).toBeGreaterThanOrEqual(1);
    expect(res.stats.keptClips).toBeLessThanOrEqual(DEFAULT_KEEP_ANIMS.length);
    // Byte-count should be smaller than the input (head verts + N-3 clips gone).
    expect(res.stats.bytesOut).toBeLessThan(res.stats.bytesIn);
  }, 30_000);

  it('authors a valid headless variant from nostrich-master.glb', async () => {
    const buf = await loadMaster('nostrich-master.glb');
    const res = await authorHeadlessGlb(buf);
    expect(res.ok).toBe(true);
    expect(res.stats.removedVerts).toBeGreaterThan(0);
    expect(res.stats.keptClips).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe('authorHeadlessGlb — no-head-joint branch', () => {
  it('returns { ok:false, error:"no-head-joint" } when no joint name matches', async () => {
    // Override headJointNames to a name that does not exist on the master
    // skeleton — simulates an uploaded / AI-generated mesh whose skin has no
    // recognisable head joint. Must fail closed with the tagged error so the
    // client can publish the character WITHOUT a headlessHash instead of
    // crashing (see main.js _uploadCustomMesh fallback).
    const buf = await loadMaster('guest-master.glb');
    const res = await authorHeadlessGlb(buf, {
      headJointNames: ['ThisJointDoesNotExistOnAnyPlayerSkeleton'],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-head-joint');
  }, 30_000);
});

describe('authorHeadlessGlb — error branches', () => {
  it('returns { ok:false, error:"invalid-glb" } on garbage bytes', async () => {
    const res = await authorHeadlessGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid-glb');
  });

  it('returns { ok:false, error:"invalid-glb" } on an empty buffer', async () => {
    const res = await authorHeadlessGlb(new Uint8Array(0));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid-glb');
  });

  it('accepts a Buffer as well as a Uint8Array (Node HTTP body path)', async () => {
    const master = await loadMaster('guest-master.glb');
    // Buffer IS-A Uint8Array but ensure the authoring core does not blow up.
    const res = await authorHeadlessGlb(Buffer.from(master));
    expect(res.ok).toBe(true);
  }, 30_000);
});

describe('authorHeadlessGlb — defaults surface', () => {
  it('exports the master-library keep-anims + head-joint defaults', () => {
    expect(DEFAULT_KEEP_ANIMS).toEqual(['Idle_02', 'Stylish_Walk_inplace', 'Running']);
    expect(DEFAULT_HEAD_JOINTS.length).toBeGreaterThan(0);
    // At least the canonical "Head" joint name must be in the default set.
    expect(DEFAULT_HEAD_JOINTS).toContain('Head');
  });
});
