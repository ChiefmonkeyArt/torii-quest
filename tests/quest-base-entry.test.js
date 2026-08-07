// tests/quest-base-entry.test.js — emitted deploy-base contracts.
//
// The Suite mounts Torii Quest at `/quest/`. Real production builds lock both
// the versioned entry-import graph and service-worker registration to the
// configured Vite base. A root-relative regression would escape the mount.
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

// Every specifier that targets the pinned entry chunk, from the inline bootstrap
// and from each chunk's back-reference import.
const ENTRY_URL_RE = /['"]([^'"]*torii-entry\.js\?v=[^'"]*)['"]/g;

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

describe('quest-base entry-import — every torii-entry URL carries the /quest/ deploy base', () => {
  it('the inline bootstrap imports the entry under the /quest/ base', () => {
    const urls = collectEntryUrls(questBuild.indexHtml);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^\/quest\/assets\/torii-entry\.js\?v=/);
  });

  it('no dist artifact references the entry at root-relative /assets/', () => {
    const all = [...collectEntryUrls(questBuild.indexHtml), ...questBuild.chunkUrls];
    for (const url of all) {
      expect(url.startsWith('/assets/torii-entry.js')).toBe(false);
      expect(url).toMatch(/^\/quest\/assets\/torii-entry\.js\?v=/);
    }
  });

  it('the arenaRuntime chunk back-references the entry under /quest/', () => {
    expect(questBuild.arenaChunk.length).toBeGreaterThan(0);
    const urls = collectEntryUrls(questBuild.arenaChunk);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    for (const url of urls) expect(url).toMatch(/^\/quest\/assets\/torii-entry\.js\?v=/);
  });

  it('the inline bootstrap and every chunk agree on one entry URL', () => {
    const all = [...collectEntryUrls(questBuild.indexHtml), ...questBuild.chunkUrls];
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all).size).toBe(1);
  });

  it('no static entry script tag survives', () => {
    expect(existsSync(join(QUEST_OUT, 'index.html'))).toBe(true);
    expect(questBuild.indexHtml).not.toMatch(/<script\b[^>]*\bsrc=["'][^"']*\/assets\/torii-entry\.js["']/);
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
