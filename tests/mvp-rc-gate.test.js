// tests/mvp-rc-gate.test.js — pure MVP RELEASE-CANDIDATE GATE assembly + formatting
// (tools/mvpRcGate.mjs, v0.2.201). Covers buildMvpRcGate (folding an MVP-readiness rollup + a
// release-readiness summary into ONE READY/NEAR/BLOCKED verdict + pct + reasons + next tasks),
// the verdict banding, the blended percentage, the text/markdown formatters, and degraded /
// missing-input cases. No fs/git — every input is plain data, fully deterministic (generatedAt
// is omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  MVP_RC_GATE_SCHEMA, MVP_RC_GATE_SCHEMA_VERSION, MVP_RC_GATE_BADGE,
  MVP_RC_GATE_COMMAND, MVP_RC_STATES,
  buildMvpRcGate, formatMvpRcGate, formatMvpRcGateMarkdown,
} from '../tools/mvpRcGate.mjs';

const V = 'v0.2.201-alpha';

// A representative runMvpReadiness() rollup (all-green by default; override per case).
const rollup = (over = {}) => ({
  version: 1, badge: 'MVP READINESS ROLLUP · READ-ONLY · NO DEPLOY',
  ok: true, mvpPct: 100, status: 'READY', currentVersion: V,
  signals: [
    { key: 'version-marker', label: 'Version marker', status: 'ok', detail: `VERSION=${V}` },
    { key: 'nostr-read-health', label: 'Nostr read health', status: 'ok', detail: '3/3 signals' },
    { key: 'gateway-travel-smoke', label: 'Gateway travel', status: 'ok', detail: '' },
    { key: 'update-flow-smoke', label: 'Update flow', status: 'ok', detail: '' },
    { key: 'host-route-smoke', label: 'Host route', status: 'ok', detail: '' },
    { key: 'release-metadata-floor', label: 'Release metadata floor', status: 'ok', detail: '' },
    { key: 'test-suite', label: 'Test suite', status: 'ok', detail: '1251 passing / 79 files' },
    { key: 'vps-dry-run', label: 'VPS dry-run', status: 'ok', detail: '' },
    { key: 'docs-handoff', label: 'Docs / handoff', status: 'ok', detail: '' },
  ],
  summary: { total: 9, ok: 9, fail: 0 },
  reasons: [],
  nextSafeTask: { title: 'Continue the read-only oversight loop — next safe infra slice', why: 'keep cadence', kind: 'infra' },
  ...over,
});

// A representative buildReleaseReadiness() summary (all-green by default; override per case).
const release = (over = {}) => ({
  badge: 'RELEASE READINESS · LOCAL · READ-ONLY',
  gateCommand: 'npm run test:release',
  status: 'ready', statusLabel: 'READY', ready: true,
  blockers: [], unknowns: [],
  version: V, packageVersion: '0.2.201-alpha', gitCommit: 'abc1234',
  signals: {
    versionSync: { state: 'ok', ok: true },
    tests: { state: 'ok', ok: true, fast: 5, foundation: 25 },
    regression: { state: 'ok', ok: true, count: 15, expected: 15 },
    bundle: { state: 'advisory', ok: true, overLimit: ['rapier'] },
    zoneFallback: { state: 'ok', ok: true },
    docs: { state: 'ok', ok: true },
  },
  latestReports: ['torii-v0.2.200-dashboard-metric-freshness-report.md'],
  ...over,
});

describe('mvp-rc-gate — constants', () => {
  it('exposes a stable schema, version, badge, gate command, and state vocabulary', () => {
    expect(MVP_RC_GATE_SCHEMA).toBe('torii.mvp-rc-gate');
    expect(MVP_RC_GATE_SCHEMA_VERSION).toBe(1);
    expect(MVP_RC_GATE_BADGE).toBe('MVP RELEASE-CANDIDATE GATE · LOCAL · READ-ONLY');
    expect(MVP_RC_GATE_COMMAND).toBe('npm run test:release');
    expect(MVP_RC_STATES).toEqual(['READY', 'NEAR', 'BLOCKED']);
    expect(Object.isFrozen(MVP_RC_STATES)).toBe(true);
  });
});

