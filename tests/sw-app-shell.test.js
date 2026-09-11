// tests/sw-app-shell.test.js — entry-flow regression guard (v0.2.226).
//
// The login / ENTER ARENA buttons went inert in the field because a returning player was
// controlled by a service worker that had PRECACHED the HTML app shell ('/'). The shell
// pins a content-hashed `/assets/index-<hash>.js` bundle; after a redeploy mints a new
// hash, the stale precached shell points at a 404'd bundle, the bundle never executes,
// and the title screen renders (static HTML) while every button's click handler — which
// lives in the dead bundle — does nothing.
//
// This suite freezes the fix as a contract (pure file reads, no fs mutation / network):
//   - the SW must NOT precache the HTML shell ('/' or any .html);
//   - the SW cache name must track the app VERSION (so the activate purge can evict it);
//   - HTML/JS must be served network-first (only binary assets are cache-first);
//   - index.html must register the SW with a loop-guarded controllerchange→reload so an
//     already-stranded client auto-heals when the fresh version-named SW claims the page;
//   - the fallback CSP sha256 must match the default-root inline bootstrap after
//     Vite resolves %BASE_URL% and the fallback entry import is appended. Real builds
//     recompute their own hash from emitted HTML, including path-prefixed deployments.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { VERSION } from '../src/config.js';
import {
  CSP_VALUE,
  INLINE_SCRIPT_SHA256,
  ENTRY_IMPORT_LINE,
  cspValueForSha,
  inlineBootstrapSourceOf,
} from '../tools/csp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');

// Extract the PRECACHE_ASSETS array literal contents.
function precacheList() {
  const m = SW.match(/PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  return (m[1].match(/'([^']+)'|"([^"]+)"/g) || []).map((s) => s.replace(/['"]/g, ''));
}

// The browser-executed text of the one real attribute-less inline bootstrap.
function inlineRegistrationScript() {
  return inlineBootstrapSourceOf(HTML);
}

function scriptSrcTokens(cspValue) {
  const directive = cspValue
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === 'script-src' || part.startsWith('script-src '));
  expect(directive).toBeDefined();
  return directive.split(/\s+/).slice(1);
}

function expectSingleQuotedHashSource(cspValue, expectedHash) {
  const tokens = scriptSrcTokens(cspValue);
  const quotedHashes = tokens.filter((token) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(token));
  expect(quotedHashes).toEqual([`'${expectedHash}'`]);
  expect(tokens.some((token) => /^sha256-[A-Za-z0-9+/]+=*$/.test(token))).toBe(false);
}

function expectSameOriginModuleGraphPolicy(cspValue) {
  const tokens = scriptSrcTokens(cspValue);
  expect(tokens).toContain("'self'");
  expect(tokens).not.toContain("'strict-dynamic'");
  expect(tokens).not.toContain('blob:');
}

function expectWorkerBlobPolicy(cspValue) {
  const directive = cspValue
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === 'worker-src' || part.startsWith('worker-src '));
  expect(directive).toBeDefined();
  const tokens = directive.split(/\s+/).slice(1);
  expect(tokens).toContain("'self'");
  expect(tokens).toContain('blob:');
}

