// tests/playtest-results-state.test.js — pure MVP PLAYTEST RESULTS STATE summary
// (tools/playtestResultsState.mjs, v0.2.222). Covers summarizePlaytestForState (mapping a
// results-markdown / summary into not-run / incomplete / attention / complete + counts), the
// shipped-default not-run posture, the HARD invariant that the state NEVER implies approval, the
// text formatter, and the committed canonical MVP_PLAYTEST_RESULTS.md (blank → not-run). No
// fs/git in the pure assertions (the committed-artifact check reads the file read-only).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLAYTEST_RESULTS_STATE_SCHEMA, PLAYTEST_RESULTS_STATE_SCHEMA_VERSION,
  PLAYTEST_RESULTS_STATE_BADGE, PLAYTEST_RESULTS_STATE_FILE, PLAYTEST_RESULTS_STATUSES,
  summarizePlaytestForState, formatPlaytestResultsState,
} from '../tools/playtestResultsState.mjs';

// Build a minimal results-markdown item block the parser recognises. A blank `result` leaves the
// Result cell empty (parses as 'blank').
function item(id, result = '') {
  return [
    `### [ ] ${id} — some item title  _(blocker)_`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Result (PASS / FAIL / N/A) | ${result} |`,
    '',
  ].join('\n');
}
const doc = (...blocks) => `# Results\n\n${blocks.join('\n')}`;

describe('playtest-results-state — constants', () => {
  it('exposes a stable schema, badge, canonical filename, and status vocabulary', () => {
    expect(PLAYTEST_RESULTS_STATE_SCHEMA).toBe('torii.playtest-results-state');
    expect(PLAYTEST_RESULTS_STATE_SCHEMA_VERSION).toBe(1);
    expect(PLAYTEST_RESULTS_STATE_FILE).toBe('MVP_PLAYTEST_RESULTS.md');
    expect(PLAYTEST_RESULTS_STATE_BADGE).toContain('NOT AN APPROVAL');
    expect(Object.isFrozen(PLAYTEST_RESULTS_STATUSES)).toBe(true);
    expect(PLAYTEST_RESULTS_STATUSES).toEqual({
      UNKNOWN: 'unknown', NOT_RUN: 'not-run', INCOMPLETE: 'incomplete',
      ATTENTION: 'attention', COMPLETE: 'complete',
    });
  });
});

describe('summarizePlaytestForState — status mapping', () => {
  it('reads every-item-blank as not-run (the shipped default), pending + un-run', () => {
    const s = summarizePlaytestForState(doc(item('LAUNCH-1'), item('SHOOT-1'), item('AIM-2')));
    expect(s.status).toBe('not-run');
    expect(s.ran).toBe(false);
    expect(s.complete).toBe(false);
    expect(s.pending).toBe(true);
    expect(s.total).toBe(3);
    expect(s.counts.blank).toBe(3);
    expect(s.fails).toEqual([]);
  });

  it('flags attention when any item recorded FAIL and lists the failing ids', () => {
    const s = summarizePlaytestForState(doc(item('LAUNCH-1', 'PASS'), item('AIM-2', 'FAIL'), item('NAP-1', 'N/A')));
    expect(s.status).toBe('attention');
    expect(s.ran).toBe(true);
    expect(s.pending).toBe(true);
    expect(s.counts).toMatchObject({ pass: 1, fail: 1, na: 1, blank: 0 });
    expect(s.fails).toEqual(['AIM-2']);
  });

  it('is incomplete when some items recorded but at least one still blank', () => {
    const s = summarizePlaytestForState(doc(item('LAUNCH-1', 'PASS'), item('SHOOT-1', '')));
    expect(s.status).toBe('incomplete');
    expect(s.pending).toBe(true);
  });

  it('is complete only when every item is PASS or N/A with no failures', () => {
    const s = summarizePlaytestForState(doc(item('LAUNCH-1', 'PASS'), item('SHOOT-1', 'PASS'), item('NAP-1', 'N/A')));
    expect(s.status).toBe('complete');
    expect(s.ran).toBe(true);
    expect(s.complete).toBe(true);
    expect(s.pending).toBe(false);
  });

  it('degrades to unknown on null / empty / no-item input (never throws)', () => {
    expect(summarizePlaytestForState(null).status).toBe('unknown');
    expect(summarizePlaytestForState('').status).toBe('unknown');
    expect(summarizePlaytestForState('# Heading with no items').status).toBe('unknown');
    expect(summarizePlaytestForState({ garbled: true }).status).toBe('unknown');
  });

  it('accepts either raw markdown text or a summarizePlaytestResults() summary', () => {
    const summary = { schema: 'torii.playtest-results-summary', total: 1, counts: { total: 1, pass: 1, fail: 0, na: 0, blank: 0, other: 0 }, fails: [], verdict: 'COMPLETE' };
    expect(summarizePlaytestForState(summary).status).toBe('complete');
  });
});

describe('summarizePlaytestForState — never implies approval (hard invariant)', () => {
  it('pins approvalImplied false for not-run, attention, AND a fully complete playtest', () => {
    const notRun = summarizePlaytestForState(doc(item('LAUNCH-1')));
    const attention = summarizePlaytestForState(doc(item('LAUNCH-1', 'FAIL')));
    const complete = summarizePlaytestForState(doc(item('LAUNCH-1', 'PASS'), item('SHOOT-1', 'N/A')));
    expect(notRun.approvalImplied).toBe(false);
    expect(attention.approvalImplied).toBe(false);
    expect(complete.approvalImplied).toBe(false);
    // Even a clean playtest stays pending-for-approval: complete is not the same as approved.
    expect(complete.complete).toBe(true);
    expect(complete.approvalImplied).toBe(false);
  });
});

describe('formatPlaytestResultsState — formatter', () => {
  it('renders the badge, status, and the not-an-approval reminder', () => {
    const txt = formatPlaytestResultsState(summarizePlaytestForState(doc(item('LAUNCH-1'))));
    expect(txt).toContain(PLAYTEST_RESULTS_STATE_BADGE);
    expect(txt).toContain('status: not-run');
    expect(txt).toContain('implies approval: NO');
    expect(txt).toContain('separate gate');
  });

  it('is null-safe', () => {
    expect(formatPlaytestResultsState(null)).toBe('playtest-results-state: (no state)');
  });
});

// The committed canonical recording file ships BLANK, so a fresh checkout must read as not-run and
// can never, by itself, imply approval.
describe('committed MVP_PLAYTEST_RESULTS.md', () => {
  it('exists and summarises to not-run (blank by default, approvalImplied false)', () => {
    let raw = null;
    try { raw = readFileSync(join(process.cwd(), PLAYTEST_RESULTS_STATE_FILE), 'utf8'); } catch { raw = null; }
    expect(raw).not.toBe(null);
    const s = summarizePlaytestForState(raw);
    expect(s.total).toBeGreaterThan(0);
    expect(s.status).toBe('not-run');
    expect(s.pending).toBe(true);
    expect(s.approvalImplied).toBe(false);
  });
});
