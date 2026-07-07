// tests/release-readiness.test.js — pure release-readiness aggregation + formatting
// (tools/releaseReadiness.mjs, v0.2.187). Covers buildReleaseReadiness (verdict logic across
// version sync / test profiles / regression gate / bundle / zone fallback / docs) and
// formatReleaseReadiness. No fs/git — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  REGRESSION_CHECK_COUNT, RELEASE_READINESS_BADGE, RELEASE_GATE_COMMAND,
  RELEASE_STATUS_SCHEMA, RELEASE_STATUS_SCHEMA_VERSION,
  buildReleaseReadiness, formatReleaseReadiness, buildReleaseStatusJson,
} from '../tools/releaseReadiness.mjs';
import { PROFILES } from '../tools/testProfiles.mjs';

const V = 'v0.2.187-alpha';
const PKG = '0.2.187-alpha';

// Every test file the profiles reference exists (so validateProfiles passes).
const allTests = () => [
  ...new Set([...PROFILES.fast, ...PROFILES.foundation].map((f) => `tests/${f}`)),
];

const greenInputs = (over = {}) => ({
  version: V,
  packageVersion: PKG,
  gitCommit: 'abc1234',
  existingTests: allTests(),
  regression: { count: REGRESSION_CHECK_COUNT },
  bundle: { totals: { jsBytes: 2_900_000, jsGzip: 1_030_000 }, warnings: [] },
  zoneFallback: { ok: true, errors: [], warnings: [], dist: { skipped: false } },
  docs: { ok: true, errors: [], warnings: [] },
  latestReports: ['torii-v0.2.187-release-readiness-summary-report.md'],
  ...over,
});

describe('buildReleaseReadiness — verdict', () => {
  it('is READY when every required signal is present and ok', () => {
    const s = buildReleaseReadiness(greenInputs());
    expect(s.status).toBe('ready');
    expect(s.statusLabel).toBe('READY');
    expect(s.ready).toBe(true);
    expect(s.blockers).toEqual([]);
    expect(s.unknowns).toEqual([]);
    expect(s.badge).toBe(RELEASE_READINESS_BADGE);
    expect(s.gateCommand).toBe(RELEASE_GATE_COMMAND);
  });

  it('is NOT READY (version blocker) when config/package versions drift', () => {
    const s = buildReleaseReadiness(greenInputs({ packageVersion: '0.2.186-alpha' }));
    expect(s.status).toBe('not-ready');
    expect(s.blockers).toContain('versionSync');
    expect(s.ready).toBe(false);
  });

  it('is NOT READY when the regression gate has fewer than expected checks', () => {
    const s = buildReleaseReadiness(greenInputs({ regression: { count: 14 } }));
    expect(s.blockers).toContain('regression');
    expect(s.signals.regression.ok).toBe(false);
  });

  it('is NOT READY when zone fallback or docs consistency fail', () => {
    const s = buildReleaseReadiness(greenInputs({
      zoneFallback: { ok: false, errors: ['VPS_INSTALL.md missing fallback'], warnings: [], dist: { skipped: false } },
      docs: { ok: false, errors: ['torii-quest-todo.md does not reference current version'], warnings: [] },
    }));
    expect(s.status).toBe('not-ready');
    expect(s.blockers).toEqual(expect.arrayContaining(['zoneFallback', 'docs']));
  });

  it('treats a bundle over the warn limit as ADVISORY — never a blocker', () => {
    const s = buildReleaseReadiness(greenInputs({
      bundle: { totals: { jsBytes: 2_900_000, jsGzip: 1_030_000 }, warnings: ['rapier-DE6a0vmv.js'] },
    }));
    expect(s.signals.bundle.state).toBe('advisory');
    expect(s.signals.bundle.ok).toBe(true);
    expect(s.status).toBe('ready');
    expect(s.blockers).toEqual([]);
  });

  it('does not block when the dist route check is skipped (no build this pass)', () => {
    const s = buildReleaseReadiness(greenInputs({
      bundle: null,
      zoneFallback: { ok: true, errors: [], warnings: [], dist: { skipped: true } },
    }));
    expect(s.signals.bundle.state).toBe('skipped');
    expect(s.signals.zoneFallback.distSkipped).toBe(true);
    expect(s.status).toBe('ready');
  });

  it('is INCOMPLETE (not READY) when a required signal is unknown', () => {
    const s = buildReleaseReadiness(greenInputs({ regression: null, zoneFallback: null, docs: null }));
    expect(s.status).toBe('incomplete');
    expect(s.ready).toBe(false);
    expect(s.unknowns).toEqual(expect.arrayContaining(['regression', 'zoneFallback', 'docs']));
    expect(s.blockers).toEqual([]);
  });

  it('blocks (not merely incomplete) when a present signal fails alongside unknowns', () => {
    const s = buildReleaseReadiness(greenInputs({ packageVersion: 'x', docs: null }));
    expect(s.status).toBe('not-ready');
    expect(s.blockers).toContain('versionSync');
  });

  it('surfaces the test-profile file counts from the registry', () => {
    const s = buildReleaseReadiness(greenInputs());
    expect(s.signals.tests.fast).toBe(PROFILES.fast.length);
    expect(s.signals.tests.foundation).toBe(PROFILES.foundation.length);
    expect(s.signals.tests.ok).toBe(true);
  });

  it('flags a stale profile entry as a test blocker', () => {
    const s = buildReleaseReadiness(greenInputs({ existingTests: ['tests/state.test.js'] }));
    expect(s.signals.tests.ok).toBe(false);
    expect(s.blockers).toContain('tests');
  });

  it('is deterministic and JSON-serialisable, and does not mutate caller arrays', () => {
    const reports = ['r1.md'];
    const args = greenInputs({ latestReports: reports });
    const a = buildReleaseReadiness(args);
    const b = buildReleaseReadiness(args);
    expect(a).toEqual(b);
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
    a.latestReports.push('mutated.md');
    expect(reports).toEqual(['r1.md']);
  });
});

