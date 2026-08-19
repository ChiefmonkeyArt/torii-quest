// tests/playtest-checklist.test.js — pure MVP MANUAL PLAYTEST ACCEPTANCE CHECKLIST assembly +
// formatting (tools/playtestChecklist.mjs, v0.2.203). Covers the frozen curated checklist
// (sections + per-item shape: id/steps/expected/severity/ifFailed), the assembled model, the
// item count, the text/markdown formatters (checkboxes + Result/Notes fields), the safety
// posture, and degraded / missing-input cases. No fs/git — every input is plain data, fully
// deterministic (generatedAt omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  PLAYTEST_CHECKLIST_SCHEMA, PLAYTEST_CHECKLIST_SCHEMA_VERSION, PLAYTEST_CHECKLIST_BADGE,
  PLAYTEST_CHECKLIST_WRITE_FILENAME, PLAYTEST_CHECKLIST_TITLE,
  PLAYTEST_SEVERITIES, PLAYTEST_CHECKLIST_SECTIONS, PLAYTEST_CHECKLIST_ADVISORIES,
  PLAYTEST_CHECKLIST_HOWTO,
  buildPlaytestChecklistModel, formatPlaytestChecklist, formatPlaytestChecklistMarkdown,
  playtestItemCount,
} from '../tools/playtestChecklist.mjs';

const V = 'v0.2.203-alpha';

