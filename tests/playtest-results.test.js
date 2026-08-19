// tests/playtest-results.test.js — pure MVP MANUAL PLAYTEST RESULTS INTAKE assembly + formatting +
// the tolerant results-markdown parser/summary (tools/playtestResults.mjs, v0.2.204). Covers the
// constants, the blank-template model (item list DERIVED from the frozen checklist), the
// text/markdown formatters, the safety posture, the tolerant parser (PASS/FAIL/N-A/blank/other),
// the summary counts + verdict + failing-id rollup, and degraded / garbled-input cases. No fs/git —
// every input is plain data, fully deterministic (generatedAt omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  PLAYTEST_RESULTS_SCHEMA, PLAYTEST_RESULTS_SCHEMA_VERSION, PLAYTEST_RESULTS_SUMMARY_SCHEMA,
  PLAYTEST_RESULTS_BADGE, PLAYTEST_RESULTS_WRITE_FILENAME, PLAYTEST_RESULTS_TITLE,
  PLAYTEST_RESULT_VALUES, PLAYTEST_RESULTS_META_FIELDS, PLAYTEST_RESULTS_ITEM_FIELDS,
  PLAYTEST_RESULTS_HOWTO,
  buildPlaytestResultsTemplate, formatPlaytestResultsTemplate,
  formatPlaytestResultsTemplateMarkdown, parsePlaytestResults, summarizePlaytestResults,
  formatPlaytestResultsSummary, playtestResultsItemCount,
} from '../tools/playtestResults.mjs';
import {
  PLAYTEST_CHECKLIST_SECTIONS, playtestItemCount,
} from '../tools/playtestChecklist.mjs';

const V = 'v0.2.204-alpha';

describe('playtest-results — constants', () => {
  it('exposes stable schemas, version, badge, write filename, and title', () => {
    expect(PLAYTEST_RESULTS_SCHEMA).toBe('torii.playtest-results');
    expect(PLAYTEST_RESULTS_SCHEMA_VERSION).toBe(1);
    expect(PLAYTEST_RESULTS_SUMMARY_SCHEMA).toBe('torii.playtest-results-summary');
    expect(PLAYTEST_RESULTS_BADGE).toBe('MVP PLAYTEST RESULTS INTAKE · LOCAL · READ-ONLY');
    expect(PLAYTEST_RESULTS_WRITE_FILENAME).toBe('MVP_PLAYTEST_RESULTS_TEMPLATE.md');
    expect(PLAYTEST_RESULTS_TITLE).toBe('Torii Quest — MVP Manual Playtest Results');
  });

  it('ships frozen result values + meta/item field definitions + how-to', () => {
    expect(Object.isFrozen(PLAYTEST_RESULT_VALUES)).toBe(true);
    expect(PLAYTEST_RESULT_VALUES).toEqual(['PASS', 'FAIL', 'N/A']);
    expect(Object.isFrozen(PLAYTEST_RESULTS_META_FIELDS)).toBe(true);
    expect(Object.isFrozen(PLAYTEST_RESULTS_ITEM_FIELDS)).toBe(true);
    const metaKeys = PLAYTEST_RESULTS_META_FIELDS.map((f) => f.key);
    for (const k of ['build', 'tester', 'date', 'environment']) expect(metaKeys).toContain(k);
    const itemKeys = PLAYTEST_RESULTS_ITEM_FIELDS.map((f) => f.key);
    for (const k of ['result', 'severity', 'repro', 'media', 'nextAction']) expect(itemKeys).toContain(k);
    expect(Object.isFrozen(PLAYTEST_RESULTS_HOWTO)).toBe(true);
    expect(PLAYTEST_RESULTS_HOWTO.length).toBeGreaterThan(0);
  });

  it('item count matches the source checklist (single source of truth)', () => {
    expect(playtestResultsItemCount()).toBe(playtestItemCount());
  });
});

