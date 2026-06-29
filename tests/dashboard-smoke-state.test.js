// tests/dashboard-smoke-state.test.js — pure DASHBOARD-SMOKE STATE helpers
// (tools/dashboardSmokeState.mjs, v0.2.232). Covers buildDashboardSmokeState (shape + result
// coercion + check normalisation), validateDashboardSmokeState (the pass-requires-evidence safety
// floor), isDashboardSmokePass, the formatter, summarizeDashboardSmokeForState (the block folded
// into the next-action state), the required-keys guard, and a NON-STALENESS guard on the committed
// DASHBOARD_SMOKE_STATE.json: it must parse, validate, and never claim a version NEWER than the
// build (a smoke can only observe a deployed build, so the recorded version may equal or lag config
// VERSION, never lead). No fs/network beyond the one committed-artifact read; every other input is
// plain data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DASHBOARD_SMOKE_BADGE, DASHBOARD_SMOKE_SCHEMA, DASHBOARD_SMOKE_SCHEMA_VERSION,
  DASHBOARD_SMOKE_FILE, DASHBOARD_SMOKE_RESULTS, DASHBOARD_SMOKE_REQUIRED_KEYS,
  buildDashboardSmokeState, validateDashboardSmokeState, isDashboardSmokePass,
  formatDashboardSmokeState, summarizeDashboardSmokeForState,
} from '../tools/dashboardSmokeState.mjs';
import { VERSION } from '../src/config.js';

const passingChecks = [
  { id: 'a', label: 'A', expected: 'x', observed: 'x', outcome: 'pass' },
  { id: 'b', label: 'B', expected: 'y', observed: 'y', outcome: 'pass' },
];

describe('dashboard-smoke-state — constants', () => {
  it('exposes a stable schema id, version, file, and frozen required-keys', () => {
    expect(DASHBOARD_SMOKE_SCHEMA).toBe('torii.dashboard-smoke-state');
    expect(DASHBOARD_SMOKE_SCHEMA_VERSION).toBe(1);
    expect(DASHBOARD_SMOKE_FILE).toBe('DASHBOARD_SMOKE_STATE.json');
    expect(DASHBOARD_SMOKE_BADGE).toMatch(/READ-ONLY/);
    expect(Object.isFrozen(DASHBOARD_SMOKE_REQUIRED_KEYS)).toBe(true);
  });
});

describe('buildDashboardSmokeState — shape + coercion', () => {
  it('always returns the required keys, even on empty input', () => {
    const s = buildDashboardSmokeState();
    for (const k of DASHBOARD_SMOKE_REQUIRED_KEYS) expect(s).toHaveProperty(k);
    expect(s.kind).toBe(DASHBOARD_SMOKE_SCHEMA);
    expect(s.result).toBe(DASHBOARD_SMOKE_RESULTS.UNKNOWN);
  });

  it('coerces any non pass/fail result to unknown (no silent pass via typo)', () => {
    expect(buildDashboardSmokeState({ result: 'PASSED' }).result).toBe('unknown');
    expect(buildDashboardSmokeState({ result: 'ok' }).result).toBe('unknown');
    expect(buildDashboardSmokeState({ result: true }).result).toBe('unknown');
    expect(buildDashboardSmokeState({ result: 'pass' }).result).toBe('pass');
    expect(buildDashboardSmokeState({ result: 'fail' }).result).toBe('fail');
  });

  it('normalises checks: drops idless entries and coerces unknown outcomes to skip', () => {
    const s = buildDashboardSmokeState({
      checks: [
        { id: 'ok', outcome: 'pass' },
        { label: 'no id', outcome: 'pass' },
        { id: 'weird', outcome: 'definitely' },
      ],
    });
    expect(s.checks).toHaveLength(2);
    expect(s.checks[0]).toMatchObject({ id: 'ok', label: 'ok', outcome: 'pass' });
    expect(s.checks[1].outcome).toBe('skip');
  });

  it('keeps the surface field and pins the safety block all-false', () => {
    const s = buildDashboardSmokeState({ result: 'pass', surface: 'dashboard.html' });
    expect(s.surface).toBe('dashboard.html');
    expect(s.safety).toEqual({
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false,
      impliesApproval: false, impliesPlaytestComplete: false,
    });
  });
});

