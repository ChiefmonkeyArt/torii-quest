// tests/release-manifest.test.js — pure RELEASE ARTIFACT MANIFEST assembly + formatting
// (tools/releaseManifest.mjs). Covers buildReleaseManifestModel (folding the CLI-injected
// present/sha256/bytes map for the REQUIRED + OPTIONAL artifact lists into ONE manifest model), the
// COMPLETE/INCOMPLETE verdict banding, the text/markdown formatters, and degraded/garbled-input
// cases. One integration-flavoured case proves every REQUIRED artifact references a REAL repo file
// (so a missing required RC artifact is caught locally before any release is attempted).
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  RELEASE_MANIFEST_SCHEMA, RELEASE_MANIFEST_SCHEMA_VERSION, RELEASE_MANIFEST_BADGE,
  RELEASE_MANIFEST_WRITE_FILENAME, RELEASE_MANIFEST_TITLE, RELEASE_MANIFEST_STATES,
  RELEASE_MANIFEST_REQUIRED, RELEASE_MANIFEST_OPTIONAL, RELEASE_MANIFEST_NOTES,
  RELEASE_MANIFEST_REPORT_RE, RELEASE_MANIFEST_REPORT_CAP,
  buildReleaseManifestModel, formatReleaseManifest, formatReleaseManifestMarkdown,
  selectRecentReports,
} from '../tools/releaseManifest.mjs';

const V = 'v0.2.212-alpha';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(64);

// allPresent() → a { key: { present, sha256, bytes } } map marking every required + optional ref present.
function allPresent() {
  const map = {};
  for (const d of RELEASE_MANIFEST_REQUIRED) map[d.key] = { present: true, sha256: SHA, bytes: 100 };
  for (const d of RELEASE_MANIFEST_OPTIONAL) map[d.key] = { present: true, sha256: SHA, bytes: 50 };
  return map;
}

describe('release-manifest — constants', () => {
  it('exposes a stable schema, version, badge, write filename, title, and states', () => {
    expect(RELEASE_MANIFEST_SCHEMA).toBe('torii.release-manifest');
    expect(RELEASE_MANIFEST_SCHEMA_VERSION).toBe(1);
    expect(RELEASE_MANIFEST_BADGE).toBe('RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY');
    expect(RELEASE_MANIFEST_WRITE_FILENAME).toBe('RELEASE_ARTIFACT_MANIFEST.md');
    expect(RELEASE_MANIFEST_TITLE).toBe('Torii Quest — Release Artifact Manifest');
    expect(RELEASE_MANIFEST_STATES).toEqual(['COMPLETE', 'INCOMPLETE']);
    expect(Object.isFrozen(RELEASE_MANIFEST_STATES)).toBe(true);
  });

  it('ships frozen required / optional / notes lists with unique keys', () => {
    expect(Object.isFrozen(RELEASE_MANIFEST_REQUIRED)).toBe(true);
    expect(Object.isFrozen(RELEASE_MANIFEST_OPTIONAL)).toBe(true);
    expect(Object.isFrozen(RELEASE_MANIFEST_NOTES)).toBe(true);
    expect(RELEASE_MANIFEST_REQUIRED.length).toBeGreaterThan(0);
    expect(RELEASE_MANIFEST_NOTES.length).toBeGreaterThan(0);
    const keys = RELEASE_MANIFEST_REQUIRED.concat(RELEASE_MANIFEST_OPTIONAL).map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of RELEASE_MANIFEST_REQUIRED.concat(RELEASE_MANIFEST_OPTIONAL)) {
      expect(typeof d.file).toBe('string');
      expect(typeof d.label).toBe('string');
      expect(typeof d.category).toBe('string');
    }
  });
});

describe('release-manifest — references real repo artifacts', () => {
  it('every REQUIRED artifact exists on disk (a missing required RC artifact is caught locally)', () => {
    for (const d of RELEASE_MANIFEST_REQUIRED) {
      expect(existsSync(join(REPO_ROOT, d.file)), `${d.file} (${d.key}) should exist`).toBe(true);
    }
  });
});