describe('playtest-checklist — constants', () => {
  it('exposes a stable schema, version, badge, write filename, and title', () => {
    expect(PLAYTEST_CHECKLIST_SCHEMA).toBe('torii.playtest-checklist');
    expect(PLAYTEST_CHECKLIST_SCHEMA_VERSION).toBe(1);
    expect(PLAYTEST_CHECKLIST_BADGE).toBe('MVP MANUAL PLAYTEST CHECKLIST · LOCAL · READ-ONLY');
    expect(PLAYTEST_CHECKLIST_WRITE_FILENAME).toBe('MVP_PLAYTEST_CHECKLIST.md');
    expect(PLAYTEST_CHECKLIST_TITLE).toBe('Torii Quest — MVP Manual Playtest Acceptance Checklist');
  });

  it('ships frozen severities ordered most-severe first', () => {
    expect(Object.isFrozen(PLAYTEST_SEVERITIES)).toBe(true);
    expect(PLAYTEST_SEVERITIES).toEqual(['blocker', 'major', 'minor']);
  });

  it('ships a frozen curated checklist covering every required playtest area', () => {
    expect(Object.isFrozen(PLAYTEST_CHECKLIST_SECTIONS)).toBe(true);
    const keys = PLAYTEST_CHECKLIST_SECTIONS.map((s) => s.key);
    for (const k of [
      'launch', 'shooter', 'movement', 'aim', 'reload', 'gun', 'mirror',
      'crates', 'nap', 'continuum', 'update', 'nostr', 'gateway',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('every item has id, steps, expected, a valid severity, and an ifFailed action', () => {
    for (const s of PLAYTEST_CHECKLIST_SECTIONS) {
      expect(Array.isArray(s.items)).toBe(true);
      expect(s.items.length).toBeGreaterThan(0);
      for (const it of s.items) {
        expect(typeof it.id).toBe('string');
        expect(it.id.length).toBeGreaterThan(0);
        expect(Array.isArray(it.steps)).toBe(true);
        expect(it.steps.length).toBeGreaterThan(0);
        expect(typeof it.expected).toBe('string');
        expect(it.expected.length).toBeGreaterThan(0);
        expect(PLAYTEST_SEVERITIES).toContain(it.severity);
        expect(typeof it.ifFailed).toBe('string');
        expect(it.ifFailed.length).toBeGreaterThan(0);
      }
    }
  });

  it('item ids are unique across the whole checklist', () => {
    const ids = PLAYTEST_CHECKLIST_SECTIONS.flatMap((s) => s.items.map((it) => it.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships a frozen non-blocking advisories list and how-to guidance', () => {
    expect(Object.isFrozen(PLAYTEST_CHECKLIST_ADVISORIES)).toBe(true);
    expect(PLAYTEST_CHECKLIST_ADVISORIES.join(' ')).toMatch(/rapier/);
    expect(Object.isFrozen(PLAYTEST_CHECKLIST_HOWTO)).toBe(true);
    expect(PLAYTEST_CHECKLIST_HOWTO.length).toBeGreaterThan(0);
  });

  it('playtestItemCount sums every section', () => {
    const manual = PLAYTEST_CHECKLIST_SECTIONS.reduce((n, s) => n + s.items.length, 0);
    expect(playtestItemCount()).toBe(manual);
  });
});

describe('playtest-checklist — assembly', () => {
  it('builds a model that carries the curated checklist + stamped header', () => {
    const m = buildPlaytestChecklistModel({
      version: V, gitCommit: 'abc1234', liveUrl: 'https://chiefmonkey.art/quest',
    });
    expect(m.schema).toBe('torii.playtest-checklist');
    expect(m.manual).toBe(true);
    expect(m.version).toBe(V);
    expect(m.gitCommit).toBe('abc1234');
    expect(m.liveUrl).toBe('https://chiefmonkey.art/quest');
    expect(m.sections.length).toBe(PLAYTEST_CHECKLIST_SECTIONS.length);
    expect(m.itemCount).toBe(playtestItemCount());
    expect(m.advisories.length).toBe(PLAYTEST_CHECKLIST_ADVISORIES.length);
    expect(m.severities).toEqual(['blocker', 'major', 'minor']);
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildPlaytestChecklistModel({ version: V });
    expect(m.safety).toEqual({
      automated: false, served: false, navigated: false, deployed: false,
      published: false, wrote: false, network: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });

  it('deep-copies sections so the frozen source cannot be mutated through the model', () => {
    const m = buildPlaytestChecklistModel({ version: V });
    m.sections[0].items[0].steps.push('mutated');
    expect(PLAYTEST_CHECKLIST_SECTIONS[0].items[0].steps).not.toContain('mutated');
  });
});

describe('playtest-checklist — formatters', () => {
  it('text block carries badge, how-to, checkboxes, result fields, and advisories', () => {
    const m = buildPlaytestChecklistModel({
      version: V, liveUrl: 'https://chiefmonkey.art/quest',
      generatedAt: '2026-06-26T00:00:00Z',
    });
    const txt = formatPlaytestChecklist(m);
    expect(txt).toContain('MVP MANUAL PLAYTEST CHECKLIST · LOCAL · READ-ONLY');
    expect(txt).toContain('How to run:');
    expect(txt).toContain('[ ] LAUNCH-1');
    expect(txt).toContain('result: ____');
    expect(txt).toContain('Known deferred / non-blocking advisories:');
    expect(txt).toContain('MANUAL CHECKLIST ONLY');
    expect(txt).toContain('generated: 2026-06-26T00:00:00Z');
  });

  it('markdown carries the title, checkboxes, Result/Notes tables, and manual-only note', () => {
    const m = buildPlaytestChecklistModel({ version: V });
    const md = formatPlaytestChecklistMarkdown(m);
    expect(md).toContain('# Torii Quest — MVP Manual Playtest Acceptance Checklist');
    expect(md).toContain('### [ ] LAUNCH-1');
    expect(md).toContain('| Result (PASS / FAIL / N/A) | Notes |');
    expect(md).toContain('## Known deferred / non-blocking advisories');
    expect(md).toContain('_MANUAL CHECKLIST ONLY');
  });

  it('both formatters are null-safe', () => {
    expect(formatPlaytestChecklist(null)).toBe('playtest-checklist: (no checklist)');
    expect(formatPlaytestChecklistMarkdown(null)).toContain('_(no checklist)_');
  });
});

describe('playtest-checklist — robustness', () => {
  it('degrades to honest defaults with no inputs and never throws', () => {
    expect(() => buildPlaytestChecklistModel({})).not.toThrow();
    const m = buildPlaytestChecklistModel({});
    expect(m.version).toBe(null);
    expect(m.gitCommit).toBe(null);
    expect(m.liveUrl).toBe(null);
    // the curated checklist is always present even with no stamped header
    expect(m.sections.length).toBe(PLAYTEST_CHECKLIST_SECTIONS.length);
    expect(m.itemCount).toBe(playtestItemCount());
  });

  it('never throws on garbled inputs', () => {
    expect(() => buildPlaytestChecklistModel({ version: 42, gitCommit: [], liveUrl: {} })).not.toThrow();
    const m = buildPlaytestChecklistModel({ version: 42, gitCommit: [], liveUrl: {} });
    expect(m.version).toBe(null);
    expect(m.gitCommit).toBe(null);
    expect(m.liveUrl).toBe(null);
  });
});
