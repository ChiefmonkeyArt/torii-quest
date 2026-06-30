// tests/continuum-dashboard.helpers.test.js — split from continuum-dashboard.test.js (E3, v0.2.267).
// Slice: pure helpers/format fns (module shape, escapeHtml, clampPct, barCells, ringDash, computeTotals).
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
import * as DashboardSDK from '../src/sdk/dashboard.js';
import { VERSION } from '../src/config.js';
import { DEFAULT_TEST_STATUS } from '../src/engine/status/mvpReadiness.js';

describe('module shape', () => {
  it('pins the version (tracks the build) and the read-only oversight badge', () => {
    expect(CONTINUUM_VERSION).toBe('v0.2.278-alpha');
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
