// tests/agent-handoff.test.js — pure AGENT HANDOFF READINESS assembly + formatting
// (tools/agentHandoff.mjs, v0.2.199). Covers buildAgentHandoff (composing a handoff-summary
// brief + an MVP-readiness rollup + the smoke-harness inventory), the text/markdown formatters,
// and degraded/missing-input cases. No fs/git — every input is plain data, fully deterministic
// (generatedAt is omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  AGENT_HANDOFF_BADGE, AGENT_HANDOFF_SCHEMA, AGENT_HANDOFF_SCHEMA_VERSION,
  AGENT_HANDOFF_WRITE_FILENAME, SMOKE_HARNESSES,
  buildAgentHandoff, formatAgentHandoff, formatAgentHandoffMarkdown,
} from '../tools/agentHandoff.mjs';

const V = 'v0.2.201-alpha';
const PKG = '0.2.201-alpha';

// A representative buildHandoffSummary() brief (the shape the CLI passes in).
const summary = () => ({
  schema: 'torii.handoff-summary',
  schemaVersion: 1,
  badge: 'AI HANDOFF SUMMARY · LOCAL · READ-ONLY',
  version: V,
  packageVersion: PKG,
  gitCommit: 'abc1234',
  liveUrl: 'https://torii-quest.pplx.app',
  gate: {
    status: 'ready', statusLabel: 'READY', ready: true,
    gateCommand: 'npm run test:release', blockers: [], unknowns: [],
    regression: { count: 15, expected: 15 },
    testProfiles: { fast: 5, foundation: 25 },
  },
  nextSafeTask: 'Continue safe no-blocker infrastructure/tooling/docs.',
  constraints: ['version bump every deploy', 'godMode false'],
  verifyCommands: [{ cmd: 'npm run check', desc: 'guardrails' }],
  latestReports: ['torii-v0.2.198-mvp-readiness-rollup-report.md'],
});

// A representative runMvpReadiness() rollup (all-green).
const rollup = (over = {}) => ({
  version: 1, badge: 'MVP READINESS ROLLUP · READ-ONLY · NO DEPLOY',
  ok: true, mvpPct: 100, status: 'READY', currentVersion: V,
  signals: [
    { key: 'nostr-read-health', label: 'Nostr read health', status: 'ok', detail: '' },
    { key: 'gateway-travel-smoke', label: 'Gateway travel', status: 'ok', detail: '' },
    { key: 'update-flow-smoke', label: 'Update flow', status: 'ok', detail: '' },
    { key: 'host-route-smoke', label: 'Host route', status: 'ok', detail: '' },
  ],
  summary: { total: 9, ok: 9, fail: 0 },
  reasons: [],
  nextSafeTask: { title: 'Next infra slice', why: 'keep cadence', kind: 'infra' },
  ...over,
});

describe('agent-handoff — constants', () => {
  it('exposes a stable badge, schema, and generated-file name', () => {
    expect(AGENT_HANDOFF_BADGE).toBe('AGENT HANDOFF READINESS · LOCAL · READ-ONLY');
    expect(AGENT_HANDOFF_SCHEMA).toBe('torii.agent-handoff');
    expect(AGENT_HANDOFF_SCHEMA_VERSION).toBe(1);
    expect(AGENT_HANDOFF_WRITE_FILENAME).toBe('HANDOFF.generated.md');
  });

  it('ships a frozen smoke-harness inventory mapping modules to SDK + shell', () => {
    expect(Object.isFrozen(SMOKE_HARNESSES)).toBe(true);
    const keys = SMOKE_HARNESSES.map((h) => h.key);
    expect(keys).toEqual([
      'readHealth', 'gatewayTravelSmoke', 'updateFlowSmoke', 'hostRouteSmoke', 'mvpReadiness',
    ]);
    for (const h of SMOKE_HARNESSES) {
      expect(typeof h.sdk).toBe('string');
      expect(typeof h.shell).toBe('string');
      expect(typeof h.purpose).toBe('string');
    }
    // The four signal-backed harnesses map to MVP-readiness signal keys; the rollup itself is null.
    const mapped = SMOKE_HARNESSES.filter((h) => h.signalKey).map((h) => h.signalKey);
    expect(mapped).toEqual([
      'nostr-read-health', 'gateway-travel-smoke', 'update-flow-smoke', 'host-route-smoke',
    ]);
  });
});

