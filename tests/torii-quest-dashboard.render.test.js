// tests/torii-quest-dashboard.render.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: render output safety + CSP + layout + test-count freshness.
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

describe('renderToriiQuestPage', () => {
  const html = renderToriiQuestPage();

  it('returns a self-contained HTML document with the version', () => {
    expect(typeof html).toBe('string');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('v0.2.389-alpha');
    expect(html).toContain('Torii Quest');
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
    expect(html).toContain('torii-quest-todo.md');
    expect(html).toContain('torii-quest-strategy.md');
    expect(html).toContain('torii-quest-progress.md');
  });

  it('SAFETY: no external navigation, no http(s) href/redirect', () => {
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/window\.open/);
    expect(html).not.toMatch(/window\.location/);
    expect(html).not.toMatch(/location\.href/);
  });

  it('SAFETY: only same-origin relative fetch, no timers, no eval', () => {
    expect(html).toContain("fetch('./torii-quest-data.json'");
    expect(html).not.toMatch(/fetch\(\s*["']https?:/i);
    expect(html).not.toMatch(/setTimeout|setInterval/);
    expect(html).not.toMatch(/\beval\(/);
  });
});

describe('CSP hardening (v0.2.172)', () => {
  const html = renderToriiQuestPage();

  it('emits a Content-Security-Policy meta tag carrying the strict policy', () => {
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain(TORII_QUEST_CSP);
  });

  it('script-src is self + the script hash with NO unsafe-inline (XSS surface closed)', () => {
    expect(TORII_QUEST_CSP).toContain("script-src 'self' '" + TORII_QUEST_SCRIPT_SHA256 + "'");
    // 'unsafe-inline'/'unsafe-eval' must NEVER appear in script-src.
    expect(TORII_QUEST_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(TORII_QUEST_CSP).not.toContain("'unsafe-eval'");
  });

  it('default-src/object-src/base-uri/form-action/frame-ancestors are locked down', () => {
    expect(TORII_QUEST_CSP).toContain("default-src 'self'");
    expect(TORII_QUEST_CSP).toContain("object-src 'none'");
    expect(TORII_QUEST_CSP).toContain("base-uri 'none'");
    expect(TORII_QUEST_CSP).toContain("form-action 'none'");
    expect(TORII_QUEST_CSP).toContain("frame-ancestors 'none'");
  });

  it('connect-src is same-origin only — no relay/external endpoint', () => {
    expect(TORII_QUEST_CSP).toContain("connect-src 'self'");
    expect(TORII_QUEST_CSP).not.toMatch(/connect-src[^;]*(https?:|wss?:)/i);
  });

  it('the declared script hash is the REAL sha256 of the shipped inline script', () => {
    const real = 'sha256-' + createHash('sha256').update(TORII_QUEST_REFRESH_SCRIPT, 'utf8').digest('base64');
    expect(TORII_QUEST_SCRIPT_SHA256).toBe(real);
  });

  it('the rendered page ships exactly that inline script (hash cannot drift)', () => {
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
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

describe('layout / readability pass (v0.2.177)', () => {
  const html = renderToriiQuestPage();

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
    const m = buildToriiQuestModel();
    expect(html).toContain(`>15-hour proof-of-concept route</h2> <span class="count">${m.leanRoute.length}</span>`);
    expect(html).toContain(`>Next 12 tasks</h2> <span class="count">${m.next12.length}</span>`);
  });

  it('SAFETY: the layout pass adds no new script and preserves the CSP script hash', () => {
    expect((html.match(/<script/g) || []).length).toBe(1);
    const mm = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(mm[1]).toBe(TORII_QUEST_REFRESH_SCRIPT);
    const pageHash = 'sha256-' + createHash('sha256').update(mm[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
    // No external assets/links introduced by the layout pass.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
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
    expect(tests.value).toContain(`test:foundation:list ~${CURRENT_TEST_STATUS.foundationProfile}`);
    // E2 (v0.2.265): test:foundation is now change-detection (vitest --changed), not the curated list.
    expect(tests.value).toContain('test:foundation = vitest --changed origin/main');
  });

  it('the curated count agrees across both captures (dashboard vs MVP rollup)', () => {
    // mvpReadiness.DEFAULT_TEST_STATUS is the other curated test-count capture; keep them
    // in lock-step so the MVP percentage/status can never be computed off a stale number.
    expect(DEFAULT_TEST_STATUS.passing).toBe(CURRENT_TEST_STATUS.passing);
    expect(DEFAULT_TEST_STATUS.files).toBe(CURRENT_TEST_STATUS.files);
  });
});
