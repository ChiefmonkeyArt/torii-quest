// tests/torii-quest-dashboard.clickthrough.test.js — split from torii-quest-dashboard.test.js (E3, v0.2.267).
// Slice: MVP loop click-through mockup section.
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

describe('MVP loop click-through mockup section (v0.2.244 — C2)', () => {
  const curated = buildToriiQuestModel().clickThrough;

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

  it('buildToriiQuestModel + toriiQuestDataJSON carry the curated click-through snapshot', () => {
    const model = buildToriiQuestModel();
    expect(model.clickThrough).toBeTruthy();
    expect(model.clickThrough.badge).toBe(CLICKTHROUGH_BADGE);
    const json = toriiQuestDataJSON(model);
    expect(json.clickThrough).toBeTruthy();
    expect(json.clickThrough.views.length).toBe(5);
    expect(json.clickThrough.pill).toBe('deferred');
  });

  it('renders the click-through section in the dashboard with all five view cards', () => {
    const html = renderToriiQuestPage();
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
    const html = renderToriiQuestPage();
    const allowed = ['pill-no-blocker', 'pill-gated', 'pill-manual', 'pill-deferred', 'pill-open-edge'];
    const section = html.slice(html.indexOf('MVP loop click-through'));
    const pillMatch = section.match(/class="pill (pill-[a-z-]+)"/);
    expect(pillMatch).toBeTruthy();
    expect(allowed).toContain(pillMatch[1]);
  });

  it('escapes injected click-through content and keeps exactly one inline script + the CSP hash', () => {
    const evil = buildToriiQuestModel({
      clickThrough: buildClickThroughModel({
        views: [{ id: 'g', title: 'G<script>alert(1)</script>', proofs: '<img src=x onerror=alert(1)>', mockState: 'm<script>boom()</script>', status: 'proof' }],
        note: 'n<script>evil()</script>',
      }),
    });
    const html = renderToriiQuestPage(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>boom()</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect((html.match(/<script/g) || []).length).toBe(1);
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const pageHash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    expect(pageHash).toBe(TORII_QUEST_SCRIPT_SHA256);
  });

  it('CSP/refresh-script hash is unchanged by the C2 section (no new script, no new data-k key)', () => {
    const html = renderToriiQuestPage();
    expect(TORII_QUEST_SCRIPT_SHA256).toBe('sha256-LuHCRD7D19XircznJIAKE8dV4QcKG0v4gYFNX9Imzlg=');
    expect((html.match(/<script/g) || []).length).toBe(1);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/\bon\w+\s*=\s*["']/i);
  });

  it('an override-free legacy model (clickThrough absent) omits the section entirely', () => {
    const html = renderToriiQuestPage({ ...buildToriiQuestModel(), clickThrough: null });
    expect(html).not.toContain('MVP loop click-through');
  });
});
