// tests/stale-docs.test.js — pure STALE-DOC DETECTOR logic (tools/staleDocs.mjs, v0.2.191).
// Covers the header-vs-changelog version discrimination, test-count extraction, report-token
// derivation, the detectStaleDocs aggregation (clean / each drift kind / degraded inputs), and
// the text formatter. No fs — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  STALE_DOCS_BADGE, CONTINUITY_DOCS,
  staleVersionHeaderLines, testCountsInText, reportVersionToken,
  detectStaleDocs, formatStaleDocs,
} from '../tools/staleDocs.mjs';

const V = 'v0.2.191-alpha';

describe('staleVersionHeaderLines — header drift vs prose', () => {
  it('flags a header line citing a non-current version', () => {
    const out = staleVersionHeaderLines('Current version: **v0.2.190-alpha**', V);
    expect(out).toHaveLength(1);
    expect(out[0].markers).toEqual(['v0.2.190-alpha']);
  });

  it('does NOT flag a header that already cites the current version', () => {
    expect(staleVersionHeaderLines(`Current version: ${V}`, V)).toEqual([]);
  });

  it('ignores changelog prose where words sit between "version" and the marker', () => {
    // The marker is far from `version` and separated by real words → not a header assertion.
    expect(staleVersionHeaderLines('runtime version drift fixed (v0.2.137)', V)).toEqual([]);
  });

  it('ignores a quoted/inline-code marker (changelog quoting the pattern)', () => {
    expect(staleVersionHeaderLines('the `Current version: v0.2.100-alpha` header', V)).toEqual([]);
    expect(staleVersionHeaderLines('see "version: v0.2.100-alpha" example', V)).toEqual([]);
  });

  it('is safe on non-string / empty inputs', () => {
    expect(staleVersionHeaderLines(null, V)).toEqual([]);
    expect(staleVersionHeaderLines('x', '')).toEqual([]);
    expect(staleVersionHeaderLines(42, V)).toEqual([]);
  });
});

describe('testCountsInText', () => {
  it('extracts every "<N> passing" count in order', () => {
    expect(testCountsInText('Tests 1052 passing / 69 files; later 1052 passing')).toEqual([1052, 1052]);
  });
  it('returns [] when there is no passing count', () => {
    expect(testCountsInText('no counts here')).toEqual([]);
    expect(testCountsInText(null)).toEqual([]);
  });
});

describe('reportVersionToken', () => {
  it('strips the prerelease tag', () => {
    expect(reportVersionToken('v0.2.191-alpha')).toBe('v0.2.191');
  });
  it('returns null on bad input', () => {
    expect(reportVersionToken('nope')).toBeNull();
    expect(reportVersionToken(42)).toBeNull();
  });
});

