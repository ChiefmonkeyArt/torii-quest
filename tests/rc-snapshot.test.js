// tests/rc-snapshot.test.js — pure MVP RC SNAPSHOT / FREEZE-CANDIDATE assembly + formatting
// (tools/rcSnapshot.mjs). Covers buildRcSnapshotModel (folding the RC-gate verdict + MVP rollup +
// GitHub release dry-run + test/regression counts + a present map + the curated manual-validation /
// release-steps / advisories lists into ONE freeze-candidate model), the freeze-candidate verdict
// banding, rcSnapshotVersionConsistency, the text/markdown formatters, and degraded/missing-input
// cases. Two integration-flavoured cases prove the snapshot references REAL repo docs and that the
// referenced docs / current version metadata stay in sync (so the doc list cannot silently rot).
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  RC_SNAPSHOT_SCHEMA, RC_SNAPSHOT_SCHEMA_VERSION, RC_SNAPSHOT_BADGE,
  RC_SNAPSHOT_WRITE_FILENAME, RC_SNAPSHOT_TITLE, RC_SNAPSHOT_STATES,
  RC_SNAPSHOT_DOC_REFS, RC_SNAPSHOT_ADVISORIES,
  RC_SNAPSHOT_MANUAL_VALIDATION, RC_SNAPSHOT_RELEASE_STEPS,
  rcSnapshotVersionConsistency, buildRcSnapshotModel,
  formatRcSnapshot, formatRcSnapshotMarkdown,
} from '../tools/rcSnapshot.mjs';
import { VERSION } from '../src/config.js';

const V = 'v0.2.210-alpha';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A green RC-gate verdict (mirrors buildMvpRcGate output, candidate/ready).
const readyGate = {
  version: V, status: 'READY', isCandidate: true, pct: 100, reasons: [], nextTasks: ['ship the next safe slice'],
};
// A green MVP rollup (mirrors runMvpReadiness output).
const readyMvp = {
  ok: true, mvpPct: 100, status: 'READY', currentVersion: V,
  summary: { total: 9, ok: 9, fail: 0 }, reasons: [],
};
// A near GitHub dry-run (soft-pending clean tree / push before the parent pushes).
const nearDryRun = {
  version: V, status: 'near', ready: false,
  missing: [{ key: 'clean-tree', label: 'Working tree clean (all changes committed)' }],
  approvalGate: 'Manual user approval is REQUIRED before any git tag, push, or gh release.',
};

