// tests/md-patch.test.js — locks down tools/mdPatch.mjs: whitelist + traversal
// boundary, the pure append/replace transforms (exact byte preservation outside
// the targeted section), and the fs-backed applyPatch (backup-before-edit,
// no-create, dry-run).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MD_PATCH_WHITELIST,
  MD_PATCH_CAPABILITIES,
  MD_PATCH_NOTE_HEADING,
  resolveTarget,
  resolveCapability,
  capabilityFor,
  findSection,
  headingLevel,
  headingText,
  appendBulletUnderHeading,
  replaceNamedSection,
  appendNote,
  formatStamp,
  listHeadings,
  applyPatch,
} from '../tools/mdPatch.mjs';

let root;
const QTODO = 'quest-todo.md';
const CTODO = 'continuum-todo.md';
const TODO = 'todo.md';
const PROG = 'progress.md';
const HAND = 'HANDOFF.md';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mdpatch-'));
});
afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

function writeTodo(name, md) {
  writeFileSync(join(root, name), md, 'utf8');
}

const FIXTURE = `# Torii Quest ToDo

Source of truth for Torii Quest tasks.

## Scope

Torii Quest is the game app.

Some prose ending.

## Active tasks

Keep the loop clear.

- gateway
- product

## Milestone 2

Deferred work.
`;

describe('resolveTarget — whitelist + traversal boundary', () => {
  it('accepts both whitelisted basenames', () => {
    expect(resolveTarget(root, QTODO)).toEqual({ ok: true, path: join(root, QTODO) });
    expect(resolveTarget(root, CTODO)).toEqual({ ok: true, path: join(root, CTODO) });
  });
  it('rejects a non-whitelisted file', () => {
    const r = resolveTarget(root, 'NOSTR_ARENA_MASTER_TODO.md');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-whitelisted');
  });
  it('rejects NEXT_ACTION_STATE.json (read-only)', () => {
    const r = resolveTarget(root, 'NEXT_ACTION_STATE.json');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-whitelisted');
  });
  it('rejects absolute paths', () => {
    expect(resolveTarget(root, '/etc/passwd').error).toBe('absolute-path-not-allowed');
    expect(resolveTarget(root, join(root, QTODO)).error).toBe('absolute-path-not-allowed');
  });
  it('rejects path separators and traversal', () => {
    expect(resolveTarget(root, '../quest-todo.md').error).toBe('path-separator-not-allowed');
    expect(resolveTarget(root, 'sub/quest-todo.md').error).toBe('path-separator-not-allowed');
    expect(resolveTarget(root, '..\\quest-todo.md').error).toBe('path-separator-not-allowed');
    expect(resolveTarget(root, './quest-todo.md').error).toBe('path-separator-not-allowed');
  });
  it('rejects empty / non-string inputs without throwing', () => {
    expect(resolveTarget('', QTODO).error).toBe('no-root');
    expect(resolveTarget(root, '').error).toBe('no-file');
    expect(resolveTarget(root, null).error).toBe('no-file');
    expect(resolveTarget(null, QTODO).error).toBe('no-root');
  });
  it('whitelist is frozen and exactly the five editable docs', () => {
    expect(Object.isFrozen(MD_PATCH_WHITELIST)).toBe(true);
    expect([...MD_PATCH_WHITELIST]).toEqual([
      'quest-todo.md',
      'continuum-todo.md',
      'todo.md',
      'progress.md',
      'HANDOFF.md',
    ]);
  });
  it('accepts all five whitelisted basenames', () => {
    for (const f of MD_PATCH_WHITELIST) {
      expect(resolveTarget(root, f)).toEqual({ ok: true, path: join(root, f) });
    }
  });
});

