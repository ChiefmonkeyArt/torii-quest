// tests/handoff-control-panel.test.js — locks the PURE handoff / release control-panel module
// (src/engine/status/handoffControlPanel.js, v0.2.233). Proves the GREEN-REQUIRES-EVIDENCE floor
// (the panel cannot read complete without a current version, both live URLs, passing entry- AND
// dashboard-smoke evidence, an explicit manual-blocker boolean, AND non-religious ethics copy),
// the non-religious-ethics guard, the safety pins, the next-action fold, and the dashboard card.
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_LIVE_URL, HANDOFF_DASHBOARD_URL, HANDOFF_CONTROL_PANEL_BADGE,
  PROJECT_PRINCIPLES, HANDOFF_DO_NOT, WORKFLOW_INVARIANTS, ETHICS_NOTE, RELIGIOUS_DENYLIST,
  findReligiousLanguage, containsReligiousLanguage,
  buildHandoffControlPanel, validateHandoffControlPanel, isHandoffPanelGreen,
  HANDOFF_CONTROL_PANEL_REQUIRED_KEYS, summarizeHandoffControlPanelForState,
  buildHandoffControlPanelCard,
} from '../src/engine/status/handoffControlPanel.js';
import { VERSION } from '../src/config.js';

// A fully-populated, green-eligible input (manual blocker still pending — the expected MVP posture).
function greenInput(overrides = {}) {
  return {
    version: VERSION,
    liveUrl: HANDOFF_LIVE_URL,
    dashboardUrl: HANDOFF_DASHBOARD_URL,
    entrySmoke: { result: 'pass', pass: true, version: 'v0.2.230-alpha', checks: 3, passed: 3, failed: 0 },
    dashboardSmoke: { result: 'pass', pass: true, version: 'v0.2.231-alpha', checks: 4, passed: 4, failed: 0 },
    manualBlocker: { pending: true, statusLabel: 'MVP playtest + approval pending', pill: 'manual' },
    mvpApproval: { approved: false, status: 'pending' },
    nextSafeTask: { title: 'Next safe infra/status slice', why: 'no runtime risk', kind: 'infra' },
    ...overrides,
  };
}

describe('shape + required keys', () => {
  it('buildHandoffControlPanel never omits the required keys, even with no input', () => {
    const panel = buildHandoffControlPanel();
    for (const k of HANDOFF_CONTROL_PANEL_REQUIRED_KEYS) {
      expect(panel).toHaveProperty(k);
    }
    expect(panel.badge).toBe(HANDOFF_CONTROL_PANEL_BADGE);
  });

  it('defaults to the curated live + dashboard URLs and the curated ethics copy', () => {
    const panel = buildHandoffControlPanel();
    expect(panel.liveUrl).toBe(HANDOFF_LIVE_URL);
    expect(panel.dashboardUrl).toBe(HANDOFF_DASHBOARD_URL);
    expect(panel.principles).toEqual(Array.from(PROJECT_PRINCIPLES));
    expect(panel.doNot).toEqual(Array.from(HANDOFF_DO_NOT));
    expect(panel.ethicsNote).toBe(ETHICS_NOTE);
  });

  it('pins every safety flag false', () => {
    const s = buildHandoffControlPanel().safety;
    for (const k of ['deploy', 'publish', 'push', 'tag', 'networkWrite', 'nostrWrite', 'godMode',
      'impliesApproval', 'impliesPlaytestComplete']) {
      expect(s[k]).toBe(false);
    }
  });
});

