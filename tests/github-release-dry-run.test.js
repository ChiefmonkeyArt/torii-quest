// tests/github-release-dry-run.test.js — pure GITHUB MVP RELEASE DRY-RUN assembly + formatting
// (tools/githubReleaseDryRun.mjs). Covers buildGithubReleaseDryRunModel (folding version sync,
// clean-tree / pushed / file-presence / gate / live-url / no-auto-update signals into ONE
// READY/NEAR/BLOCKED verdict + a missing list + inert future commands), the text/markdown
// formatters, and degraded / missing-input cases. No fs/git — every input is plain data, fully
// deterministic (generatedAt is omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  GITHUB_RELEASE_DRY_RUN_SCHEMA, GITHUB_RELEASE_DRY_RUN_SCHEMA_VERSION,
  GITHUB_RELEASE_DRY_RUN_BADGE, GITHUB_RELEASE_DRY_RUN_WRITE_FILENAME,
  GITHUB_RELEASE_DRY_RUN_TITLE, GITHUB_RELEASE_DRY_RUN_PREREQUISITES,
  GITHUB_RELEASE_DRY_RUN_ADVISORIES, GITHUB_RELEASE_APPROVAL_GATE,
  buildGithubReleaseDryRunModel, formatGithubReleaseDryRun, formatGithubReleaseDryRunMarkdown,
} from '../tools/githubReleaseDryRun.mjs';

const V = 'v0.2.207-alpha';
const PKG = '0.2.207-alpha';

// A fully-satisfied set of inputs (every gating + soft signal ok) → READY.
function readyInputs(over = {}) {
  return {
    version: V, packageVersion: PKG, gitCommit: 'abc1234',
    cleanTree: true, pushed: true,
    releaseNotesPresent: true, releasePackagePresent: true,
    gateReady: true, liveUrl: 'https://torii-quest.pplx.app',
    autoUpdateActionable: false,
    ...over,
  };
}

describe('github-release-dry-run — constants', () => {
  it('exposes a stable schema, version, badge, write filename, and title', () => {
    expect(GITHUB_RELEASE_DRY_RUN_SCHEMA).toBe('torii.github-release-dry-run');
    expect(GITHUB_RELEASE_DRY_RUN_SCHEMA_VERSION).toBe(1);
    expect(GITHUB_RELEASE_DRY_RUN_BADGE).toContain('NO TAG / NO RELEASE');
    expect(GITHUB_RELEASE_DRY_RUN_WRITE_FILENAME).toBe('GITHUB_RELEASE_DRY_RUN.md');
    expect(GITHUB_RELEASE_DRY_RUN_TITLE).toBe('Torii Quest — GitHub MVP Release Dry-Run');
  });

  it('ships a frozen prerequisite list covering the required release gates', () => {
    expect(Object.isFrozen(GITHUB_RELEASE_DRY_RUN_PREREQUISITES)).toBe(true);
    const keys = GITHUB_RELEASE_DRY_RUN_PREREQUISITES.map((c) => c.key);
    for (const k of [
      'version', 'version-sync', 'clean-tree', 'pushed', 'release-notes',
      'release-package', 'gate-ready', 'live-url', 'no-auto-update',
    ]) {
      expect(keys).toContain(k);
    }
    // keys unique; each carries a label + boolean gating flag
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of GITHUB_RELEASE_DRY_RUN_PREREQUISITES) {
      expect(typeof c.label).toBe('string');
      expect(typeof c.gating).toBe('boolean');
    }
  });

  it('ships a frozen advisories list and an explicit manual-approval gate', () => {
    expect(Object.isFrozen(GITHUB_RELEASE_DRY_RUN_ADVISORIES)).toBe(true);
    expect(GITHUB_RELEASE_DRY_RUN_ADVISORIES.join(' ')).toMatch(/rapier/);
    expect(GITHUB_RELEASE_APPROVAL_GATE).toMatch(/approval is REQUIRED/i);
  });
});

