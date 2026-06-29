// tests/continuum-dashboard.test.js — locks the Torii Continuum project-oversight
// DASHBOARD data model + pure renderer (src/engine/dashboard/continuumData.js,
// v0.2.171). Proves the data/model helpers, computed totals/percentages, the
// JSON snapshot shape, render-output SAFETY (no external href, same-origin-only
// fetch, no setTimeout/eval, struck completed-24h, source-of-truth note, donut
// SVG present), and SDK exposure. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CONTINUUM_VERSION, CONTINUUM_BADGE, CONTINUUM,
  CONTINUUM_REFRESH_SCRIPT, CONTINUUM_SCRIPT_SHA256, CONTINUUM_CSP,
  CURRENT_TEST_STATUS, testCountLabel,
  HEALTH_LASTKNOWN, buildHealthModel,
  SEED_MILESTONES, buildMilestoneModel,
  READINESS_BADGE, buildReadinessModel,
  SHIP_BADGE, SHIP_LASTKNOWN, SHIP_NEXT_SAFE_TASK, buildShipModel,
  RCSTATUS_BADGE, RCSTATUS_LASTKNOWN, buildRcStatusModel,
  MANUALVALIDATION_BADGE, MANUALVALIDATION_LASTKNOWN, buildManualValidationModel,
  NOBLOCKERQUEUE_BADGE, NOBLOCKERQUEUE_LASTKNOWN, buildNoBlockerQueueModel,
  MVPAPPROVAL_BADGE, MVPAPPROVAL_LASTKNOWN, buildMvpApprovalModel,
  PLAYTESTRESULTS_BADGE, PLAYTESTRESULTS_LASTKNOWN, buildPlaytestResultsCardModel,
  READHEALTH_BADGE, buildReadHealthModel,
  CLICKTHROUGH_BADGE, CLICKTHROUGH_VIEWS, buildClickThroughModel,
  escapeHtml, clampPct, barCells, ringDash,
  computeTotals, buildContinuumModel, continuumDataJSON, renderContinuumPage,
} from '../src/engine/dashboard/continuumData.js';
import * as SDK from '../src/sdk/index.js';
import { VERSION } from '../src/config.js';
import { DEFAULT_TEST_STATUS } from '../src/engine/status/mvpReadiness.js';

describe('module shape', () => {
  it('pins the version (tracks the build) and the read-only oversight badge', () => {
    expect(CONTINUUM_VERSION).toBe('v0.2.252-alpha');
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
    expect(t.pocProgressPct).toBe(47);
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
    expect(round.version).toBe('v0.2.252-alpha');
    expect(round.totals.pocProgressPct).toBe(47);
    expect(round.contributors.isSeed).toBe(true);
  });
});

