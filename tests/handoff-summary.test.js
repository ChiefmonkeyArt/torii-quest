// tests/handoff-summary.test.js — pure AI-handoff auto-summary assembly + formatting
// (tools/handoffSummary.mjs, v0.2.190). Covers buildHandoffSummary, the text/markdown
// formatters, and degraded/missing-input cases. No fs/git — every input is plain data, fully
// node-deterministic (generatedAt is omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';
import {
  HANDOFF_SUMMARY_BADGE, HANDOFF_SUMMARY_SCHEMA, HANDOFF_SUMMARY_SCHEMA_VERSION,
  HANDOFF_SUMMARY_LIVE_URL, VERIFY_COMMANDS, KEY_CONSTRAINTS, DEFAULT_NEXT_SAFE_TASK,
  DEFAULT_WRITE_FILENAME,
  buildHandoffSummary, formatHandoffSummary, formatHandoffSummaryMarkdown,
  resolveHandoffWritePath,
} from '../tools/handoffSummary.mjs';

const V = 'v0.2.190-alpha';
const PKG = '0.2.190-alpha';

// A representative READY release-readiness summary (the shape buildReleaseReadiness returns).
const readyRelease = () => ({
  badge: 'RELEASE READINESS · LOCAL · READ-ONLY',
  gateCommand: 'npm run test:release',
  status: 'ready',
  statusLabel: 'READY',
  ready: true,
  blockers: [],
  unknowns: [],
  version: V,
  packageVersion: PKG,
  gitCommit: 'abc1234',
  signals: {
    regression: { state: 'ok', count: 15, expected: 15, ok: true },
    tests: { state: 'ok', fast: 5, foundation: 25, ok: true, errors: [] },
  },
  latestReports: ['torii-v0.2.189-release-status-json-report.md'],
});

describe('buildHandoffSummary — assembly', () => {
  it('folds a READY release summary into a stable handoff brief', () => {
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, gitCommit: 'abc1234', release: readyRelease() });
    expect(s.schema).toBe(HANDOFF_SUMMARY_SCHEMA);
    expect(s.schemaVersion).toBe(HANDOFF_SUMMARY_SCHEMA_VERSION);
    expect(s.badge).toBe(HANDOFF_SUMMARY_BADGE);
    expect(s.version).toBe(V);
    expect(s.packageVersion).toBe(PKG);
    expect(s.gitCommit).toBe('abc1234');
    expect(s.liveUrl).toBe(HANDOFF_SUMMARY_LIVE_URL);
    expect(s.gate.status).toBe('ready');
    expect(s.gate.statusLabel).toBe('READY');
    expect(s.gate.ready).toBe(true);
    expect(s.gate.blockers).toEqual([]);
    expect(s.gate.regression).toEqual({ count: 15, expected: 15 });
    expect(s.gate.testProfiles).toEqual({ fast: 5, foundation: 25 });
    expect(s.latestReports).toEqual(['torii-v0.2.189-release-status-json-report.md']);
  });

  it('defaults next safe task, constraints and verify commands when not supplied', () => {
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, release: readyRelease() });
    expect(s.nextSafeTask).toBe(DEFAULT_NEXT_SAFE_TASK);
    expect(s.constraints).toEqual([...KEY_CONSTRAINTS]);
    expect(s.verifyCommands).toEqual(VERIFY_COMMANDS.map((c) => ({ cmd: c.cmd, desc: c.desc })));
    // standing constraints the work order pins
    expect(s.constraints).toContain('godMode false');
    expect(s.constraints).toContain("comments use 'nostrich'");
    expect(s.constraints).toContain('Chiefmonkey spelling');
  });

  it('honours explicit overrides for task / constraints / reports', () => {
    const s = buildHandoffSummary({
      version: V, packageVersion: PKG, release: readyRelease(),
      nextSafeTask: 'do the safe thing', constraints: ['only this'],
      latestReports: ['r1.md', 'r2.md'],
    });
    expect(s.nextSafeTask).toBe('do the safe thing');
    expect(s.constraints).toEqual(['only this']);
    expect(s.latestReports).toEqual(['r1.md', 'r2.md']);
  });

  it('generatedAt is the only non-deterministic field — omitted → null and reproducible', () => {
    const a = buildHandoffSummary({ version: V, packageVersion: PKG, release: readyRelease() });
    const b = buildHandoffSummary({ version: V, packageVersion: PKG, release: readyRelease() });
    expect(a.generatedAt).toBeNull();
    expect(a).toEqual(b);
    const stamped = buildHandoffSummary({ version: V, packageVersion: PKG, release: readyRelease(), generatedAt: '2026-06-25T00:00:00.000Z' });
    expect(stamped.generatedAt).toBe('2026-06-25T00:00:00.000Z');
    // The stamp is isolated: blank it out and the rest of the envelope matches the unstamped one.
    expect({ ...stamped, generatedAt: null }).toEqual(a);
  });

  it('passes NOT READY blockers through', () => {
    const rel = { ...readyRelease(), status: 'not-ready', statusLabel: 'NOT READY', ready: false, blockers: ['docs'] };
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, release: rel });
    expect(s.gate.ready).toBe(false);
    expect(s.gate.statusLabel).toBe('NOT READY');
    expect(s.gate.blockers).toEqual(['docs']);
  });

  it('JSON-serialisable', () => {
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, release: readyRelease() });
    expect(() => JSON.stringify(s)).not.toThrow();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('buildHandoffSummary — degraded / missing inputs', () => {
  it('null release degrades to an honest unknown gate (never throws)', () => {
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, release: null });
    expect(s.gate.status).toBe('unknown');
    expect(s.gate.statusLabel).toBe('NO RELEASE SUMMARY');
    expect(s.gate.ready).toBe(false);
    expect(s.gate.blockers).toEqual([]);
    expect(s.gate.regression).toEqual({ count: null, expected: null });
    expect(s.gate.testProfiles).toEqual({ fast: null, foundation: null });
    expect(s.latestReports).toEqual([]);
  });

  it('garbled release inputs (array / number / string) degrade to unknown', () => {
    for (const bad of [[], 42, 'nope', undefined]) {
      const s = buildHandoffSummary({ version: V, packageVersion: PKG, release: bad });
      expect(s.gate.status).toBe('unknown');
      expect(s.gate.ready).toBe(false);
      expect(s.version).toBe(V);
    }
  });

  it('missing version/package fall back to null', () => {
    const s = buildHandoffSummary({ release: readyRelease() });
    expect(s.version).toBeNull();
    expect(s.packageVersion).toBeNull();
    expect(s.gitCommit).toBeNull();
  });
});