describe('rc-snapshot — constants', () => {
  it('exposes a stable schema, version, badge, write filename, title, and states', () => {
    expect(RC_SNAPSHOT_SCHEMA).toBe('torii.rc-snapshot');
    expect(RC_SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(RC_SNAPSHOT_BADGE).toBe('MVP RC SNAPSHOT · FREEZE CANDIDATE · LOCAL · READ-ONLY');
    expect(RC_SNAPSHOT_WRITE_FILENAME).toBe('MVP_RC_SNAPSHOT.md');
    expect(RC_SNAPSHOT_TITLE).toBe('Torii Quest — MVP RC Snapshot');
    expect(RC_SNAPSHOT_STATES).toEqual(['FREEZE-CANDIDATE', 'NEAR', 'BLOCKED']);
    expect(Object.isFrozen(RC_SNAPSHOT_STATES)).toBe(true);
  });

  it('ships frozen doc-ref / advisories / manual-validation / release-steps lists', () => {
    expect(Object.isFrozen(RC_SNAPSHOT_DOC_REFS)).toBe(true);
    expect(Object.isFrozen(RC_SNAPSHOT_ADVISORIES)).toBe(true);
    expect(Object.isFrozen(RC_SNAPSHOT_MANUAL_VALIDATION)).toBe(true);
    expect(Object.isFrozen(RC_SNAPSHOT_RELEASE_STEPS)).toBe(true);
    expect(RC_SNAPSHOT_MANUAL_VALIDATION.length).toBeGreaterThan(0);
    expect(RC_SNAPSHOT_RELEASE_STEPS.length).toBeGreaterThan(0);
    // doc-ref keys are unique
    const keys = RC_SNAPSHOT_DOC_REFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('rc-snapshot — references real repo docs + current version metadata', () => {
  it('every referenced RC doc exists on disk (the doc list cannot silently rot)', () => {
    for (const d of RC_SNAPSHOT_DOC_REFS) {
      expect(existsSync(join(REPO_ROOT, d.file)), `${d.file} (${d.key}) should exist`).toBe(true);
    }
  });

  it('reports a consistent version when the folded sources agree with config VERSION', () => {
    const c = rcSnapshotVersionConsistency({
      version: VERSION, packageVersion: VERSION.replace(/^v/, ''),
      rcGate: { version: VERSION }, mvpReadiness: { currentVersion: VERSION }, dryRun: { version: VERSION },
    });
    expect(c.ok).toBe(true);
    expect(c.version).toBe(VERSION);
    expect(c.mismatches).toEqual([]);
  });
});

describe('rc-snapshot — version consistency', () => {
  it('flags a mismatching folded source', () => {
    const c = rcSnapshotVersionConsistency({
      version: V, rcGate: { version: V }, mvpReadiness: { currentVersion: 'v0.2.209-alpha' },
    });
    expect(c.ok).toBe(false);
    expect(c.mismatches).toContain('mvpReadiness=v0.2.209-alpha');
  });

  it('ignores absent sources (a null source is not a mismatch)', () => {
    const c = rcSnapshotVersionConsistency({ version: V, rcGate: null, mvpReadiness: null, dryRun: null });
    expect(c.ok).toBe(true);
    expect(c.version).toBe(V);
  });

  it('is not ok when no version source is present', () => {
    const c = rcSnapshotVersionConsistency({});
    expect(c.ok).toBe(false);
    expect(c.version).toBe(null);
  });
});

describe('rc-snapshot — assembly + verdict', () => {
  it('FREEZE-CANDIDATE when the RC gate is a candidate and the dry-run is not blocked', () => {
    const m = buildRcSnapshotModel({
      version: V, packageVersion: '0.2.210-alpha', gitCommit: 'abc1234',
      liveUrl: 'https://torii-quest.pplx.app',
      rcGate: readyGate, mvpReadiness: readyMvp, dryRun: nearDryRun,
      testStatus: { passing: 1342, files: 85, profile: 'full' },
      regression: { count: 15, expected: 15 },
      present: { 'release-notes': true, 'playtest-results': false },
    });
    expect(m.schema).toBe('torii.rc-snapshot');
    expect(m.snapshot).toBe(true);
    expect(m.status).toBe('FREEZE-CANDIDATE');
    expect(m.freezeCandidate).toBe(true);
    expect(m.version).toBe(V);
    expect(m.rcGate.isCandidate).toBe(true);
    expect(m.mvpReadiness.pct).toBe(100);
    expect(m.releaseDryRun.status).toBe('near');
    expect(m.releaseDryRun.missing).toContain('Working tree clean (all changes committed)');
    expect(m.tests).toMatchObject({ passing: 1342, files: 85, profile: 'full' });
    const byKey = Object.fromEntries(m.docs.map((d) => [d.key, d]));
    expect(byKey['release-notes'].present).toBe(true);
    expect(byKey['playtest-results'].present).toBe(false);
    expect(byKey['handoff'].present).toBe(null);
  });

  it('BLOCKED when the RC gate is blocked', () => {
    const m = buildRcSnapshotModel({
      version: V, rcGate: { status: 'BLOCKED', isCandidate: false, reasons: ['release:tests'] },
      mvpReadiness: readyMvp, dryRun: nearDryRun,
    });
    expect(m.status).toBe('BLOCKED');
    expect(m.freezeCandidate).toBe(false);
  });

  it('BLOCKED when the dry-run is blocked even if the RC gate is a candidate', () => {
    const m = buildRcSnapshotModel({
      version: V, rcGate: readyGate, mvpReadiness: readyMvp,
      dryRun: { status: 'blocked', ready: false, missing: [] },
    });
    expect(m.status).toBe('BLOCKED');
  });

  it('NEAR when the RC gate is not a candidate but nothing is hard-blocking', () => {
    const m = buildRcSnapshotModel({
      version: V, rcGate: { status: 'NEAR', isCandidate: false, reasons: [] },
      mvpReadiness: readyMvp, dryRun: nearDryRun,
    });
    expect(m.status).toBe('NEAR');
  });

  it('defaults the manual-validation / release-steps / advisories lists when not supplied', () => {
    const m = buildRcSnapshotModel({ version: V, rcGate: readyGate, dryRun: nearDryRun });
    expect(m.manualValidation.length).toBe(RC_SNAPSHOT_MANUAL_VALIDATION.length);
    expect(m.releaseSteps.length).toBe(RC_SNAPSHOT_RELEASE_STEPS.length);
    expect(m.advisories.length).toBe(RC_SNAPSHOT_ADVISORIES.length);
  });

  it('accepts explicit list overrides', () => {
    const m = buildRcSnapshotModel({
      version: V, advisories: ['only this'], manualValidation: ['check one'], releaseSteps: ['step one'],
    });
    expect(m.advisories).toEqual(['only this']);
    expect(m.manualValidation).toEqual(['check one']);
    expect(m.releaseSteps).toEqual(['step one']);
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildRcSnapshotModel({ version: V });
    expect(m.safety).toEqual({
      released: false, tagged: false, published: false, announced: false,
      served: false, navigated: false, wrote: false, network: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });
});

describe('rc-snapshot — formatters', () => {
  const model = buildRcSnapshotModel({
    version: V, gitCommit: 'abc1234', liveUrl: 'https://torii-quest.pplx.app',
    rcGate: readyGate, mvpReadiness: readyMvp, dryRun: nearDryRun,
    testStatus: { passing: 1342, files: 85, profile: 'full' },
    regression: { count: 15, expected: 15 },
    present: { 'release-notes': true },
    reports: ['torii-v0.2.210-mvp-rc-snapshot-report.md'],
    generatedAt: '2026-06-26T00:00:00Z',
  });

  it('text block carries badge, status, sections, and the snapshot-only note', () => {
    const txt = formatRcSnapshot(model);
    expect(txt).toContain('MVP RC SNAPSHOT · FREEZE CANDIDATE · LOCAL · READ-ONLY');
    expect(txt).toContain('status: FREEZE-CANDIDATE');
    expect(txt).toContain('RC gate:');
    expect(txt).toContain('MVP readiness:');
    expect(txt).toContain('GitHub release dry-run:');
    expect(txt).toContain('Still needs manual user validation:');
    expect(txt).toContain('To turn this into a real GitHub release/tag');
    expect(txt).toContain('SNAPSHOT ONLY');
    expect(txt).toContain('generated: 2026-06-26T00:00:00Z');
    // the source-commit wording (never implies the file's own commit)
    expect(txt).toContain('@ abc1234 (source)');
  });

  it('markdown carries the title, sections, the approval gate, and the snapshot-only note', () => {
    const md = formatRcSnapshotMarkdown(model);
    expect(md).toContain('# Torii Quest — MVP RC Snapshot — RC Freeze-Candidate Snapshot');
    expect(md).toContain('## RC gate');
    expect(md).toContain('## GitHub release dry-run');
    expect(md).toContain('## Still needs manual user validation');
    expect(md).toContain('## To turn this into a real GitHub release/tag');
    expect(md).toContain('**APPROVAL GATE:**');
    expect(md).toContain('_SNAPSHOT ONLY');
  });

  it('both formatters are null-safe', () => {
    expect(formatRcSnapshot(null)).toBe('rc-snapshot: (no snapshot)');
    expect(formatRcSnapshotMarkdown(null)).toContain('_(no snapshot)_');
  });
});

describe('rc-snapshot — robustness', () => {
  it('degrades to honest unknowns with no inputs and never throws', () => {
    expect(() => buildRcSnapshotModel({})).not.toThrow();
    const m = buildRcSnapshotModel({});
    expect(m.version).toBe(null);
    expect(m.rcGate.present).toBe(false);
    expect(m.mvpReadiness.present).toBe(false);
    expect(m.releaseDryRun.present).toBe(false);
    expect(m.status).toBe('NEAR');
    for (const d of m.docs) expect(d.present).toBe(null);
  });

  it('never throws on garbled inputs', () => {
    expect(() => buildRcSnapshotModel({ rcGate: 'nope', mvpReadiness: 42, dryRun: [], present: [] })).not.toThrow();
    const m = buildRcSnapshotModel({ rcGate: 'nope', mvpReadiness: 42, dryRun: [], present: [] });
    expect(m.rcGate.present).toBe(false);
    expect(m.tests).toBe(null);
    for (const d of m.docs) expect(d.present).toBe(null);
  });
});