describe('detectStaleDocs — aggregation', () => {
  const cleanDocs = () => ({
    'todo.md': `Current version: ${V}`,
    'progress.md': `Current version: ${V}\n| Tests | 1052 passing |`,
    'HANDOFF.md': `Current version: ${V}\nlatest: torii-v0.2.191-foo-report.md`,
  });

  it('reports no drift on consistent docs + a current, linked report', () => {
    const r = detectStaleDocs({
      version: V, docs: cleanDocs(), reports: ['torii-v0.2.191-foo-report.md'],
    });
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ error: 0, warn: 0 });
    expect(r.badge).toBe(STALE_DOCS_BADGE);
    expect(r.issues).toEqual([]);
  });

  it('flags version-header-drift in a continuity doc', () => {
    const docs = cleanDocs();
    docs['todo.md'] = 'Current version: **v0.2.190-alpha**';
    const r = detectStaleDocs({ version: V, docs, reports: ['torii-v0.2.191-foo-report.md'] });
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toContain('version-header-drift');
    expect(kinds).toContain('version-missing'); // todo.md no longer mentions V at all
    expect(r.ok).toBe(true); // advisory — warnings never fail
  });

  it('flags a continuity doc that never mentions the current version', () => {
    const docs = cleanDocs();
    docs['progress.md'] = 'no version anywhere | 1052 passing |';
    const r = detectStaleDocs({ version: V, docs, reports: ['torii-v0.2.191-foo-report.md'] });
    expect(r.issues.some((i) => i.kind === 'version-missing' && i.doc === 'progress.md')).toBe(true);
  });

  it('flags an unavailable continuity doc', () => {
    const docs = cleanDocs();
    delete docs['HANDOFF.md'];
    const r = detectStaleDocs({ version: V, docs, reports: ['torii-v0.2.191-foo-report.md'] });
    expect(r.issues.some((i) => i.kind === 'doc-unavailable' && i.doc === 'HANDOFF.md')).toBe(true);
  });

  it('flags a newest report that no continuity doc references', () => {
    const docs = cleanDocs();
    docs['HANDOFF.md'] = `Current version: ${V}`; // drop the report link
    const r = detectStaleDocs({ version: V, docs, reports: ['torii-v0.2.191-foo-report.md'] });
    expect(r.issues.some((i) => i.kind === 'latest-report-unlinked')).toBe(true);
  });

  it('flags a newest report that lags the current version', () => {
    const docs = cleanDocs();
    docs['HANDOFF.md'] = `Current version: ${V}\nlatest: torii-v0.2.190-old-report.md`;
    const r = detectStaleDocs({ version: V, docs, reports: ['torii-v0.2.190-old-report.md'] });
    expect(r.issues.some((i) => i.kind === 'report-version-lag')).toBe(true);
  });

  it('warns when there are no reports at all', () => {
    const r = detectStaleDocs({ version: V, docs: cleanDocs(), reports: [] });
    expect(r.issues.some((i) => i.kind === 'no-reports')).toBe(true);
  });

  it('flags disagreeing test counts across continuity docs', () => {
    const docs = cleanDocs();
    docs['todo.md'] = `Current version: ${V}\n1040 passing`;
    docs['progress.md'] = `Current version: ${V}\n1052 passing`;
    const r = detectStaleDocs({ version: V, docs, reports: ['torii-v0.2.191-foo-report.md'] });
    const drift = r.issues.find((i) => i.kind === 'test-count-drift');
    expect(drift).toBeTruthy();
    expect(drift.detail).toContain('1040');
    expect(drift.detail).toContain('1052');
  });

  it('does NOT flag test-count-drift when all docs agree', () => {
    const r = detectStaleDocs({ version: V, docs: cleanDocs(), reports: ['torii-v0.2.191-foo-report.md'] });
    expect(r.issues.some((i) => i.kind === 'test-count-drift')).toBe(false);
  });

  it('errors (ok:false) only when no version is provided', () => {
    const r = detectStaleDocs({ version: '', docs: cleanDocs(), reports: [] });
    expect(r.ok).toBe(false);
    expect(r.counts.error).toBe(1);
    expect(r.issues[0].kind).toBe('no-version');
  });

  it('degrades safely on garbled inputs (never throws)', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(() => detectStaleDocs({ version: V, docs: bad, reports: bad })).not.toThrow();
    }
    const r = detectStaleDocs({ version: V, docs: 'nope', reports: 'nope' });
    // all continuity docs unavailable → doc-unavailable per doc, plus no-reports
    expect(r.issues.some((i) => i.kind === 'doc-unavailable')).toBe(true);
    expect(r.issues.some((i) => i.kind === 'no-reports')).toBe(true);
  });

  it('uses default empty inputs when called with no args', () => {
    const r = detectStaleDocs();
    expect(r.ok).toBe(false); // no version
    expect(r.issues[0].kind).toBe('no-version');
  });

  it('scans exactly the continuity docs', () => {
    expect(CONTINUITY_DOCS).toEqual(['todo.md', 'progress.md', 'HANDOFF.md']);
  });
});

describe('formatStaleDocs — text', () => {
  it('renders the no-drift block', () => {
    const r = detectStaleDocs({
      version: V,
      docs: {
        'todo.md': `Current version: ${V}`,
        'progress.md': `Current version: ${V}`,
        'HANDOFF.md': `Current version: ${V}\ntorii-v0.2.191-foo-report.md`,
      },
      reports: ['torii-v0.2.191-foo-report.md'],
    });
    const out = formatStaleDocs(r);
    expect(out).toContain('stale-doc detector');
    expect(out).toContain(STALE_DOCS_BADGE);
    expect(out).toContain('no drift detected');
    expect(out).toContain(V);
  });

  it('renders issue lines when drift exists', () => {
    const r = detectStaleDocs({ version: V, docs: {}, reports: [] });
    const out = formatStaleDocs(r);
    expect(out).toContain('[doc-unavailable]');
    expect(out).toContain('advisory');
  });

  it('is safe on null / non-object input', () => {
    expect(formatStaleDocs(null)).toBe('stale-docs: (no report)');
    expect(formatStaleDocs(42)).toBe('stale-docs: (no report)');
  });
});
