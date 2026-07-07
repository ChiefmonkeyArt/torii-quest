// tests/handoff-status.test.js — pure AI-handoff status assembly + formatting
// (tools/handoffStatus.mjs, v0.2.156). Covers stripV, versionAgreement, buildHandoffStatus,
// and formatHandoffStatus. No fs/git — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  LIVE_URL, CORE_DOCS, CHECK_COMMANDS,
  stripV, versionAgreement, buildHandoffStatus, formatHandoffStatus,
} from '../tools/handoffStatus.mjs';

const V = 'v0.2.156-alpha';
const PKG = '0.2.156-alpha';

const allPresent = () => Object.fromEntries(CORE_DOCS.map((d) => [d, true]));
const sampleBundle = () => ({
  totals: { jsBytes: 2_900_000, jsGzip: 1_030_000, count: 4 },
  categories: { app: 119_000, three: 624_000, rapier: 2_236_000 },
  warnings: ['rapier-DE6a0vmv.js'],
});

describe('stripV', () => {
  it('strips a single leading v', () => {
    expect(stripV('v0.2.156-alpha')).toBe('0.2.156-alpha');
    expect(stripV('0.2.156-alpha')).toBe('0.2.156-alpha');
  });
  it('is safe on bad input', () => {
    expect(stripV(null)).toBe('');
    expect(stripV(undefined)).toBe('');
  });
});

describe('versionAgreement', () => {
  it('agrees when package == config with the v stripped', () => {
    const r = versionAgreement(V, PKG);
    expect(r.ok).toBe(true);
    expect(r.expectedPackage).toBe(PKG);
  });
  it('flags drift', () => {
    expect(versionAgreement(V, '0.2.150-alpha').ok).toBe(false);
    expect(versionAgreement(V, null).ok).toBe(false);
    expect(versionAgreement(null, PKG).ok).toBe(false);
  });
});

describe('buildHandoffStatus', () => {
  it('assembles a complete status when all inputs are present', () => {
    const s = buildHandoffStatus({
      version: V, packageVersion: PKG, gitCommit: 'abc1234',
      docsPresent: allPresent(), latestReports: ['torii-v0.2.156-handoff-status-report.md'],
      bundle: sampleBundle(),
    });
    expect(s.badge).toBe('torii-handoff-status');
    expect(s.version).toBe(V);
    expect(s.packageVersion).toBe(PKG);
    expect(s.versionMatch).toBe(true);
    expect(s.gitCommit).toBe('abc1234');
    expect(s.liveUrl).toBe(LIVE_URL);
    expect(s.docs.present).toEqual(CORE_DOCS);
    expect(s.docs.missing).toEqual([]);
    expect(s.checks.map((c) => c.cmd)).toEqual(CHECK_COMMANDS.map((c) => c.cmd));
    expect(s.bundle.totalJsBytes).toBe(2_900_000);
    expect(s.bundle.overLimit).toEqual(['rapier-DE6a0vmv.js']);
  });

  it('reports missing core docs', () => {
    const present = allPresent();
    delete present['torii-quest-handoff.md'];
    present['torii-quest-handoff.md'] = false;
    const s = buildHandoffStatus({ version: V, packageVersion: PKG, docsPresent: present });
    expect(s.docs.missing).toContain('torii-quest-handoff.md');
    expect(s.docs.present).not.toContain('torii-quest-handoff.md');
  });

  it('degrades safely when git commit and dist bundle are unavailable', () => {
    const s = buildHandoffStatus({ version: V, packageVersion: PKG, docsPresent: allPresent() });
    expect(s.gitCommit).toBeNull();
    expect(s.bundle).toBeNull();
    expect(s.latestReports).toEqual([]);
  });

  it('surfaces version drift in versionMatch', () => {
    const s = buildHandoffStatus({ version: V, packageVersion: '0.2.150-alpha', docsPresent: allPresent() });
    expect(s.versionMatch).toBe(false);
  });

  it('is deterministic and JSON-serialisable', () => {
    const args = { version: V, packageVersion: PKG, gitCommit: 'abc1234', docsPresent: allPresent(), bundle: sampleBundle() };
    const a = buildHandoffStatus(args);
    const b = buildHandoffStatus(args);
    expect(a).toEqual(b);
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
  });

  it('does not mutate the caller-supplied arrays', () => {
    const reports = ['r1.md'];
    const s = buildHandoffStatus({ version: V, packageVersion: PKG, docsPresent: allPresent(), latestReports: reports });
    s.latestReports.push('mutated.md');
    expect(reports).toEqual(['r1.md']);
  });
});

describe('formatHandoffStatus', () => {
  it('renders the key fields and check commands', () => {
    const s = buildHandoffStatus({
      version: V, packageVersion: PKG, gitCommit: 'abc1234',
      docsPresent: allPresent(), bundle: sampleBundle(),
    });
    const out = formatHandoffStatus(s);
    expect(out).toContain(V);
    expect(out).toContain(PKG);
    expect(out).toContain('abc1234');
    expect(out).toContain(LIVE_URL);
    expect(out).toContain('npm run check');
    expect(out).toContain('in sync');
    expect(out).toContain('bundle baseline');
  });

  it('flags version drift and missing docs in the text', () => {
    const present = allPresent();
    present['torii-quest-strategy.md'] = false;
    const s = buildHandoffStatus({ version: V, packageVersion: '0.2.150-alpha', docsPresent: present });
    const out = formatHandoffStatus(s);
    expect(out).toContain('DRIFT');
    expect(out).toContain('MISSING');
    expect(out).toContain('torii-quest-strategy.md');
  });

  it('notes when no dist bundle exists', () => {
    const s = buildHandoffStatus({ version: V, packageVersion: PKG, docsPresent: allPresent() });
    expect(formatHandoffStatus(s)).toContain('no dist/');
  });

  it('is safe on bad input', () => {
    expect(formatHandoffStatus(null)).toContain('no status');
  });
});
