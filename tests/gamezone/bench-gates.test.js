// tests/gamezone/bench-gates.test.js — the Game Zone v2 definition of done (ADR-0130).
//
// Runs the real bench (tools/gamezone-bench.mjs) at a reduced size against the
// shipped GLBs: skinned-triangle ground truth vs the v2 hitbox rig, the
// authority's claim validator, and the shared sim's tick cost on the real
// arena world. Fails when any gate regresses.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { stripRootMotion, isHeadVertex } from '../../src/gamezone/client/hitbox.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Game Zone bench gates (real GLBs)', () => {
  it('v2 hitboxes match the rendered mesh exactly, claims validate, ticks stay cheap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gzb-'));
    try {
      const out = join(dir, 'bench.json');
      const r = spawnSync(process.execPath, ['tools/gamezone-bench.mjs', '--rays', '40', '--poses', '2', '--soft-timing', '--json', out], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
      expect(r.status, r.stderr).toBe(0);
      const b = JSON.parse(readFileSync(out, 'utf8'));
      for (const kind of ['regular', 'boss']) {
        const k = b.hit[kind];
        expect(k.skeletal.hitAgreePct).toBe(100);
        expect(k.skeletal.zoneAgreePct).toBe(100);
        expect(k.skeletal.headRecallPct).toBe(100);
        expect(k.validator.rejectPct).toBeLessThan(1);
      }
      // Boss headshots were impossible on the legacy collider; v2 makes them real.
      expect(b.hit.boss.legacy.headRecallPct).toBeLessThan(b.hit.boss.skeletal.headRecallPct);
      // Timing is load-dependent in a parallel test run; the strict p99/over-5ms
      // gates run in `npm run bench:gamezone`. Here: the median tick stays tiny.
      expect(b.sim.p50).toBeLessThan(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120000);
});

describe('hitbox helpers', () => {
  it('stripRootMotion pins Hips x/z to the first key (keeps the bob), any naming', () => {
    const mk = (name) => new THREE.VectorKeyframeTrack(name, [0, 1], [0.1, 1, 0.2, 2.5, 0.9, 3]);
    const clip = new THREE.AnimationClip('c', 1, [mk('Hips.position'), mk('Armature/mixamorig:Hips.position'), mk('Spine.position')]);
    expect(stripRootMotion([clip])).toBe(2);
    expect(Array.from(clip.tracks[0].values)).toEqual([0.1, 1, 0.2, 0.1, 0.9, 0.2].map((v) => Math.fround(v)));
    expect(clip.tracks[2].values[3]).toBeCloseTo(2.5, 5);
  });
  it('head zone is anatomical: rest height at or above the neck line', () => {
    expect(isHeadVertex(1.42, 1.42)).toBe(true);
    expect(isHeadVertex(1.41, 1.42)).toBe(false);
  });
});