describe('mvp-rc-gate — READY assembly', () => {
  it('folds two all-green composites into a READY candidate at 100%', () => {
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: release() });
    expect(g.schema).toBe('torii.mvp-rc-gate');
    expect(g.status).toBe('READY');
    expect(g.isCandidate).toBe(true);
    expect(g.pct).toBe(100);
    expect(g.reasons).toEqual([]);
    expect(g.version).toBe(V);
    expect(g.gitCommit).toBe('abc1234');
    expect(g.components.mvpReadiness).toMatchObject({ present: true, ok: true, pct: 100, status: 'READY', fails: 0 });
    expect(g.components.releaseReadiness).toMatchObject({ present: true, ready: true, requiredOk: 5, requiredTotal: 5 });
  });

  it('recommends the rollup next safe task (no blocker prefix when clean)', () => {
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: release() });
    expect(g.nextTasks.length).toBe(1);
    expect(g.nextTasks[0]).toContain('next safe infra slice');
    expect(g.nextTasks[0]).not.toMatch(/Clear top blocker/);
  });

  it('pins every safety flag false and stays inert', () => {
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: release() });
    expect(g.safety).toEqual({
      served: false, deployed: false, published: false, navigated: false,
      released: false, tagged: false, wrote: false, network: false,
    });
    expect(g.rendered).toBe(false);
    expect(g.actionable).toBe(false);
  });
});

describe('mvp-rc-gate — NEAR banding', () => {
  it('one short MVP signal (rollup NEAR) is a NEAR, not a block', () => {
    const mvp = rollup({
      ok: false, mvpPct: 89, status: 'NEAR',
      signals: rollup().signals.map((s, i) => i === 1 ? { ...s, status: 'fail', detail: '0/3 signals' } : s),
      summary: { total: 9, ok: 8, fail: 1 },
      reasons: ['nostr-read-health: 0/3 signals'],
    });
    const g = buildMvpRcGate({ mvpReadiness: mvp, releaseReadiness: release() });
    expect(g.status).toBe('NEAR');
    expect(g.isCandidate).toBe(false);
    expect(g.reasons).toContain('mvp:nostr-read-health: 0/3 signals');
    expect(g.nextTasks[0]).toMatch(/Clear top blocker/);
    expect(g.nextTasks.length).toBe(2);
  });

  it('a release UNKNOWN (incomplete, no blockers) is a NEAR with a "not checked" reason', () => {
    const rel = release({
      status: 'incomplete', statusLabel: 'INCOMPLETE · SIGNALS MISSING', ready: false,
      unknowns: ['zoneFallback'],
      signals: { ...release().signals, zoneFallback: { state: 'unknown', ok: false } },
    });
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: rel });
    expect(g.status).toBe('NEAR');
    expect(g.reasons).toContain('release:zoneFallback (not checked this pass)');
    expect(g.components.releaseReadiness.requiredOk).toBe(4);
  });
});

