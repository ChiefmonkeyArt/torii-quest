// tests/doc-consistency.test.js — pure docs/status consistency checks (tools/
// docConsistency.mjs, v0.2.154). Covers versionInText, findVersionMarkers,
// staleLiveVersionLines, and the checkDocConsistency hard-fail/advisory split. No fs —
// every input is a plain {name → content} string map, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  CONTINUITY_DOCS, ADVISORY_DOCS,
  versionInText, findVersionMarkers, staleLiveVersionLines, checkDocConsistency,
} from '../tools/docConsistency.mjs';

const V = 'v0.2.154-alpha';
// A minimal set of "good" docs that all reference the current version.
const goodFiles = () => ({
  'todo.md': `# TODO\nCurrent version: ${V}\n- do things`,
  'progress.md': `# Progress\nCurrent version: ${V}\n`,
  'HANDOFF.md': `# Handoff\n- Current version: ${V}\n`,
  'SDK_DEBUG_INDEX.md': `# Index (${V})\n`,
  'CODE_INDEX.md': `# Code index\nindex (${V})\n`,
});

describe('versionInText', () => {
  it('matches the exact version string', () => {
    expect(versionInText(V, `intro ${V} outro`)).toBe(true);
    expect(versionInText(V, 'no version here')).toBe(false);
  });
  it('is safe on bad input', () => {
    expect(versionInText('', 'x')).toBe(false);
    expect(versionInText(V, null)).toBe(false);
    expect(versionInText(null, 'x')).toBe(false);
  });
});

describe('findVersionMarkers', () => {
  it('finds every vX.Y.Z-tag marker in order', () => {
    expect(findVersionMarkers('a v0.2.10-alpha b v0.2.154-alpha')).toEqual(['v0.2.10-alpha', 'v0.2.154-alpha']);
  });
  it('returns [] for no markers or bad input', () => {
    expect(findVersionMarkers('nothing')).toEqual([]);
    expect(findVersionMarkers(null)).toEqual([]);
  });
});

describe('staleLiveVersionLines', () => {
  it('flags a live/published line naming a non-current version', () => {
    const out = staleLiveVersionLines('live published version: v0.2.113-alpha', V);
    expect(out).toHaveLength(1);
    expect(out[0].markers).toEqual(['v0.2.113-alpha']);
  });
  it('does not flag a live line that names the current version', () => {
    expect(staleLiveVersionLines(`live version: ${V}`, V)).toEqual([]);
  });
  it('ignores ordinary version mentions with no live/published/deployed context', () => {
    expect(staleLiveVersionLines('changelog v0.2.113-alpha shipped a fix', V)).toEqual([]);
  });
  it('does not flag a deploy task line that mentions "live"+a version but no "version:" assertion', () => {
    expect(staleLiveVersionLines('**Torii.quest live** — publish the current green source (v0.2.135-alpha)', V)).toEqual([]);
  });
  it('is safe on bad input', () => {
    expect(staleLiveVersionLines(null, V)).toEqual([]);
  });
});

describe('checkDocConsistency', () => {
  it('passes when all continuity docs carry the current version', () => {
    const r = checkDocConsistency({ version: V, files: goodFiles() });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.checked).toEqual(expect.arrayContaining(CONTINUITY_DOCS));
  });

  it('HARD FAILS when a continuity doc has drifted off the current version', () => {
    const files = goodFiles();
    files['progress.md'] = '# Progress\nCurrent version: v0.2.150-alpha\n';
    const r = checkDocConsistency({ version: V, files });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('progress.md') && e.includes(V))).toBe(true);
  });

  it('HARD FAILS when a core continuity doc is missing', () => {
    const files = goodFiles();
    delete files['HANDOFF.md'];
    const r = checkDocConsistency({ version: V, files });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('missing core doc: HANDOFF.md'))).toBe(true);
  });

  it('respects an explicit present:false over a supplied file body', () => {
    const r = checkDocConsistency({ version: V, files: goodFiles(), present: { 'todo.md': false } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('missing core doc: todo.md'))).toBe(true);
  });

  it('only WARNS (never fails) when an advisory doc lags the current version', () => {
    const files = goodFiles();
    files['SDK_DEBUG_INDEX.md'] = '# Index (v0.2.150-alpha)\n';
    const r = checkDocConsistency({ version: V, files });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('SDK_DEBUG_INDEX.md') && w.includes('advisory'))).toBe(true);
  });

  it('WARNS on a stale live/published version line without failing', () => {
    const files = goodFiles();
    files['progress.md'] += '\n> live published version: v0.2.113-alpha';
    const r = checkDocConsistency({ version: V, files });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('stale live/published version'))).toBe(true);
  });

  it('FAILS clearly when no version is provided', () => {
    const r = checkDocConsistency({ files: goodFiles() });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/no current version/);
  });

  it('is deterministic and JSON-serialisable', () => {
    const a = checkDocConsistency({ version: V, files: goodFiles() });
    const b = checkDocConsistency({ version: V, files: goodFiles() });
    expect(a).toEqual(b);
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
  });

  it('exposes the documented doc lists', () => {
    expect(CONTINUITY_DOCS).toEqual(['todo.md', 'progress.md', 'HANDOFF.md']);
    expect(ADVISORY_DOCS).toEqual(['SDK_DEBUG_INDEX.md', 'CODE_INDEX.md']);
  });
});