describe('validateDashboardSmokeState — the pass-requires-evidence floor', () => {
  it('a green verdict needs ≥1 check, all passing, a version, and a smokedAt', () => {
    const ok = buildDashboardSmokeState({
      result: 'pass', version: 'v0.2.231-alpha', smokedAt: '2026-06-26', checks: passingChecks,
    });
    expect(validateDashboardSmokeState(ok).ok).toBe(true);
    expect(isDashboardSmokePass(ok)).toBe(true);
  });

  it('rejects a pass with no checks', () => {
    const s = buildDashboardSmokeState({ result: 'pass', version: 'v0.2.231-alpha', smokedAt: '2026-06-26' });
    const v = validateDashboardSmokeState(s);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/at least one recorded check/);
    expect(isDashboardSmokePass(s)).toBe(false);
  });

  it('rejects a pass while any check failed', () => {
    const s = buildDashboardSmokeState({
      result: 'pass', version: 'v0.2.231-alpha', smokedAt: '2026-06-26',
      checks: [...passingChecks, { id: 'c', outcome: 'fail' }],
    });
    expect(validateDashboardSmokeState(s).ok).toBe(false);
    expect(isDashboardSmokePass(s)).toBe(false);
  });

  it('rejects a pass with no version or no smokedAt', () => {
    expect(validateDashboardSmokeState(buildDashboardSmokeState({ result: 'pass', smokedAt: '2026-06-26', checks: passingChecks })).ok).toBe(false);
    expect(validateDashboardSmokeState(buildDashboardSmokeState({ result: 'pass', version: 'v0.2.231-alpha', checks: passingChecks })).ok).toBe(false);
  });

  it('a fail verdict is valid; warns when it carries no checks', () => {
    const s = buildDashboardSmokeState({ result: 'fail', version: 'v0.2.231-alpha' });
    const v = validateDashboardSmokeState(s);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/no checks/);
  });

  it('flags a bad shape rather than throwing', () => {
    expect(validateDashboardSmokeState(null).ok).toBe(false);
    expect(validateDashboardSmokeState([]).ok).toBe(false);
  });
});

describe('summarizeDashboardSmokeForState — folded block', () => {
  it('summarises counts and never implies approval or playtest-complete', () => {
    const s = buildDashboardSmokeState({
      result: 'pass', version: 'v0.2.231-alpha', surface: 'dashboard.html',
      smokedAt: '2026-06-26', checks: passingChecks,
    });
    expect(summarizeDashboardSmokeForState(s)).toEqual({
      result: 'pass', pass: true, version: 'v0.2.231-alpha', surface: 'dashboard.html',
      smokedAt: '2026-06-26', checks: 2, passed: 2, failed: 0,
      impliesApproval: false, impliesPlaytestComplete: false,
    });
  });

  it('an invalid pass summarises as pass:false', () => {
    const s = buildDashboardSmokeState({ result: 'pass' }); // no evidence
    expect(summarizeDashboardSmokeForState(s).pass).toBe(false);
  });

  it('degrades to unknown on null/garbled input', () => {
    expect(summarizeDashboardSmokeForState(null)).toMatchObject({
      result: 'unknown', pass: false, impliesApproval: false, impliesPlaytestComplete: false,
    });
  });
});

describe('formatDashboardSmokeState — terminal block', () => {
  it('renders the badge, verdict, surface, and each check; safe on null', () => {
    const s = buildDashboardSmokeState({
      result: 'pass', version: 'v0.2.231-alpha', surface: 'dashboard.html',
      smokedAt: '2026-06-26', checks: passingChecks,
    });
    const out = formatDashboardSmokeState(s);
    expect(out).toMatch(/dashboard smoke state/i);
    expect(out).toMatch(/✓ PASS/);
    expect(out).toMatch(/dashboard\.html/);
    expect(out).toMatch(/checks:\s*2/);
    expect(formatDashboardSmokeState(null)).toMatch(/no state/);
  });
});

describe('dashboard-smoke-state — committed artifact is not stale', () => {
  it('DASHBOARD_SMOKE_STATE.json (if present) parses, validates, and never leads config VERSION', () => {
    let raw = null;
    try { raw = readFileSync(join(process.cwd(), DASHBOARD_SMOKE_FILE), 'utf8'); } catch { raw = null; }
    if (raw == null) return; // absence is not a failure here
    const parsed = JSON.parse(raw);
    const state = buildDashboardSmokeState(parsed);
    expect(state.kind).toBe(DASHBOARD_SMOKE_SCHEMA);
    expect(validateDashboardSmokeState(state).ok).toBe(true);
    // A smoke can only observe a DEPLOYED build, so the recorded version may equal or lag the
    // current config VERSION, but must never LEAD it (that would be a fabricated/typo'd record).
    const toParts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map(Number);
    const [a, b, c] = toParts(state.version);
    const [x, y, z] = toParts(VERSION);
    const recorded = a * 1e6 + b * 1e3 + c;
    const build = x * 1e6 + y * 1e3 + z;
    expect(recorded).toBeLessThanOrEqual(build);
  });
});
