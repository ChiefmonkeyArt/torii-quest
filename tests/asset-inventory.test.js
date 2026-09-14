// tests/asset-inventory.test.js — structural guard for the F13 asset cleanup
// (v0.2.843). Locks the inventory boundary established by the 2026-09 frontend audit:
// dead binary assets (wall-texture.*, torii-gate.webp, dist-orient/) stay gone, the
// still-live assets the renderer actually loads stay present, and the service-worker
// precache never re-points at a removed texture. A future edit that re-adds a dead
// asset — or that drops a live one — fails here instead of silently regrowing the
// app payload or breaking the OG/runtime surfaces that depend on them.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (rel) => existsSync(join(ROOT, rel));

describe('F13 asset inventory — dead assets stay removed', () => {
  const REMOVED = [
    'public/wall-texture.jpg',
    'public/wall-texture.webp',
    'public/torii-gate.webp',
    'dist-orient/index.html',
    'dist-orient/vendor/three.module.js',
    'dist-orient/vendor/three.core.js',
  ];

  for (const rel of REMOVED) {
    it(`${rel} is gone`, () => {
      expect(has(rel), `${rel} must not be re-added`).toBe(false);
    });
  }

  it('the live renderer/OG assets are still present', () => {
    for (const rel of [
      'public/bitcoin-b.png',  // sats HUD icon (SW-precached)
      'public/torii-gate.png', // OG metadata image
      'public/torii-gate.glb', // arena/entry gate model
    ]) {
      expect(has(rel), `${rel} must remain (still referenced)`).toBe(true);
    }
  });

  it('service-worker precache references only live binary assets', () => {
    const sw = read('public/sw.js');
    const m = sw.match(/const PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toContain('wall-texture');
    expect(m[1]).toContain('bitcoin-b.png');
  });

  it('the homepage no longer styles an absent dashboard-link element', () => {
    const html = read('index.html');
    expect(html).not.toContain('torii-quest-dashboard-link');
  });
});