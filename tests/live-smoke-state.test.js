// tests/live-smoke-state.test.js — pure LIVE-SMOKE STATE helpers (tools/liveSmokeState.mjs,
// v0.2.231). Covers buildLiveSmokeState (shape + result coercion + check normalisation),
// validateLiveSmokeState (the pass-requires-evidence safety floor), isLiveSmokePass, the
// formatter, summarizeLiveSmokeForState (the block folded into the next-action state), the
// required-keys guard, and a NON-STALENESS guard on the committed LIVE_SMOKE_STATE.json: it must
// parse, validate, and never claim a version NEWER than the build (a smoke can only observe a
// deployed build, so the recorded version may equal or lag config VERSION, never lead). No
// fs/network beyond the one committed-artifact read; every other input is plain data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIVE_SMOKE_BADGE, LIVE_SMOKE_SCHEMA, LIVE_SMOKE_SCHEMA_VERSION, LIVE_SMOKE_FILE,
  LIVE_SMOKE_RESULTS, LIVE_SMOKE_REQUIRED_KEYS,
  buildLiveSmokeState, validateLiveSmokeState, isLiveSmokePass,
  formatLiveSmokeState, summarizeLiveSmokeForState,
} from '../tools/liveSmokeState.mjs';
import { VERSION } from '../src/config.js';

const passingChecks = [
  { id: 'a', label: 'A', expected: 'x', observed: 'x', outcome: 'pass' },
  { id: 'b', label: 'B', expected: 'y', observed: 'y', outcome: 'pass' },
];

describe('live-smoke-state — constants', () => {
  it('exposes a stable schema id, version, file, and frozen required-keys', () => {
    expect(LIVE_SMOKE_SCHEMA).toBe('torii.live-smoke-state');
    expect(LIVE_SMOKE_SCHEMA_VERSION).toBe(1);
    expect(LIVE_SMOKE_FILE).toBe('LIVE_SMOKE_STATE.json');
    expect(LIVE_SMOKE_BADGE).toMatch(/READ-ONLY/);
    expect(Object.isFrozen(LIVE_SMOKE_REQUIRED_KEYS)).toBe(true);
  });
});

describe('buildLiveSmokeState — shape + coercion', () => {
  it('always returns the required keys, even on empty input', () => {
    const s = buildLiveSmokeState();
    for (const k of LIVE_SMOKE_REQUIRED_KEYS) expect(s).toHaveProperty(k);
    expect(s.kind).toBe(LIVE_SMOKE_SCHEMA);
    expect(s.result).toBe(LIVE_SMOKE_RESULTS.UNKNOWN);
  });

  it('coerces any non pass/fail result to unknown (no silent pass via typo)', () => {
    expect(buildLiveSmokeState({ result: 'PASSED' }).result).toBe('unknown');
    expect(buildLiveSmokeState({ result: 'ok' }).result).toBe('unknown');
    expect(buildLiveSmokeState({ result: true }).result).toBe('unknown');
    expect(buildLiveSmokeState({ result: 'pass' }).result).toBe('pass');
    expect(buildLiveSmokeState({ result: 'fail' }).result).toBe('fail');
  });

  it('normalises checks: drops idless entries and coerces unknown outcomes to skip', () => {
    const s = buildLiveSmokeState({
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

  it('pins the safety block all-false, including impliesApproval', () => {
    const s = buildLiveSmokeState({ result: 'pass' });
    expect(s.safety).toEqual({
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false, impliesApproval: false,
    });
  });
});

describe('validateLiveSmokeState — the pass-requires-evidence floor', () => {
  it('a green verdict needs ≥1 check, all passing, a version, and a smokedAt', () => {
    const ok = buildLiveSmokeState({
      result: 'pass', version: 'v0.2.230-alpha', smokedAt: '2026-06-26', checks: passingChecks,
    });
    expect(validateLiveSmokeState(ok).ok).toBe(true);
    expect(isLiveSmokePass(ok)).toBe(true);
  });

  it('rejects a pass with no checks', () => {
    const s = buildLiveSmokeState({ result: 'pass', version: 'v0.2.230-alpha', smokedAt: '2026-06-26' });
    const v = validateLiveSmokeState(s);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/at least one recorded check/);
    expect(isLiveSmokePass(s)).toBe(false);
  });

  it('rejects a pass while any check failed', () => {
    const s = buildLiveSmokeState({
      result: 'pass', version: 'v0.2.230-alpha', smokedAt: '2026-06-26',
      checks: [...passingChecks, { id: 'c', outcome: 'fail' }],
    });
    expect(validateLiveSmokeState(s).ok).toBe(false);
    expect(isLiveSmokePass(s)).toBe(false);
  });

  it('rejects a pass with no version or no smokedAt', () => {
    expect(validateLiveSmokeState(buildLiveSmokeState({ result: 'pass', smokedAt: '2026-06-26', checks: passingChecks })).ok).toBe(false);
    expect(validateLiveSmokeState(buildLiveSmokeState({ result: 'pass', version: 'v0.2.230-alpha', checks: passingChecks })).ok).toBe(false);
  });

  it('a fail verdict is valid; warns when it carries no checks', () => {
    const s = buildLiveSmokeState({ result: 'fail', version: 'v0.2.230-alpha' });
    const v = validateLiveSmokeState(s);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/no checks/);
  });

  it('flags a bad shape rather than throwing', () => {
    expect(validateLiveSmokeState(null).ok).toBe(false);
    expect(validateLiveSmokeState([]).ok).toBe(false);
  });
});

describe('summarizeLiveSmokeForState — folded block', () => {
  it('summarises counts and never implies approval', () => {
    const s = buildLiveSmokeState({
      result: 'pass', version: 'v0.2.230-alpha', smokedAt: '2026-06-26', checks: passingChecks,
    });
    expect(summarizeLiveSmokeForState(s)).toEqual({
      result: 'pass', pass: true, version: 'v0.2.230-alpha', smokedAt: '2026-06-26',
      checks: 2, passed: 2, failed: 0, impliesApproval: false,
    });
  });

  it('an invalid pass summarises as pass:false', () => {
    const s = buildLiveSmokeState({ result: 'pass' }); // no evidence
    expect(summarizeLiveSmokeForState(s).pass).toBe(false);
  });

  it('degrades to unknown on null/garbled input', () => {
    expect(summarizeLiveSmokeForState(null)).toMatchObject({ result: 'unknown', pass: false, impliesApproval: false });
  });
});

describe('formatLiveSmokeState — terminal block', () => {
  it('renders the badge, verdict, and each check; safe on null', () => {
    const s = buildLiveSmokeState({
      result: 'pass', version: 'v0.2.230-alpha', smokedAt: '2026-06-26', checks: passingChecks,
    });
    const out = formatLiveSmokeState(s);
    expect(out).toMatch(/live smoke state/i);
    expect(out).toMatch(/✓ PASS/);
    expect(out).toMatch(/checks:\s*2/);
    expect(formatLiveSmokeState(null)).toMatch(/no state/);
  });
});

describe('live-smoke-state — committed artifact is not stale', () => {
  it('LIVE_SMOKE_STATE.json (if present) parses, validates, and never leads config VERSION', () => {
    let raw = null;
    try { raw = readFileSync(join(process.cwd(), LIVE_SMOKE_FILE), 'utf8'); } catch { raw = null; }
    if (raw == null) return; // absence is not a failure here
    const parsed = JSON.parse(raw);
    const state = buildLiveSmokeState(parsed);
    expect(state.kind).toBe(LIVE_SMOKE_SCHEMA);
    expect(validateLiveSmokeState(state).ok).toBe(true);
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