describe('release-manifest — assembly + verdict', () => {
  it('COMPLETE when every required artifact is present', () => {
    const m = buildReleaseManifestModel({
      version: V, packageVersion: '0.2.212-alpha', gitCommit: 'abc1234',
      liveUrl: 'https://torii-quest.pplx.app', artifacts: allPresent(),
    });
    expect(m.schema).toBe('torii.release-manifest');
    expect(m.manifest).toBe(true);
    expect(m.status).toBe('COMPLETE');
    expect(m.complete).toBe(true);
    expect(m.version).toBe(V);
    expect(m.missingRequired).toEqual([]);
    expect(m.counts.required).toBe(RELEASE_MANIFEST_REQUIRED.length);
    expect(m.counts.requiredPresent).toBe(RELEASE_MANIFEST_REQUIRED.length);
    expect(m.counts.hashed).toBe(RELEASE_MANIFEST_REQUIRED.length + RELEASE_MANIFEST_OPTIONAL.length);
    const byKey = Object.fromEntries(m.required.map((e) => [e.key, e]));
    const firstKey = RELEASE_MANIFEST_REQUIRED[0].key;
    expect(byKey[firstKey].sha256).toBe(SHA);
    expect(byKey[firstKey].bytes).toBe(100);
  });

  it('INCOMPLETE when a required artifact is explicitly missing', () => {
    const map = allPresent();
    const missingKey = RELEASE_MANIFEST_REQUIRED[0].key;
    const missingFile = RELEASE_MANIFEST_REQUIRED[0].file;
    map[missingKey] = { present: false, sha256: null, bytes: null };
    const m = buildReleaseManifestModel({ version: V, artifacts: map });
    expect(m.status).toBe('INCOMPLETE');
    expect(m.complete).toBe(false);
    expect(m.missingRequired).toContain(missingFile);
    expect(m.counts.requiredMissing).toBe(1);
  });

  it('an unknown (null) required present flag is NOT treated as missing', () => {
    const m = buildReleaseManifestModel({ version: V });
    // No artifacts injected → every present flag is null, none known-absent.
    expect(m.status).toBe('COMPLETE');
    expect(m.missingRequired).toEqual([]);
    for (const e of m.required) expect(e.present).toBe(null);
  });

  it('rejects a malformed sha256 (keeps only 64-hex)', () => {
    const map = allPresent();
    const k = RELEASE_MANIFEST_REQUIRED[0].key;
    map[k] = { present: true, sha256: 'not-a-hash', bytes: 10 };
    const m = buildReleaseManifestModel({ version: V, artifacts: map });
    const e = m.required.find((x) => x.key === k);
    expect(e.sha256).toBe(null);
  });

  it('defaults the notes list when not supplied and accepts an override', () => {
    expect(buildReleaseManifestModel({ version: V }).notes.length).toBe(RELEASE_MANIFEST_NOTES.length);
    expect(buildReleaseManifestModel({ version: V, notes: ['only this'] }).notes).toEqual(['only this']);
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildReleaseManifestModel({ version: V });
    expect(m.safety).toEqual({
      released: false, tagged: false, published: false, selfUpdated: false,
      served: false, wrote: false, network: false, hashedSecrets: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });
});

describe('release-manifest — formatters', () => {
  const model = buildReleaseManifestModel({
    version: V, packageVersion: '0.2.212-alpha', gitCommit: 'abc1234',
    liveUrl: 'https://torii-quest.pplx.app', artifacts: allPresent(),
    reports: ['torii-v0.2.212-release-manifest-shellless-report.md'],
    generatedAt: '2026-06-26T00:00:00Z',
  });

  it('text block carries badge, status, sections, and the manifest-only note', () => {
    const txt = formatReleaseManifest(model);
    expect(txt).toContain('RELEASE ARTIFACT MANIFEST · LOCAL · READ-ONLY');
    expect(txt).toContain('status: COMPLETE');
    expect(txt).toContain('Required artifacts:');
    expect(txt).toContain('Optional artifacts:');
    expect(txt).toContain('How this supports release integrity / self-update:');
    expect(txt).toContain('MANIFEST ONLY');
    expect(txt).toContain('generated: 2026-06-26T00:00:00Z');
    expect(txt).toContain('@ abc1234 (source)');
  });

  it('markdown carries the title, artifact tables, and the manifest-only note', () => {
    const md = formatReleaseManifestMarkdown(model);
    expect(md).toContain('# Torii Quest — Release Artifact Manifest');
    expect(md).toContain('## Required artifacts');
    expect(md).toContain('## Optional artifacts');
    expect(md).toContain('| Artifact | Label | Category | Present | sha256 | Bytes |');
    expect(md).toContain('## How this supports release integrity / self-update');
    expect(md).toContain('_MANIFEST ONLY');
  });

  it('both formatters are null-safe', () => {
    expect(formatReleaseManifest(null)).toBe('release-manifest: (no manifest)');
    expect(formatReleaseManifestMarkdown(null)).toContain('_(no manifest)_');
  });
});

describe('release-manifest — selectRecentReports (shell-less discovery)', () => {
  it('keeps only torii-v*-report.md names and drops everything else', () => {
    const names = [
      'torii-v0.2.210-mvp-rc-snapshot-report.md',
      'torii-v0.2.211-release-artifact-manifest-report.md',
      'README.md', 'torii-quest-progress.md', 'torii-notes.md', 'torii-v0.2.212-report.md.bak',
      'package.json', 'src',
    ];
    expect(selectRecentReports(names)).toEqual([
      'torii-v0.2.210-mvp-rc-snapshot-report.md',
      'torii-v0.2.211-release-artifact-manifest-report.md',
    ]);
  });

  it('sorts deterministically regardless of input order (matches the old ls glob order)', () => {
    const shuffled = [
      'torii-v0.2.211-c-report.md',
      'torii-v0.2.209-a-report.md',
      'torii-v0.2.210-b-report.md',
    ];
    const expected = shuffled.slice().sort();
    expect(selectRecentReports(shuffled)).toEqual(expected);
    // Same multiset, different order in → identical output.
    expect(selectRecentReports(shuffled.slice().reverse())).toEqual(expected);
  });

  it('caps to the most recent entries (newest-ish last)', () => {
    const many = [];
    for (let i = 0; i < 10; i += 1) many.push(`torii-v0.2.2${i.toString().padStart(2, '0')}-report.md`);
    const out = selectRecentReports(many);
    expect(out.length).toBe(RELEASE_MANIFEST_REPORT_CAP);
    expect(out[out.length - 1]).toBe(many[many.length - 1]);
    expect(out).toEqual(many.slice(-RELEASE_MANIFEST_REPORT_CAP));
  });

  it('honours a custom positive cap and ignores a garbled one', () => {
    const names = ['torii-v0.2.208-report.md', 'torii-v0.2.209-report.md', 'torii-v0.2.210-report.md'];
    expect(selectRecentReports(names, 2)).toEqual(names.slice(-2));
    expect(selectRecentReports(names, 0)).toEqual(names);
    expect(selectRecentReports(names, -3)).toEqual(names);
    expect(selectRecentReports(names, 'nope')).toEqual(names);
  });

  it('exposes a report shape regex + cap and is null-safe / never throws', () => {
    expect(RELEASE_MANIFEST_REPORT_RE.test('torii-v0.2.212-x-report.md')).toBe(true);
    expect(RELEASE_MANIFEST_REPORT_RE.test('something-else.md')).toBe(false);
    expect(Number.isInteger(RELEASE_MANIFEST_REPORT_CAP)).toBe(true);
    expect(() => selectRecentReports(undefined)).not.toThrow();
    expect(selectRecentReports(undefined)).toEqual([]);
    expect(selectRecentReports('not-an-array')).toEqual([]);
    expect(selectRecentReports([42, null, {}, 'torii-v0.2.212-report.md'])).toEqual(['torii-v0.2.212-report.md']);
  });
});

describe('release-manifest — robustness', () => {
  it('degrades to honest unknowns with no inputs and never throws', () => {
    expect(() => buildReleaseManifestModel({})).not.toThrow();
    const m = buildReleaseManifestModel({});
    expect(m.version).toBe(null);
    expect(m.status).toBe('COMPLETE');
    for (const e of m.required) expect(e.present).toBe(null);
  });

  it('never throws on garbled inputs', () => {
    expect(() => buildReleaseManifestModel({ artifacts: [], required: 'nope', reports: 42 })).not.toThrow();
    const m = buildReleaseManifestModel({ artifacts: [], required: 'nope', reports: 42 });
    expect(m.counts.required).toBe(RELEASE_MANIFEST_REQUIRED.length);
    expect(m.latestReports).toEqual([]);
  });
});
