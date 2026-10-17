// tests/gamezone/hit-flash.test.js — bots must not go dark after being hit.
//
// Both bot GLBs are lit by an emissive texture (emissiveFactor [1,1,1]) and are
// metallic, so emissive IS their visible colour. The first v2 flash faded
// emissive to BLACK, so every bot that had been hit stayed dark for good.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHitFlash } from '../../src/gamezone/client/hitFlash.js';

function botMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
  m.emissive.setRGB(1, 1, 1);  // as loaded from banker-rigged.glb / augustink4.glb
  m.emissiveIntensity = 1;
  return m;
}

describe('bot hit flash', () => {
  it('flashes red, then restores each material to exactly its own emissive', () => {
    const a = botMaterial();
    const b = new THREE.MeshStandardMaterial(); b.emissive.setRGB(0.2, 0.3, 0.4); b.emissiveIntensity = 0.5;
    const f = createHitFlash([a, b, null, new THREE.MeshBasicMaterial()]);
    expect(f.count).toBe(2); // only emissive-capable materials

    f.apply(1);
    expect(a.emissive.r).toBeCloseTo(0.9, 6); expect(a.emissive.g).toBeCloseTo(0.08, 6);
    expect(b.emissive.r).toBeCloseTo(0.9, 6);

    for (const k of [0.75, 0.5, 0.25, 0.01]) f.apply(k); // decaying flash
    f.apply(0);
    expect([a.emissive.r, a.emissive.g, a.emissive.b, a.emissiveIntensity]).toEqual([1, 1, 1, 1]);
    expect(b.emissive.r).toBeCloseTo(0.2, 9); expect(b.emissive.g).toBeCloseTo(0.3, 9);
    expect(b.emissive.b).toBeCloseTo(0.4, 9); expect(b.emissiveIntensity).toBeCloseTo(0.5, 9);
  });

  it('never ends darker than it started, however many hits land', () => {
    const a = botMaterial();
    const f = createHitFlash([a]);
    for (let hit = 0; hit < 20; hit++) { for (let k = 1; k >= 0; k -= 0.1) f.apply(k); f.apply(0); }
    expect(a.emissive.getHex()).toBe(0xffffff);
    expect(a.emissiveIntensity).toBe(1);
  });

  it('is a no-op at rest (no per-frame writes when nothing is flashing)', () => {
    const a = botMaterial();
    const f = createHitFlash([a]);
    a.emissive.setRGB(0.5, 0.5, 0.5); // if apply(0) at rest wrote, this would be reset
    f.apply(0);
    expect(a.emissive.r).toBe(0.5);
  });

  it('botView uses the restoring flash, not a fade to black', () => {
    const src = readFileSync(new URL('../../src/gamezone/client/botView.js', import.meta.url), 'utf8');
    expect(src).toMatch(/hitFlash = createHitFlash\(materials\)/);
    expect(src).toMatch(/hitFlash\.apply\(flash \/ FLASH_S\)/);
    expect(src).not.toMatch(/emissive\.setRGB\(0\.9 \* k/);
  });
});
