// tests/bundle-sizes.test.js — pure size formatting + classification for the dist
// bundle baseline (tools/bundleSizes.mjs, v0.2.153). Covers formatBytes rounding/units,
// classifyAsset stem matching (hash-agnostic), the advisory severity threshold, and
// summarizeBundle aggregation/ordering/totals. No fs/zlib — fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  KIB, MIB, DEFAULT_WARN_LIMIT,
  formatBytes, classifyAsset, isJsCategory, severityFor, summarizeBundle,
} from '../tools/bundleSizes.mjs';

describe('formatBytes', () => {
  it('shows bytes without a decimal under 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(158)).toBe('158 B');
    expect(formatBytes(KIB - 1)).toBe('1023 B');
  });
  it('shows KB with one fraction digit from 1 KiB up', () => {
    expect(formatBytes(KIB)).toBe('1.0 KB');
    expect(formatBytes(116 * KIB + 300)).toBe('116.3 KB');
  });
  it('shows MB at/above 1 MiB and honours the digits arg', () => {
    expect(formatBytes(MIB)).toBe('1.0 MB');
    expect(formatBytes(2.1 * MIB, 2)).toBe('2.10 MB');
  });
  it('returns n/a for invalid/negative input', () => {
    expect(formatBytes(-1)).toBe('n/a');
    expect(formatBytes(NaN)).toBe('n/a');
    expect(formatBytes('nope')).toBe('n/a');
  });
});

describe('classifyAsset', () => {
  it('classifies the known dist chunks by stem, ignoring the content hash', () => {
    expect(classifyAsset('index-BcVmFbfD.js')).toBe('app');
    expect(classifyAsset('three-vendor-BZJ-67gd.js')).toBe('three');
    expect(classifyAsset('rapier-DE6a0vmv.js')).toBe('rapier');
    expect(classifyAsset('rolldown-runtime-DK3Fl9T5.js')).toBe('runtime');
    expect(classifyAsset('index.html')).toBe('html');
  });
  it('falls back to other for unrecognised assets', () => {
    expect(classifyAsset('styles-abc123.css')).toBe('other');
    expect(classifyAsset('')).toBe('other');
    expect(classifyAsset(null)).toBe('other');
  });
  it('marks the JS categories (not html) as JS', () => {
    for (const c of ['app', 'three', 'rapier', 'runtime', 'other']) expect(isJsCategory(c)).toBe(true);
    expect(isJsCategory('html')).toBe(false);
  });
});

describe('severityFor', () => {
  it('flags only assets strictly over the advisory limit', () => {
    expect(severityFor(DEFAULT_WARN_LIMIT - 1)).toBe('ok');
    expect(severityFor(DEFAULT_WARN_LIMIT)).toBe('ok');
    expect(severityFor(DEFAULT_WARN_LIMIT + 1)).toBe('warn');
  });
  it('honours a custom limit and degrades safely on bad input', () => {
    expect(severityFor(100, 50)).toBe('warn');
    expect(severityFor(40, 50)).toBe('ok');
    expect(severityFor(NaN)).toBe('ok');
  });
});

describe('summarizeBundle', () => {
  const entries = [
    { name: 'index-AAA.js', bytes: 116 * KIB, gzip: 40 * KIB },
    { name: 'three-vendor-BBB.js', bytes: 609 * KIB, gzip: 155 * KIB },
    { name: 'rapier-CCC.js', bytes: 2 * MIB, gzip: 800 * KIB },
    { name: 'rolldown-runtime-DDD.js', bytes: 158, gzip: 154 },
    { name: 'index.html', bytes: 36 * KIB, gzip: 8 * KIB },
  ];

  it('sorts assets by raw size descending and classifies each', () => {
    const r = summarizeBundle(entries);
    expect(r.assets.map((a) => a.name)).toEqual([
      'rapier-CCC.js', 'three-vendor-BBB.js', 'index-AAA.js', 'index.html', 'rolldown-runtime-DDD.js',
    ]);
    expect(r.assets[0].category).toBe('rapier');
    expect(r.assets[0].severity).toBe('warn');
  });

  it('totals JS bytes/gzip separately from html, and per-category', () => {
    const r = summarizeBundle(entries);
    expect(r.totals.count).toBe(5);
    expect(r.totals.jsBytes).toBe(116 * KIB + 609 * KIB + 2 * MIB + 158);
    expect(r.totals.jsGzip).toBe(40 * KIB + 155 * KIB + 800 * KIB + 154);
    expect(r.totals.htmlBytes).toBe(36 * KIB);
    expect(r.totals.allBytes).toBe(r.totals.jsBytes + r.totals.htmlBytes);
    expect(r.categories.three).toBe(609 * KIB);
    expect(r.categories.rapier).toBe(2 * MIB);
  });

  it('lists only the over-limit chunks as warnings', () => {
    const r = summarizeBundle(entries);
    expect(r.warnings).toEqual(['rapier-CCC.js']);
  });

  it('is deterministic and JSON-serialisable', () => {
    const a = summarizeBundle(entries);
    const b = summarizeBundle(entries);
    expect(a).toEqual(b);
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
  });

  it('degrades safely on empty/missing input', () => {
    const r = summarizeBundle();
    expect(r.totals).toEqual({ count: 0, jsBytes: 0, jsGzip: 0, htmlBytes: 0, allBytes: 0 });
    expect(r.assets).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('handles a missing gzip field without polluting the gzip total', () => {
    const r = summarizeBundle([{ name: 'index-X.js', bytes: 1000 }]);
    expect(r.assets[0].gzip).toBe(null);
    expect(r.totals.jsGzip).toBe(0);
    expect(r.totals.jsBytes).toBe(1000);
  });

  it('respects a custom warnLimit', () => {
    const r = summarizeBundle([{ name: 'three-vendor-Z.js', bytes: 100 * KIB }], { warnLimit: 50 * KIB });
    expect(r.warnLimit).toBe(50 * KIB);
    expect(r.warnings).toEqual(['three-vendor-Z.js']);
  });
});
