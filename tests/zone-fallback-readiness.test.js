// tests/zone-fallback-readiness.test.js — pure SPA `/zone/*` fallback readiness checks
// (tools/zoneFallbackReadiness.mjs, v0.2.185). Covers fallbackEvidence, checkFallbackDocs
// (hard-fail on a missing/under-documented doc), zonePathsInDist / checkDistRoutes (the
// built route-shape guard), and the folded checkZoneFallbackReadiness. No fs/network — every
// input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  ZONE_ROUTE_PREFIX, ZONE_FALLBACK_BADGE, REQUIRED_FALLBACK_DOCS,
  fallbackEvidence, checkFallbackDocs, zonePathsInDist, checkDistRoutes,
  checkZoneFallbackReadiness,
} from '../tools/zoneFallbackReadiness.mjs';

// Minimal docs that both name the /zone/ route and show an index.html fallback directive.
const goodDocs = () => ({
  'VPS_INSTALL.md': 'serve /zone/<slug> via nginx: try_files $uri $uri/ /index.html;',
  'HANDOFF.md': 'SPA fallback: serve index.html for any /zone/* path (Caddy try_files {path} /index.html).',
});

describe('module constants', () => {
  it('pins the route prefix, badge, and required docs', () => {
    expect(ZONE_ROUTE_PREFIX).toBe('/zone/');
    expect(ZONE_FALLBACK_BADGE).toMatch(/LOCAL READ-ONLY/);
    expect(REQUIRED_FALLBACK_DOCS).toEqual(['VPS_INSTALL.md', 'HANDOFF.md']);
  });
});

describe('fallbackEvidence', () => {
  it('detects an nginx try_files /index.html directive + the zone path', () => {
    const ev = fallbackEvidence('location / { try_files $uri $uri/ /index.html; }  # /zone/<slug>');
    expect(ev.tryFiles).toBe(true);
    expect(ev.indexFallback).toBe(true);
    expect(ev.zonePath).toBe(true);
  });
  it('detects a Caddy try_files {path} /index.html directive', () => {
    const ev = fallbackEvidence('try_files {path} /index.html');
    expect(ev.tryFiles).toBe(true);
    expect(ev.indexFallback).toBe(true);
  });
  it('detects prose "fallback document … index.html" without try_files', () => {
    const ev = fallbackEvidence('set the SPA 404 fallback document to index.html');
    expect(ev.tryFiles).toBe(false);
    expect(ev.indexFallback).toBe(true);
  });
  it('is false on text with no fallback signal, and safe on bad input', () => {
    expect(fallbackEvidence('just serve some files')).toEqual({ zonePath: false, indexFallback: false, tryFiles: false });
    expect(fallbackEvidence(null)).toEqual({ zonePath: false, indexFallback: false, tryFiles: false });
  });
});

describe('checkFallbackDocs', () => {
  it('passes when every required doc documents the index.html fallback', () => {
    const r = checkFallbackDocs(goodDocs());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.checked).toEqual(REQUIRED_FALLBACK_DOCS);
  });

  it('HARD FAILS when a required doc is missing', () => {
    const docs = goodDocs();
    delete docs['HANDOFF.md'];
    const r = checkFallbackDocs(docs);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('HANDOFF.md'))).toBe(true);
  });

  it('HARD FAILS when a required doc never describes the index.html fallback', () => {
    const docs = goodDocs();
    docs['VPS_INSTALL.md'] = 'install nginx and point DNS at the box for /zone/ travel';
    const r = checkFallbackDocs(docs);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('VPS_INSTALL.md') && e.includes('fallback'))).toBe(true);
  });

  it('WARNS (does not fail) when the fallback is shown but the /zone/ route is unnamed', () => {
    const docs = goodDocs();
    docs['HANDOFF.md'] = 'SPA fallback: try_files $uri /index.html;';
    const r = checkFallbackDocs(docs);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('HANDOFF.md') && w.includes('/zone/'))).toBe(true);
  });

  it('is deterministic and JSON-serialisable', () => {
    const a = checkFallbackDocs(goodDocs());
    const b = checkFallbackDocs(goodDocs());
    expect(a).toEqual(b);
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
  });
});

describe('zonePathsInDist', () => {
  it('flags built files published under /zone/* (which would shadow the fallback)', () => {
    expect(zonePathsInDist(['index.html', 'zone/foo.html', 'assets/app.js'])).toEqual(['/zone/foo.html']);
    expect(zonePathsInDist(['/zone/bar/index.html'])).toEqual(['/zone/bar/index.html']);
  });
  it('returns [] for a clean build and is safe on bad input', () => {
    expect(zonePathsInDist(['index.html', 'assets/app-abc.js', 'favicon.ico'])).toEqual([]);
    expect(zonePathsInDist(null)).toEqual([]);
  });
});

describe('checkDistRoutes', () => {
  it('passes a normal Vite build: index.html present, nothing under /zone/*', () => {
    const r = checkDistRoutes({ paths: ['index.html', 'assets/app-abc.js', 'assets/three-def.js'] });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.indexHtml).toBe(true);
    expect(r.zonePaths).toEqual([]);
  });

  it('is SKIPPED (ok) when no paths are provided (no build yet)', () => {
    const r = checkDistRoutes({});
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('HARD FAILS when dist has no index.html for the fallback to serve', () => {
    const r = checkDistRoutes({ paths: ['assets/app.js'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('index.html'))).toBe(true);
  });

  it('HARD FAILS when a static file is published under /zone/* (shadows the fallback)', () => {
    const r = checkDistRoutes({ paths: ['index.html', 'zone/plebeian-market-bazaar.html'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('/zone/') && e.toUpperCase().includes('SHADOW'))).toBe(true);
  });
});

describe('checkZoneFallbackReadiness', () => {
  it('is ok when docs document the fallback and dist relies on it', () => {
    const r = checkZoneFallbackReadiness({
      docs: goodDocs(),
      dist: { paths: ['index.html', 'assets/app.js'] },
    });
    expect(r.ok).toBe(true);
    expect(r.badge).toBe(ZONE_FALLBACK_BADGE);
    expect(r.errors).toEqual([]);
  });

  it('skips the dist guard but still checks docs when no build is supplied', () => {
    const r = checkZoneFallbackReadiness({ docs: goodDocs() });
    expect(r.ok).toBe(true);
    expect(r.dist.skipped).toBe(true);
  });

  it('folds doc + dist failures into one not-ok result', () => {
    const docs = goodDocs();
    delete docs['VPS_INSTALL.md'];
    const r = checkZoneFallbackReadiness({ docs, dist: { paths: ['zone/x.html'] } });
    expect(r.ok).toBe(false);
    // Missing doc + missing index.html + shadowing zone file = 3 errors.
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('is safe on empty input (docs missing → not ok, never throws)', () => {
    const r = checkZoneFallbackReadiness();
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.errors)).toBe(true);
  });
});
