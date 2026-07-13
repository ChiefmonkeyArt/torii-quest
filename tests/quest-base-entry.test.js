// tests/quest-base-entry.test.js — deploy-base entry-import contract (v0.2.370-alpha).
//
// Freezes the v0.2.370-alpha production regression: on the Torii Suite the app is
// mounted at a subpath (`/quest/`) and built with `vite build --base=/quest/`. The
// vite CSP plugin pins the entry chunk and rewrites BOTH the inline bootstrap import
// and every chunk's back-reference import of the entry to one versioned URL. Before
// this fix those URLs were HARDCODED root-relative (`/assets/torii-entry.js?v=<stamp>`),
// dropping the `/quest/` base. Under the mount that URL 404s — and because
// arenaRuntime.js statically imports the entry, the ENTER ARENA
// `import('./arenaRuntime.js')` graph load REJECTED and the arena never booted (live
// symptom: click ENTER ARENA → session hangs / never renders a frame).
//
// This is a real `--base=/quest/` build into a throwaway outDir, asserting every
// entry-import URL carries the deploy base. A root-relative regression fails here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp-quest-base-build');
const BASE = '/quest/';
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

// Every specifier that targets the pinned entry chunk, from the inline bootstrap
// `import('…torii-entry.js?v=…')` and from each chunk's `from"…torii-entry.js?v=…"`.
const ENTRY_URL_RE = /['"]([^'"]*torii-entry\.js\?v=[^'"]*)['"]/g;

function collectEntryUrls(text) {
  return [...text.matchAll(ENTRY_URL_RE)].map((m) => m[1]);
}

let indexHtml = '';
let chunkUrls = [];
let arenaChunk = '';

beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  // Real production build at the Suite mount base. --outDir inside ROOT so vite
  // won't prompt about emptying a dir outside the project.
  execFileSync('node', [VITE, 'build', '--base', BASE, '--outDir', OUT], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  indexHtml = readFileSync(join(OUT, 'index.html'), 'utf8');
  const assetsDir = join(OUT, 'assets');
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(assetsDir, f), 'utf8');
    chunkUrls.push(...collectEntryUrls(src));
    if (f.startsWith('arenaRuntime')) arenaChunk = src;
  }
}, 60000);

afterAll(() => {
  rmSync(OUT, { recursive: true, force: true });
});

describe('quest-base entry-import — every torii-entry URL carries the /quest/ deploy base (v0.2.370)', () => {
  it('the inline bootstrap imports the entry under the /quest/ base (not root-relative)', () => {
    const urls = collectEntryUrls(indexHtml);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^\/quest\/assets\/torii-entry\.js\?v=/);
  });

  it('no dist artifact references the entry at the root-relative /assets/ path (the 404 bug)', () => {
    const all = [...collectEntryUrls(indexHtml), ...chunkUrls];
    for (const u of all) {
      expect(u.startsWith('/assets/torii-entry.js')).toBe(false);
      expect(u).toMatch(/^\/quest\/assets\/torii-entry\.js\?v=/);
    }
  });

  it('the arenaRuntime chunk (ENTER ARENA graph) back-references the entry under /quest/', () => {
    // arenaRuntime is the module the ENTER handler dynamically imports; its static
    // entry import is what 404'd under the mount and rejected the whole graph load.
    expect(arenaChunk.length).toBeGreaterThan(0);
    const urls = collectEntryUrls(arenaChunk);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    for (const u of urls) expect(u).toMatch(/^\/quest\/assets\/torii-entry\.js\?v=/);
  });

  it('the inline bootstrap and every chunk agree on ONE identical entry URL (single module instance)', () => {
    // A mismatch would make the browser fetch two module instances for the same
    // entry — the v0.2.285 "does not provide export" class of bug — as well as the
    // base regression. All references must be byte-identical.
    const all = [...collectEntryUrls(indexHtml), ...chunkUrls];
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all).size).toBe(1);
  });

  it('no static entry <script> tag survives (strict-dynamic loads it via the trusted inline import)', () => {
    expect(existsSync(join(OUT, 'index.html'))).toBe(true);
    expect(indexHtml).not.toMatch(/<script\b[^>]*\bsrc=["'][^"']*\/assets\/torii-entry\.js["']/);
  });
});
