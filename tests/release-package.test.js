// tests/release-package.test.js — pure MVP RELEASE-PACKAGE INDEX assembly + formatting
// (tools/releasePackage.mjs). Covers buildReleasePackageModel (folding version/commit/test-count
// + a present map + advisories + next action into ONE index model), the curated indexed-file
// list grouped by category, the text/markdown formatters, and degraded / missing-input cases.
// No fs/git — every input is plain data, fully deterministic (generatedAt is omitted so the
// shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  RELEASE_PACKAGE_SCHEMA, RELEASE_PACKAGE_SCHEMA_VERSION, RELEASE_PACKAGE_BADGE,
  RELEASE_PACKAGE_WRITE_FILENAME, RELEASE_PACKAGE_TITLE,
  RELEASE_PACKAGE_ENTRIES, RELEASE_PACKAGE_ADVISORIES, RELEASE_PACKAGE_DEFAULT_NEXT_ACTION,
  buildReleasePackageModel, formatReleasePackage, formatReleasePackageMarkdown,
} from '../tools/releasePackage.mjs';

const V = 'v0.2.206-alpha';

describe('release-package — constants', () => {
  it('exposes a stable schema, version, badge, write filename, and title', () => {
    expect(RELEASE_PACKAGE_SCHEMA).toBe('torii.release-package');
    expect(RELEASE_PACKAGE_SCHEMA_VERSION).toBe(1);
    expect(RELEASE_PACKAGE_BADGE).toBe('MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY');
    expect(RELEASE_PACKAGE_WRITE_FILENAME).toBe('MVP_RELEASE_PACKAGE.md');
    expect(RELEASE_PACKAGE_TITLE).toBe('Torii Quest — MVP Release Package');
  });

  it('ships a frozen curated index pointing at every required package file', () => {
    expect(Object.isFrozen(RELEASE_PACKAGE_ENTRIES)).toBe(true);
    const files = RELEASE_PACKAGE_ENTRIES.map((e) => e.file);
    for (const f of [
      'RELEASE_NOTES_DRAFT.md', 'MVP_PLAYTEST_CHECKLIST.md', 'MVP_PLAYTEST_RESULTS_TEMPLATE.md',
      'HANDOFF.generated.md', 'HANDOFF.md', 'progress.md', 'todo.md',
      'UPDATE_CHECK.md', 'VPS_INSTALL.md', 'ZONE_FALLBACK_READINESS.md',
    ]) {
      expect(files).toContain(f);
    }
    for (const e of RELEASE_PACKAGE_ENTRIES) {
      expect(typeof e.key).toBe('string');
      expect(e.key.length).toBeGreaterThan(0);
      expect(typeof e.label).toBe('string');
      expect(typeof e.category).toBe('string');
    }
    // keys are unique
    const keys = RELEASE_PACKAGE_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ships a frozen non-blocking advisories list and a default next action', () => {
    expect(Object.isFrozen(RELEASE_PACKAGE_ADVISORIES)).toBe(true);
    expect(RELEASE_PACKAGE_ADVISORIES.join(' ')).toMatch(/rapier/);
    expect(typeof RELEASE_PACKAGE_DEFAULT_NEXT_ACTION).toBe('string');
    expect(RELEASE_PACKAGE_DEFAULT_NEXT_ACTION.length).toBeGreaterThan(0);
  });
});