describe('playtest-results — template assembly', () => {
  it('derives its sections + items from the checklist and stamps the header', () => {
    const m = buildPlaytestResultsTemplate({
      version: V, gitCommit: 'abc1234', liveUrl: 'https://chiefmonkey.art/quest',
    });
    expect(m.schema).toBe('torii.playtest-results');
    expect(m.manual).toBe(true);
    expect(m.version).toBe(V);
    expect(m.gitCommit).toBe('abc1234');
    expect(m.liveUrl).toBe('https://chiefmonkey.art/quest');
    expect(m.sections.length).toBe(PLAYTEST_CHECKLIST_SECTIONS.length);
    expect(m.itemCount).toBe(playtestResultsItemCount());
    // every checklist item id is present in the template
    const tmplIds = m.sections.flatMap((s) => s.items.map((it) => it.id));
    const srcIds = PLAYTEST_CHECKLIST_SECTIONS.flatMap((s) => s.items.map((it) => it.id));
    expect(tmplIds).toEqual(srcIds);
    // items carry severity + expected so the tester has context while recording
    expect(m.sections[0].items[0]).toHaveProperty('severity');
    expect(m.sections[0].items[0]).toHaveProperty('expected');
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildPlaytestResultsTemplate({ version: V });
    expect(m.safety).toEqual({
      automated: false, served: false, navigated: false, deployed: false,
      published: false, wrote: false, network: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });
});

describe('playtest-results — template formatters', () => {
  it('text block carries badge, how-to, build fields, and per-item result fields', () => {
    const m = buildPlaytestResultsTemplate({
      version: V, liveUrl: 'https://chiefmonkey.art/quest', generatedAt: '2026-06-26T00:00:00Z',
    });
    const txt = formatPlaytestResultsTemplate(m);
    expect(txt).toContain('MVP PLAYTEST RESULTS INTAKE · LOCAL · READ-ONLY');
    expect(txt).toContain('How to use:');
    expect(txt).toContain('Build / session:');
    expect(txt).toContain('[ ] LAUNCH-1');
    expect(txt).toContain('Result (PASS / FAIL / N/A): ____');
    expect(txt).toContain('RESULTS INTAKE TEMPLATE ONLY');
    expect(txt).toContain('generated: 2026-06-26T00:00:00Z');
  });

  it('markdown carries the title, build table, per-item Field/Value tables, and intake-only note', () => {
    const m = buildPlaytestResultsTemplate({ version: V, gitCommit: 'abc1234' });
    const md = formatPlaytestResultsTemplateMarkdown(m);
    expect(md).toContain('# Torii Quest — MVP Manual Playtest Results');
    expect(md).toContain('## Build / session');
    expect(md).toContain('| Build / version | v0.2.204-alpha |');
    expect(md).toContain('| Commit | abc1234 |');
    expect(md).toContain('### [ ] LAUNCH-1');
    expect(md).toContain('| Result (PASS / FAIL / N/A) |  |');
    expect(md).toContain('_RESULTS INTAKE TEMPLATE ONLY');
  });

  it('both template formatters are null-safe', () => {
    expect(formatPlaytestResultsTemplate(null)).toBe('playtest-results: (no template)');
    expect(formatPlaytestResultsTemplateMarkdown(null)).toContain('_(no template)_');
  });

  it('a freshly generated blank template summarizes as INCOMPLETE (all blank)', () => {
    const m = buildPlaytestResultsTemplate({ version: V });
    const md = formatPlaytestResultsTemplateMarkdown(m);
    const summary = summarizePlaytestResults(parsePlaytestResults(md));
    expect(summary.total).toBe(playtestResultsItemCount());
    expect(summary.counts.blank).toBe(summary.total);
    expect(summary.counts.fail).toBe(0);
    expect(summary.verdict).toBe('INCOMPLETE');
  });
});

describe('playtest-results — parser', () => {
  const filled = [
    '### [ ] LAUNCH-1 — Title  _(blocker)_',
    '| Field | Value |',
    '| --- | --- |',
    '| Result (PASS / FAIL / N/A) | PASS |',
    '',
    '### [ ] SHOOT-1 — Loop  _(blocker)_',
    '| Result (PASS / FAIL / N/A) | FAIL |',
    '| Observed severity (if FAIL) | blocker |',
    '',
    '### [ ] AIM-2 — Heads  _(major)_',
    '| Result (PASS / FAIL / N/A) | N/A |',
    '',
    '### [ ] MOVE-2 — Footsteps  _(minor)_',
    '| Result (PASS / FAIL / N/A) |  |',
  ].join('\n');

  it('classifies PASS / FAIL / N/A / blank per item by reading the Result row', () => {
    const parsed = parsePlaytestResults(filled);
    expect(parsed.schema).toBe('torii.playtest-results');
    expect(parsed.total).toBe(4);
    const byId = Object.fromEntries(parsed.items.map((it) => [it.id, it.result]));
    expect(byId['LAUNCH-1']).toBe('pass');
    expect(byId['SHOOT-1']).toBe('fail');
    expect(byId['AIM-2']).toBe('na');
    expect(byId['MOVE-2']).toBe('blank');
  });

  it('ignores the placeholder hint and tolerates a missing Result row', () => {
    const md = [
      '### [ ] LAUNCH-1 — Title',
      '| Result (PASS / FAIL / N/A) | _(PASS / FAIL / N/A)_ |', // unfilled hint → blank
      '### [ ] SHOOT-1 — Loop',
      '_Expected:_ something', // no table at all
    ].join('\n');
    const parsed = parsePlaytestResults(md);
    const byId = Object.fromEntries(parsed.items.map((it) => [it.id, it.result]));
    expect(byId['LAUNCH-1']).toBe('blank');
    expect(byId['SHOOT-1']).toBe('blank');
  });

  it('never throws on non-string / empty input', () => {
    expect(() => parsePlaytestResults(null)).not.toThrow();
    expect(parsePlaytestResults(null).total).toBe(0);
    expect(parsePlaytestResults(42).total).toBe(0);
    expect(parsePlaytestResults('').total).toBe(0);
  });
});

describe('playtest-results — summary', () => {
  it('counts results, lists failing ids, and assigns a verdict', () => {
    const md = [
      '### [ ] LAUNCH-1', '| Result (PASS / FAIL / N/A) | PASS |',
      '### [ ] SHOOT-1', '| Result (PASS / FAIL / N/A) | FAIL |',
      '### [ ] AIM-2', '| Result (PASS / FAIL / N/A) | N/A |',
    ].join('\n');
    const summary = summarizePlaytestResults(parsePlaytestResults(md));
    expect(summary.schema).toBe('torii.playtest-results-summary');
    expect(summary.total).toBe(3);
    expect(summary.counts.pass).toBe(1);
    expect(summary.counts.fail).toBe(1);
    expect(summary.counts.na).toBe(1);
    expect(summary.counts.blank).toBe(0);
    expect(summary.fails).toEqual(['SHOOT-1']);
    expect(summary.verdict).toBe('ATTENTION');
  });

  it('verdict COMPLETE when every item is PASS / N/A with no blanks', () => {
    const md = [
      '### [ ] A-1', '| Result (PASS / FAIL / N/A) | PASS |',
      '### [ ] B-1', '| Result (PASS / FAIL / N/A) | N/A |',
    ].join('\n');
    expect(summarizePlaytestResults(parsePlaytestResults(md)).verdict).toBe('COMPLETE');
  });

  it('verdict EMPTY for no items; accepts raw markdown directly', () => {
    expect(summarizePlaytestResults(parsePlaytestResults('')).verdict).toBe('EMPTY');
    // accepts a raw markdown string as well as a parsed object
    const s = summarizePlaytestResults('### [ ] A-1\n| Result (PASS / FAIL / N/A) | PASS |');
    expect(s.total).toBe(1);
    expect(s.verdict).toBe('COMPLETE');
  });

  it('summary formatter is null-safe and lists failing ids', () => {
    expect(formatPlaytestResultsSummary(null)).toBe('playtest-results summary: (no summary)');
    const md = '### [ ] X-1\n| Result (PASS / FAIL / N/A) | FAIL |';
    const txt = formatPlaytestResultsSummary(summarizePlaytestResults(parsePlaytestResults(md)));
    expect(txt).toContain('verdict: ATTENTION');
    expect(txt).toContain('X-1');
  });
});
