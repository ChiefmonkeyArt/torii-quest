// tests/continuum-parse.test.js — locks the PURE build-time doc parser
// (tools/continuumParse.mjs, v0.2.174) that derives the Torii Continuum dashboard's
// list sections from torii-quest-progress.md/torii-quest-todo.md, plus the buildContinuumModel(overrides)
// merge seam it feeds. Proves: section/list parsing, bullet cleaning, safe fallback +
// gap reporting on a missing/garbled section, the docs-derived task counts, and that
// overrides REPLACE curated arrays + recompute totals while no-override stays curated.
import { describe, it, expect } from 'vitest';
import {
  stripInlineMd, cleanBullet, sectionLines,
  parseNumberedList, parseStruckBullets, parseBullets,
  countStruck, deriveContinuumData, summariseTaskTotals,
} from '../tools/continuumParse.mjs';
import {
  buildContinuumModel, computeTotals, CONTINUUM,
} from '../src/engine/dashboard/continuumData.js';

const PROGRESS = `# Title

## Active now

- 🔄 **v0.2.174 — automation** doing the thing.
- ✅ ARS-4 close-out.

## Next 12 tasks

1. First task here.
2. Second task here.
3. Third task here.

## Risk / blocked / no-blocker

| a | b |

## Completed last 24h

Struck items stay ~24h then collapse.

- ~~**v0.2.174** — derived dashboard data. +tests.~~
- ~~v0.2.173 — test profiles. +11 tests.~~

## Archive

- **v0.2.159–168 — gateway chain cluster.**
- **v0.2.120–133 — SDK + harness cluster.**

## Update Rules

1. not a task list.
`;

const TODO = `# TODO

| ~~ARS-1~~ | DONE |
| ~~ARS-2~~ | DONE |
| ARS-4 | open |
`;

describe('text helpers', () => {
  it('stripInlineMd removes **, ~~, backticks', () => {
    expect(stripInlineMd('**bold** and ~~struck~~ and `code`')).toBe('bold and struck and code');
  });
  it('cleanBullet drops a leading status glyph after stripping markdown', () => {
    expect(cleanBullet('🔄 **v0.2.174 — x**')).toBe('v0.2.174 — x');
    expect(cleanBullet('Plain start')).toBe('Plain start');
  });
});

describe('sectionLines', () => {
  it('returns the lines under a heading up to the next heading', () => {
    const s = sectionLines(PROGRESS, 'Next 12 tasks');
    expect(Array.isArray(s)).toBe(true);
    expect(s.join('\n')).toContain('1. First task here.');
    expect(s.join('\n')).not.toContain('Risk / blocked');
  });
  it('returns null when the heading is absent', () => {
    expect(sectionLines(PROGRESS, 'No Such Heading')).toBeNull();
  });
});

describe('list parsers', () => {
  it('parseNumberedList pulls the N. items, cleaned', () => {
    expect(parseNumberedList(PROGRESS, 'Next 12 tasks')).toEqual([
      'First task here.', 'Second task here.', 'Third task here.',
    ]);
  });
  it('parseStruckBullets pulls only ~~struck~~ bullets', () => {
    const c = parseStruckBullets(PROGRESS, 'Completed last 24h');
    expect(c.length).toBe(2);
    expect(c[0]).toBe('v0.2.174 — derived dashboard data. +tests.');
  });
  it('parseBullets pulls top-level bullets and skips struck ones', () => {
    const a = parseBullets(PROGRESS, 'Active now');
    expect(a).toEqual(['v0.2.174 — automation doing the thing.', 'ARS-4 close-out.']);
    const arc = parseBullets(PROGRESS, 'Archive');
    expect(arc.length).toBe(2);
  });
  it('countStruck counts ~~…~~ spans (todo completed markers)', () => {
    expect(countStruck(TODO)).toBe(2);
  });
});