describe('mvp-rc-gate — BLOCKED banding', () => {
  it('a release blocker forces BLOCKED', () => {
    const rel = release({
      status: 'not-ready', statusLabel: 'NOT READY', ready: false,
      blockers: ['docs'],
      signals: { ...release().signals, docs: { state: 'blocked', ok: false } },
    });
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: rel });
    expect(g.status).toBe('BLOCKED');
    expect(g.isCandidate).toBe(false);
    expect(g.reasons[0]).toBe('release:docs');
    expect(g.nextTasks[0]).toBe('Clear top blocker: release:docs');
  });

  it('two or more failing MVP signals force BLOCKED', () => {
    const mvp = rollup({
      ok: false, mvpPct: 78, status: 'ATTENTION',
      signals: rollup().signals.map((s, i) => i < 2 ? { ...s, status: 'fail', detail: 'down' } : s),
      summary: { total: 9, ok: 7, fail: 2 },
    });
    const g = buildMvpRcGate({ mvpReadiness: mvp, releaseReadiness: release() });
    expect(g.status).toBe('BLOCKED');
    expect(g.reasons.filter((r) => r.startsWith('mvp:')).length).toBe(2);
  });

  it('missing inputs degrade to an honest BLOCKED with an explicit reason', () => {
    const g = buildMvpRcGate({});
    expect(g.status).toBe('BLOCKED');
    expect(g.isCandidate).toBe(false);
    expect(g.pct).toBe(0);
    expect(g.reasons[0]).toMatch(/inputs missing/);
    expect(g.components.mvpReadiness.present).toBe(false);
    expect(g.components.releaseReadiness.present).toBe(false);
  });
});

describe('mvp-rc-gate — blended percentage', () => {
  it('rcPct is the share of composed underlying signals that are ok', () => {
    // 9 mvp signals (1 failing → 8 ok) + 5 required release signals (1 blocked → 4 ok)
    //   = 12 / 14 ≈ 86%.
    const mvp = rollup({
      ok: false, status: 'NEAR',
      signals: rollup().signals.map((s, i) => i === 0 ? { ...s, status: 'fail' } : s),
      summary: { total: 9, ok: 8, fail: 1 },
    });
    const rel = release({
      status: 'not-ready', ready: false, blockers: ['docs'],
      signals: { ...release().signals, docs: { state: 'blocked', ok: false } },
    });
    const g = buildMvpRcGate({ mvpReadiness: mvp, releaseReadiness: rel });
    expect(g.pct).toBe(Math.round((12 / 14) * 100));
  });
});

describe('mvp-rc-gate — formatters', () => {
  it('text block carries badge, verdict, pct, candidate flag, and the gate command', () => {
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: release(), generatedAt: '2026-06-25T00:00:00Z' });
    const txt = formatMvpRcGate(g);
    expect(txt).toContain('MVP RELEASE-CANDIDATE GATE · LOCAL · READ-ONLY');
    expect(txt).toContain('READY');
    expect(txt).toContain('100%');
    expect(txt).toContain('release candidate: YES');
    expect(txt).toContain('npm run test:release');
    expect(txt).toContain('generated: 2026-06-25T00:00:00Z');
  });

  it('markdown carries the verdict, components, reasons heading, and gate command', () => {
    const rel = release({ status: 'not-ready', ready: false, blockers: ['docs'] });
    const g = buildMvpRcGate({ mvpReadiness: rollup(), releaseReadiness: rel });
    const md = formatMvpRcGateMarkdown(g);
    expect(md).toContain('# Torii Quest — MVP release-candidate gate');
    expect(md).toContain('**Verdict:** BLOCKED');
    expect(md).toContain('**Release candidate:** NO');
    expect(md).toContain('- release:docs');
    expect(md).toContain('## Next safe task(s)');
  });

  it('both formatters are null-safe', () => {
    expect(formatMvpRcGate(null)).toBe('mvp-rc-gate: (no verdict)');
    expect(formatMvpRcGateMarkdown(null)).toContain('_(no verdict)_');
  });
});

describe('mvp-rc-gate — robustness', () => {
  it('never throws on garbled inputs and reports honest UNKNOWN components', () => {
    expect(() => buildMvpRcGate({ mvpReadiness: 42, releaseReadiness: 'nope' })).not.toThrow();
    const g = buildMvpRcGate({ mvpReadiness: [], releaseReadiness: null });
    expect(g.status).toBe('BLOCKED');
    expect(g.components.mvpReadiness.present).toBe(false);
    expect(g.components.releaseReadiness.present).toBe(false);
  });
});