describe('green-requires-evidence floor', () => {
  it('a fully-populated panel is green (complete surface) even with the blocker pending', () => {
    const panel = buildHandoffControlPanel(greenInput());
    const v = validateHandoffControlPanel(panel);
    expect(v.ok).toBe(true);
    expect(isHandoffPanelGreen(panel)).toBe(true);
    // green ≠ approved — a pending blocker is surfaced as a WARNING, not an error.
    expect(v.warnings.some((w) => /pending/i.test(w))).toBe(true);
  });

  it('an empty panel is NOT green', () => {
    expect(isHandoffPanelGreen(buildHandoffControlPanel())).toBe(false);
  });

  it('a missing version blocks green', () => {
    const panel = buildHandoffControlPanel(greenInput({ version: null }));
    expect(isHandoffPanelGreen(panel)).toBe(false);
    expect(validateHandoffControlPanel(panel).errors.join(' ')).toMatch(/version marker/i);
  });

  it('a non-passing entry smoke blocks green', () => {
    const panel = buildHandoffControlPanel(greenInput({
      entrySmoke: { result: 'unknown', pass: false, version: null, checks: 0, passed: 0, failed: 0 },
    }));
    expect(isHandoffPanelGreen(panel)).toBe(false);
    expect(validateHandoffControlPanel(panel).errors.join(' ')).toMatch(/entry smoke/i);
  });

  it('a passing smoke with no checks or no version is not accepted as evidence', () => {
    const noChecks = buildHandoffControlPanel(greenInput({
      dashboardSmoke: { result: 'pass', pass: true, version: 'v0.2.231-alpha', checks: 0, passed: 0, failed: 0 },
    }));
    expect(isHandoffPanelGreen(noChecks)).toBe(false);
    const noVersion = buildHandoffControlPanel(greenInput({
      dashboardSmoke: { result: 'pass', pass: true, version: null, checks: 4, passed: 4, failed: 0 },
    }));
    expect(isHandoffPanelGreen(noVersion)).toBe(false);
  });

  it('an unknown manual-blocker (not an explicit boolean) blocks green', () => {
    const panel = buildHandoffControlPanel(greenInput({ manualBlocker: { statusLabel: 'x', pill: 'manual' } }));
    expect(panel.manualBlocker.pending).toBe(null);
    expect(isHandoffPanelGreen(panel)).toBe(false);
    expect(validateHandoffControlPanel(panel).errors.join(' ')).toMatch(/explicit boolean/i);
  });

  it('a clear blocker (pending:false) is also accepted as a known boolean', () => {
    const panel = buildHandoffControlPanel(greenInput({ manualBlocker: { pending: false, statusLabel: 'clear', pill: 'no-blocker' } }));
    expect(isHandoffPanelGreen(panel)).toBe(true);
  });

  it('a missing next safe task blocks green', () => {
    const panel = buildHandoffControlPanel(greenInput({ nextSafeTask: null }));
    expect(isHandoffPanelGreen(panel)).toBe(false);
  });
});

describe('workflow invariants (do-not-cancel-useful-jobs rule)', () => {
  it('exports a frozen WORKFLOW_INVARIANTS with the rule + its four exceptions', () => {
    expect(Array.isArray(WORKFLOW_INVARIANTS)).toBe(true);
    expect(Object.isFrozen(WORKFLOW_INVARIANTS)).toBe(true);
    expect(WORKFLOW_INVARIANTS.length).toBeGreaterThanOrEqual(5);
    // first entry = the rule itself
    expect(WORKFLOW_INVARIANTS[0]).toMatch(/cancel a useful in-progress job/i);
    expect(WORKFLOW_INVARIANTS[0]).toMatch(/finish it first/i);
    // the four documented exceptions
    const blob = WORKFLOW_INVARIANTS.join('\n');
    expect(blob).toMatch(/explicit/i);            // explicit user cancel
    expect(blob).toMatch(/conflict/i);            // immediate conflict
    expect(blob).toMatch(/resum/i);               // safely resumable
    expect(blob).toMatch(/stale|hung/i);          // stale/hung & already shipped
    expect(blob).toMatch(/shipped|pushed|synced|smoke/i);
  });

  it('a built panel carries the workflow invariants by default', () => {
    const panel = buildHandoffControlPanel();
    expect(HANDOFF_CONTROL_PANEL_REQUIRED_KEYS).toContain('workflowInvariants');
    expect(panel.workflowInvariants).toEqual(Array.from(WORKFLOW_INVARIANTS));
  });

  it('the builder folds the curated invariants back in when handed an empty array (surface never empty)', () => {
    const panel = buildHandoffControlPanel(greenInput({ workflowInvariants: [] }));
    expect(panel.workflowInvariants.length).toBeGreaterThanOrEqual(5);
  });

  it('a panel object that genuinely carries NO workflow invariants is a validator ERROR', () => {
    const green = buildHandoffControlPanel(greenInput());
    const v = validateHandoffControlPanel({ ...green, workflowInvariants: [] });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/workflow invariant/i);
  });

  it('the summary folds the invariant count and never implies approval', () => {
    const s = summarizeHandoffControlPanelForState(buildHandoffControlPanel(greenInput()));
    expect(s.workflowInvariants).toBe(WORKFLOW_INVARIANTS.length);
    expect(s.impliesApproval).toBe(false);
    expect(s.impliesPlaytestComplete).toBe(false);
  });

  it('the dashboard card surfaces a Workflow invariants metric', () => {
    const card = buildHandoffControlPanelCard(buildHandoffControlPanel(greenInput()));
    const metric = (card.metrics || []).find((m) => /workflow invariant/i.test(m.label || ''));
    expect(metric).toBeTruthy();
    expect(metric.value).toMatch(/cancel a useful in-progress job/i);
  });

  it('the curated invariants contain NO religious language', () => {
    expect(containsReligiousLanguage(WORKFLOW_INVARIANTS.join('\n'))).toBe(false);
  });
});