describe('release-package — assembly', () => {
  it('folds version/commit/live/tests + a present map into an index model', () => {
    const m = buildReleasePackageModel({
      version: V, gitCommit: 'abc1234', liveUrl: 'https://torii-quest.pplx.app',
      testStatus: { passing: 1310, files: 83, profile: 'full' },
      regression: { count: 15, expected: 15 },
      present: { 'release-notes': true, todo: false },
    });
    expect(m.schema).toBe('torii.release-package');
    expect(m.index).toBe(true);
    expect(m.version).toBe(V);
    expect(m.gitCommit).toBe('abc1234');
    expect(m.liveUrl).toBe('https://torii-quest.pplx.app');
    expect(m.tests).toMatchObject({ passing: 1310, files: 83, profile: 'full' });
    expect(m.regression).toMatchObject({ count: 15, expected: 15 });
    expect(m.entries.length).toBe(RELEASE_PACKAGE_ENTRIES.length);
    const byKey = Object.fromEntries(m.entries.map((e) => [e.key, e]));
    expect(byKey['release-notes'].present).toBe(true);
    expect(byKey['todo'].present).toBe(false);
    // a key with no present flag injected is unknown (null)
    expect(byKey['handoff'].present).toBe(null);
  });

  it('defaults advisories + next action when not supplied', () => {
    const m = buildReleasePackageModel({ version: V });
    expect(m.advisories.length).toBe(RELEASE_PACKAGE_ADVISORIES.length);
    expect(m.nextAction).toBe(RELEASE_PACKAGE_DEFAULT_NEXT_ACTION);
  });

  it('accepts explicit advisories, next action, and reports overrides', () => {
    const m = buildReleasePackageModel({
      version: V, advisories: ['only this'], nextAction: 'do the thing',
      reports: ['torii-v0.2.205-x-report.md', 'torii-v0.2.206-y-report.md'],
    });
    expect(m.advisories).toEqual(['only this']);
    expect(m.nextAction).toBe('do the thing');
    expect(m.latestReports).toEqual(['torii-v0.2.205-x-report.md', 'torii-v0.2.206-y-report.md']);
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildReleasePackageModel({ version: V });
    expect(m.safety).toEqual({
      released: false, tagged: false, published: false, announced: false,
      served: false, navigated: false, wrote: false, network: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });
});

describe('release-package — formatters', () => {
  it('text block carries badge, version, files, advisories, and next action', () => {
    const m = buildReleasePackageModel({
      version: V, gitCommit: 'abc1234', liveUrl: 'https://torii-quest.pplx.app',
      testStatus: { passing: 1310, files: 83, profile: 'full' },
      present: { 'release-notes': true },
      generatedAt: '2026-06-26T00:00:00Z',
    });
    const txt = formatReleasePackage(m);
    expect(txt).toContain('MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY');
    expect(txt).toContain('Package files:');
    expect(txt).toContain('RELEASE_NOTES_DRAFT.md');
    expect(txt).toContain('Known non-blocking advisories');
    expect(txt).toContain('Recommended next action');
    expect(txt).toContain('INDEX ONLY');
    expect(txt).toContain('generated: 2026-06-26T00:00:00Z');
  });

  it('markdown carries the title, package files, advisories, and index-only note', () => {
    const m = buildReleasePackageModel({ version: V, testStatus: { passing: 1310, files: 83, profile: 'full' } });
    const md = formatReleasePackageMarkdown(m);
    expect(md).toContain('# Torii Quest — MVP Release Package — Release Package Index');
    expect(md).toContain('## Package files');
    expect(md).toContain('`RELEASE_NOTES_DRAFT.md`');
    expect(md).toContain('## Known non-blocking advisories');
    expect(md).toContain('## Recommended next action');
    expect(md).toContain('_INDEX ONLY');
  });

  it('both formatters are null-safe', () => {
    expect(formatReleasePackage(null)).toBe('release-package: (no index)');
    expect(formatReleasePackageMarkdown(null)).toContain('_(no index)_');
  });
});

describe('release-package — robustness', () => {
  it('degrades to honest unknowns with no inputs and never throws', () => {
    expect(() => buildReleasePackageModel({})).not.toThrow();
    const m = buildReleasePackageModel({});
    expect(m.version).toBe(null);
    expect(m.tests).toBe(null);
    expect(m.regression).toBe(null);
    // the curated index is always present even with no live signals
    expect(m.entries.length).toBe(RELEASE_PACKAGE_ENTRIES.length);
    for (const e of m.entries) expect(e.present).toBe(null);
  });

  it('never throws on garbled inputs', () => {
    expect(() => buildReleasePackageModel({ testStatus: 'nope', regression: 42, present: [] })).not.toThrow();
    const m = buildReleasePackageModel({ testStatus: 'nope', regression: 42, present: [] });
    expect(m.tests).toBe(null);
    expect(m.regression).toBe(null);
    for (const e of m.entries) expect(e.present).toBe(null);
  });
});
