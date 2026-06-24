// tests/proof-surface-render-plan.test.js — pure RENDER PLAN for the first
// display-only proof-surface mesh pass (proofSurfaceRenderPlan.js, v0.2.150).
// Covers: the default plan gates open with one panel per spec in loop order;
// each panel is plain data (finite position/size/yawRad, numeric colour); inert
// flags are present and no live-action keys leak; failing either gate yields
// ok:false with the matching reason and no panels; the plan is deterministic;
// and panel placement/labels stay consistent with the specs + resolved anchors.
import { describe, it, expect } from 'vitest';
import {
  buildProofSurfaceRenderPlan,
  RENDER_PLAN_BADGE,
} from '../src/engine/world/proofSurfaceRenderPlan.js';
import { PROOF_SURFACE_SPECS } from '../src/engine/world/proofSurfaceSpecs.js';
import { resolveAllAnchors } from '../src/engine/world/anchorTransforms.js';

const FORBIDDEN_KEYS = [
  'fetch', 'navigate', 'href', 'url', 'onClick', 'onclick', 'sign', 'publish',
  'checkout', 'pay', 'zap', 'submit', 'relay', 'action', 'actions', 'mesh',
  'geometry', 'material', 'handler', 'listener',
];

const isPlainNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec3 = (v) =>
  v && typeof v === 'object' && isPlainNum(v.x) && isPlainNum(v.y) && isPlainNum(v.z);

describe('proofSurfaceRenderPlan — default (live gates)', () => {
  it('opens both gates and yields one panel per spec, in loop order', () => {
    const plan = buildProofSurfaceRenderPlan();
    expect(plan.ok).toBe(true);
    expect(plan.gates).toEqual({ anchorsOk: true, specCheckOk: true });
    expect(plan.badge).toBe(RENDER_PLAN_BADGE);
    expect(plan.count).toBe(PROOF_SURFACE_SPECS.length);
    expect(plan.panels).toHaveLength(PROOF_SURFACE_SPECS.length);
    expect(plan.reasons).toEqual([]);
    // Resolution order follows the spec order (Travel→Market→Score→Update).
    expect(plan.panels.map((p) => p.id)).toEqual(PROOF_SURFACE_SPECS.map((s) => s.id));
  });

  it('the plan itself renders nothing and is not actionable', () => {
    const plan = buildProofSurfaceRenderPlan();
    expect(plan.rendered).toBe(false);
    expect(plan.actionable).toBe(false);
  });

  it('each panel is plain finite data with a numeric colour', () => {
    const plan = buildProofSurfaceRenderPlan();
    for (const p of plan.panels) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.sublabel).toBe('string');
      expect(typeof p.anchor).toBe('string');
      expect(isVec3(p.position)).toBe(true);
      expect(isPlainNum(p.size.width)).toBe(true);
      expect(isPlainNum(p.size.height)).toBe(true);
      expect(isPlainNum(p.size.depth)).toBe(true);
      expect(isPlainNum(p.yawRad)).toBe(true);
      expect(typeof p.color).toBe('number');
      expect(Number.isFinite(p.color)).toBe(true);
      // Plain object prototype — never a THREE class.
      expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    }
  });

  it('marks every panel read-only/inert and leaks no live-action keys', () => {
    const plan = buildProofSurfaceRenderPlan();
    for (const p of plan.panels) {
      expect(p.readOnly).toBe(true);
      expect(p.actionable).toBe(false);
      for (const k of FORBIDDEN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(p, k)).toBe(false);
      }
    }
  });

  it('round-trips through JSON (pure data only)', () => {
    const plan = buildProofSurfaceRenderPlan();
    expect(() => JSON.parse(JSON.stringify(plan))).not.toThrow();
    const round = JSON.parse(JSON.stringify(plan));
    expect(round.panels).toHaveLength(plan.panels.length);
  });

  it('is deterministic across calls', () => {
    const a = buildProofSurfaceRenderPlan();
    const b = buildProofSurfaceRenderPlan();
    expect(a).toEqual(b);
  });

  it('keeps panel position/size/yaw/label consistent with specs + anchors', () => {
    const plan = buildProofSurfaceRenderPlan();
    const resolved = resolveAllAnchors().resolved;
    const tById = new Map(resolved.map((t) => [t.surfaceId, t]));
    const specById = new Map(PROOF_SURFACE_SPECS.map((s) => [s.id, s]));
    for (const p of plan.panels) {
      const t = tById.get(p.id);
      const spec = specById.get(p.id);
      expect(t).toBeTruthy();
      expect(spec).toBeTruthy();
      expect(p.position).toEqual({ x: t.position.x, y: t.position.y, z: t.position.z });
      expect(p.size).toEqual({ width: t.size.width, height: t.size.height, depth: t.size.depth });
      expect(p.yawRad).toBe(t.yawRad);
      expect(p.anchor).toBe(t.anchor);
      expect(p.parent).toBe(t.parent);
      expect(p.label).toBe(spec.title);
      expect(p.sublabel).toBe(`${spec.step} · ${spec.lean}`);
    }
  });

  it('carries the scene-graph parent hint on every panel', () => {
    const plan = buildProofSurfaceRenderPlan();
    for (const p of plan.panels) {
      expect(typeof p.parent).toBe('string');
      expect(p.parent.length).toBeGreaterThan(0);
    }
  });
});

describe('proofSurfaceRenderPlan — gate failures (injected)', () => {
  it('fails closed when anchors are unresolved', () => {
    const plan = buildProofSurfaceRenderPlan({ anchors: { ok: false, resolved: [] } });
    expect(plan.ok).toBe(false);
    expect(plan.gates.anchorsOk).toBe(false);
    expect(plan.reasons).toContain('anchors-unresolved');
    expect(plan.panels).toEqual([]);
    expect(plan.count).toBe(0);
  });

  it('fails closed when the spec check fails', () => {
    const plan = buildProofSurfaceRenderPlan({ check: { ok: false } });
    expect(plan.ok).toBe(false);
    expect(plan.gates.specCheckOk).toBe(false);
    expect(plan.reasons).toContain('spec-check-failed');
  });

  it('reports both reasons when both gates fail', () => {
    const plan = buildProofSurfaceRenderPlan({
      anchors: { ok: false, resolved: [] },
      check: { ok: false },
    });
    expect(plan.ok).toBe(false);
    expect(plan.reasons).toContain('anchors-unresolved');
    expect(plan.reasons).toContain('spec-check-failed');
    expect(plan.panels).toEqual([]);
  });

  it('stays ok:false when anchors resolve but the spec check still fails', () => {
    const plan = buildProofSurfaceRenderPlan({ check: { ok: false } });
    expect(plan.gates.anchorsOk).toBe(true);
    expect(plan.ok).toBe(false);
  });
});