describe('non-religious ethics guard', () => {
  it('the curated principles + note contain NO religious language', () => {
    const blob = [ETHICS_NOTE, ...PROJECT_PRINCIPLES].join('\n');
    expect(containsReligiousLanguage(blob)).toBe(false);
    expect(findReligiousLanguage(blob)).toEqual([]);
  });

  it('flags sacred / doctrinal / worship language', () => {
    expect(containsReligiousLanguage('this is a sacred and holy mission')).toBe(true);
    expect(findReligiousLanguage('worship the divine scripture')).toEqual(
      expect.arrayContaining(['worship', 'divine', 'scripture']));
  });

  it('does NOT flag the brand vocabulary or the godMode safety flag', () => {
    // torii / gate / shrine / ⛩ are the product name, not religious framing; and a bare "god"
    // must never trip on the standing godMode flag.
    expect(containsReligiousLanguage('the torii gate shrine ⛩ keeps godMode false')).toBe(false);
    expect(RELIGIOUS_DENYLIST).not.toContain('god');
    expect(RELIGIOUS_DENYLIST).not.toContain('torii');
    expect(RELIGIOUS_DENYLIST).not.toContain('shrine');
  });

  it('religious ethics copy is a validator ERROR (panel cannot go green)', () => {
    const panel = buildHandoffControlPanel(greenInput({
      principles: ['Pursue the sacred mission with devotion'],
      ethicsNote: 'Worship the open protocols.',
    }));
    expect(isHandoffPanelGreen(panel)).toBe(false);
    expect(validateHandoffControlPanel(panel).errors.join(' ')).toMatch(/non-religious/i);
  });
});

describe('next-action fold', () => {
  it('summarizes a green panel with its evidence and never implies approval', () => {
    const panel = buildHandoffControlPanel(greenInput());
    const s = summarizeHandoffControlPanelForState(panel);
    expect(s.green).toBe(true);
    expect(s.version).toBe(VERSION);
    expect(s.entrySmoke.pass).toBe(true);
    expect(s.dashboardSmoke.pass).toBe(true);
    expect(s.manualBlockerPending).toBe(true);
    expect(s.ethicsNonReligious).toBe(true);
    expect(s.impliesApproval).toBe(false);
    expect(s.impliesPlaytestComplete).toBe(false);
  });

  it('degrades to green:false on null', () => {
    const s = summarizeHandoffControlPanelForState(null);
    expect(s.green).toBe(false);
    expect(s.impliesApproval).toBe(false);
  });
});

describe('dashboard card', () => {
  it('a green panel with a pending blocker renders a manual-pill READY-PENDING card', () => {
    const card = buildHandoffControlPanelCard(buildHandoffControlPanel(greenInput()));
    expect(card.green).toBe(true);
    expect(card.pill).toBe('manual');
    expect(card.statusLabel).toMatch(/READY/);
    expect(card.statusLabel).toMatch(/PENDING/);
    expect(Array.isArray(card.metrics)).toBe(true);
    expect(card.kind).toBe('generated');
  });

  it('a green panel with a clear blocker renders a no-blocker pill', () => {
    const card = buildHandoffControlPanelCard(buildHandoffControlPanel(greenInput({
      manualBlocker: { pending: false, statusLabel: 'clear', pill: 'no-blocker' },
    })));
    expect(card.pill).toBe('no-blocker');
  });

  it('an incomplete panel renders an INCOMPLETE manual card', () => {
    const card = buildHandoffControlPanelCard(buildHandoffControlPanel());
    expect(card.green).toBe(false);
    expect(card.statusLabel).toMatch(/INCOMPLETE/);
    expect(card.pill).toBe('manual');
  });
});