describe('service worker — app-shell precache guard (entry-flow regression)', () => {
  it('does NOT precache the HTML app shell', () => {
    const list = precacheList();
    expect(list).not.toBeNull();
    expect(list).not.toContain('/');
    expect(list).not.toContain('/index.html');
    expect(list).not.toContain('index.html');
  });

  it('precaches only immutable binary assets (no .html / .js / .css)', () => {
    const list = precacheList();
    for (const url of list) {
      expect(/\.(glb|webp|jpg|jpeg|png|woff2|wasm)$/i.test(url)).toBe(true);
    }
  });

  it('cache name tracks the app VERSION so activate can purge the old one', () => {
    const m = SW.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(m[1]).toContain(VERSION);
  });

  it('treats HTML and JS as non-static (so they go network-first)', () => {
    // isStaticAsset must be cache-first ONLY for binary assets, never HTML/JS/CSS.
    const m = SW.match(/function isStaticAsset\(path\)\s*\{([\s\S]*?)\}/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).not.toMatch(/\.html/);
    expect(body).not.toMatch(/\.js'/);
    expect(body).not.toMatch(/\.css/);
  });

  it('only intercepts GET requests — non-GET passes straight to network (ADR-0062)', () => {
    // The Cache API's put() rejects POST/PUT/DELETE with TypeError: Request
    // method 'POST' is unsupported. The fetch handler must guard on method
    // BEFORE calling respondWith(networkFirst(...)) so same-origin POSTs
    // (kami auto-capture /mp/kami/autocap, session auth /mp/session, admin
    // update checks) never reach cache.put().
    const m = SW.match(/addEventListener\('fetch',\s*event\s*=>\s*\{([\s\S]*?)\n\}\);/);
    expect(m).not.toBeNull();
    const handler = m[1];
    expect(handler).toMatch(/event\.request\.method\s*!==\s*['"]GET['"]/);
    // The guard must appear BEFORE any respondWith call inside the handler.
    const guardIdx = handler.search(/event\.request\.method\s*!==\s*['"]GET['"]/);
    const respondWithIdx = handler.search(/respondWith/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(respondWithIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(respondWithIdx);
  });
});
describe('index.html — service-worker registration self-heal', () => {
  it('registers the service worker', () => {
    const s = inlineRegistrationScript();
    expect(s).not.toBeNull();
    expect(s).toMatch(
      /serviceWorker\.register\(\s*['"]%BASE_URL%sw\.js['"]\s*,\s*\{\s*scope:\s*['"]%BASE_URL%['"]\s*,?\s*\}\s*\)/,
    );
  });

  it('reloads once on controllerchange, guarded against a reload loop', () => {
    const s = inlineRegistrationScript();
    expect(s).toMatch(/addEventListener\(\s*['"]controllerchange['"]/);
    expect(s).toMatch(/location\.reload\(\)/);
    // A guard flag must short-circuit a second reload.
    expect(s).toMatch(/if\s*\(\s*reloading\s*\)\s*return/);
  });

  it('never auto-reloads once the game has actually entered (double-mount guard)', () => {
    // v0.2.777-alpha (Bug K): the double-mount guard now keys on window.__toriiEntered
    // (set only when the arena is truly live), NOT __toriiEnterReady (set as soon as
    // buttons are wired). This lets a title-screen visitor with wired-but-stranded
    // buttons still auto-heal, while a live 3D runtime is never yanked (ADR-0106).
    const s = inlineRegistrationScript();
    expect(s).toMatch(/if\s*\(\s*window\.__toriiEntered\s*\)\s*return/);
    const enteredIdx = s.search(/window\.__toriiEntered\s*\)\s*return/);
    const reloadIdx = s.indexOf('location.reload()');
    expect(enteredIdx).toBeGreaterThan(-1);
    expect(reloadIdx).toBeGreaterThan(-1);
    expect(enteredIdx).toBeLessThan(reloadIdx);
  });

  it('CSP fallback sha256 matches the real default-root inline bootstrap', () => {
    // Shipped builds recompute the hash from final emitted HTML. This constant is the
    // root-deploy fallback used before an emitted dist/index.html is available.
    // The decoy freezes the browser-found regression: comment prose containing a
    // literal script tag must never be selected as executable source.
    const decoy = '<!-- decoy <script>not executable</script> -->\n'
      + '<script>\ntrusted();\n</script>';
    expect(inlineBootstrapSourceOf(decoy)).toBe('\ntrusted();\n');

    const s = inlineRegistrationScript();
    const rootFallback = s.replaceAll('%BASE_URL%', '/') + ENTRY_IMPORT_LINE + '\n';
    const hash = 'sha256-' + createHash('sha256')
      .update(rootFallback, 'utf8')
      .digest('base64');
    expect(hash).toBe(INLINE_SCRIPT_SHA256);
    expectSingleQuotedHashSource(CSP_VALUE, INLINE_SCRIPT_SHA256);
    expectSameOriginModuleGraphPolicy(CSP_VALUE);
    expectWorkerBlobPolicy(CSP_VALUE);

    const suppliedHash = 'sha256-' + createHash('sha256')
      .update('dynamic-csp-hash-source-test', 'utf8')
      .digest('base64');
    expect(suppliedHash).not.toBe(INLINE_SCRIPT_SHA256);
    const dynamicCsp = cspValueForSha(suppliedHash);
    expectSingleQuotedHashSource(dynamicCsp, suppliedHash);
    expectSameOriginModuleGraphPolicy(dynamicCsp);
    expectWorkerBlobPolicy(dynamicCsp);
  });
});

describe('service worker — F05 cache boundaries (no private response is stored)', () => {
  it('never intercepts API/status/admin /mp traffic or credentialed GETs', () => {
    // F05: the Cache API keys by URL+method only. The /mp mount and any request
    // carrying an Authorization header must pass straight to the network, before
    // any respondWith(cacheFirst/networkFirst) call can store the response.
    const m = SW.match(/addEventListener\('fetch',\s*event\s*=>\s*\{([\s\S]*?)\n\}\);/);
    expect(m).not.toBeNull();
    const handler = m[1];
    expect(handler).toMatch(/path\s*===\s*'\/mp'\s*\|\|\s*path\.startsWith\('\/mp\/'\)/);
    expect(handler).toMatch(/Authorization/);
    // The /mp bypass must appear before the first respondWith call.
    const mpIdx = handler.search(/startsWith\('\/mp\/'\)/);
    const respondIdx = handler.search(/respondWith/);
    expect(mpIdx).toBeGreaterThan(-1);
    expect(respondIdx).toBeGreaterThan(-1);
    expect(mpIdx).toBeLessThan(respondIdx);
  });

  it('rejects no-store/private/Vary responses before any cache.put', () => {
    const m = SW.match(/function _canCacheResponse\(response\)\s*\{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/no-store/);
    expect(body).toMatch(/private/);
    expect(body).toMatch(/Vary/);
    // Both store helpers must gate cache.put on _canCacheResponse.
    expect(SW).toMatch(/if\s*\(\s*_canCacheResponse\(response\)\s*\)\s*\{/);
  });
});

describe('index.html + main.js — F07 recovery is scoped to Quest', () => {
  it('purges only the torii-quest- cache namespace, not sibling-app caches', () => {
    const inventory = [HTML, MAIN];
    for (const src of inventory) {
      expect(src).toMatch(/torii-quest-/);
      // The delete must be gated by a filter on the torii-quest- namespace, not a
      // bare keys().map(delete) that would also drop sibling-app caches.
      expect(src).toMatch(/filter[\s\S]{0,80}torii-quest-/);
    }
  });

  it('unregisters only Quest\'s own registration scope', () => {
    // Both self-heal paths must filter registrations by Quest's scope and never
    // blanket-unregister every same-origin registration.
    expect(HTML).toMatch(/r\.scope\s*===\s*questScope/);
    expect(MAIN).toMatch(/r\.scope\s*===\s*questScope/);
  });

  it('the module recovery path keeps the persistent ?nuked=1 loop guard', () => {
    // F07: src/main.js _selfHealStaleShellAndReload must early-return once the
    // ?nuked=1 URL pin is present (the inline path always had it).
    expect(MAIN).toMatch(/\[\?&\]nuked=1/);
    expect(MAIN).toMatch(/if\s*\(\s*\/\[\?&\]nuked=1/);
  });

  it('the version-mismatch handler never disrupts an active arena session', () => {
    // F07: the TORII_SW_VERSION mismatch branch must respect window.__toriiEntered
    // (the same guard controllerchange uses) rather than self-heal mid-game.
    const s = inlineRegistrationScript();
    const msgIdx = s.indexOf("type !== 'TORII_SW_VERSION'");
    const enteredIdx = s.indexOf('window.__toriiEntered) return', msgIdx);
    expect(msgIdx).toBeGreaterThan(-1);
    expect(enteredIdx).toBeGreaterThan(-1);
    expect(enteredIdx).toBeGreaterThan(msgIdx);
  });
});
