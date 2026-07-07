// tests/torii-quest-dashboard.health.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: engineering health + Nostr read-path health panels.
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

  it('toriiQuestDataJSON carries the health model', () => {
    const j = toriiQuestDataJSON();
    expect(j.health).toBeTruthy();
    expect(Array.isArray(j.health.metrics)).toBe(true);
  });

  it('renderToriiQuestPage shows the Engineering health section with provenance chips', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('Engineering health');
    expect(html).toContain('hk-gen');
    expect(html).toContain('hk-lk');
    expect(html).toContain('GENERATED');
    expect(html).toContain('LAST-KNOWN');
  });

  it('SAFETY: the health section adds no new script and preserves the CSP script hash', () => {
    const html = renderToriiQuestPage();
    // Still exactly one inline script, and its hash still matches (health is static text).
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
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

  it('toriiQuestDataJSON carries the read-health model', () => {
    const j = toriiQuestDataJSON();
    expect(j.readHealth).toBeTruthy();
    expect(typeof j.readHealth.statusLabel).toBe('string');
    expect(Array.isArray(j.readHealth.signals)).toBe(true);
  });

  it('renderToriiQuestPage shows the Nostr read-path health section + badge + invariants', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('Nostr read-path health');
    expect(html).toContain(READHEALTH_BADGE);
    expect(html).toContain('READ-ONLY OK');
    expect(html).toContain('Read-only invariants:');
    expect(html).toContain('pill pill-');
  });

  it('SAFETY: the read-health section injects no unsafe token + no new script (CSP hash intact)', () => {
    const html = renderToriiQuestPage();
    for (const bad of ['javascript:', 'window.location', 'location.href', 'eval(', 'window.open']) {
      expect(html).not.toContain(bad);
    }
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});
