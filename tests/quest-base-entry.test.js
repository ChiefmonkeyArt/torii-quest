// tests/quest-base-entry.test.js — emitted deploy-base contracts.
//
// The Suite mounts Torii Quest at `/quest/`, and the deploy tool
// preview serves the bundle under an arbitrary sub-path (unknown at build
// time). Real production builds therefore emit the entry-import graph as
// RELATIVE specifiers so it resolves correctly at root, `/quest/`, AND any
// preview sub-path — no build-time base knowledge is needed. A root-absolute
// regression (`/assets/torii-entry-<hash>.js`) would 404 under the sub-path
// deploy and ship a dead bundle.
//
// v0.2.791-alpha: the entry is CONTENT-HASHED (`torii-entry-<hash>.js`) and the
// per-build `?v=<timestamp>` query is gone. The inline bootstrap (in index.html,
// depth 0) imports `./assets/torii-entry-<hash>.js`; every chunk back-reference
// (in /assets/, depth 1) imports `./torii-entry-<hash>.js` (peer-relative, emitted
// by the bundler). Both forms resolve to the SAME content-hashed entry filename, so
// the browser fetches one immutable module and a stale cached chunk can only point at
// an old, now-404 entry file — never re-evaluate the fresh entry.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  inlineBootstrapSha256Of,
  inlineBootstrapSourceOf,
} from '../tools/csp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_OUT = join(ROOT, '.tmp-root-base-build');
const QUEST_OUT = join(ROOT, '.tmp-quest-base-build');
const QUEST_BASE = '/quest/';
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

// Every specifier that targets the content-hashed entry chunk, from the inline
// bootstrap and from each chunk's back-reference import.
const ENTRY_URL_RE = /['"]([^'"]*torii-entry-[A-Za-z0-9_-]+\.js)['"]/g;

function collectEntryUrls(text) {
  return [...text.matchAll(ENTRY_URL_RE)].map((m) => m[1]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAtBase(outDir, base = null) {
  rmSync(outDir, { recursive: true, force: true });
  const args = [VITE, 'build', '--outDir', outDir];
  if (base !== null) args.push('--base', base);
  execFileSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'pipe',
  });

  const indexHtml = readFileSync(join(outDir, 'index.html'), 'utf8');
  const serviceWorker = readFileSync(join(outDir, 'sw.js'), 'utf8');
  const headers = readFileSync(join(outDir, '_headers'), 'utf8');
  const chunkUrls = [];
  let arenaChunk = '';
  const assetsDir = join(outDir, 'assets');
  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith('.js')) continue;
    const src = readFileSync(join(assetsDir, file), 'utf8');
    chunkUrls.push(...collectEntryUrls(src));
    if (file.startsWith('arenaRuntime')) arenaChunk = src;
  }
  return { outDir, indexHtml, serviceWorker, headers, chunkUrls, arenaChunk };
}

function expectWorkerRegistration(indexHtml, scriptUrl, scope) {
  const registration = new RegExp(
    `navigator\\.serviceWorker\\.register\\(\\s*['"]${escapeRegExp(scriptUrl)}['"]\\s*,\\s*\\{\\s*scope:\\s*['"]${escapeRegExp(scope)}['"]\\s*,?\\s*\\}\\s*\\)`,
  );
  expect(indexHtml).toMatch(registration);
  expect(indexHtml).not.toContain('%BASE_URL%');
}

function expectScopeRelativePrecache(serviceWorker) {
  const manifest = serviceWorker.match(/const PRECACHE_ASSETS = \[([\s\S]*?)\];/);
  expect(manifest).not.toBeNull();
  const entries = [...manifest[1].matchAll(/^\s*['"]([^'"]+)['"]\s*,?/gm)]
    .map((match) => match[1]);
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => !entry.startsWith('/'))).toBe(true);
  expect(serviceWorker).toContain('new URL(asset, self.registration.scope).href');
}

function scriptSrcTokens(headersBody) {
  const cspLine = headersBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('Content-Security-Policy:'));
  expect(cspLine).toBeDefined();
  const cspValue = cspLine.slice('Content-Security-Policy:'.length).trim();
  const directive = cspValue
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === 'script-src' || part.startsWith('script-src '));
  expect(directive).toBeDefined();
  return directive.split(/\s+/).slice(1);
}

function expectCspMatchesFinalInline(build) {
  const source = inlineBootstrapSourceOf(build.indexHtml);
  const hash = inlineBootstrapSha256Of(build.indexHtml);
  expect(source).toContain('navigator.serviceWorker.register');
  expect(source).toContain("import('");
  expect(source).not.toContain('Instance Settings overlay');
  const tokens = scriptSrcTokens(build.headers);
  expect(tokens).toContain("'self'");
  expect(tokens).not.toContain("'strict-dynamic'");
  expect(tokens).not.toContain('blob:');
  const quotedHashes = tokens.filter((token) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(token));
  expect(quotedHashes).toEqual([`'${hash}'`]);
  expect(tokens).not.toContain(hash);
}