describe('formatReleaseReadiness', () => {
  it('renders the verdict, version, and every signal line', () => {
    const out = formatReleaseReadiness(buildReleaseReadiness(greenInputs()));
    expect(out).toContain('READY');
    expect(out).toContain(V);
    expect(out).toContain('version sync');
    expect(out).toContain('test profiles');
    expect(out).toContain('regression gate');
    expect(out).toContain('bundle baseline');
    expect(out).toContain('zone /zone/* fb');
    expect(out).toContain('docs consistency');
    expect(out).toContain(RELEASE_GATE_COMMAND);
  });

  it('lists blockers in the text when not ready', () => {
    const out = formatReleaseReadiness(buildReleaseReadiness(greenInputs({ packageVersion: 'x' })));
    expect(out).toContain('NOT READY');
    expect(out).toContain('blockers:');
    expect(out).toContain('versionSync');
  });

  it('notes a skipped bundle (no dist/) honestly', () => {
    const out = formatReleaseReadiness(buildReleaseReadiness(greenInputs({ bundle: null })));
    expect(out).toContain('no dist/');
  });

  it('is safe on bad input', () => {
    expect(formatReleaseReadiness(null)).toContain('no summary');
  });
});

describe('buildReleaseStatusJson — machine-readable envelope (v0.2.189)', () => {
  it('wraps a summary in a stable schema envelope and preserves the verdict', () => {
    const summary = buildReleaseReadiness(greenInputs());
    const json = buildReleaseStatusJson(summary);
    expect(json.schema).toBe(RELEASE_STATUS_SCHEMA);
    expect(json.schemaVersion).toBe(RELEASE_STATUS_SCHEMA_VERSION);
    expect(json.status).toBe('ready');
    expect(json.statusLabel).toBe('READY');
    expect(json.ready).toBe(true);
    expect(json.blockers).toEqual([]);
    expect(json.unknowns).toEqual([]);
    expect(json.version).toBe(V);
    expect(json.packageVersion).toBe(PKG);
    expect(json.gitCommit).toBe('abc1234');
    expect(json.badge).toBe(RELEASE_READINESS_BADGE);
    expect(json.gateCommand).toBe(RELEASE_GATE_COMMAND);
    expect(Object.keys(json.signals)).toEqual(
      expect.arrayContaining(['versionSync', 'tests', 'regression', 'bundle', 'zoneFallback', 'docs']),
    );
  });

  it('omits the timestamp by default (deterministic) and isolates it when supplied', () => {
    const summary = buildReleaseReadiness(greenInputs());
    const a = buildReleaseStatusJson(summary);
    const b = buildReleaseStatusJson(summary);
    expect(a.generatedAt).toBeNull();
    expect(a).toEqual(b); // fully reproducible with no stamp
    const stamped = buildReleaseStatusJson(summary, { generatedAt: '2026-06-25T00:00:00.000Z' });
    expect(stamped.generatedAt).toBe('2026-06-25T00:00:00.000Z');
    // The stamp is the ONLY difference — strip it and the envelopes match.
    const { generatedAt: _s, ...restStamped } = stamped;
    const { generatedAt: _a, ...restA } = a;
    expect(restStamped).toEqual(restA);
  });

  it('ignores a non-string timestamp and stays JSON-serialisable', () => {
    const summary = buildReleaseReadiness(greenInputs());
    const json = buildReleaseStatusJson(summary, { generatedAt: 12345 });
    expect(json.generatedAt).toBeNull();
    expect(() => JSON.parse(JSON.stringify(json))).not.toThrow();
  });

  it('carries blockers and the not-ready verdict through to the envelope', () => {
    const summary = buildReleaseReadiness(greenInputs({ packageVersion: '0.2.186-alpha' }));
    const json = buildReleaseStatusJson(summary);
    expect(json.status).toBe('not-ready');
    expect(json.ready).toBe(false);
    expect(json.blockers).toContain('versionSync');
  });

  it('carries the incomplete verdict + unknown signals through', () => {
    const summary = buildReleaseReadiness(greenInputs({ regression: null, zoneFallback: null, docs: null }));
    const json = buildReleaseStatusJson(summary);
    expect(json.status).toBe('incomplete');
    expect(json.ready).toBe(false);
    expect(json.unknowns).toEqual(expect.arrayContaining(['regression', 'zoneFallback', 'docs']));
  });

  it('degrades to an honest unknown envelope on a missing/garbled summary (never throws)', () => {
    for (const bad of [null, undefined, 42, 'nope', []]) {
      const json = buildReleaseStatusJson(bad);
      expect(json.schema).toBe(RELEASE_STATUS_SCHEMA);
      expect(json.schemaVersion).toBe(RELEASE_STATUS_SCHEMA_VERSION);
      expect(json.status).toBe('unknown');
      expect(json.ready).toBe(false);
      expect(json.error).toBe('no-summary');
      expect(json.signals).toEqual({});
      expect(json.blockers).toEqual([]);
      expect(() => JSON.parse(JSON.stringify(json))).not.toThrow();
    }
  });

  it('does not mutate the source summary arrays/signals', () => {
    const summary = buildReleaseReadiness(greenInputs({ latestReports: ['r1.md'] }));
    const json = buildReleaseStatusJson(summary);
    json.blockers.push('x');
    json.latestReports.push('x.md');
    json.signals.tests.fast = -1;
    expect(summary.latestReports).toEqual(['r1.md']);
    expect(summary.blockers).toEqual([]);
    expect(summary.signals.tests.fast).toBe(PROFILES.fast.length);
  });
});