describe('renderContinuumPage', () => {
  const html = renderContinuumPage();

  it('returns a self-contained HTML document with the version', () => {
    expect(typeof html).toBe('string');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('v0.2.252-alpha');
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
    expect(ms.active.progressPct).toBe(47);
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

describe('RC / release-manifest status (v0.2.214)', () => {
  it('degrades to an honest LAST-KNOWN model with no input (never throws)', () => {
    const rc = buildRcStatusModel();
    expect(rc.kind).toBe('last-known');
    expect(rc.badge).toBe(RCSTATUS_BADGE);
    expect(rc.version).toBe(RCSTATUS_LASTKNOWN.version);
    expect(rc.manifestStatus).toBe('COMPLETE');
    expect(Array.isArray(rc.metrics)).toBe(true);
    expect(rc.metrics.length).toBe(7);
    // COMPLETE artifacts + a READY last gate → local gates green, manual validation still pending.
    expect(rc.band).toBe('gates-green');
    expect(rc.pill).toBe('manual');
    expect(rc.statusLabel).toMatch(/MANUAL VALIDATION/);
  });

  it('folds LIVE artifact-presence inputs into a generated band', () => {
    const rc = buildRcStatusModel({
      version: 'v9.9.9-test',
      testLabel: '42 passing / 7 files',
      profileSummary: 'fast ~5 · foundation ~25 · full',
      manifest: { status: 'COMPLETE', requiredPresent: 6, required: 6, optionalPresent: 6, optional: 6 },
      rcDocs: { present: 7, total: 7 },
      manualValidationRemaining: 7,
      gateStatusLabel: 'READY',
    });
    expect(rc.kind).toBe('generated');
    expect(rc.band).toBe('gates-green');
    expect(rc.version).toBe('v9.9.9-test');
    expect(rc.testLabel).toBe('42 passing / 7 files');
    const byLabel = Object.fromEntries(rc.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Release manifest']).toContain('6/6 required present');
    expect(byLabel['RC package docs']).toBe('7/7 present');
    expect(byLabel['Manual validation remaining']).toContain('7 live-browser checks');
  });

  it('reports ARTIFACTS INCOMPLETE when a required artifact or RC doc is missing', () => {
    const missingReq = buildRcStatusModel({
      manifest: { status: 'INCOMPLETE', requiredPresent: 5, required: 6, optionalPresent: 6, optional: 6 },
      rcDocs: { present: 7, total: 7 }, gateStatusLabel: 'READY',
    });
    expect(missingReq.band).toBe('artifacts-incomplete');
    expect(missingReq.pill).toBe('gated');
    expect(missingReq.statusLabel).toBe('ARTIFACTS INCOMPLETE');
    const missingDoc = buildRcStatusModel({
      manifest: { status: 'COMPLETE', requiredPresent: 6, required: 6, optionalPresent: 6, optional: 6 },
      rcDocs: { present: 6, total: 7 }, gateStatusLabel: 'READY',
    });
    expect(missingDoc.band).toBe('artifacts-incomplete');
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { manifest: { status: 'COMPLETE', requiredPresent: 6, required: 6, optionalPresent: 6, optional: 6 }, rcDocs: { present: 7, total: 7 }, gateStatusLabel: 'NEAR' },
      { manifest: { status: 'INCOMPLETE', requiredPresent: 4, required: 6 }, rcDocs: { present: 3, total: 7 } }]) {
      expect(allowed.has(buildRcStatusModel(input).pill)).toBe(true);
    }
  });

  it('continuumDataJSON carries the rcStatus model', () => {
    const j = continuumDataJSON();
    expect(j.rcStatus).toBeTruthy();
    expect(typeof j.rcStatus.statusLabel).toBe('string');
    expect(Array.isArray(j.rcStatus.metrics)).toBe(true);
  });

  it('renderContinuumPage shows the RC / release-manifest section + badge + band pill', () => {
    const html = renderContinuumPage();
    expect(html).toContain('RC / release manifest');
    expect(html).toContain(RCSTATUS_BADGE);
    expect(html).toContain('Release manifest');
    expect(html).toContain('Manual validation remaining');
    expect(html).toContain('pill pill-');
  });

  it('SAFETY: a tag-injecting rcStatus is escaped + no new script + hash intact', () => {
    const hostile = buildRcStatusModel({
      version: 'v9<img src=x>',
      testLabel: '<script>alert(1)</script>',
      gateStatusLabel: 'READY',
      manifest: { status: 'COMPLETE', requiredPresent: 6, required: 6, optionalPresent: 6, optional: 6 },
      rcDocs: { present: 7, total: 7 }, manualValidationRemaining: 7,
    });
    const html = renderContinuumPage(buildContinuumModel({ rcStatus: hostile }));
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('manual validation / MVP-playtest readiness (v0.2.215)', () => {
  it('degrades to an honest LAST-KNOWN model with no input (never throws)', () => {
    const mv = buildManualValidationModel();
    expect(mv.kind).toBe('last-known');
    expect(mv.badge).toBe(MANUALVALIDATION_BADGE);
    expect(mv.sections).toBe(MANUALVALIDATION_LASTKNOWN.sections);
    expect(mv.items).toBe(MANUALVALIDATION_LASTKNOWN.items);
    expect(Array.isArray(mv.metrics)).toBe(true);
    expect(mv.metrics.length).toBe(6);
    // Docs present + a READY last gate → local gates green, manual playtest still pending.
    expect(mv.band).toBe('gates-green');
    expect(mv.pill).toBe('manual');
    expect(mv.statusLabel).toMatch(/MANUAL PLAYTEST \+ APPROVAL PENDING/);
  });

  it('folds LIVE checklist counts into a generated band that SEPARATES automated vs manual', () => {
    const mv = buildManualValidationModel({
      sections: 13, items: 17, blocker: 4, major: 5, minor: 8,
      validationAreas: 7, checklistDocPresent: true, resultsTemplatePresent: true,
      gateStatusLabel: 'READY',
    });
    expect(mv.kind).toBe('generated');
    expect(mv.band).toBe('gates-green');
    const byLabel = Object.fromEntries(mv.metrics.map((m) => [m.label, m.value]));
    // Local automated gates report GREEN, but the manual playtest is explicitly PENDING.
    expect(byLabel['Local automated gates']).toMatch(/READY/);
    expect(byLabel['Manual playtest']).toMatch(/PENDING/);
    expect(byLabel['Manual playtest']).toMatch(/approval required/i);
    expect(byLabel['Playtest checklist']).toBe('13 sections · 17 items');
    expect(byLabel['Severity coverage']).toBe('4 blocker · 5 major · 8 minor');
  });

  it('reports PLAYTEST DOCS INCOMPLETE when the checklist or results-template doc is missing', () => {
    const noChecklist = buildManualValidationModel({ checklistDocPresent: false, resultsTemplatePresent: true, gateStatusLabel: 'READY' });
    expect(noChecklist.band).toBe('docs-incomplete');
    expect(noChecklist.pill).toBe('gated');
    expect(noChecklist.statusLabel).toBe('PLAYTEST DOCS INCOMPLETE');
    const noTemplate = buildManualValidationModel({ checklistDocPresent: true, resultsTemplatePresent: false, gateStatusLabel: 'READY' });
    expect(noTemplate.band).toBe('docs-incomplete');
  });

  it('reports MANUAL VALIDATION OUTSTANDING when docs ready but the local gate is not green', () => {
    const mv = buildManualValidationModel({ checklistDocPresent: true, resultsTemplatePresent: true, gateStatusLabel: 'NEAR' });
    expect(mv.band).toBe('manual-outstanding');
    expect(mv.pill).toBe('manual');
    expect(mv.statusLabel).toBe('MANUAL VALIDATION OUTSTANDING');
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { checklistDocPresent: true, resultsTemplatePresent: true, gateStatusLabel: 'READY' },
      { checklistDocPresent: true, resultsTemplatePresent: true, gateStatusLabel: 'NEAR' },
      { checklistDocPresent: false, resultsTemplatePresent: true, gateStatusLabel: 'READY' }]) {
      expect(allowed.has(buildManualValidationModel(input).pill)).toBe(true);
    }
  });

  it('continuumDataJSON carries the manualValidation model', () => {
    const j = continuumDataJSON();
    expect(j.manualValidation).toBeTruthy();
    expect(typeof j.manualValidation.statusLabel).toBe('string');
    expect(Array.isArray(j.manualValidation.metrics)).toBe(true);
  });

  it('renderContinuumPage shows the manual-validation section + badge + band pill', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Manual validation');
    expect(html).toContain(MANUALVALIDATION_BADGE);
    expect(html).toContain('Local automated gates');
    expect(html).toContain('Manual playtest');
    expect(html).toContain('Playtest checklist');
  });

  it('SAFETY: a tag-injecting manualValidation is escaped + no new script + hash intact', () => {
    const hostile = buildManualValidationModel({
      gateStatusLabel: 'READY<script>alert(1)</script>',
      checklistDocPresent: true, resultsTemplatePresent: true,
      areas: ['<img src=x onerror=alert(1)>', '</section><script>evil()</script>'],
    });
    const html = renderContinuumPage(buildContinuumModel({ manualValidation: hostile }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<img src=x');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('no-blocker queue (v0.2.216)', () => {
  it('degrades to an honest LAST-KNOWN model with no input (never throws)', () => {
    const nb = buildNoBlockerQueueModel();
    expect(nb.kind).toBe('last-known');
    expect(nb.badge).toBe(NOBLOCKERQUEUE_BADGE);
    expect(nb.activeNow).toBe(NOBLOCKERQUEUE_LASTKNOWN.activeNow);
    expect(nb.nextUp).toBe(NOBLOCKERQUEUE_LASTKNOWN.nextUp);
    expect(Array.isArray(nb.metrics)).toBe(true);
    expect(nb.metrics.length).toBe(6);
    // A queued safe task + manual playtest still pending → no-blocker work available, user-gated noted.
    expect(nb.band).toBe('safe-available');
    expect(nb.pill).toBe('no-blocker');
    expect(nb.statusLabel).toMatch(/NO-BLOCKER WORK AVAILABLE/);
    expect(nb.statusLabel).toMatch(/MANUAL PLAYTEST AWAITS USER/);
  });

  it('folds LIVE parsed todo/progress counts into a generated band that SEPARATES safe vs user-gated', () => {
    const nb = buildNoBlockerQueueModel({
      nextSafeTitle: 'Next safe infra/dashboard slice',
      nextSafeKind: 'infra',
      activeNow: 42, nextUp: 12, archiveClusters: 11, completed24h: 27, todoCompletedMarkers: 12,
      manualPending: true,
    });
    expect(nb.kind).toBe('generated');
    expect(nb.band).toBe('safe-available');
    const byLabel = Object.fromEntries(nb.metrics.map((m) => [m.label, m.value]));
    // The safe next task an agent can pick up with no user input is explicit...
    expect(byLabel['Next safe task']).toBe('Next safe infra/dashboard slice');
    expect(byLabel['Why safe']).toMatch(/no runtime risk/);
    expect(byLabel['Why safe']).toMatch(/no deploy/);
    // ...while the ONLY user-gated item is the manual playtest + approval.
    expect(byLabel['Awaiting user']).toMatch(/playtest \+ explicit approval/i);
    expect(byLabel['Awaiting user']).toMatch(/ONLY user-gated/);
    expect(byLabel['Active now']).toBe('42 in progress');
    expect(byLabel['Next up']).toBe('12 queued · next-12');
    expect(byLabel['Archive / done']).toMatch(/11 landed clusters · 27 done \(24h\) · 12 struck markers/);
  });

  it('drops the user-gated clause when no manual validation is pending', () => {
    const nb = buildNoBlockerQueueModel({ nextSafeTitle: 'safe slice', manualPending: false });
    expect(nb.band).toBe('safe-available-clear');
    expect(nb.pill).toBe('no-blocker');
    expect(nb.statusLabel).toBe('NO-BLOCKER WORK AVAILABLE');
    const byLabel = Object.fromEntries(nb.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Awaiting user']).toMatch(/nothing/i);
  });

  it('invalid / omitted counts fall back to the honest last-known values (never NaN)', () => {
    const nb = buildNoBlockerQueueModel({
      nextSafeTitle: 'safe slice', activeNow: -3, nextUp: 'oops', archiveClusters: null,
    });
    expect(nb.activeNow).toBe(NOBLOCKERQUEUE_LASTKNOWN.activeNow);
    expect(nb.nextUp).toBe(NOBLOCKERQUEUE_LASTKNOWN.nextUp);
    expect(nb.archiveClusters).toBe(NOBLOCKERQUEUE_LASTKNOWN.archiveClusters);
    expect(Number.isInteger(nb.activeNow)).toBe(true);
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { nextSafeTitle: 'x', manualPending: true },
      { nextSafeTitle: 'x', manualPending: false },
      { nextSafeTitle: 'x', activeNow: 0, nextUp: 0 }]) {
      expect(allowed.has(buildNoBlockerQueueModel(input).pill)).toBe(true);
    }
  });

  it('continuumDataJSON carries the noBlockerQueue model', () => {
    const j = continuumDataJSON();
    expect(j.noBlockerQueue).toBeTruthy();
    expect(typeof j.noBlockerQueue.statusLabel).toBe('string');
    expect(Array.isArray(j.noBlockerQueue.metrics)).toBe(true);
  });

  it('renderContinuumPage shows the no-blocker-queue section + badge + band pill', () => {
    const html = renderContinuumPage();
    expect(html).toContain('No-blocker queue');
    expect(html).toContain(NOBLOCKERQUEUE_BADGE);
    expect(html).toContain('Next safe task');
    expect(html).toContain('Awaiting user');
    expect(html).toContain('Active now');
  });

  it('SAFETY: a tag-injecting noBlockerQueue is escaped + no new script + hash intact', () => {
    const hostile = buildNoBlockerQueueModel({
      nextSafeTitle: 'safe<script>alert(1)</script>',
      nextSafeKind: '</section><script>evil()</script>',
      activeNow: 1, manualPending: true,
    });
    const html = renderContinuumPage(buildContinuumModel({ noBlockerQueue: hostile }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('mvp approval card (v0.2.221)', () => {
  it('degrades to an honest LAST-KNOWN pending model with no input (never throws)', () => {
    const mv = buildMvpApprovalModel();
    expect(mv.kind).toBe('last-known');
    expect(mv.badge).toBe(MVPAPPROVAL_BADGE);
    expect(mv.status).toBe('pending');
    expect(mv.approved).toBe(false);
    expect(mv.approvedBy).toBe(MVPAPPROVAL_LASTKNOWN.approvedBy);
    expect(Array.isArray(mv.metrics)).toBe(true);
    expect(mv.metrics.length).toBe(5);
    expect(mv.band).toBe('pending');
    expect(mv.pill).toBe('manual');
    expect(mv.statusLabel).toMatch(/MVP APPROVAL PENDING/);
    expect(mv.statusLabel).toMatch(/USER PLAYTEST \+ EXPLICIT OK REQUIRED/);
  });

  it('folds a LIVE pending record into a generated pending card with the clear next step', () => {
    const mv = buildMvpApprovalModel({
      status: 'pending', approved: false, version: 'v0.2.221-alpha',
      approvedBy: null, approvedAt: null,
    });
    expect(mv.kind).toBe('generated');
    expect(mv.band).toBe('pending');
    expect(mv.approved).toBe(false);
    const byLabel = Object.fromEntries(mv.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Approval status']).toBe('PENDING');
    expect(byLabel['Version']).toBe('v0.2.221-alpha');
    expect(byLabel['Approved by']).toMatch(/no approver yet/);
    expect(byLabel['Approved at']).toBe('—');
    expect(byLabel['Next step']).toMatch(/MVP approved/);
    expect(byLabel['Next step']).toMatch(/live-browser MVP playtest/);
  });

  it('renders approved ONLY when status approved AND approved flag AND who/when present (strict)', () => {
    const full = buildMvpApprovalModel({
      status: 'approved', approved: true, version: 'v0.2.221-alpha',
      approvedBy: 'user', approvedAt: '2026-06-26T00:00:00Z',
    });
    expect(full.approved).toBe(true);
    expect(full.band).toBe('approved');
    expect(full.pill).toBe('no-blocker');
    expect(full.statusLabel).toBe('MVP APPROVED');
    // A partial "approved" record (no provenance, or flag not set) must NOT render as approved.
    const partial = buildMvpApprovalModel({ status: 'approved', approved: false, version: 'v0.2.221-alpha' });
    expect(partial.approved).toBe(false);
    expect(partial.band).toBe('pending');
    const flagOnly = buildMvpApprovalModel({ status: 'approved', approved: true, version: 'v0.2.221-alpha' });
    expect(flagOnly.approved).toBe(false);
    expect(flagOnly.band).toBe('pending');
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { status: 'pending' },
      { status: 'approved', approved: true, version: 'v0.2.221-alpha', approvedBy: 'u', approvedAt: 't' },
      { status: 'weird' }]) {
      expect(allowed.has(buildMvpApprovalModel(input).pill)).toBe(true);
    }
  });

  it('continuumDataJSON carries the mvpApproval model', () => {
    const j = continuumDataJSON();
    expect(j.mvpApproval).toBeTruthy();
    expect(typeof j.mvpApproval.statusLabel).toBe('string');
    expect(j.mvpApproval.status).toBe('pending');
    expect(Array.isArray(j.mvpApproval.metrics)).toBe(true);
  });

  it('renderContinuumPage shows the MVP-approval section + badge + pending band pill', () => {
    const html = renderContinuumPage();
    expect(html).toContain('>MVP approval<');
    expect(html).toContain(MVPAPPROVAL_BADGE);
    expect(html).toContain('Approval status');
    expect(html).toContain('MVP APPROVAL PENDING');
  });

  it('SAFETY: a tag-injecting mvpApproval is escaped + no new script + hash intact', () => {
    const hostile = buildMvpApprovalModel({
      status: 'pending',
      version: 'v0<script>alert(1)</script>',
      approvedBy: '</section><script>evil()</script>',
    });
    const html = renderContinuumPage(buildContinuumModel({ mvpApproval: hostile }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });
});

describe('playtest results card (v0.2.223)', () => {
  it('degrades to an honest LAST-KNOWN not-run model with no input (never throws)', () => {
    const pr = buildPlaytestResultsCardModel();
    expect(pr.kind).toBe('last-known');
    expect(pr.badge).toBe(PLAYTESTRESULTS_BADGE);
    expect(pr.status).toBe('not-run');
    expect(pr.ran).toBe(false);
    expect(pr.complete).toBe(false);
    expect(pr.approvalImplied).toBe(false);
    expect(pr.total).toBe(PLAYTESTRESULTS_LASTKNOWN.total);
    expect(Array.isArray(pr.metrics)).toBe(true);
    expect(pr.metrics.length).toBe(5);
    expect(pr.band).toBe('not-run');
    expect(pr.pill).toBe('manual');
    expect(pr.statusLabel).toMatch(/PLAYTEST NOT RUN/);
  });

  it('folds a LIVE not-run state into a generated card with the clear next step', () => {
    const pr = buildPlaytestResultsCardModel({
      status: 'not-run', ran: false, total: 17,
      pass: 0, fail: 0, na: 0, blank: 17, other: 0, fails: [],
    });
    expect(pr.kind).toBe('generated');
    expect(pr.band).toBe('not-run');
    expect(pr.approvalImplied).toBe(false);
    const byLabel = Object.fromEntries(pr.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Results status']).toBe('NOT-RUN');
    expect(byLabel['Recorded']).toMatch(/no/);
    expect(byLabel['Items']).toMatch(/17 blank \/ 17/);
    expect(byLabel['Implies approval']).toMatch(/no/i);
    expect(byLabel['Next step']).toMatch(/MVP_PLAYTEST_RESULTS\.md/);
  });

  it('attention band on any FAIL surfaces the failing item ids; never implies approval', () => {
    const pr = buildPlaytestResultsCardModel({
      status: 'attention', total: 3, pass: 1, fail: 1, na: 0, blank: 1, other: 0,
      fails: ['shooter-1', 'aim-2'],
    });
    expect(pr.band).toBe('attention');
    expect(pr.pill).toBe('open-edge');
    expect(pr.approvalImplied).toBe(false);
    const byLabel = Object.fromEntries(pr.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Failing items']).toBe('shooter-1 · aim-2');
  });

  it('a fully COMPLETE playtest still renders NOT-AN-APPROVAL and approvalImplied stays false', () => {
    const pr = buildPlaytestResultsCardModel({
      status: 'complete', total: 3, pass: 2, fail: 0, na: 1, blank: 0, other: 0, fails: [],
    });
    expect(pr.band).toBe('complete');
    expect(pr.pill).toBe('no-blocker');
    expect(pr.complete).toBe(true);
    expect(pr.approvalImplied).toBe(false);
    expect(pr.statusLabel).toMatch(/NOT AN APPROVAL/);
    const byLabel = Object.fromEntries(pr.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Implies approval']).toMatch(/no/i);
    expect(byLabel['Next step']).toMatch(/MVP approved/);
  });

  it('the band pill uses only the existing pill vocabulary (no new CSS)', () => {
    const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
    for (const input of [undefined,
      { status: 'not-run' }, { status: 'incomplete' }, { status: 'attention' },
      { status: 'complete' }, { status: 'unknown' }, { status: 'weird' }]) {
      expect(allowed.has(buildPlaytestResultsCardModel(input).pill)).toBe(true);
    }
  });

  it('continuumDataJSON carries the playtestResults model', () => {
    const j = continuumDataJSON();
    expect(j.playtestResults).toBeTruthy();
    expect(typeof j.playtestResults.statusLabel).toBe('string');
    expect(j.playtestResults.status).toBe('not-run');
    expect(j.playtestResults.approvalImplied).toBe(false);
    expect(Array.isArray(j.playtestResults.metrics)).toBe(true);
  });

  it('renderContinuumPage shows the Playtest-results section + badge + not-run band pill', () => {
    const html = renderContinuumPage();
    expect(html).toContain('>Playtest results<');
    expect(html).toContain(PLAYTESTRESULTS_BADGE);
    expect(html).toContain('Results status');
    expect(html).toContain('PLAYTEST NOT RUN');
  });

  it('SAFETY: a tag-injecting playtestResults is escaped + no new script + hash intact', () => {
    const hostile = buildPlaytestResultsCardModel({
      status: 'attention', total: 1, fail: 1,
      fails: ['</section><script>evil()</script>'],
    });
    const html = renderContinuumPage(buildContinuumModel({ playtestResults: hostile }));
    expect(html).not.toContain('<script>evil()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(CONTINUUM_REFRESH_SCRIPT);
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

describe('test-count freshness (v0.2.200 — single source of truth)', () => {
  it('CURRENT_TEST_STATUS is a frozen, well-shaped curated capture', () => {
    expect(Object.isFrozen(CURRENT_TEST_STATUS)).toBe(true);
    expect(Number.isInteger(CURRENT_TEST_STATUS.passing)).toBe(true);
    expect(CURRENT_TEST_STATUS.passing).toBeGreaterThan(0);
    expect(Number.isInteger(CURRENT_TEST_STATUS.files)).toBe(true);
    expect(CURRENT_TEST_STATUS.files).toBeGreaterThan(0);
  });

  it('the curated file count matches the real number of test files on disk (drift guard)', () => {
    const testsDir = dirname(fileURLToPath(import.meta.url));
    const onDisk = readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).length;
    expect(CURRENT_TEST_STATUS.files).toBe(onDisk);
  });

  it('testCountLabel derives the canonical "<N> passing / <M> files" string', () => {
    expect(testCountLabel()).toBe(
      `${CURRENT_TEST_STATUS.passing} passing / ${CURRENT_TEST_STATUS.files} files`);
    // safe on a partial/garbled status — falls back to curated fields
    expect(testCountLabel(null)).toBe(testCountLabel());
    expect(testCountLabel({ passing: 9 })).toBe(`9 passing / ${CURRENT_TEST_STATUS.files} files`);
  });

  it('BOTH displayed surfaces derive from CURRENT_TEST_STATUS so they cannot drift apart', () => {
    // engineering-health "Total tests" is now derived (was the stale '1180 passing' copy)
    expect(HEALTH_LASTKNOWN.totalTests).toBe(testCountLabel());
    expect(HEALTH_LASTKNOWN.totalTests).not.toMatch(/1180/);
    // "at a glance" Tests metric is derived from the same source
    const tests = CONTINUUM.metrics.find((m) => m.label === 'Tests');
    expect(tests.value).toContain(testCountLabel());
    expect(tests.value).toContain(`test:fast ~${CURRENT_TEST_STATUS.fastProfile}`);
    expect(tests.value).toContain(`test:foundation ~${CURRENT_TEST_STATUS.foundationProfile}`);
  });

  it('the curated count agrees across both captures (dashboard vs MVP rollup)', () => {
    // mvpReadiness.DEFAULT_TEST_STATUS is the other curated test-count capture; keep them
    // in lock-step so the MVP percentage/status can never be computed off a stale number.
    expect(DEFAULT_TEST_STATUS.passing).toBe(CURRENT_TEST_STATUS.passing);
    expect(DEFAULT_TEST_STATUS.files).toBe(CURRENT_TEST_STATUS.files);
  });
});

describe('handoff / release control panel section (v0.2.233)', () => {
  it('renders the curated handoff panel section with version, live URLs, and principles', () => {
    const html = renderContinuumPage();
    expect(html).toContain('Handoff / release control panel');
    expect(html).toContain('torii-quest.pplx.app');
    expect(html).toContain('dashboard.html');
    // The curated panel is a complete (green) surface with the blocker still pending.
    expect(html).toContain('HANDOFF READY');
    // At least one of the practical, non-religious operating principles is surfaced.
    expect(html).toContain('Self-sovereignty');
  });

  it('surfaces the Workflow invariants metric (the do-not-cancel-useful-jobs rule) in the panel section', () => {
    const html = renderContinuumPage();
    const section = html.slice(html.indexOf('Handoff / release control panel'));
    expect(section).toContain('Workflow invariants');
    // The rule text must be visible to a future agent/human reading the dashboard.
    expect(section.toLowerCase()).toContain('cancel a useful in-progress job');
    // …and it must not be mistaken for approval/deploy authorisation.
    expect(html).toContain('HANDOFF READY'); // still surface-complete, not MVP-approved
  });

  it('the rendered ethics copy contains NO religious language', () => {
    const html = renderContinuumPage();
    // The panel's ethics copy must read as a practical engineering compass, not doctrine.
    const denied = ['sacred', 'holy', 'worship', 'prayer', 'divine', 'scripture', 'doctrine', 'gospel', 'salvation'];
    for (const term of denied) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(html)).toBe(false);
    }
  });

  it('escapes injected handoff-panel content and keeps exactly one inline script + the CSP hash', () => {
    const evilPanel = buildContinuumModel({
      handoffPanel: {
        badge: 'B<script>alert(1)</script>',
        kind: 'generated',
        band: 'ready-pending',
        statusLabel: 'HANDOFF<script>evil()</script>',
        pill: 'manual',
        green: true,
        metrics: [{ label: 'X</section><script>x()</script>', value: '<img src=x onerror=alert(1)>' }],
        note: 'n<script>boom()</script>',
      },
    });
    const html = renderContinuumPage(evilPanel);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });

  it('the panel pill stays within the allowed vocabulary', () => {
    const html = renderContinuumPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    // The handoff panel's pill class must be one of the known classes (no stray class injected).
    const section = html.slice(html.indexOf('Handoff / release control panel'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });
});

describe('MVP approval gate section (v0.2.234)', () => {
  it('renders the gate section with the verdict, the focus categories, and the clarifications', () => {
    const html = renderContinuumPage();
    expect(html).toContain('>MVP approval gate<');
    expect(html).toContain('MVP APPROVAL GATE · LOCAL · READ-ONLY · GREEN CHECKS ≠ HUMAN APPROVAL');
    // The curated gate is confidence-green but awaiting an explicit human OK — never approved.
    expect(html).toContain('awaiting-approval');
    // Each green automated signal is explicitly labelled confidence-only, not approval.
    expect(html).toContain('confidence only, not approval');
    // The manual playtest focus categories the user asked to be visible for sign-off.
    const lower = html.toLowerCase();
    for (const term of ['entry flow', 'shooter feel', 'headshot', 'bot behaviour',
      'footstep', 'reload', 'mirror', 'crate', 'nap monkey', 'dashboard clarity', 'fun']) {
      expect(lower).toContain(term);
    }
    // The clarifications make clear green checks are not approval and a smoke pass is not a playtest.
    expect(html).toContain('CONFIDENCE signals');
    expect(html).toContain('EXPLICIT human OK');
  });

  it('the gate copy contains NO religious language', () => {
    const html = renderContinuumPage();
    const denied = ['sacred', 'holy', 'worship', 'prayer', 'divine', 'scripture', 'doctrine', 'gospel', 'salvation'];
    for (const term of denied) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(html)).toBe(false);
    }
  });

  it('escapes injected gate content and keeps exactly one inline script + the CSP hash', () => {
    const evil = buildContinuumModel({
      mvpGate: {
        badge: 'B<script>alert(1)</script>',
        kind: 'generated',
        band: 'awaiting-approval',
        statusLabel: 'GATE<script>evil()</script>',
        pill: 'manual',
        verdict: 'awaiting-approval',
        approved: false,
        confidenceGreen: true,
        metrics: [{ label: 'X</section><script>x()</script>', value: '<img src=x onerror=alert(1)>' }],
        note: 'n<script>boom()</script>',
      },
    });
    const html = renderContinuumPage(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });

  it('the gate pill stays within the allowed vocabulary', () => {
    const html = renderContinuumPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    const section = html.slice(html.indexOf('>MVP approval gate<'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });
});

describe('Playtest verdict section (v0.2.235)', () => {
  it('renders the verdict section with the badge, the focus categories, and the how-to', () => {
    const html = renderContinuumPage();
    expect(html).toContain('>Playtest verdict<');
    expect(html).toContain('MVP PLAYTEST VERDICT · LOCAL · READ-ONLY · TESTER VERDICT ≠ MVP APPROVAL');
    // Curated default ships blank → pending (no verdict recorded yet).
    expect(html).toContain('NO VERDICT RECORDED YET');
    // The one-line how-to so a tester knows exactly how to report.
    expect(html).toContain('Verdict: MVP OK');
    expect(html).toContain('Verdict: blockers:');
    // The verdict is a confidence signal — never an approval.
    const lower = html.toLowerCase();
    expect(lower).toContain('tester verdict');
    expect(lower).toContain('mvp_approval_state.json');
  });

  it('keeps every reported blocker VISIBLE in the rendered section', () => {
    const model = buildContinuumModel({
      playtestVerdict: {
        badge: 'MVP PLAYTEST VERDICT · LOCAL · READ-ONLY · TESTER VERDICT ≠ MVP APPROVAL',
        kind: 'generated', band: 'blocked',
        statusLabel: 'BLOCKERS REPORTED (2) — TRIAGE BEFORE APPROVAL', pill: 'open-edge',
        verdict: 'blocked', blockers: ['headshots flaky', 'crate jitter'], blockerCount: 2,
        metrics: [
          { label: 'Verdict', value: 'BLOCKED — 2 blocker(s)' },
          { label: 'Blockers', value: 'headshots flaky · crate jitter' },
        ],
        note: 'verdict note',
      },
    });
    const html = renderContinuumPage(model);
    const section = html.slice(html.indexOf('>Playtest verdict<'));
    expect(section).toContain('headshots flaky');
    expect(section).toContain('crate jitter');
  });

  it('the verdict copy contains NO religious language', () => {
    const html = renderContinuumPage();
    const denied = ['sacred', 'holy', 'worship', 'prayer', 'divine', 'scripture', 'doctrine', 'gospel', 'salvation'];
    for (const term of denied) {
      expect(new RegExp(`\\b${term}\\b`, 'i').test(html)).toBe(false);
    }
  });

  it('escapes injected verdict content and keeps exactly one inline script + the CSP hash', () => {
    const evil = buildContinuumModel({
      playtestVerdict: {
        badge: 'B<script>alert(1)</script>',
        kind: 'generated', band: 'blocked',
        statusLabel: 'V<script>evil()</script>', pill: 'open-edge',
        verdict: 'blocked', blockers: ['<img src=x onerror=alert(1)>'], blockerCount: 1,
        metrics: [{ label: 'X</section><script>x()</script>', value: '<img src=x onerror=alert(1)>' }],
        note: 'n<script>boom()</script>',
      },
    });
    const html = renderContinuumPage(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });

  it('the verdict pill stays within the allowed vocabulary', () => {
    const html = renderContinuumPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    const section = html.slice(html.indexOf('>Playtest verdict<'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });
});

describe('MVP loop click-through mockup section (v0.2.244 — C2)', () => {
  const curated = buildContinuumModel().clickThrough;

  it('the curated views are frozen and name the five MVP-loop screens in walk-through order', () => {
    expect(Object.isFrozen(CLICKTHROUGH_VIEWS)).toBe(true);
    expect(CLICKTHROUGH_VIEWS.length).toBe(5);
    expect(CLICKTHROUGH_VIEWS.map((v) => v.id)).toEqual(
      ['gateway', 'product', 'leaderboard', 'update', 'console']);
    expect(CLICKTHROUGH_VIEWS.map((v) => v.title)).toEqual(
      ['Gateway', 'Product', 'Leaderboard', 'Update', 'Console']);
    for (const v of CLICKTHROUGH_VIEWS) {
      expect(Object.isFrozen(v)).toBe(true);
      expect(['proof', 'mockup']).toContain(v.status);
    }
  });

  it('buildClickThroughModel with no input is an honest LAST-KNOWN curated mockup', () => {
    const ct = buildClickThroughModel();
    expect(ct.kind).toBe('last-known');
    expect(ct.badge).toBe(CLICKTHROUGH_BADGE);
    expect(ct.statusLabel).toBe('MOCKUP · READ-ONLY · PROOF ONLY');
    expect(ct.pill).toBe('deferred');
    expect(ct.views.length).toBe(5);
    expect(ct.views.map((v) => v.id)).toEqual(
      ['gateway', 'product', 'leaderboard', 'update', 'console']);
  });

  it('the click-through mockup is READ-ONLY/INERT by construction (the four pinned invariants)', () => {
    const ct = buildClickThroughModel();
    // Documented invariants: a mockup never acts. These are pinned false, not runtime flags.
    expect(ct.performed).toBe(false);
    expect(ct.signed).toBe(false);
    expect(ct.published).toBe(false);
    expect(ct.network).toBe(false);
  });

  it('curated proof/mockup state is honest — four proofs + one mockup (console)', () => {
    const proofs = CLICKTHROUGH_VIEWS.filter((v) => v.status === 'proof');
    const mockups = CLICKTHROUGH_VIEWS.filter((v) => v.status === 'mockup');
    expect(proofs.map((v) => v.id)).toEqual(['gateway', 'product', 'leaderboard', 'update']);
    expect(mockups.map((v) => v.id)).toEqual(['console']);
    expect(curated.metrics.find((m) => m.label === 'Proof state').value).toContain('4 proof');
    expect(curated.metrics.find((m) => m.label === 'Proof state').value).toContain('1 mockup');
  });

  it('the metrics carry the read-only/no-action/no-live-data/no-network story', () => {
    const byLabel = Object.fromEntries(curated.metrics.map((m) => [m.label, m.value]));
    expect(byLabel['Screens']).toContain('5 mockup views');
    expect(byLabel['Live data']).toMatch(/none.*read-only/i);
    expect(byLabel['Actions']).toMatch(/none.*no navigation/i);
    expect(byLabel['Promotion gate']).toMatch(/SEC-1.*SEC-2.*SEC-3.*deferred/i);
  });

  it('kind is "generated" when a caller supplies view overrides, "last-known" otherwise', () => {
    const generated = buildClickThroughModel({ views: [{ id: 'x', title: 'X', proofs: 'p', mockState: 'm', status: 'proof' }] });
    expect(generated.kind).toBe('generated');
    expect(generated.views.length).toBe(1);
    expect(generated.views[0].id).toBe('x');
    expect(buildClickThroughModel({ note: 'override only' }).kind).toBe('last-known');
    expect(buildClickThroughModel({}).kind).toBe('last-known');
  });

  it('never throws on garbled input — degrades to a safe, honest mockup', () => {
    const cases = [null, undefined, 7, 'str', [], [{ id: 'a' }], { views: 'nope' }, { views: [{}, null, 3, { id: '', title: '   ' }] }];
    for (const c of cases) {
      const ct = buildClickThroughModel(c);
      expect(ct.badge).toBe(CLICKTHROUGH_BADGE);
      expect(ct.pill).toBe('deferred');
      expect(['proof', 'mockup']).toContain((ct.views[0] && ct.views[0].status) || 'mockup');
      expect(ct.performed).toBe(false);
      expect(ct.signed).toBe(false);
      expect(ct.published).toBe(false);
      expect(ct.network).toBe(false);
    }
    // An all-garbage view row still gets a safe id/title + a mockup status.
    const g = buildClickThroughModel({ views: [{ garbage: true }] });
    expect(g.views[0].id).toBe('unknown');
    expect(g.views[0].title).toBe('Unknown');
    expect(g.views[0].status).toBe('mockup');
  });

  it('caps an oversized override list at 12 views (render stays bounded)', () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, title: `V${i}`, proofs: 'p', mockState: 'm', status: 'proof' }));
    expect(buildClickThroughModel({ views: big }).views.length).toBe(12);
  });

  it('buildContinuumModel + continuumDataJSON carry the curated click-through snapshot', () => {
    const model = buildContinuumModel();
    expect(model.clickThrough).toBeTruthy();
    expect(model.clickThrough.badge).toBe(CLICKTHROUGH_BADGE);
    const json = continuumDataJSON(model);
    expect(json.clickThrough).toBeTruthy();
    expect(json.clickThrough.views.length).toBe(5);
    expect(json.clickThrough.pill).toBe('deferred');
  });

  it('renders the click-through section in the dashboard with all five view cards', () => {
    const html = renderContinuumPage();
    expect(html).toContain('MVP loop click-through');
    expect(html).toContain('1/5 · Gateway');
    expect(html).toContain('2/5 · Product');
    expect(html).toContain('3/5 · Leaderboard');
    expect(html).toContain('4/5 · Update');
    expect(html).toContain('5/5 · Console');
    expect(html).toContain(CLICKTHROUGH_BADGE);
    expect(html).toContain('MOCKUP · READ-ONLY · PROOF ONLY');
    expect(html).toContain('SEC-1 / SEC-2 / SEC-3 + manual deploy (deferred)');
    expect(html).toContain('no navigation, no writes, no signing');
  });

  it('the section pill stays within the allowed vocabulary', () => {
    const html = renderContinuumPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    const section = html.slice(html.indexOf('MVP loop click-through'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });

  it('escapes injected click-through content and keeps exactly one inline script + the CSP hash', () => {
    const evil = buildContinuumModel({
      clickThrough: buildClickThroughModel({
        views: [{ id: 'g', title: 'G<script>alert(1)</script>', proofs: '<img src=x onerror=alert(1)>', mockState: 'm<script>boom()</script>', status: 'proof' }],
        note: 'n<script>evil()</script>',
      }),
    });
    const html = renderContinuumPage(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(CONTINUUM_SCRIPT_SHA256);
  });

  it('CSP/refresh-script hash is unchanged by the C2 section (no new script, no new data-k key)', () => {
    const html = renderContinuumPage();
    expect(CONTINUUM_SCRIPT_SHA256).toBe('sha256-otKqhP2RYAA6ZkrRVcAQSBm7B1ssPR70QQR5dXePHmw=');
    expect((html.match(/<script/g) || []).length).toBe(1);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/\bon\w+\s*=\s*["']/i);
  });

  it('an override-free legacy model (clickThrough absent) omits the section entirely', () => {
    const html = renderContinuumPage({ ...buildContinuumModel(), clickThrough: null });
    expect(html).not.toContain('MVP loop click-through');
  });
});

describe('SDK exposure', () => {

  it('re-exports the continuum module at the experimental tier', () => {
    expect(SDK.continuum.CONTINUUM_VERSION).toBe('v0.2.252-alpha');
    expect(typeof SDK.continuum.renderContinuumPage).toBe('function');
    expect(SDK.SDK_SURFACE.continuum.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });

  it('re-exports the handoff control-panel module at the experimental tier', () => {
    expect(typeof SDK.handoffControlPanel.buildHandoffControlPanel).toBe('function');
    expect(typeof SDK.handoffControlPanel.isHandoffPanelGreen).toBe('function');
    expect(SDK.SDK_SURFACE.handoffControlPanel.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