describe('formatHandoffSummary — text', () => {
  it('renders the key sections', () => {
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, gitCommit: 'abc1234', release: readyRelease() });
    const out = formatHandoffSummary(s);
    expect(out).toContain('AI handoff auto-summary');
    expect(out).toContain(V);
    expect(out).toContain('gate verdict: READY');
    expect(out).toContain('regression: 15/15 checks');
    expect(out).toContain('next safe task:');
    expect(out).toContain('key constraints:');
    expect(out).toContain('verify before ship');
    expect(out).toContain('npm run test:release');
  });

  it('is safe on no summary', () => {
    expect(formatHandoffSummary(null)).toBe('handoff-summary: (no summary)');
    expect(formatHandoffSummary(42)).toBe('handoff-summary: (no summary)');
  });
});

describe('formatHandoffSummaryMarkdown — markdown', () => {
  it('renders markdown headings + bullets', () => {
    const s = buildHandoffSummary({ version: V, packageVersion: PKG, gitCommit: 'abc1234', release: readyRelease() });
    const md = formatHandoffSummaryMarkdown(s);
    expect(md).toContain('# Torii Quest — AI handoff auto-summary');
    expect(md).toContain('## Next safe task');
    expect(md).toContain('## Key constraints');
    expect(md).toContain('## Verify before ship');
    expect(md).toContain('- `npm run check`');
    expect(md).toContain(`**Version:** ${V}`);
  });

  it('is safe on no summary', () => {
    expect(formatHandoffSummaryMarkdown(null)).toContain('_(no summary)_');
  });
});

describe('resolveHandoffWritePath — --write repo-boundary (WARN-3)', () => {
  const ROOT = sep === '\\' ? 'C:\\repo' : '/repo';

  it('defaults to the in-repo handoff-summary.md when no path is given', () => {
    for (const raw of ['', '   ', undefined, null]) {
      const r = resolveHandoffWritePath(raw, ROOT);
      expect(r.ok).toBe(true);
      expect(r.path).toBe(resolve(ROOT, DEFAULT_WRITE_FILENAME));
    }
  });

  it('allows a safe relative path inside the repo (incl. a subdirectory)', () => {
    expect(resolveHandoffWritePath('brief.md', ROOT)).toEqual({ ok: true, path: resolve(ROOT, 'brief.md') });
    expect(resolveHandoffWritePath('docs/handoff.md', ROOT)).toEqual({ ok: true, path: resolve(ROOT, 'docs/handoff.md') });
    expect(resolveHandoffWritePath('./a/b/c.md', ROOT)).toEqual({ ok: true, path: resolve(ROOT, 'a/b/c.md') });
  });

  it('rejects an absolute path (no clobbering arbitrary files outside the repo)', () => {
    const abs = sep === '\\' ? 'C:\\etc\\evil.md' : '/etc/evil.md';
    expect(resolveHandoffWritePath(abs, ROOT)).toEqual({ ok: false, error: 'absolute-path-not-allowed' });
  });

  it('rejects a relative path that escapes the repo via ..', () => {
    expect(resolveHandoffWritePath('../escape.md', ROOT).ok).toBe(false);
    expect(resolveHandoffWritePath('../../etc/passwd', ROOT).error).toBe('outside-repo');
    expect(resolveHandoffWritePath('docs/../../escape.md', ROOT).error).toBe('outside-repo');
  });

  it('rejects resolving to the repo root itself (a dir, not a file)', () => {
    expect(resolveHandoffWritePath('.', ROOT)).toEqual({ ok: false, error: 'outside-repo' });
  });

  it('rejects a missing/garbled root rather than guessing', () => {
    for (const bad of ['', null, undefined, 42, {}]) {
      expect(resolveHandoffWritePath('brief.md', bad)).toEqual({ ok: false, error: 'no-root' });
    }
  });

  it('never throws on hostile input', () => {
    for (const raw of [42, {}, [], '\0', 'a b.md']) {
      expect(() => resolveHandoffWritePath(raw, ROOT)).not.toThrow();
    }
  });
});
