// tests/portal-mesh-plan.test.js — locks the v0.2.183 in-world GATEWAY PORTAL marker.
// Covers the PURE render plan (portalMeshPlan.js): range-aligned outer ring, the two
// inert marker parts (outer ring + sats-symbol core), the inert flags pinned on every
// part + the plan, and graceful degradation on bad input. Also exercises the browser-only adapter (portalMesh.js)
// build/tick/dispose with a fake scene (no DOM/WebGL — the marker uses no textures),
// the debug-shell report, and SDK exposure. Pure plan → node-safe.
import { describe, it, expect, afterEach } from 'vitest';
import {
  PORTAL_MESH_PLAN_VERSION, PORTAL_MESH_BADGE, PORTAL_MESH_GROUP,
  buildPortalMeshPlan, describePortalMeshPlan, DEMO_PORTAL_MESH_OPTS,
} from '../src/engine/gateway/portalMeshPlan.js';
import {
  portalMeshRenderState, buildPortalMesh, tickPortalMesh, setPortalApproach, disposePortalMesh,
} from '../src/engine/gateway/portalMesh.js';
import { portalMeshPlanReport } from '../src/engine/debug/shellReport.js';
import * as SDK from '../src/sdk/index.js';

const INERT_KEYS = ['navigated', 'performed', 'external', 'signed', 'published'];

describe('module shape', () => {
  it('pins version, badge, group, and demo opts', () => {
    expect(PORTAL_MESH_PLAN_VERSION).toBe(4);
    expect(PORTAL_MESH_BADGE).toBe('PORTAL MESH · DISPLAY-ONLY · INERT');
    expect(PORTAL_MESH_GROUP).toBe('gateway-portal');
    expect(DEMO_PORTAL_MESH_OPTS).toEqual({ position: { x: 20, y: 0, z: 0 }, range: 3, title: 'Plebeian Market Bazaar' });
  });
});

describe('buildPortalMeshPlan — happy path', () => {
  it('builds the clean 2-part marker (ring + core), ok, anchored at the trigger position', () => {
    const p = buildPortalMeshPlan({ position: { x: 20, y: 0, z: 0 }, range: 3, title: 'Bazaar' });
    expect(p.ok).toBe(true);
    expect(p.count).toBe(2);
    expect(p.parts).toHaveLength(2);
    expect(p.anchor).toEqual({ x: 20, y: 0, z: 0 });
    expect(p.title).toBe('Bazaar');
    expect(p.reasons).toEqual([]);
  });

  it('aligns the outer ring radius EXACTLY to the trigger range', () => {
    const p = buildPortalMeshPlan({ position: { x: 0, y: 0, z: 0 }, range: 5 });
    expect(p.range).toBe(5);
    expect(p.ringRadius).toBe(5);
    const outer = p.parts.find((x) => x.id === 'outer-ring');
    expect(outer.geometry.radius).toBe(5);
    expect(outer.role).toBe('range-boundary');
  });

  it('has the expected 2 part ids/kinds and spin/pulse assignment', () => {
    const p = buildPortalMeshPlan({ position: { x: 0, y: 0, z: 0 }, range: 3 });
    expect(p.parts.map((x) => x.id)).toEqual(
      ['outer-ring', 'core'],
    );
    expect(p.parts.find((x) => x.id === 'outer-ring').pulse).toBe(true);
    expect(p.parts.find((x) => x.id === 'core').spin).toBe(true);
    expect(p.parts.find((x) => x.id === 'outer-ring').transparent).toBe(false);
  });

  it('lays the ring flat on the ground and floats the sats core above it', () => {
    const p = buildPortalMeshPlan({ position: { x: 0, y: 0, z: 0 }, range: 3 });
    const outer = p.parts.find((x) => x.id === 'outer-ring');
    const core = p.parts.find((x) => x.id === 'core');
    expect(outer.geometry.type).toBe('torus');
    // Ring lies flat (rotated -PI/2 about X) at ground level.
    expect(outer.rotation.x).toBe(-Math.PI / 2);
    // Core is a Bitcoin-orange sats symbol floating above the ring.
    expect(core.geometry.type).toBe('sats-symbol');
    expect(core.color).toBe(0xf7931a);
    expect(core.position.y).toBeGreaterThan(outer.position.y);
  });

  it('flags only the core for the host-driven approach glow (rings are not)', () => {
    const p = buildPortalMeshPlan({ position: { x: 0, y: 0, z: 0 }, range: 3 });
    const approachIds = p.parts.filter((x) => x.approach === true).map((x) => x.id).sort();
    expect(approachIds).toEqual(['core']);
    expect(p.parts.find((x) => x.id === 'outer-ring').approach).toBe(false);
  });
});

