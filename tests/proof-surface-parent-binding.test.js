// tests/proof-surface-parent-binding.test.js — pure scene-graph PARENT BINDING for the
// display-only proof-surface boards (proofSurfaceParentBinding.js, v0.2.151). Covers:
// the parent-hint → node-name / group-name maps; grouping a render plan's panels by
// parent in plan order; the live default plan binds all four panels into the two NAP
// groups (torii-gate + nap-zone-floor); panels with no parent land in `unbound`; the
// report is plain JSON data with no live-action keys; and it stays consistent with the
// anchor registry. No THREE/DOM/browser — fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  PARENT_BINDING_BADGE,
  PROOF_SURFACE_GROUP,
  PARENT_NODE_NAMES,
  parentNodeName,
  parentGroupName,
  resolveParentBindings,
} from '../src/engine/world/proofSurfaceParentBinding.js';
import { buildProofSurfaceRenderPlan } from '../src/engine/world/proofSurfaceRenderPlan.js';
import { PROOF_SURFACE_ANCHORS } from '../src/engine/world/anchorTransforms.js';

const FORBIDDEN_KEYS = [
  'fetch', 'navigate', 'href', 'url', 'onClick', 'onclick', 'sign', 'publish',
  'checkout', 'pay', 'zap', 'submit', 'relay', 'action', 'actions', 'mesh',
  'geometry', 'material', 'handler', 'listener',
];

describe('proofSurfaceParentBinding — name maps', () => {
  it('maps the two parent hints to stable live node names', () => {
    expect(PARENT_NODE_NAMES).toEqual({ 'torii-gate': 'torii-gate', 'nap-zone-floor': 'nap-zone-floor' });
    expect(parentNodeName('torii-gate')).toBe('torii-gate');
    expect(parentNodeName('nap-zone-floor')).toBe('nap-zone-floor');
    expect(parentNodeName('unknown')).toBe(null);
  });

  it('namespaces the per-parent group name under the root group', () => {
    expect(PROOF_SURFACE_GROUP).toBe('proof-surfaces');
    expect(parentGroupName('torii-gate')).toBe('proof-surfaces::torii-gate');
    expect(parentGroupName('nap-zone-floor')).toBe('proof-surfaces::nap-zone-floor');
  });

  it('every anchor parent hint resolves to a known live node name', () => {
    for (const a of Object.values(PROOF_SURFACE_ANCHORS)) {
      expect(parentNodeName(a.parent)).not.toBe(null);
    }
  });
});

describe('proofSurfaceParentBinding — resolveParentBindings (live plan)', () => {
  it('binds all four panels into the torii-gate + nap-zone-floor groups', () => {
    const binding = resolveParentBindings(buildProofSurfaceRenderPlan());
    expect(binding.badge).toBe(PARENT_BINDING_BADGE);
    expect(binding.group).toBe(PROOF_SURFACE_GROUP);
    expect(binding.ok).toBe(true);
    expect(binding.count).toBe(4);
    expect(binding.unbound).toEqual([]);
    expect(binding.groups.map((g) => g.parent)).toEqual(['torii-gate', 'nap-zone-floor']);

    const [gate, floor] = binding.groups;
    expect(gate.parentNode).toBe('torii-gate');
    expect(gate.groupName).toBe('proof-surfaces::torii-gate');
    expect(gate.panelIds).toEqual(['gateway-portal-panel']);

    expect(floor.parentNode).toBe('nap-zone-floor');
    expect(floor.groupName).toBe('proof-surfaces::nap-zone-floor');
    expect(floor.panelIds).toEqual(['product-stall-panel', 'leaderboard-board', 'update-prompt-board']);
  });

  it('every panel id appears in exactly one group (partition of the plan)', () => {
    const plan = buildProofSurfaceRenderPlan();
    const binding = resolveParentBindings(plan);
    const fromGroups = binding.groups.flatMap((g) => g.panelIds).sort();
    const fromPlan = plan.panels.map((p) => p.id).sort();
    expect(fromGroups).toEqual(fromPlan);
  });

  it('is deterministic and JSON-serialisable with no live-action keys', () => {
    const a = resolveParentBindings(buildProofSurfaceRenderPlan());
    const b = resolveParentBindings(buildProofSurfaceRenderPlan());
    expect(a).toEqual(b);
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
    expect(a.rendered).toBe(false);
    expect(a.actionable).toBe(false);
    for (const g of a.groups) {
      for (const k of FORBIDDEN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(g, k)).toBe(false);
      }
    }
  });

  it('falls back to the anchor registry when a panel omits parent', () => {
    const plan = buildProofSurfaceRenderPlan();
    const stripped = { panels: plan.panels.map(({ parent, ...rest }) => rest) };
    const binding = resolveParentBindings(stripped);
    expect(binding.ok).toBe(true);
    expect(binding.groups.map((g) => g.parent)).toEqual(['torii-gate', 'nap-zone-floor']);
  });
});

describe('proofSurfaceParentBinding — degrades safely', () => {
  it('reports unbound panels instead of throwing', () => {
    const binding = resolveParentBindings({ panels: [{ id: 'orphan', anchor: 'nope' }] });
    expect(binding.ok).toBe(false);
    expect(binding.unbound).toEqual(['orphan']);
    expect(binding.groups).toEqual([]);
  });

  it('handles a missing / empty plan without throwing', () => {
    expect(resolveParentBindings(null).ok).toBe(false);
    expect(resolveParentBindings({}).groups).toEqual([]);
    expect(resolveParentBindings({ panels: [] }).count).toBe(0);
  });
});