describe('deriveContinuumData', () => {
  it('derives all four list sections + task totals from clean docs', () => {
    const d = deriveContinuumData({ progressMd: PROGRESS, todoMd: TODO });
    expect(d.overrides.next12.length).toBe(3);
    expect(d.overrides.activeNow.length).toBe(2);
    expect(d.overrides.completed24h.length).toBe(2);
    expect(d.overrides.archive.length).toBe(2);
    expect(d.taskTotals.todoCompletedMarkers).toBe(2);
    expect(d.taskTotals.next12).toBe(3);
    expect(d.gaps).toEqual([]);
    expect(d.parsed.length).toBe(4);
  });
  it('falls back safely (no override) and reports a gap when a section is missing', () => {
    const d = deriveContinuumData({ progressMd: '# empty\n', todoMd: '' });
    expect(d.overrides.next12).toBeUndefined();
    expect(d.overrides.activeNow).toBeUndefined();
    expect(d.gaps.length).toBeGreaterThan(0);
    expect(d.taskTotals.todoCompletedMarkers).toBe(0);
  });
  it('never throws on null/garbage input', () => {
    expect(() => deriveContinuumData()).not.toThrow();
    expect(() => deriveContinuumData({ progressMd: null, todoMd: 123 })).not.toThrow();
  });
  it('summariseTaskTotals renders a one-line metric, safe on null', () => {
    expect(summariseTaskTotals(null)).toBe('');
    const s = summariseTaskTotals({ todoCompletedMarkers: 2, next12: 3, archiveClusters: 2 });
    expect(s).toContain('2 completed task markers');
    expect(s).toContain('3 next-12');
  });
});

describe('running-log bounds tolerance (v0.2.208)', () => {
  // torii-quest-progress.md "Active now" / "Completed last 24h" are running logs: every shipped slice
  // prepends an entry, so the realistic lengths (30+) far exceed the original v0.2.174
  // ceilings. These cases lock the raised bounds: a long-but-bounded list now parses
  // (no gap, dashboard derives from the doc) while a truly absurd list still falls back.
  const docWith = (activeCount, completedCount) => {
    const active = Array.from({ length: activeCount }, (_, i) => `- ✅ **v0.2.${200 - i} — slice ${i}** did the thing.`).join('\n');
    const completed = Array.from({ length: completedCount }, (_, i) => `- ~~**v0.2.${190 - i}** — done ${i}. +tests.~~`).join('\n');
    return `# Title\n\n## Active now\n\n${active}\n\n## Completed last 24h\n\n${completed}\n\n## Update Rules\n\n1. x\n`;
  };

  it('parses a long-but-bounded Active now (34 items) without a gap', () => {
    const d = deriveContinuumData({ progressMd: docWith(34, 26), todoMd: '' });
    expect(d.overrides.activeNow.length).toBe(34);
    expect(d.overrides.completed24h.length).toBe(26);
    expect(d.gaps.some((g) => g.startsWith('activeNow'))).toBe(false);
    expect(d.gaps.some((g) => g.startsWith('completed24h'))).toBe(false);
  });

  it('still falls back to the curated default when a list is absurdly long', () => {
    const d = deriveContinuumData({ progressMd: docWith(61, 61), todoMd: '' });
    expect(d.overrides.activeNow).toBeUndefined();
    expect(d.overrides.completed24h).toBeUndefined();
    expect(d.gaps.some((g) => g.startsWith('activeNow'))).toBe(true);
    expect(d.gaps.some((g) => g.startsWith('completed24h'))).toBe(true);
  });
});

describe('buildContinuumModel(overrides) merge seam', () => {
  it('no overrides → curated model unchanged', () => {
    const m = buildContinuumModel();
    expect(m.next12).toEqual(CONTINUUM.next12);
    expect(m.totals.tasksAhead).toBe(12);
    expect(m.taskTotals).toBeNull();
    expect(m.derived).toBeNull();
  });
  it('list overrides REPLACE curated arrays and recompute totals', () => {
    const overrides = {
      next12: ['a', 'b', 'c'],
      completed24h: ['x'],
      taskTotals: { isDerived: true, todoCompletedMarkers: 9 },
      derived: { parsed: ['next12 (3)'], gaps: [], sources: ['torii-quest-progress.md'] },
    };
    const m = buildContinuumModel(overrides);
    expect(m.totals.tasksAhead).toBe(3);
    expect(m.totals.completedLast24h).toBe(1);
    expect(m.taskTotals.todoCompletedMarkers).toBe(9);
    expect(m.derived.sources).toEqual(['torii-quest-progress.md']);
    // curated source is not mutated
    expect(CONTINUUM.next12.length).toBe(12);
  });
  it('totals override keeps non-overridden sections curated', () => {
    const m = buildContinuumModel({ next12: ['only one'] });
    expect(m.totals.activeTasks).toBe(computeTotals(CONTINUUM).activeTasks);
  });
});