describe('buildAgentHandoff — assembly', () => {
  it('folds a summary + rollup into a stable export', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: rollup() });
    expect(h.schema).toBe(AGENT_HANDOFF_SCHEMA);
    expect(h.schemaVersion).toBe(AGENT_HANDOFF_SCHEMA_VERSION);
    expect(h.badge).toBe(AGENT_HANDOFF_BADGE);
    expect(h.generatedAt).toBe(null);
    expect(h.version).toBe(V);
    expect(h.packageVersion).toBe(PKG);
    expect(h.gitCommit).toBe('abc1234');
    expect(h.liveUrl).toBe('https://torii-quest.pplx.app');
    expect(h.gate.statusLabel).toBe('READY');
    expect(h.gate.ready).toBe(true);
    expect(h.gate.regression).toEqual({ count: 15, expected: 15 });
    expect(h.gate.testProfiles).toEqual({ fast: 5, foundation: 25 });
    expect(h.constraints).toContain('godMode false');
    expect(h.verifyCommands).toEqual([{ cmd: 'npm run check', desc: 'guardrails' }]);
    expect(h.latestReports).toEqual(['torii-v0.2.198-mvp-readiness-rollup-report.md']);
  });

  it('surfaces the MVP-readiness pct/status/summary', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: rollup() });
    expect(h.readiness.pct).toBe(100);
    expect(h.readiness.status).toBe('READY');
    expect(h.readiness.ok).toBe(true);
    expect(h.readiness.summary).toEqual({ total: 9, ok: 9, fail: 0 });
    expect(h.readiness.reasons).toEqual([]);
  });

  it('annotates each harness with its live status from the rollup signals', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: rollup() });
    expect(h.harnesses).toHaveLength(5);
    const byKey = Object.fromEntries(h.harnesses.map((x) => [x.key, x]));
    expect(byKey.readHealth.status).toBe('ok');
    expect(byKey.hostRouteSmoke.status).toBe('ok');
    expect(byKey.mvpReadiness.status).toBe(null); // the rollup itself has no backing signal
    expect(byKey.readHealth.sdk).toBe('SDK.readHealth');
    expect(byKey.readHealth.shell).toBe('shells.readHealth(o?)');
  });

  it('reflects a failing readiness signal as ✗ on its harness + NEAR status', () => {
    const r = rollup({
      ok: false, mvpPct: 89, status: 'NEAR',
      summary: { total: 9, ok: 8, fail: 1 }, reasons: ['host-route-smoke: failed'],
      signals: [
        { key: 'nostr-read-health', status: 'ok' },
        { key: 'host-route-smoke', status: 'fail' },
      ],
    });
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: r });
    expect(h.readiness.pct).toBe(89);
    expect(h.readiness.status).toBe('NEAR');
    expect(h.readiness.reasons).toEqual(['host-route-smoke: failed']);
    const byKey = Object.fromEntries(h.harnesses.map((x) => [x.key, x]));
    expect(byKey.hostRouteSmoke.status).toBe('fail');
  });

  it('prefers the rollup structured next-safe-task over the summary string', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: rollup() });
    expect(h.nextSafeTask).toEqual({ title: 'Next infra slice', why: 'keep cadence', kind: 'infra' });
  });

  it('falls back to the summary next-safe-task string when the rollup is absent', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: null });
    expect(h.nextSafeTask.title).toBe('Continue safe no-blocker infrastructure/tooling/docs.');
    expect(h.readiness.status).toBe('UNKNOWN');
    expect(h.readiness.pct).toBe(null);
  });

  it('degrades safely with no inputs (honest unknowns, never throws)', () => {
    const h = buildAgentHandoff();
    expect(h.schema).toBe(AGENT_HANDOFF_SCHEMA);
    expect(h.version).toBe(null);
    expect(h.gate.statusLabel).toBe('UNKNOWN');
    expect(h.gate.ready).toBe(false);
    expect(h.readiness.status).toBe('UNKNOWN');
    expect(h.harnesses).toHaveLength(5); // inventory still present, statuses null
    expect(h.harnesses.every((x) => x.status === null)).toBe(true);
    expect(h.constraints).toEqual([]);
  });

  it('tolerates garbled inputs (arrays / wrong types) without throwing', () => {
    const h = buildAgentHandoff({ handoffSummary: [1, 2], mvpReadiness: 'nope' });
    expect(h.version).toBe(null);
    expect(h.readiness.status).toBe('UNKNOWN');
    expect(h.harnesses).toHaveLength(5);
  });
});

describe('agent-handoff — formatters', () => {
  it('renders a text block with badge, readiness, harnesses, and verify commands', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: rollup() });
    const txt = formatAgentHandoff(h);
    expect(txt).toContain(AGENT_HANDOFF_BADGE);
    expect(txt).toContain('MVP readiness: 100% · READY');
    expect(txt).toContain('smoke harnesses');
    expect(txt).toContain('shells.readHealth(o?)');
    expect(txt).toContain('npm run check');
    expect(txt).toContain(V);
  });

  it('renders a markdown export with a harness table and the source-of-truth note', () => {
    const h = buildAgentHandoff({ handoffSummary: summary(), mvpReadiness: rollup() });
    const md = formatAgentHandoffMarkdown(h);
    expect(md).toContain('# Torii Quest — agent handoff readiness (generated)');
    expect(md).toContain('The curated `HANDOFF.md` stays the source of truth');
    expect(md).toContain('| Harness | SDK | Debug shell | Status | Purpose |');
    expect(md).toContain('| readHealth | `SDK.readHealth` | `shells.readHealth(o?)` | ok |');
    expect(md).toContain('**MVP readiness:** 100% · READY');
    expect(md).toContain('## Next safe task');
  });

  it('formatters are null-safe', () => {
    expect(formatAgentHandoff(null)).toBe('agent-handoff: (no handoff)');
    expect(formatAgentHandoffMarkdown(null)).toContain('_(no handoff)_');
  });
});