describe('buildPortalMeshPlan — inert by construction', () => {
  it('pins the inert flags false on the plan and every part', () => {
    const p = buildPortalMeshPlan({ position: { x: 0, y: 0, z: 0 }, range: 3 });
    expect(p.rendered).toBe(false);
    expect(p.actionable).toBe(false);
    for (const k of INERT_KEYS) expect(p[k]).toBe(false);
    for (const part of p.parts) {
      for (const k of INERT_KEYS) expect(part[k]).toBe(false);
      expect(part.readOnly).toBe(true);
      expect(part.actionable).toBe(false);
    }
  });
});

describe('buildPortalMeshPlan — degraded input', () => {
  it('marks ok:false with invalid-position for a missing position', () => {
    const p = buildPortalMeshPlan({ range: 3 });
    expect(p.ok).toBe(false);
    expect(p.reasons).toContain('invalid-position');
    expect(p.anchor).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('defaults the range (3) and notes it when range is bad', () => {
    const p = buildPortalMeshPlan({ position: { x: 1, y: 2, z: 3 }, range: -1 });
    expect(p.range).toBe(3);
    expect(p.ringRadius).toBe(3);
    expect(p.reasons).toContain('range-defaulted');
  });

  it('never throws on hostile input', () => {
    expect(() => buildPortalMeshPlan(null)).not.toThrow();
    expect(() => buildPortalMeshPlan([])).not.toThrow();
    expect(() => buildPortalMeshPlan('x')).not.toThrow();
  });
});

describe('describePortalMeshPlan', () => {
  it('renders one stable line for a valid plan', () => {
    const s = describePortalMeshPlan(DEMO_PORTAL_MESH_OPTS);
    expect(s).toContain('Plebeian Market Bazaar');
    expect(s).toContain('Display-only');
  });
  it('reports INVALID for a bad plan', () => {
    expect(describePortalMeshPlan({})).toContain('INVALID');
  });
});

describe('portalMesh adapter — build/tick/dispose', () => {
  afterEach(() => disposePortalMesh());

  it('reports not-built before any build', () => {
    disposePortalMesh();
    const s = portalMeshRenderState();
    expect(s.rendered).toBe(false);
    expect(s.ok).toBe(false);
  });

  it('does NOT render without a scene (and does not throw)', () => {
    const s = buildPortalMesh(null, DEMO_PORTAL_MESH_OPTS);
    expect(s.rendered).toBe(false);
    expect(s.ok).toBe(false);
    expect(s.reasons).toContain('no-scene');
  });

  it('does NOT render when the plan is invalid', () => {
    const s = buildPortalMesh({ add() {}, remove() {} }, { range: 3 }); // no position
    expect(s.rendered).toBe(false);
    expect(s.ok).toBe(false);
    expect(s.reasons).toContain('invalid-position');
  });

  it('builds the inert marker once at the trigger position', () => {
    let added = null;
    const scene = { add(g) { added = g; }, remove() {} };
    const s = buildPortalMesh(scene, { position: { x: 20, y: 0, z: 0 }, range: 3 });
    expect(s.rendered).toBe(true);
    expect(s.ok).toBe(true);
    expect(s.count).toBe(2);
    expect(s.anchor).toEqual({ x: 20, y: 0, z: 0 });
    expect(s.ringRadius).toBe(3);
    expect(added).toBeTruthy();
    expect(added.name).toBe(PORTAL_MESH_GROUP);
    expect(added.children).toHaveLength(2);
    const sats = added.children[1];
    expect(sats.type).toBe('Group');
    expect(sats.children).toHaveLength(4);
    expect(new Set(sats.children.map((bar) => bar.material)).size).toBe(1);
    // Idempotent: a second build is a no-op (still one group added).
    const again = buildPortalMesh({ add() { throw new Error('should not add twice'); }, remove() {} }, DEMO_PORTAL_MESH_OPTS);
    expect(again.rendered).toBe(true);
  });

  it('tick is a safe no-op shape (does not throw, mutates only scalars)', () => {
    let added = null;
    buildPortalMesh({ add(g) { added = g; }, remove() {} }, DEMO_PORTAL_MESH_OPTS);
    const sats = added.children[1];
    const before = sats.rotation.y;
    expect(() => { tickPortalMesh(0.016); tickPortalMesh(); tickPortalMesh(NaN); }).not.toThrow();
    expect(sats.rotation.y).toBeGreaterThan(before);
  });

  it('setPortalApproach drives the marker glow (scalar only) and ignores bad input', () => {
    // Safe before any build.
    expect(() => setPortalApproach(1)).not.toThrow();
    let added = null;
    buildPortalMesh({ add(g) { added = g; }, remove() {} }, DEMO_PORTAL_MESH_OPTS);
    const sharedSatsMat = added.children[1].children[0].material;
    const before = sharedSatsMat.emissiveIntensity;
    expect(() => { setPortalApproach(0); setPortalApproach(1.05); setPortalApproach(NaN); setPortalApproach('x'); }).not.toThrow();
    expect(sharedSatsMat.emissiveIntensity).toBeGreaterThan(before);
  });

  it('dispose frees all geometries/materials and resets to a clean teardown state', () => {
    let added = null;
    buildPortalMesh({ add(g) { added = g; }, remove() {} }, DEMO_PORTAL_MESH_OPTS);
    const sats = added.children[1];
    const geometries = [added.children[0].geometry, ...sats.children.map((bar) => bar.geometry)];
    const materials = [...new Set([added.children[0].material, ...sats.children.map((bar) => bar.material)])];
    let disposedGeometries = 0;
    let disposedMaterials = 0;
    for (const geometry of geometries) geometry.addEventListener('dispose', () => { disposedGeometries += 1; });
    for (const material of materials) material.addEventListener('dispose', () => { disposedMaterials += 1; });
    disposePortalMesh();
    const s = portalMeshRenderState();
    expect(s.rendered).toBe(false);
    expect(s.reasons).toContain('disposed');
    expect(disposedGeometries).toBe(5);
    expect(disposedMaterials).toBe(2);
  });
});

describe('portalMeshPlanReport — debug shell', () => {
  it('confirms range alignment and all-parts-inert', () => {
    const r = portalMeshPlanReport();
    expect(r.title).toBe('PORTAL MESH PLAN');
    expect(r.badge).toBe(PORTAL_MESH_BADGE);
    expect(r.ok).toBe(true);
    expect(r.ringMatchesRange).toBe(true);
    expect(r.allPartsInert).toBe(true);
    for (const k of INERT_KEYS) expect(r[k]).toBe(false);
    expect(r.actionable).toBe(false);
    expect(r.rendered).toBe(false);
  });
});

describe('SDK exposure', () => {
  it('re-exports portalMeshPlan and lists it as experimental', () => {
    expect(SDK.portalMeshPlan).toBeTruthy();
    expect(typeof SDK.portalMeshPlan.buildPortalMeshPlan).toBe('function');
    expect(SDK.SDK_SURFACE.portalMeshPlan).toEqual({
      tier: SDK.STABILITY.EXPERIMENTAL,
      module: '../engine/gateway/portalMeshPlan.js',
    });
  });
});