describe('github-release-dry-run — verdict', () => {
  it('is READY when every gating + soft prerequisite is satisfied', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs());
    expect(m.schema).toBe('torii.github-release-dry-run');
    expect(m.dryRun).toBe(true);
    expect(m.status).toBe('ready');
    expect(m.statusLabel).toMatch(/READY/);
    expect(m.ready).toBe(true);
    expect(m.missing).toEqual([]);
    // approval is always still required, even at READY
    expect(m.approvalRequired).toBe(true);
  });

  it('is BLOCKED when a gating prerequisite is definitively unmet', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs({ releaseNotesPresent: false }));
    expect(m.status).toBe('blocked');
    expect(m.statusLabel).toBe('BLOCKED');
    expect(m.ready).toBe(false);
    expect(m.missing.map((x) => x.key)).toContain('release-notes');
  });

  it('is BLOCKED when release metadata is actionable (autoUpdate)', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs({ autoUpdateActionable: true }));
    expect(m.status).toBe('blocked');
    expect(m.missing.map((x) => x.key)).toContain('no-auto-update');
  });

  it('is NEAR when only soft signals (dirty tree / unpushed HEAD) are pending', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs({ cleanTree: false, pushed: false }));
    expect(m.status).toBe('near');
    expect(m.statusLabel).toBe('NEAR');
    const keys = m.missing.map((x) => x.key);
    expect(keys).toContain('clean-tree');
    expect(keys).toContain('pushed');
    // soft pending never escalates to a hard block
    expect(m.missing.every((x) => x.state === 'pending')).toBe(true);
  });

  it('is NEAR (not BLOCKED) when a gating signal is merely unknown', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs({ gateReady: null }));
    expect(m.status).toBe('near');
    expect(m.missing.map((x) => x.key)).toContain('gate-ready');
  });

  it('flags a version/package mismatch as a hard blocker', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs({ packageVersion: '9.9.9-alpha' }));
    expect(m.status).toBe('blocked');
    expect(m.missing.map((x) => x.key)).toContain('version-sync');
  });
});

describe('github-release-dry-run — future commands + safety', () => {
  it('emits inert future commands stamped with the version and a do-not-run note', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs());
    expect(Array.isArray(m.futureCommands)).toBe(true);
    expect(m.futureCommands.length).toBeGreaterThan(0);
    const joined = m.futureCommands.map((c) => c.cmd).join('\n');
    expect(joined).toContain(`git tag -a ${V}`);
    expect(joined).toContain('gh release create');
    for (const c of m.futureCommands) expect(c.note).toMatch(/approval/i);
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs());
    expect(m.safety).toEqual({
      tagged: false, released: false, pushed: false, published: false, deployed: false,
      announced: false, served: false, navigated: false, wrote: false, network: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });
});

describe('github-release-dry-run — formatters', () => {
  it('text block carries badge, verdict, prerequisites, future commands, and approval gate', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs({ generatedAt: '2026-06-26T00:00:00Z' }));
    const txt = formatGithubReleaseDryRun(m);
    expect(txt).toContain('NO TAG / NO RELEASE');
    expect(txt).toContain('Prerequisites:');
    expect(txt).toContain('Suggested FUTURE manual commands');
    expect(txt).toContain('APPROVAL GATE:');
    expect(txt).toContain('DRY-RUN ONLY');
    expect(txt).toContain('generated: 2026-06-26T00:00:00Z');
  });

  it('markdown carries the title, prerequisites, fenced future commands, and approval gate', () => {
    const m = buildGithubReleaseDryRunModel(readyInputs());
    const md = formatGithubReleaseDryRunMarkdown(m);
    expect(md).toContain('# Torii Quest — GitHub MVP Release Dry-Run');
    expect(md).toContain('## Prerequisites');
    expect(md).toContain('## Suggested FUTURE manual commands');
    expect(md).toContain('Do not run without explicit user approval');
    expect(md).toContain('## Approval gate');
    expect(md).toContain('_DRY-RUN ONLY');
  });

  it('both formatters are null-safe', () => {
    expect(formatGithubReleaseDryRun(null)).toBe('github-release-dry-run: (no dry-run)');
    expect(formatGithubReleaseDryRunMarkdown(null)).toContain('_(no dry-run)_');
  });
});

describe('github-release-dry-run — robustness', () => {
  it('degrades to honest unknowns with no inputs and never throws', () => {
    expect(() => buildGithubReleaseDryRunModel({})).not.toThrow();
    const m = buildGithubReleaseDryRunModel({});
    expect(m.version).toBe(null);
    // version + live-url are gating with no signal → blocked; verdict is BLOCKED
    expect(m.status).toBe('blocked');
    expect(m.prerequisites.length).toBe(GITHUB_RELEASE_DRY_RUN_PREREQUISITES.length);
  });

  it('never throws on garbled inputs', () => {
    expect(() => buildGithubReleaseDryRunModel({
      version: 42, packageVersion: {}, cleanTree: 'maybe', pushed: 1,
      releaseNotesPresent: 'yes', autoUpdateActionable: 'no', advisories: 'nope',
    })).not.toThrow();
    const m = buildGithubReleaseDryRunModel({ version: 42, advisories: 'nope' });
    expect(m.version).toBe(null);
    // falls back to the curated advisories when the override is garbled
    expect(m.advisories.length).toBe(GITHUB_RELEASE_DRY_RUN_ADVISORIES.length);
  });
});
