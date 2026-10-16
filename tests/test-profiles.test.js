// tests/test-profiles.test.js — locks the pure TEST-PROFILE registry (tools/testProfiles.mjs,
// v0.2.173): the fast/foundation file lists, profile resolution, the validate-against-disk
// guard (every listed test must exist on disk, and fast must nest inside foundation), and the
// timing/summary formatting. Also reads the real tests/ dir so a renamed/deleted test trips
// validateProfiles here instead of silently shrinking a profile. Pure + node-safe.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ALL_TESTS_GLOB, TESTS_DIR, PROFILES, PROFILE_NAMES,
  isKnownProfile, profileBasenames, profileFiles, validateProfiles,
  formatProfileLine, formatTiming,
} from '../tools/testProfiles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const realTestFiles = readdirSync(here, { recursive: true })
  .map((f) => String(f).split('\\').join('/'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => `tests/${f}`);

describe('registry shape', () => {
  it('exposes frozen fast + foundation profiles and their names', () => {
    expect(PROFILE_NAMES).toEqual(['fast', 'foundation']);
    expect(Object.isFrozen(PROFILES)).toBe(true);
    expect(Object.isFrozen(PROFILES.fast)).toBe(true);
    expect(Object.isFrozen(PROFILES.foundation)).toBe(true);
    expect(TESTS_DIR).toBe('tests');
    expect(ALL_TESTS_GLOB).toBe('tests/**/*.test.js');
  });

  it('release is NOT a curated file list (full suite is the gate, not a subset)', () => {
    expect(PROFILES).not.toHaveProperty('release');
  });

  it('fast is small and foundation is broader', () => {
    expect(PROFILES.fast.length).toBeGreaterThan(0);
    expect(PROFILES.foundation.length).toBeGreaterThan(PROFILES.fast.length);
  });
});

describe('resolution helpers', () => {
  it('isKnownProfile only accepts defined profiles', () => {
    expect(isKnownProfile('fast')).toBe(true);
    expect(isKnownProfile('foundation')).toBe(true);
    expect(isKnownProfile('release')).toBe(false);
    expect(isKnownProfile('nope')).toBe(false);
    expect(isKnownProfile(undefined)).toBe(false);
  });

  it('profileBasenames returns the list for known, [] for unknown', () => {
    expect(profileBasenames('fast')).toContain('state.test.js');
    expect(profileBasenames('bogus')).toEqual([]);
  });

  it('profileFiles maps to repo-relative tests/ paths (the vitest args)', () => {
    expect(profileFiles('fast')).toContain('tests/state.test.js');
    expect(profileFiles('fast').every((p) => p.startsWith('tests/'))).toBe(true);
    expect(profileFiles('bogus')).toEqual([]);
  });
});

describe('profile nesting + on-disk validity', () => {
  it('fast is a strict subset of foundation', () => {
    const f = new Set(PROFILES.foundation);
    expect(PROFILES.fast.every((t) => f.has(t))).toBe(true);
  });

  it('validateProfiles is ok against the real tests/ directory (no stale entries)', () => {
    const { ok, missing, notSubset, errors } = validateProfiles(realTestFiles);
    expect(missing).toEqual([]);
    expect(notSubset).toEqual([]);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it('validateProfiles flags a missing test file', () => {
    const withoutState = realTestFiles.filter((f) => f !== 'tests/state.test.js');
    const { ok, missing } = validateProfiles(withoutState);
    expect(ok).toBe(false);
    expect(missing.some((m) => m.file === 'tests/state.test.js')).toBe(true);
  });
});

describe('formatting', () => {
  it('formatProfileLine summarises size', () => {
    expect(formatProfileLine('fast')).toMatch(/profile "fast": \d+ test files?/);
    expect(formatProfileLine('nope')).toBe('unknown profile: nope');
  });

  it('formatTiming renders seconds with a file count', () => {
    expect(formatTiming('fast', 5, 1234)).toBe('test:fast — ran 5 files in 1.23s');
    expect(formatTiming('foundation', 1, 0)).toBe('test:foundation — ran 1 file in 0.00s');
    expect(formatTiming('fast', 3, -50)).toBe('test:fast — ran 3 files in 0.00s');
  });
});
