// tests/torii-quest-dashboard.readiness.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: deployment / ship / RC-status readiness cards.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TORII_QUEST_VERSION, TORII_QUEST_BADGE, CONTINUUM,
  TORII_QUEST_REFRESH_SCRIPT, TORII_QUEST_SCRIPT_SHA256, TORII_QUEST_CSP,
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
  computeTotals, buildToriiQuestModel, toriiQuestDataJSON, renderToriiQuestPage,
} from '../src/engine/dashboard/toriiQuestDashboardData.js';
import * as SDK from '../src/sdk/index.js';
import * as DashboardSDK from '../src/sdk/dashboard.js';
import { VERSION } from '../src/config.js';
import { DEFAULT_TEST_STATUS } from '../src/engine/status/mvpReadiness.js';

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

  it('toriiQuestDataJSON carries the readiness model', () => {
    const j = toriiQuestDataJSON();
    expect(j.readiness).toBeTruthy();
    expect(typeof j.readiness.statusLabel).toBe('string');
    expect(Array.isArray(j.readiness.checks)).toBe(true);
  });

  it('renderToriiQuestPage shows the Deployment-readiness section with a status pill + badge', () => {
    const html = renderToriiQuestPage();
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
    const html = renderToriiQuestPage(buildToriiQuestModel({ readiness: blocked }));
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
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

  it('toriiQuestDataJSON carries the ship model', () => {
    const j = toriiQuestDataJSON();
    expect(j.ship).toBeTruthy();
    expect(typeof j.ship.statusLabel).toBe('string');
    expect(Array.isArray(j.ship.signals)).toBe(true);
  });

  it('renderToriiQuestPage shows the Ship-readiness section + next safe task + badge', () => {
    const html = renderToriiQuestPage();
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
    const html = renderToriiQuestPage(buildToriiQuestModel({
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
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
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

  it('toriiQuestDataJSON carries the rcStatus model', () => {
    const j = toriiQuestDataJSON();
    expect(j.rcStatus).toBeTruthy();
    expect(typeof j.rcStatus.statusLabel).toBe('string');
    expect(Array.isArray(j.rcStatus.metrics)).toBe(true);
  });

  it('renderToriiQuestPage shows the RC / release-manifest section + badge + band pill', () => {
    const html = renderToriiQuestPage();
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
    const html = renderToriiQuestPage(buildToriiQuestModel({ rcStatus: hostile }));
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});
