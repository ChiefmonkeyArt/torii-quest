// v0.2.775-alpha (Bug H) regression — the double-boot guard's fatal throw was
// leaking into the ENTER-ARENA catch as a user-hostile "Arena failed to load —
// torii-boot: duplicate module invocation suppressed" message. Root cause: the
// arenaRuntime lazy chunk statically imports back into torii-entry (rolldown's
// cross-chunk share pattern), so under stale-SW cache duality a mismatched
// `?v=` stamp re-evaluates the entire main.js top-level on ENTER click.
//
// This fixture regression-tests three things without executing main.js's top-
// level (it has too many browser-only side effects to run under Node): the
// SOURCE contains the tagged error code + graceful catch + self-heal helper.
// If someone reverts to the plain throw or drops the catch's dupe-boot branch,
// these tests fail. Real end-to-end validation happens live via the WS-HELLO
// check + the manual click test the user runs after each deploy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = readFileSync(join(__dirname, '..', 'src', 'main.js'), 'utf8');

describe('v0.2.775-alpha — Bug H: tagged duplicate-boot error + ENTER catch self-heal', () => {
  describe('double-boot guard tags its thrown error', () => {
    it('still throws on duplicate module invocation (single-boot invariant preserved)', () => {
      // The guard's throw block must still exist — softening it to a silent
      // early-return would reintroduce the strobing / double-mount regression
      // the guard was originally introduced (v0.2.773) to prevent.
      expect(MAIN_JS).toMatch(/if \(window\.__toriiBooted\)/);
      expect(MAIN_JS).toMatch(/throw _dupErr/);
    });

    it('sets Error.code = "TORII_DUPLICATE_BOOT" on the thrown error', () => {
      // The stable code lets the ENTER catch recognize the dupe-boot signature
      // without brittle message parsing. Guarded here so someone can't quietly
      // drop the code assignment and reintroduce the user-hostile surface.
      expect(MAIN_JS).toMatch(/_dupErr\.code\s*=\s*['"]TORII_DUPLICATE_BOOT['"]/);
    });

    it('keeps the human-readable message text stable for legacy log grep', () => {
      // ADR-0107 references this exact string; several test suites and the ops
      // playbook grep for it in browser console captures.
      expect(MAIN_JS).toMatch(/torii-boot: duplicate module invocation suppressed/);
    });
  });

  describe('ENTER-ARENA catch recognizes duplicate-boot and self-heals', () => {
    it('detects the duplicate-boot error by code + message fallback', () => {
      // Belt-and-braces: match on .code (fast, exact) OR on the message regex
      // (recovers if the error was re-thrown and stripped of custom props by
      // an intermediate frame).
      expect(MAIN_JS).toMatch(/e\.code\s*===\s*['"]TORII_DUPLICATE_BOOT['"]/);
      expect(MAIN_JS).toMatch(/torii-boot: duplicate module invocation/);
    });

    it('shows a graceful "stale build" toast instead of "Arena failed to load"', () => {
      // The user-facing regression symptom was the raw "Arena failed to load —
      // torii-boot: duplicate module invocation suppressed" message. Swap it
      // for a self-describing recovery message.
      expect(MAIN_JS).toMatch(/Stale build detected/i);
    });

    it('invokes the self-heal helper before re-throwing', () => {
      // The re-throw preserves upstream error handling; the self-heal wipes SW
      // + caches + reloads with `?nuked=1` so the next click lands on a fresh
      // chunk pair.
      expect(MAIN_JS).toMatch(/_selfHealStaleShellAndReload\(\)/);
    });
  });

  describe('_selfHealStaleShellAndReload helper', () => {
    it('is defined at module top level (dependency-free, callable from catch)', () => {
      expect(MAIN_JS).toMatch(/function _selfHealStaleShellAndReload\(\)/);
    });

    it('is idempotent per document via window.__toriiNuking flag', () => {
      // A second dupe-boot in the same document must not fire two overlapping
      // reload paths. The flag both blocks re-entry and lets tests + console
      // observe whether the self-heal was triggered.
      expect(MAIN_JS).toMatch(/window\.__toriiNuking/);
    });

    it('unregisters all service workers before reload', () => {
      expect(MAIN_JS).toMatch(/getRegistrations\(\)/);
      expect(MAIN_JS).toMatch(/unregister\(\)/);
    });

    it('purges the Cache Storage before reload', () => {
      expect(MAIN_JS).toMatch(/caches\.keys\(\)/);
      expect(MAIN_JS).toMatch(/caches\.delete/);
    });

    it('pins ?nuked=1 into the reload URL so the self-heal cannot loop', () => {
      // The inline-shell self-heal in index.html uses the same convention;
      // matching sentinel lets both paths observe each other.
      expect(MAIN_JS).toMatch(/nuked=1/);
    });

    it('uses location.replace so the pre-reload URL is not left in history', () => {
      expect(MAIN_JS).toMatch(/location\.replace/);
    });
  });
});