describe('capabilities — per-file action map', () => {
  it('HANDOFF.md is append-only (no replace)', () => {
    expect(capabilityFor(HAND)).toEqual(['append', 'note', 'list']);
    expect(resolveCapability(HAND, 'replace').error).toBe('action-not-permitted');
    expect(resolveCapability(HAND, 'append').ok).toBe(true);
    expect(resolveCapability(HAND, 'note').ok).toBe(true);
    expect(resolveCapability(HAND, 'list').ok).toBe(true);
  });
  it('the todos / todo / progress allow the full action set', () => {
    for (const f of [QTODO, CTODO, TODO, PROG]) {
      expect(capabilityFor(f)).toEqual(['append', 'replace', 'note', 'list']);
      expect(resolveCapability(f, 'replace').ok).toBe(true);
    }
  });
  it('rejects an action for a non-whitelisted file', () => {
    expect(resolveCapability('NOSTR_ARENA_MASTER_TODO.md', 'append').error).toBe('not-whitelisted');
  });
  it('every default note heading is a non-empty string', () => {
    for (const f of MD_PATCH_WHITELIST) {
      const h = MD_PATCH_NOTE_HEADING[f];
      expect(typeof h).toBe('string');
      expect(h.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('heading helpers', () => {
  it('headingLevel / headingText parse ATX headings', () => {
    expect(headingLevel('# A')).toBe(1);
    expect(headingLevel('### Active tasks')).toBe(3);
    expect(headingLevel('not a heading')).toBe(0);
    expect(headingText('### Active tasks')).toBe('Active tasks');
    expect(headingText('## Closed ##')).toBe('Closed');
    expect(headingText('plain')).toBe('');
  });
});

describe('findSection', () => {
  it('finds a section bounded by the next same-or-higher heading', () => {
    const f = findSection(FIXTURE, 'Scope');
    expect(f.ok).toBe(true);
    expect(f.level).toBe(2);
    expect(f.bodyEnd).toBeGreaterThan(f.headingIndex);
  });
  it('the last section runs to EOF', () => {
    const f = findSection(FIXTURE, 'Milestone 2');
    expect(f.ok).toBe(true);
    const lines = FIXTURE.split('\n');
    expect(f.bodyEnd).toBe(lines.length);
  });
  it('returns heading-not-found for an unknown heading', () => {
    expect(findSection(FIXTURE, 'Nope').error).toBe('heading-not-found');
  });
  it('rejects empty / non-string inputs', () => {
    expect(findSection(FIXTURE, '').error).toBe('no-heading');
    expect(findSection(null, 'Scope').error).toBe('no-markdown');
  });
});

describe('appendBulletUnderHeading', () => {
  it('appends to the end of an existing bullet list (contiguous)', () => {
    const r = appendBulletUnderHeading(FIXTURE, 'Active tasks', 'leaderboard');
    expect(r.ok).toBe(true);
    const lines = r.markdown.split('\n');
    // the three bullets should be contiguous under "## Active tasks"
    const i = lines.indexOf('## Active tasks');
    expect(lines[i + 1]).toBe(''); // blank after heading
    expect(lines[i + 2]).toBe('Keep the loop clear.');
    expect(lines[i + 3]).toBe('');
    expect(lines[i + 4]).toBe('- gateway');
    expect(lines[i + 5]).toBe('- product');
    expect(lines[i + 6]).toBe('- leaderboard'); // appended at end of list
  });
  it('inserts a blank line before the bullet when the section ends in prose', () => {
    const r = appendBulletUnderHeading(FIXTURE, 'Scope', 'a third item');
    expect(r.ok).toBe(true);
    const lines = r.markdown.split('\n');
    const i = lines.indexOf('## Scope');
    // body: blank, "Torii Quest is the game app.", blank, "- one","- two", blank(inserted), "- a third item", blank, next heading
    expect(lines).toContain('- a third item');
    const bi = lines.indexOf('- a third item');
    expect(lines[bi - 1]).toBe(''); // blank line inserted before prose→bullet
  });
  it('places the bullet right under the heading for an empty body', () => {
    const md = `# T\n\n## Empty\n\n## Next\n\nx\n`;
    const r = appendBulletUnderHeading(md, 'Empty', 'first');
    expect(r.ok).toBe(true);
    const lines = r.markdown.split('\n');
    const i = lines.indexOf('## Empty');
    expect(lines[i + 1]).toBe('- first');
    expect(lines[i + 2]).toBe(''); // blank before the following heading
    expect(lines[i + 3]).toBe('## Next');
  });
  it('collapses multiline bullets to a single line', () => {
    const r = appendBulletUnderHeading(FIXTURE, 'Active tasks', 'a\nb\nc');
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain('- a b c');
    expect(r.markdown).not.toContain('- a\nb\nc');
  });
  it('rejects empty bullets and unknown headings', () => {
    expect(appendBulletUnderHeading(FIXTURE, 'Active tasks', '   ').error).toBe('empty-bullet');
    expect(appendBulletUnderHeading(FIXTURE, 'Nope', 'x').error).toBe('heading-not-found');
  });
  it('preserves every untouched line byte-for-byte', () => {
    const r = appendBulletUnderHeading(FIXTURE, 'Active tasks', 'new');
    expect(r.ok).toBe(true);
    // removing the inserted bullet line must yield the original exactly
    const without = r.markdown.replace('\n- new\n', '\n');
    expect(without).toBe(FIXTURE);
  });
});

describe('replaceNamedSection', () => {
  it('replaces the body but keeps the heading line', () => {
    const r = replaceNamedSection(FIXTURE, 'Scope', 'NEW BODY\n- only this');
    expect(r.ok).toBe(true);
    const lines = r.markdown.split('\n');
    const i = lines.indexOf('## Scope');
    expect(lines[i]).toBe('## Scope'); // heading preserved
    expect(lines[i + 1]).toBe('NEW BODY');
    expect(lines[i + 2]).toBe('- only this');
    // the next heading is preserved right after the new body
    expect(lines[i + 3]).toBe('## Active tasks');
  });
  it('an empty body collapses the section to just its heading', () => {
    const r = replaceNamedSection(FIXTURE, 'Scope', '');
    expect(r.ok).toBe(true);
    const lines = r.markdown.split('\n');
    const i = lines.indexOf('## Scope');
    expect(lines[i]).toBe('## Scope');
    expect(lines[i + 1]).toBe('## Active tasks');
  });
  it('preserves every untouched line outside the section', () => {
    const r = replaceNamedSection(FIXTURE, 'Scope', 'X');
    expect(r.ok).toBe(true);
    const lines = r.markdown.split('\n');
    const before = lines.slice(0, lines.indexOf('## Scope'));
    const origBefore = FIXTURE.split('\n').slice(0, FIXTURE.split('\n').indexOf('## Scope'));
    expect(before).toEqual(origBefore);
    const afterStart = lines.indexOf('## Active tasks');
    const origAfterStart = FIXTURE.split('\n').indexOf('## Active tasks');
    expect(lines.slice(afterStart)).toEqual(FIXTURE.split('\n').slice(origAfterStart));
  });
  it('unescapes \\n is the CLI job; the pure function takes literal newlines', () => {
    const r = replaceNamedSection(FIXTURE, 'Scope', 'line1\nline2');
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain('line1\nline2');
  });
  it('rejects unknown headings and non-string bodies', () => {
    expect(replaceNamedSection(FIXTURE, 'Nope', 'x').error).toBe('heading-not-found');
    expect(replaceNamedSection(FIXTURE, 'Scope', null).error).toBe('no-body');
  });
});

describe('formatStamp', () => {
  it('formats a Date as "YYYY-MM-DD HH:MM UTC"', () => {
    const d = new Date(Date.UTC(2026, 5, 30, 8, 3));
    expect(formatStamp(d)).toBe('2026-06-30 08:03 UTC');
  });
  it('pads single-digit fields', () => {
    const d = new Date(Date.UTC(2026, 0, 1, 0, 5));
    expect(formatStamp(d)).toBe('2026-01-01 00:05 UTC');
  });
  it('defaults to now when called with no arg', () => {
    const s = formatStamp();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  });
});

describe('appendNote', () => {
  it('appends a timestamped bullet under the named heading', () => {
    const r = appendNote(FIXTURE, 'Active tasks', 'shipped v0.2.259', '2026-06-30 08:03 UTC');
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain('- [2026-06-30 08:03 UTC] shipped v0.2.259');
  });
  it('defaults the stamp to now when omitted', () => {
    const r = appendNote(FIXTURE, 'Active tasks', 'a live note');
    expect(r.ok).toBe(true);
    expect(r.markdown).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\] a live note/);
  });
  it('honours an explicit empty stamp by falling back to now', () => {
    const r = appendNote(FIXTURE, 'Active tasks', 'x', '   ');
    expect(r.ok).toBe(true);
    expect(r.markdown).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\] x/);
  });
  it('collapses multiline note text to one line', () => {
    const r = appendNote(FIXTURE, 'Active tasks', 'a\nb\nc', '2026-06-30 08:03 UTC');
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain('- [2026-06-30 08:03 UTC] a b c');
  });
  it('rejects empty text and unknown headings', () => {
    expect(appendNote(FIXTURE, 'Active tasks', '   ', 's').error).toBe('empty-bullet');
    expect(appendNote(FIXTURE, 'Nope', 'x', 's').error).toBe('heading-not-found');
    expect(appendNote(FIXTURE, '', 'x', 's').error).toBe('no-heading');
    expect(appendNote(null, 'Active tasks', 'x').error).toBe('no-markdown');
  });
  it('preserves every untouched line byte-for-byte', () => {
    const r = appendNote(FIXTURE, 'Active tasks', 'note', '2026-06-30 08:03 UTC');
    expect(r.ok).toBe(true);
    const without = r.markdown.replace('\n- [2026-06-30 08:03 UTC] note\n', '\n');
    expect(without).toBe(FIXTURE);
  });
});

describe('listHeadings', () => {
  it('lists every ATX heading with level and line', () => {
    const hs = listHeadings(FIXTURE);
    expect(hs.map((h) => `${h.level}:${h.text}`)).toEqual([
      '1:Torii Quest ToDo',
      '2:Scope',
      '2:Active tasks',
      '2:Milestone 2',
    ]);
  });
  it('returns [] for non-string input', () => {
    expect(listHeadings(null)).toEqual([]);
  });
});

describe('applyPatch — fs boundary, backup, dry-run', () => {
  beforeEach(() => writeTodo(QTODO, FIXTURE));

  it('writes the edit and creates a .bak backup', () => {
    const r = applyPatch({ root, file: QTODO, action: 'append', heading: 'Active tasks', bullet: 'leaderboard' });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(existsSync(r.bakPath)).toBe(true);
    expect(readFileSync(r.bakPath, 'utf8')).toBe(FIXTURE); // backup == original
    expect(readFileSync(join(root, QTODO), 'utf8')).toContain('- leaderboard');
  });
  it('dry-run writes nothing and previews the result', () => {
    const r = applyPatch({ root, file: QTODO, action: 'append', heading: 'Active tasks', bullet: 'leaderboard', dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.preview).toContain('- leaderboard');
    // file untouched, no backup created
    expect(readFileSync(join(root, QTODO), 'utf8')).toBe(FIXTURE);
    expect(existsSync(join(root, `${QTODO}.bak`))).toBe(false);
  });
  it('no-change when the transform produces identical bytes', () => {
    // replacing Scope body with its exact current body → identical
    const cur = readFileSync(join(root, QTODO), 'utf8');
    const f = findSection(cur, 'Scope');
    const bodyLines = cur.split('\n').slice(f.headingIndex + 1, f.bodyEnd);
    const r = applyPatch({ root, file: QTODO, action: 'replace', section: 'Scope', body: bodyLines.join('\n') });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
  });
  it('refuses to edit a non-whitelisted file even if it exists', () => {
    writeTodo('NOSTR_ARENA_MASTER_TODO.md', '# arena\n');
    const r = applyPatch({ root, file: 'NOSTR_ARENA_MASTER_TODO.md', action: 'append', heading: 'arena', bullet: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-whitelisted');
  });
  it('rejects path traversal at the apply layer', () => {
    const r = applyPatch({ root, file: '../quest-todo.md', action: 'append', heading: 'Scope', bullet: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('path-separator-not-allowed');
  });
  it('does not create a file that does not already exist', () => {
    const r = applyPatch({ root, file: CTODO, action: 'append', heading: 'Scope', bullet: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('file-not-found');
    expect(existsSync(join(root, CTODO))).toBe(false);
  });
  it('rejects a non-permitted action (caught by the capability map)', () => {
    const r = applyPatch({ root, file: QTODO, action: 'nuke', heading: 'Scope', bullet: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('action-not-permitted');
  });
  it('note action writes a timestamped bullet under the heading + backup', () => {
    const r = applyPatch({ root, file: QTODO, action: 'note', heading: 'Active tasks', bullet: 'shipped md pipeline', stamp: '2026-06-30 08:03 UTC' });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(existsSync(r.bakPath)).toBe(true);
    expect(readFileSync(join(root, QTODO), 'utf8')).toContain('- [2026-06-30 08:03 UTC] shipped md pipeline');
  });
  it('note dry-run writes nothing and previews', () => {
    const r = applyPatch({ root, file: QTODO, action: 'note', heading: 'Active tasks', bullet: 'x', stamp: '2026-06-30 08:03 UTC', dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.preview).toContain('- [2026-06-30 08:03 UTC] x');
    expect(readFileSync(join(root, QTODO), 'utf8')).toBe(FIXTURE);
  });
});

describe('applyPatch — HANDOFF.md append-only capability', () => {
  const HAND_FIX = `# Torii Quest — Contributor / Agent Handoff

## 8. Active issues / open edges

- one open edge
`;
  beforeEach(() => writeTodo(HAND, HAND_FIX));

  it('rejects replace on HANDOFF.md (append-only)', () => {
    const r = applyPatch({ root, file: HAND, action: 'replace', section: '8. Active issues / open edges', body: 'NEW' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('action-not-permitted');
    expect(readFileSync(join(root, HAND), 'utf8')).toBe(HAND_FIX); // untouched
  });
  it('allows append + note on HANDOFF.md under the issues heading', () => {
    const a = applyPatch({ root, file: HAND, action: 'append', heading: '8. Active issues / open edges', bullet: 'a second edge' });
    expect(a.ok).toBe(true);
    expect(readFileSync(join(root, HAND), 'utf8')).toContain('- a second edge');
    const n = applyPatch({ root, file: HAND, action: 'note', heading: '8. Active issues / open edges', bullet: 'live note', stamp: '2026-06-30 08:03 UTC' });
    expect(n.ok).toBe(true);
    expect(readFileSync(join(root, HAND), 'utf8')).toContain('- [2026-06-30 08:03 UTC] live note');
  });
});
