// tests/continuum-dashboard.test.js — locks the Torii Continuum project-oversight
// DASHBOARD data model + pure renderer (src/engine/dashboard/continuumData.js,
// v0.2.171). Proves the data/model helpers, computed totals/percentages, the
// JSON snapshot shape, render-output SAFETY (no external href, same-origin-only
// fetch, no setTimeout/eval, struck completed-24h, source-of-truth note, donut
// SVG present), and SDK exposure. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CONTINUUM_VERSION, CONTINUUM_BADGE, CONTINUUM,
  CONTINUUM_REFRESH_SCRIPT, CONTINUUM_SCRIPT_SHA256, CONTINUUM_CSP,
  HEALTH_LASTKNOWN, buildHealthModel,
  SEED_MILESTONES, buildMilestoneModel,
  READINESS_BADGE, buildReadinessModel,
  SHIP_BADGE, SHIP_LASTKNOWN, SHIP_NEXT_SAFE_TASK, buildShipModel,
  READHEALTH_BADGE, buildReadHealthModel,
  escapeHtml, clampPct, barCells, ringDash,
  computeTotals, buildContinuumModel, continuumDataJSON, renderContinuumPage,
} from '../src/engine/dashboard/continuumData.js';
import * as SDK from '../src/sdk/index.js';
import { VERSION } from '../src/config.js';