let rootBuild;
let questBuild;

beforeAll(() => {
  rootBuild = buildAtBase(ROOT_OUT);
  questBuild = buildAtBase(QUEST_OUT, QUEST_BASE);
}, 120000);

afterAll(() => {
  rmSync(ROOT_OUT, { recursive: true, force: true });
  rmSync(QUEST_OUT, { recursive: true, force: true });
});

describe('quest-base entry-import — every torii-entry URL is relative + content-hashed (root, /quest/, and arbitrary sub-path safe)', () => {
  it('the inline bootstrap imports the entry via a relative ./assets/ path', () => {
    const urls = collectEntryUrls(questBuild.indexHtml);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^\.\/assets\/torii-entry-[A-Za-z0-9_-]+\.js$/);
    // No root-absolute regression: the inline bootstrap must NOT point at
    // '/assets/...' (404s under a sub-path deploy) NOR carry a deploy base
    // prefix like '/quest/assets/...' (also 404s under a different sub-path).
    expect(urls[0].startsWith('/')).toBe(false);
  });

  it('no dist artifact references the entry at a root-absolute /assets/ path', () => {
    const all = [...collectEntryUrls(questBuild.indexHtml), ...questBuild.chunkUrls];
    expect(all.length).toBeGreaterThan(0);
    for (const url of all) {
      // Relative form only — never root-absolute '/...' (404s under sub-path)
      // nor base-prefixed '/quest/...' (404s under a different sub-path). Rolldown
      // emits three valid relative forms: './assets/…' (inline bootstrap), './…'
      // (chunk peer back-reference), and bare 'assets/…' (the runtime chunk registry).
      expect(url.startsWith('/')).toBe(false);
      expect(url).toMatch(/^(\.\/)?(assets\/)?torii-entry-[A-Za-z0-9_-]+\.js$/);
    }
  });

  it('the arenaRuntime chunk back-references the entry via a relative ./torii-entry path', () => {
    expect(questBuild.arenaChunk.length).toBeGreaterThan(0);
    const urls = collectEntryUrls(questBuild.arenaChunk);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    for (const url of urls) {
      // Chunks live in /assets/, so the peer-relative form is './torii-entry-<hash>.js'.
      expect(url).toMatch(/^\.\/torii-entry-[A-Za-z0-9_-]+\.js$/);
      expect(url.startsWith('/')).toBe(false);
    }
  });

  it('the inline bootstrap and every chunk share ONE content-hashed entry filename', () => {
    const htmlUrls = collectEntryUrls(questBuild.indexHtml);
    const chunkUrls = questBuild.chunkUrls;
    const all = [...htmlUrls, ...chunkUrls];
    expect(all.length).toBeGreaterThanOrEqual(2);
    // The HTML ('./assets/torii-entry-<hash>.js') and chunk ('./torii-entry-<hash>.js')
    // forms are intentionally DIFFERENT strings (different depth) but MUST share the
    // same content-hashed basename so the browser fetches one immutable entry module.
    const baseNames = new Set(all.map((url) => url.split('/').pop()));
    expect(baseNames.size).toBe(1);
    // Every specifier targets the same content-hashed entry filename.
    for (const url of all) {
      expect(url).toMatch(/torii-entry-[A-Za-z0-9_-]+\.js$/);
    }
  });

  it('no static entry script tag survives', () => {
    expect(existsSync(join(QUEST_OUT, 'index.html'))).toBe(true);
    expect(questBuild.indexHtml).not.toMatch(/<script\b[^>]*\bsrc=["'][^"']*torii-entry-[A-Za-z0-9_-]+\.js["']/);
  });
});

describe('service-worker deploy-base emitted artifacts', () => {
  it('the default build registers /sw.js with root scope', () => {
    expectWorkerRegistration(rootBuild.indexHtml, '/sw.js', '/');
  });

  it('the /quest/ build registers /quest/sw.js with matching scope', () => {
    expectWorkerRegistration(questBuild.indexHtml, '/quest/sw.js', '/quest/');
    expect(questBuild.indexHtml).not.toMatch(/serviceWorker\.register\(\s*['"]\/sw\.js['"]/);
  });

  it('precache entries remain relative and resolve from registration scope', () => {
    expectScopeRelativePrecache(rootBuild.serviceWorker);
    expectScopeRelativePrecache(questBuild.serviceWorker);
  });

  it('each build emits a CSP hash matching its final inline bootstrap', () => {
    expectCspMatchesFinalInline(rootBuild);
    expectCspMatchesFinalInline(questBuild);
  });
});
