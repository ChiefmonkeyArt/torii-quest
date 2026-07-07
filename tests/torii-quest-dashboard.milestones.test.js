// tests/torii-quest-dashboard.milestones.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: milestone model.
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

  it('toriiQuestDataJSON carries the milestone model', () => {
    const j = toriiQuestDataJSON();
    expect(j.milestones).toBeTruthy();
    expect(j.milestones.active.id).toBe('MVP-15H');
    expect(j.milestones.counts.active).toBe(1);
  });

  it('renderToriiQuestPage shows the Milestones section with an ACTIVE pill + SEED chips', () => {
    const html = renderToriiQuestPage();
    expect(html).toContain('Milestones');
    expect(html).toContain('Total milestones:');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('SEED · future');
    expect(html).toContain('% complete');
    expect(html).toContain('directional estimate');
  });

  it('grouped card values render as bullet lists, not dense · -separated prose', () => {
    const html = renderToriiQuestPage();
    // The docs-derived row joins parts with ' · ' → must become a <ul class="mini">.
    expect(html).toContain('ul class="mini"');
    // No raw mid-dot-joined value string should survive as a single metric-value span.
    expect(html).not.toMatch(/metric-value">[^<]* · [^<]* · /);
  });

  it('SAFETY: the milestones + bullet-list pass adds no new script (CSP hash intact)', () => {
    const html = renderToriiQuestPage();
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });
});
