// tests/md-patch.resolve.test.js — split from md-patch.test.js (E3, v0.2.267).
// Slice: resolveTarget whitelist + traversal boundary, and the per-file capability map.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MD_PATCH_WHITELIST,
  MD_PATCH_NOTE_HEADING,
  resolveTarget,
  resolveCapability,
  capabilityFor,
} from '../tools/mdPatch.mjs';
import { QTODO, CTODO, TODO, PROG, HAND } from './_md-patch-helpers.js';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mdpatch-'));
});
afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

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
    expect(resolveTarget(root, '../torii-quest-todo.md').error).toBe('path-separator-not-allowed');
    expect(resolveTarget(root, 'sub/torii-quest-todo.md').error).toBe('path-separator-not-allowed');
    expect(resolveTarget(root, '..\\torii-quest-todo.md').error).toBe('path-separator-not-allowed');
    expect(resolveTarget(root, './torii-quest-todo.md').error).toBe('path-separator-not-allowed');
  });
  it('rejects empty / non-string inputs without throwing', () => {
    expect(resolveTarget('', QTODO).error).toBe('no-root');
    expect(resolveTarget(root, '').error).toBe('no-file');
    expect(resolveTarget(root, null).error).toBe('no-file');
    expect(resolveTarget(null, QTODO).error).toBe('no-root');
  });
  it('whitelist is frozen and exactly the four editable docs', () => {
    expect(Object.isFrozen(MD_PATCH_WHITELIST)).toBe(true);
    expect([...MD_PATCH_WHITELIST]).toEqual([
      'torii-quest-todo.md',
      'torii-continuum-todo.md',
      'torii-quest-progress.md',
      'torii-quest-handoff.md',
    ]);
  });
  it('accepts all four whitelisted basenames', () => {
    for (const f of MD_PATCH_WHITELIST) {
      expect(resolveTarget(root, f)).toEqual({ ok: true, path: join(root, f) });
    }
  });
});

describe('capabilities — per-file action map', () => {
  it('torii-quest-handoff.md is append-only (no replace)', () => {
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
