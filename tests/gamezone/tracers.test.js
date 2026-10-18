// tests/gamezone/tracers.test.js — ADR-0136: visible, travelling bullet tracers.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGzFx, TRACER_PLAYER, TRACER_BOT, TRACER_PEER } from '../../src/gamezone/client/fx.js';

function setup() {
  const parent = new THREE.Group();
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 5, 0); cam.updateMatrixWorld(true);
  const fx = createGzFx(parent, cam);
  const mesh = parent.children.find((o) => o.name === 'gz-tracers');
  return { parent, fx, mesh, cam };
}
const pos = (mesh) => mesh.geometry.attributes.position.array;

describe('tracers (ADR-0136)', () => {
  it('are camera-facing ribbons in one draw call, not 1-px lines', () => {
    const { parent, mesh } = setup();
    expect(mesh.isMesh).toBe(true);
    expect(mesh.isLineSegments).toBeFalsy();
    expect(parent.children.length).toBe(2); // ribbons + sparks
  });

  it('your rounds glow orange/purple; bot rounds are black with a red glow', () => {
    const [r, g, b] = TRACER_PLAYER.core; expect(r).toBeGreaterThan(0.9); expect(g).toBeLessThan(0.5); expect(b).toBeLessThan(0.1);
    expect(TRACER_PLAYER.glow[2]).toBeGreaterThan(TRACER_PLAYER.glow[0]); // purple: blue-dominant
    expect(TRACER_BOT.core).toEqual([0, 0, 0]);
    expect(TRACER_BOT.glow[0]).toBeGreaterThan(0.9); expect(TRACER_BOT.glow[1]).toBeLessThan(0.1);
    // incoming fire is the more obvious one: wider and slower
    expect(TRACER_BOT.w).toBeGreaterThan(TRACER_PLAYER.w);
    expect(TRACER_BOT.speed).toBeLessThan(TRACER_PLAYER.speed);
    expect(TRACER_PEER.core).toEqual(TRACER_PLAYER.core);
  });

  it('a streak travels at bullet speed, then lands and fades', () => {
    const { fx, mesh } = setup();
    fx.tracer(0, 1, 0, 0, 1, -60, TRACER_BOT);
    fx.tick(0.1); // head at 11 m
    const p = pos(mesh);
    const headZ = p[8], tailZ = p[2];
    expect(headZ).toBeCloseTo(-TRACER_BOT.speed * 0.1, 3);
    expect(tailZ).toBeCloseTo(headZ + TRACER_BOT.len, 3);
    // ribbon width spans ±w/2 (camera above → width along x)
    expect(Math.abs(p[3] - p[0])).toBeGreaterThanOrEqual(TRACER_BOT.w - 1e-6);
    for (let i = 0; i < 60 && fx.active; i++) fx.tick(1 / 30);
    expect(fx.active).toBe(0);
    expect(Array.from(p.slice(0, 12)).every((v) => v === 0)).toBe(true); // hidden
  });

  it('keeps a minimum on-screen width at range', () => {
    const { fx, mesh } = setup();
    fx.tracer(0, 1, -200, 0, 1, -260, TRACER_PLAYER);
    fx.tick(0.01);
    const p = pos(mesh);
    expect(Math.abs(p[3] - p[0])).toBeGreaterThan(TRACER_PLAYER.w * 4);
  });

  it('ignores degenerate shots and never allocates per shot', () => {
    const { parent, fx } = setup();
    fx.tracer(0, 1, 0, 0, 1, 0.01);
    expect(fx.active).toBe(0);
    for (let i = 0; i < 300; i++) fx.tracer(0, 1, 0, 5, 1, 0);
    expect(parent.children.length).toBe(2);
    fx.clear(); expect(fx.active).toBe(0);
  });
});

describe('crates never render black (ADR-0136)', () => {
  it('shared wood look; component colour matches; UVs tile per ~1.2 m', async () => {
    const { crateMaterial, fitCrateUVs, CRATE_COLOR } = await import('../../src/engine/render/crateLook.js');
    const { expandArenaCrates } = await import('../../src/engine/components/arenaCrates.js');
    const m = crateMaterial();
    expect(m).toBe(crateMaterial()); // one shared material
    const c = new THREE.Color(CRATE_COLOR); // sRGB → linear
    expect((c.r + c.g + c.b) / 3).toBeGreaterThan(0.3); // was ~0.07 (#4a4458)
    expect(expandArenaCrates()[0].color).toBe(CRATE_COLOR);
    const g = fitCrateUVs(new THREE.BoxGeometry(4.8, 1.2, 2.4), 4.8, 1.2, 2.4);
    const uv = g.attributes.uv;
    let maxU = 0; for (let i = 16; i < 20; i++) maxU = Math.max(maxU, uv.getX(i)); // +z face spans width
    expect(maxU).toBe(4);
  });

  it('arena + dynamic crates use the shared look', async () => {
    const fs = await import('node:fs');
    const A = fs.readFileSync(new URL('../../src/arena.js', import.meta.url), 'utf8');
    const D = fs.readFileSync(new URL('../../src/dynamicCrates.js', import.meta.url), 'utf8');
    expect(A).toMatch(/fitCrateUVs\(new THREE\.BoxGeometry\(hw \* 2, ch, hd \* 2\), hw \* 2, ch, hd \* 2\), crateMaterial\(\)\)/);
    expect(A).not.toMatch(/0x4a4458/);
    expect(D).toMatch(/new THREE\.Mesh\(_geo, crateMaterial\(\)\)/);
  });
});

describe('incoming rounds (ADR-0136)', () => {
  it('a bot round that hits you stops 1.5 m short of the camera', () => {
    const parent = new THREE.Group();
    const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 1.7, 0); cam.updateMatrixWorld(true);
    const fx = createGzFx(parent, cam);
    const mesh = parent.children.find((o) => o.name === 'gz-tracers');
    fx.tracer(0, 1.7, -20, 0, 1.5, -0.1, TRACER_BOT);
    for (let i = 0; i < 20; i++) fx.tick(0.01); // landed, still fading
    expect(fx.active).toBe(1);
    const p = mesh.geometry.attributes.position.array;
    const headZ = (p[8] + p[11]) / 2;
    expect(headZ).toBeLessThan(-1.4);
  });
});