describe('module shape', () => {
  it('pins the version (tracks the build) and the read-only oversight badge', () => {
    expect(CONTINUUM_VERSION).toBe('v0.2.194-alpha');
    expect(CONTINUUM_VERSION).toBe(VERSION);
    expect(CONTINUUM_BADGE).toBe('PROJECT OVERSIGHT · STATIC · READ-ONLY');
  });

  it('curated data is frozen and carries the expected sections', () => {
    expect(Object.isFrozen(CONTINUUM)).toBe(true);
    expect(CONTINUUM.title).toBe('Torii Continuum');
    expect(Array.isArray(CONTINUUM.next12)).toBe(true);
    expect(Array.isArray(CONTINUUM.leanRoute)).toBe(true);
    expect(Array.isArray(CONTINUUM.tracks)).toBe(true);
    expect(CONTINUUM.sourceOfTruth.length).toBe(3);
  });

  it('contributors is a clearly-flagged SEED metric, not live data', () => {
    expect(CONTINUUM.contributors.isSeed).toBe(true);
    expect(CONTINUUM.contributors.humans).toBe(1);
    expect(CONTINUUM.contributors.clankers).toBe(3);
    expect(CONTINUUM.contributors.note).toMatch(/seed/i);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>"x"&'y'`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });
  it('treats null/undefined as empty string, never throws', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('clampPct', () => {
  it('rounds and clamps into 0..100', () => {
    expect(clampPct(46.4)).toBe(46);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
  });
  it('returns null for null/NaN so an n/a track shows', () => {
    expect(clampPct(null)).toBeNull();
    expect(clampPct(NaN)).toBeNull();
  });
});

describe('barCells', () => {
  it('splits a percent into filled/empty over the width', () => {
    const b = barCells(50, 20);
    expect(b.filled).toBe(10);
    expect(b.empty).toBe(10);
    expect(b.percent).toBe(50);
  });
  it('null percent → all-empty (the n/a Deployment track)', () => {
    const b = barCells(null, 20);
    expect(b.filled).toBe(0);
    expect(b.empty).toBe(20);
    expect(b.percent).toBeNull();
  });
});

describe('ringDash', () => {
  it('filled + rest always equals the circumference', () => {
    const C = 326.726;
    const { filled, rest } = ringDash(73, C);
    expect(filled + rest).toBeCloseTo(C, 3);
    expect(filled).toBeCloseTo(C * 0.73, 3);
  });
});

describe('computeTotals', () => {
  const t = computeTotals(CONTINUUM);
  it('counts list lengths exactly', () => {
    expect(t.tasksAhead).toBe(12);
    expect(t.activeTasks).toBe(3);
    expect(t.completedLast24h).toBe(4);
    expect(t.archivedClusters).toBe(7);
    expect(t.trackCount).toBe(6);
    expect(t.milestoneCount).toBe(5);
  });
  it('milestones achieved counts only state==="done" (honest, currently 0)', () => {
    expect(t.milestonesAchieved).toBe(0);
    expect(t.milestonesAchievedPct).toBe(0);
    expect(t.milestonesInProgress).toBe(4);
  });
  it('directional percentages match the curated data', () => {
    expect(t.pocProgressPct).toBe(46);
    expect(t.buildProgressPct).toBe(74);
  });
});

describe('buildContinuumModel', () => {
  const m = buildContinuumModel();
  it('does not mutate the frozen source', () => {
    expect(Object.isFrozen(CONTINUUM)).toBe(true);
  });
  it('attaches per-track bar cells and computed totals', () => {
    expect(m.badge).toBe(CONTINUUM_BADGE);
    expect(m.tracks.every((tk) => tk.bar && typeof tk.bar.filled === 'number')).toBe(true);
    expect(m.totals.tasksAhead).toBe(12);
  });
});

describe('continuumDataJSON', () => {
  it('is JSON-serialisable and carries totals + the seed contributors', () => {
    const j = continuumDataJSON();
    const round = JSON.parse(JSON.stringify(j));
    expect(round.version).toBe('v0.2.194-alpha');
    expect(round.totals.pocProgressPct).toBe(46);
    expect(round.contributors.isSeed).toBe(true);
  });
});

describe('renderContinuumPage', () => {
  const html = renderContinuumPage();

  it('returns a self-contained HTML document with the version', () => {
    expect(typeof html).toBe('string');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('v0.2.194-alpha');
    expect(html).toContain('Torii Continuum');
  });

  it('renders all 12 next tasks and struck completed-24h items', () => {
    for (const task of CONTINUUM.next12) {
      expect(html).toContain(escapeHtml(task));
    }
    expect(html).toContain('class="done"');
  });

  it('renders donut SVG rings and the source-of-truth note', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('donut-val');
    expect(html).toContain('Source of truth');
    expect(html).toContain('todo.md');
    expect(html).toContain('strategy.md');
    expect(html).toContain('progress.md');
  });

  it('SAFETY: no external navigation, no http(s) href/redirect', () => {
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/window\.open/);
    expect(html).not.toMatch(/window\.location/);
    expect(html).not.toMatch(/location\.href/);
  });

  it('SAFETY: only same-origin relative fetch, no timers, no eval', () => {
    expect(html).toContain("fetch('./continuum-data.json'");
    expect(html).not.toMatch(/fetch\(\s*["']https?:/i);
    expect(html).not.toMatch(/setTimeout|setInterval/);
    expect(html).not.toMatch(/\beval\(/);
  });
});

describe('CSP hardening (v0.2.172)', () => {
  const html = renderContinuumPage();

  it('emits a Content-Security-Policy meta tag carrying the strict policy', () => {
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain(CONTINUUM_CSP);
  });

  it('script-src is self + the script hash with NO unsafe-inline (XSS surface closed)', () => {
    expect(CONTINUUM_CSP).toContain("script-src 'self' '" + CONTINUUM_SCRIPT_SHA256 + "'");
    // 'unsafe-inline'/'unsafe-eval' must NEVER appear in script-src.
    expect(CONTINUUM_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(CONTINUUM_CSP).not.toContain("'unsafe-eval'");
  });

  it('default-src/object-src/base-uri/form-action/frame-ancestors are locked down', () => {
    expect(CONTINUUM_CSP).toContain("default-src 'self'");
    expect(CONTINUUM_CSP).toContain("object-src 'none'");
    expect(CONTINUUM_CSP).toContain("base-uri 'none'");
    expect(CONTINUUM_CSP).toContain("form-action 'none'");
    expect(CONTINUUM_CSP).toContain("frame-ancestors 'none'");
  });

  it('connect-src is same-origin only — no relay/external endpoint', () => {
    expect(CONTINUUM_CSP).toContain("connect-src 'self'");
    expect(CONTINUUM_CSP).not.toMatch(/connect-src[^;]*(https?:|wss?:)/i);
  });

  it('the declared script hash is the REAL sha256 of the shipped inline script', () => {
    const real = 'sha256-' + createHash('sha256').update(CONTINUUM_REFRESH_SCRIPT, 'utf8').digest('base64');
    expect(CONTINUUM_SCRIPT_SHA256).toBe(real);
  });

  it('the rendered page ships exactly that inline script (hash cannot drift)', () => {
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(html).toContain("'" + pageHash + "'");
  });

  it('exactly one inline <script> and no external/eval/inline-handler surfaces', () => {
    expect((html.match(/<script/g) || []).length).toBe(1);
    expect(html).not.toMatch(/<script[^>]+src=/i); // no external script
    expect(html).not.toMatch(/\bon\w+\s*=\s*["']/i); // no inline event handlers
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/\beval\(/);
    expect(html).not.toMatch(/window\.open|window\.location|location\.href/);
  });
});

describe('engineering health (v0.2.175)', () => {
  it('buildHealthModel returns metrics + rings + the efficiency-loop note', () => {
    const h = buildHealthModel({
      version: 'v9.9.9-test', profiles: { fast: 5, foundation: 17 },
      fullFileCount: 60, parserGaps: 0, docsInSync: true,
    });
    expect(Array.isArray(h.metrics)).toBe(true);
    expect(h.metrics.length).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(h.rings)).toBe(true);
    expect(h.note).toMatch(/measure .*profile .*standardise .*automate .*modularise .*document/);
  });

  it('GENERATED fields reflect the passed build inputs', () => {
    const h = buildHealthModel({
      version: 'v9.9.9-test', profiles: { fast: 5, foundation: 17 },
      fullFileCount: 60, parserGaps: 0, docsInSync: true,
    });
    const byLabel = Object.fromEntries(h.metrics.map((m) => [m.label, m]));
    expect(byLabel['Build version'].value).toBe('v9.9.9-test');
    expect(byLabel['Build version'].kind).toBe('generated');
    expect(byLabel['Test files / profiles'].value).toContain('fast 5');
    expect(byLabel['Test files / profiles'].value).toContain('foundation 17');
    expect(byLabel['Test files / profiles'].value).toContain('full 60');
    expect(byLabel['Parser gaps'].value).toMatch(/^0 /);
    expect(byLabel['Source-of-truth docs'].kind).toBe('generated');
  });

  it('non-zero parser gaps + doc drift are reported honestly', () => {
    const h = buildHealthModel({ parserGaps: 3, docsInSync: false });
    const byLabel = Object.fromEntries(h.metrics.map((m) => [m.label, m]));
    expect(byLabel['Parser gaps'].value).toMatch(/3 /);
    expect(byLabel['Source-of-truth docs'].value).toMatch(/drift/i);
  });

  it('LAST-KNOWN fields come from HEALTH_LASTKNOWN and are labelled last-known', () => {
    const h = buildHealthModel({});
    const byLabel = Object.fromEntries(h.metrics.map((m) => [m.label, m]));
    expect(byLabel['Total tests'].kind).toBe('last-known');
    expect(byLabel['Total tests'].value).toBe(HEALTH_LASTKNOWN.totalTests);
    expect(byLabel['Bundle baseline'].value).toBe(HEALTH_LASTKNOWN.bundle);
    expect(byLabel['Release gate'].value).toContain(HEALTH_LASTKNOWN.lastGreen);
  });

  it('foundation-coverage ring is the foundation/full percentage', () => {
    const h = buildHealthModel({ profiles: { fast: 5, foundation: 15 }, fullFileCount: 60 });
    const ring = h.rings.find((r) => r.label === 'Foundation coverage');
    expect(ring.pct).toBe(25);
    expect(ring.sub).toBe('15/60 files');
  });

  it('curated CONTINUUM.health is present and complete', () => {
    expect(CONTINUUM.health).toBeTruthy();
    expect(Array.isArray(CONTINUUM.health.metrics)).toBe(true);
    expect(CONTINUUM.health.metrics.length).toBeGreaterThanOrEqual(6);
  });

  it('continuumDataJSON carries the health model', () => {
    const j = continuumDataJSON();
    expect(j.health).toBeTruthy();
    expect(Array.isArray(j.health.metrics)).toBe(true);
  });

  it('renderContinuumPage shows the Engineering health section with provenance chips', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Engineering health');
    expect(html).toContain('hk-gen');
    expect(html).toContain('hk-lk');
    expect(html).toContain('GENERATED');
    expect(html).toContain('LAST-KNOWN');
  });

  it('SAFETY: the health section adds no new script and preserves the CSP script hash', () => {
    const html = renderContinuumPage();
    // Still exactly one inline script, and its hash still matches (health is static text).
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('milestones (v0.2.176)', () => {
  it('buildMilestoneModel folds the leanRoute into DERIVED active-milestone task counts', () => {
    const ms = buildMilestoneModel();
    expect(ms.active).toBeTruthy();
    expect(ms.active.kind).toBe('active');
    expect(ms.active.tasks).toEqual({ total: 5, done: 0, active: 4, pending: 1 });
    expect(ms.active.donePct).toBe(0);
    expect(ms.active.progressPct).toBe(46);
  });

  it('active-milestone counts are bullet-ready strings (user prefers bullet lists)', () => {
    const ms = buildMilestoneModel();
    expect(ms.active.counts).toEqual([
      '5 tasks total', '0 done', '4 active', '1 pending',
    ]);
  });

  it('SEED_MILESTONES are frozen, labelled, and never claim real task counts', () => {
    expect(Object.isFrozen(SEED_MILESTONES)).toBe(true);
    expect(SEED_MILESTONES.length).toBeGreaterThanOrEqual(3);
    for (const s of SEED_MILESTONES) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.name).toBe('string');
      expect(s.tasks).toBeUndefined();
    }
  });

  it('counts an HONEST total: one ACTIVE plus N clearly-labelled SEED milestones', () => {
    const ms = buildMilestoneModel();
    expect(ms.counts).toEqual({
      total: 1 + SEED_MILESTONES.length, active: 1,
      seed: SEED_MILESTONES.length, done: 0,
    });
    expect(ms.seed.every((s) => s.kind === 'seed')).toBe(true);
    expect(ms.note).toMatch(/SEED\/future/);
  });

  it('falls back safely when the route is empty or missing', () => {
    const empty = buildMilestoneModel({ leanRoute: [] });
    expect(empty.active.tasks).toEqual({ total: 0, done: 0, active: 0, pending: 0 });
    expect(empty.active.donePct).toBe(0);
    expect(empty.active.progressPct).toBe(0);
    const bad = buildMilestoneModel({ leanRoute: null, seed: null });
    expect(bad.active.tasks.total).toBe(0);
    expect(bad.seed).toEqual([]);
    expect(bad.counts.total).toBe(1);
  });

  it('continuumDataJSON carries the milestone model', () => {
    const j = continuumDataJSON();
    expect(j.milestones).toBeTruthy();
    expect(j.milestones.active.id).toBe('MVP-15H');
    expect(j.milestones.counts.active).toBe(1);
  });

  it('renderContinuumPage shows the Milestones section with an ACTIVE pill + SEED chips', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Milestones');
    expect(html).toContain('Total milestones:');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('SEED · future');
    expect(html).toContain('% complete');
    expect(html).toContain('directional estimate');
  });

  it('grouped card values render as bullet lists, not dense · -separated prose', () => {
    const html = renderContinuumPage();
    // The docs-derived row joins parts with ' · ' → must become a <ul class="mini">.
    expect(html).toContain('ul class="mini"');
    // No raw mid-dot-joined value string should survive as a single metric-value span.
    expect(html).not.toMatch(/metric-value">[^<]* · [^<]* · /);
  });

  it('SAFETY: the milestones + bullet-list pass adds no new script (CSP hash intact)', () => {
    const html = renderContinuumPage();
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('deployment readiness (v0.2.186)', () => {
  it('degrades to an honest NOT-CHECKED model with no input (never throws)', () => {
    const r = buildReadinessModel();
    expect(r.status).toBe('unknown');
    expect(r.statusLabel).toBe('NOT CHECKED');
    expect(r.badge).toBe(READINESS_BADGE);
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks).toHaveLength(4);
    // docs + dist checks read "not checked / no dist" → deferred; the two host steps are manual.
    expect(r.checks.map((c) => c.state)).toEqual(['deferred', 'deferred', 'manual', 'manual']);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('READY when docs ok AND dist checked ok', () => {
    const r = buildReadinessModel({
      zoneFallback: { ok: true, docs: { ok: true }, dist: { ok: true, skipped: false }, errors: [], warnings: [] },
    });
    expect(r.status).toBe('ready');
    expect(r.statusLabel).toBe('READY');
    expect(r.checks[0].state).toBe('no-blocker');
    expect(r.checks[1].state).toBe('no-blocker');
  });

  it('DOCS READY · BUILD CHECK PENDING when docs ok but dist skipped (no build)', () => {
    const r = buildReadinessModel({
      zoneFallback: { ok: true, docs: { ok: true }, dist: { skipped: true }, errors: [], warnings: [] },
    });
    expect(r.status).toBe('docs-ready');
    expect(r.statusLabel).toBe('DOCS READY · BUILD CHECK PENDING');
    expect(r.checks[0].state).toBe('no-blocker');
    expect(r.checks[1].state).toBe('deferred');
  });

  it('NOT READY (gated) when a required doc is missing the fallback', () => {
    const r = buildReadinessModel({
      zoneFallback: { ok: false, docs: { ok: false }, dist: { skipped: true }, errors: ['VPS_INSTALL.md missing fallback'], warnings: [] },
    });
    expect(r.status).toBe('blocked');
    expect(r.statusLabel).toBe('NOT READY');
    expect(r.checks[0].state).toBe('gated');
    expect(r.errors).toEqual(['VPS_INSTALL.md missing fallback']);
  });

  it('every check uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { zoneFallback: { ok: true, docs: { ok: true }, dist: { ok: true, skipped: false } } },
      { zoneFallback: { ok: false, docs: { ok: false }, dist: { ok: false, skipped: false } } }]) {
      for (const c of buildReadinessModel(input).checks) expect(allowed.has(c.state)).toBe(true);
    }
  });

  it('continuumDataJSON carries the readiness model', () => {
    const j = continuumDataJSON();
    expect(j.readiness).toBeTruthy();
    expect(typeof j.readiness.statusLabel).toBe('string');
    expect(Array.isArray(j.readiness.checks)).toBe(true);
  });

  it('renderContinuumPage shows the Deployment-readiness section with a status pill + badge', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Deployment readiness');
    expect(html).toContain(READINESS_BADGE);
    expect(html).toContain('pill pill-');
    expect(html).toContain('Host SPA fallback configured');
    expect(html).toContain('Auto-update');
  });

  it('SAFETY: the readiness section injects no unsafe token + no new script', () => {
    const blocked = buildReadinessModel({
      zoneFallback: { ok: false, docs: { ok: false }, dist: { ok: false, skipped: false }, errors: ['boom'], warnings: ['heads up'] },
    });
    const html = renderContinuumPage(buildContinuumModel({ readiness: blocked }));
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('ship readiness & next task (v0.2.188)', () => {
  it('degrades to an honest LAST-KNOWN model with no input (never throws)', () => {
    const s = buildShipModel();
    expect(s.kind).toBe('last-known');
    expect(s.badge).toBe(SHIP_BADGE);
    expect(s.status).toBe('ready');
    expect(s.statusLabel).toBe('READY');
    expect(s.ready).toBe(true);
    expect(Array.isArray(s.signals)).toBe(true);
    expect(s.signals).toHaveLength(SHIP_LASTKNOWN.signals.length);
    expect(s.nextTask.title).toBe(SHIP_NEXT_SAFE_TASK.title);
    expect(s.blockers).toEqual([]);
    expect(s.unknowns).toEqual([]);
  });

  it('folds a LIVE release-readiness summary (kind generated, passthrough verdict)', () => {
    const summary = {
      status: 'ready', statusLabel: 'READY', ready: true,
      version: 'v9.9.9-test', gitCommit: 'abc1234',
      gateCommand: 'npm run test:release',
      blockers: [], unknowns: [],
      signals: {
        versionSync: { state: 'ok', configVersion: 'v9.9.9-test', packageVersion: '9.9.9-test' },
        tests: { state: 'ok', fast: 5, foundation: 25 },
        regression: { state: 'ok', count: 15, expected: 15 },
        bundle: { state: 'advisory', overLimit: ['rapier'] },
        zoneFallback: { state: 'ok', ok: true, distSkipped: false },
        docs: { state: 'ok', ok: true },
      },
    };
    const s = buildShipModel({ readiness: summary });
    expect(s.kind).toBe('generated');
    expect(s.status).toBe('ready');
    expect(s.version).toBe('v9.9.9-test');
    expect(s.gitCommit).toBe('abc1234');
    expect(s.signals.map((r) => r.key)).toEqual(
      ['versionSync', 'tests', 'regression', 'bundle', 'zoneFallback', 'docs']);
  });

  it('a NOT-READY summary surfaces blockers and a gated pill', () => {
    const summary = {
      status: 'not-ready', statusLabel: 'NOT READY', ready: false,
      version: 'v9.9.9-test', blockers: ['regression gate failed'], unknowns: [],
      signals: { regression: { state: 'blocked', count: 14, expected: 15 } },
    };
    const s = buildShipModel({ readiness: summary });
    expect(s.ready).toBe(false);
    expect(s.blockers).toEqual(['regression gate failed']);
    expect(s.signals[0].pill).toBe('gated');
  });

  it('an INCOMPLETE summary surfaces unknowns', () => {
    const summary = {
      status: 'incomplete', statusLabel: 'INCOMPLETE · SIGNALS MISSING', ready: false,
      version: 'v9.9.9-test', blockers: [], unknowns: ['tests'],
      signals: { tests: { state: 'unknown' } },
    };
    const s = buildShipModel({ readiness: summary });
    expect(s.unknowns).toEqual(['tests']);
    expect(s.signals[0].pill).toBe('deferred');
  });

  it('accepts a nextTask override', () => {
    const s = buildShipModel({ nextTask: { title: 'Do the thing', why: 'because', kind: 'docs' } });
    expect(s.nextTask.title).toBe('Do the thing');
    expect(s.nextTask.kind).toBe('docs');
  });

  it('every signal pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    const summary = {
      status: 'ready', statusLabel: 'READY', ready: true, version: 'v', blockers: [], unknowns: [],
      signals: {
        versionSync: { state: 'ok' }, tests: { state: 'ok' }, regression: { state: 'ok' },
        bundle: { state: 'advisory' }, zoneFallback: { state: 'skipped' }, docs: { state: 'unknown' },
      },
    };
    for (const r of buildShipModel({ readiness: summary }).signals) expect(allowed.has(r.pill)).toBe(true);
    for (const r of buildShipModel().signals) expect(allowed.has(r.pill)).toBe(true);
  });

  it('continuumDataJSON carries the ship model', () => {
    const j = continuumDataJSON();
    expect(j.ship).toBeTruthy();
    expect(typeof j.ship.statusLabel).toBe('string');
    expect(Array.isArray(j.ship.signals)).toBe(true);
  });

  it('renderContinuumPage shows the Ship-readiness section + next safe task + badge', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Ship readiness');
    expect(html).toContain(SHIP_BADGE);
    expect(html).toContain('Next safe task');
    expect(html).toContain('pill pill-');
  });

  it('SAFETY: a tag-injecting readiness summary is escaped + no new script + hash intact', () => {
    const hostile = {
      status: 'not-ready', statusLabel: 'NOT READY', ready: false,
      version: 'v9<img src=x>', gitCommit: 'abc"><b>',
      blockers: ['<script>alert(1)</script>'], unknowns: ['<iframe>'],
      signals: { docs: { state: 'blocked', ok: false, errors: ['<svg/onload=1>'] } },
    };
    const html = renderContinuumPage(buildContinuumModel({
      ship: buildShipModel({ readiness: hostile, nextTask: { title: '<b>x</b>', why: '<img src=y>' } }),
    }));
    // The section's own static markup must introduce NONE of the banned tokens.
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    // Tag-injection from data is neutralised — no raw injected element survives.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<svg/onload=1>');
    // Still exactly one inline script and the CSP hash is unchanged.
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('layout / readability pass (v0.2.177)', () => {
  const html = renderContinuumPage();

  it('promotes the ACTIVE-milestone headline above At-a-glance', () => {
    const ms = html.indexOf('>Milestones<');
    const glance = html.indexOf('>At a glance<');
    expect(ms).toBeGreaterThan(-1);
    expect(glance).toBeGreaterThan(-1);
    expect(ms).toBeLessThan(glance);
  });

  it('keeps the headline order: Active focus → Milestones → At a glance → Engineering health', () => {
    const order = ['>Active focus<', '>Milestones<', '>At a glance<', '>Engineering health<']
      .map((s) => html.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('every section carries a one-line lead caption + a scannable heading row', () => {
    expect((html.match(/class="lead"/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('class="h2row"');
  });

  it('the Now/Next/Later columns show live item counts and reflow on a responsive grid', () => {
    expect(html).toContain('NOW · Active <span class="count">');
    expect(html).toContain('LATER · Archive <span class="count">');
    expect(html).toContain('DONE · Last 24h <span class="count">');
    expect(html).toContain('class="cols"');
    expect(html).toContain('grid-template-columns:repeat(auto-fit,minmax(260px,1fr))');
  });

  it('section count chips reflect the model list lengths', () => {
    const m = buildContinuumModel();
    expect(html).toContain(`>15-hour proof-of-concept route</h2> <span class="count">${m.leanRoute.length}</span>`);
    expect(html).toContain(`>Next 12 tasks</h2> <span class="count">${m.next12.length}</span>`);
  });

  it('SAFETY: the layout pass adds no new script and preserves the CSP script hash', () => {
    expect((html.match(/<script/g) || []).length).toBe(1);
    const mm = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(mm[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(mm[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
    // No external assets/links introduced by the layout pass.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
  });
});

describe('Nostr read-path health panel (v0.2.194)', () => {
  it('buildReadHealthModel folds the read-only health model into a render-ready panel', () => {
    const rh = buildReadHealthModel();
    expect(rh.badge).toBe(READHEALTH_BADGE);
    expect(rh.ok).toBe(true);
    expect(rh.statusLabel).toBe('READ-ONLY OK');
    expect(rh.summary.total).toBe(6);
    expect(rh.summary.fail).toBe(0);
    expect(Array.isArray(rh.signals)).toBe(true);
    expect(rh.signals).toHaveLength(6);
  });

  it('pins the read-only invariants and maps ok signals to the no-blocker pill', () => {
    const rh = buildReadHealthModel();
    expect(rh.signed).toBe(false);
    expect(rh.published).toBe(false);
    expect(rh.readOnly).toBe(true);
    expect(rh.signals.every((s) => s.pill === 'no-blocker')).toBe(true);
  });

  it('a broken read path surfaces an ATTENTION verdict + a gated pill (still inert)', () => {
    const rh = buildReadHealthModel({ profileEvents: [], scoreEvents: [] });
    expect(rh.ok).toBe(false);
    expect(rh.statusLabel).toBe('ATTENTION');
    expect(rh.summary.fail).toBeGreaterThan(0);
    expect(rh.signals.some((s) => s.pill === 'gated')).toBe(true);
    // The read-only invariants stay pinned even on a degraded model.
    expect(rh.signed).toBe(false);
    expect(rh.published).toBe(false);
    expect(rh.readOnly).toBe(true);
  });

  it('every signal pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const s of buildReadHealthModel().signals) expect(allowed.has(s.pill)).toBe(true);
    for (const s of buildReadHealthModel({ profileEvents: [] }).signals) expect(allowed.has(s.pill)).toBe(true);
  });

  it('continuumDataJSON carries the read-health model', () => {
    const j = continuumDataJSON();
    expect(j.readHealth).toBeTruthy();
    expect(typeof j.readHealth.statusLabel).toBe('string');
    expect(Array.isArray(j.readHealth.signals)).toBe(true);
  });

  it('renderContinuumPage shows the Nostr read-path health section + badge + invariants', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Nostr read-path health');
    expect(html).toContain(READHEALTH_BADGE);
    expect(html).toContain('READ-ONLY OK');
    expect(html).toContain('Read-only invariants:');
    expect(html).toContain('pill pill-');
  });

  it('SAFETY: the read-health section injects no unsafe token + no new script (CSP hash intact)', () => {
    const html = renderContinuumPage();
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('SDK exposure', () => {
  it('re-exports the continuum module at the experimental tier', () => {
    expect(SDK.continuum.CONTINUUM_VERSION).toBe('v0.2.194-alpha');
    expect(typeof SDK.continuum.renderContinuumPage).toBe('function');
    expect(SDK.SDK_SURFACE.continuum.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
