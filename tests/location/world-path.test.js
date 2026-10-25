// v0.2.933 (ADR-0147 M3) — world links: <app root>w/<npub>/<world>.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appRootOf, parseWorldPath, worldPathFor, appUrlOf, NPUB_RE } from '../../src/engine/location/worldPath.js';
import { hexToNpub, npubToHex } from '../../src/engine/crypto/npub.js';

const HEX = 'ec79b568bdea63ca6091f5b84b0c639c10a0919e175fa09a4de3154f82906f25';
const NPUB = 'npub1a3um269aaf3u5cy37kuykrrrnsg2pyv7za06pxjduv25lq5sdujs2qmdj6';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('hexToNpub (BIP-173 encode)', () => {
  it('encodes the host key and round-trips', () => {
    expect(hexToNpub(HEX)).toBe(NPUB);
    expect(hexToNpub(HEX.toUpperCase())).toBe(NPUB);
    expect(npubToHex(hexToNpub('00'.repeat(32)))).toBe('00'.repeat(32));
    expect(npubToHex(hexToNpub('ff'.repeat(32)))).toBe('ff'.repeat(32));
    expect(NPUB_RE.test(hexToNpub('ab'.repeat(32)))).toBe(true);
  });
  it('rejects non-hex64', () => {
    for (const v of [null, '', 'xyz', 'ab'.repeat(31), 'g'.repeat(64), 42]) expect(hexToNpub(v)).toBeNull();
  });
});

describe('appRootOf / parseWorldPath', () => {
  it('the root is the path before /w/npub1, else the directory', () => {
    expect(appRootOf('/quest/')).toBe('/quest/');
    expect(appRootOf('/quest/index.html')).toBe('/quest/');
    expect(appRootOf('/')).toBe('/');
    expect(appRootOf(`/quest/w/${NPUB}/home`)).toBe('/quest/');
    expect(appRootOf(`/w/${NPUB}`)).toBe('/');
    expect(appRootOf('/a/w/notalink/x')).toBe('/a/w/notalink/'); // `/w/` alone is no marker
    expect(appRootOf(undefined)).toBe('/');
  });
  it('parses npub + optional world', () => {
    expect(parseWorldPath('/quest/')).toEqual({ root: '/quest/', link: null });
    expect(parseWorldPath(`/quest/w/${NPUB}/torii-quest`)).toEqual({ root: '/quest/', link: { npub: NPUB, world: 'torii-quest' } });
    expect(parseWorldPath(`/quest/w/${NPUB}`)).toEqual({ root: '/quest/', link: { npub: NPUB, world: null } });
    expect(parseWorldPath(`/quest/w/${NPUB}/`).link).toEqual({ npub: NPUB, world: null });
  });
  it('fails closed on bad npub / world / shape / encoding', () => {
    expect(parseWorldPath(`/quest/w/${NPUB.slice(0, -1)}/home`).error).toBe('bad-npub');
    expect(parseWorldPath(`/quest/w/${NPUB}/Home`).error).toBe('bad-world');
    expect(parseWorldPath(`/quest/w/${NPUB}/%3Cscript%3E`).error).toBe('bad-world');
    expect(parseWorldPath(`/quest/w/${NPUB}/..`).error).toBe('bad-world');
    expect(parseWorldPath(`/quest/w/${NPUB}/a/b`).error).toBe('bad-shape');
    expect(parseWorldPath(`/quest/w/${NPUB}/%E0%A4%A`).error).toBe('bad-encoding');
    for (const p of [`/quest/w/${NPUB.slice(0, -1)}/home`, `/quest/w/${NPUB}/a/b`]) expect(parseWorldPath(p).link).toBeNull();
  });
});

describe('worldPathFor / appUrlOf', () => {
  it('builds validated paths only', () => {
    expect(worldPathFor('/quest/', NPUB, 'torii-quest')).toBe(`/quest/w/${NPUB}/torii-quest`);
    expect(worldPathFor('/quest', NPUB)).toBe(`/quest/w/${NPUB}`);
    expect(worldPathFor('/quest/', 'npub1bad', 'x')).toBeNull();
    expect(worldPathFor('/quest/', NPUB, '../x')).toBeNull();
    expect(worldPathFor('javascript:', NPUB, 'x')).toBe(`/w/${NPUB}/x`);
    const p = worldPathFor('/quest/', NPUB, 'w1');
    expect(parseWorldPath(p).link).toEqual({ npub: NPUB, world: 'w1' });
  });
  it('appUrlOf never returns a world path', () => {
    expect(appUrlOf({ origin: 'https://x.art', pathname: `/quest/w/${NPUB}/home` })).toBe('https://x.art/quest/');
    expect(appUrlOf({ origin: 'https://x.art', pathname: '/quest/' })).toBe('https://x.art/quest/');
    expect(appUrlOf(null)).toBe('/');
  });
});

describe('wiring', () => {
  const html = read('index.html');
  const vite = read('vite.config.js');
  const main = read('src/main.js');
  const rt = read('src/arenaRuntime.js');
  it('the shell resolves the entry bundle + icons from the app root', () => {
    expect(html).toMatch(/window\.__toriiAppRoot = \(function \(\) \{/);
    expect(html).toMatch(/p\.search\(\/\\\/w\\\/npub1\/\)/);
    expect(html).toMatch(/querySelectorAll\('link\[href\^="\.\/"\]'\)/);
    expect(vite).toMatch(/import\(\(window\.__toriiAppRoot \|\| '\.\/'\) \+ '\$\{entryFileName\}'\)/);
  });
  it('published URLs are the app url, never the current link', () => {
    expect(main).not.toMatch(/window\.location\.origin \+ window\.location\.pathname/);
    expect(main.match(/appUrlOf\(window\.location\)/g).length).toBeGreaterThanOrEqual(3);
    expect(read('src/engine/gateway/handshakeController.js')).toMatch(/extra\.spawn \|\| appUrlOf\(window\.location\)/);
  });
  it('the address bar follows travel; back/forward replays; a link only pre-peeks', () => {
    expect(main).toMatch(/onLocation: \(loc\) => _onArenaLocation\(loc\),/);
    expect(main).toMatch(/history\.pushState\(st, '', target \+ window\.location\.search\)/);
    expect(main).toMatch(/if \(_fromPopstate \|\| typeof history === 'undefined' \|\| !loc\) return;/);
    expect(main).toMatch(/window\.addEventListener\('popstate', \(\) => \{ void _onPopstate\(\); \}\)/);
    expect(main).toMatch(/if \(!link\) \{ if \(_arena\.returnHome\) await _arena\.returnHome\(\); return; \}/);
    expect(main).toMatch(/window\.__toriiEntered = true;\n\s*_openInitialLink\(\);/);
    const open = main.slice(main.indexOf('function _openInitialLink('), main.indexOf('async function _onPopstate()'));
    expect(open).toMatch(/_initialLink = null;/);
    expect(open).toMatch(/_gwBrowseWorld\(row\)/); // pre-peek: the player still presses 入
    expect(open).toMatch(/if \(!isPlaying\(\)\) \{ if \(tries < 3600\) requestAnimationFrame/); // waits for play, bounded
    expect(open).not.toMatch(/setTimeout/);
    expect(open).toMatch(/if \(\/\^\[0-9a-f\]\{64\}\$\/\.test\(state\.nostrPubkey \|\| ''\)\) _gwBrowseWorld\(row\);/); // guests never get an armed 入
    expect(open).not.toMatch(/travelToWorld|commitPeek/);
    expect(main).toMatch(/worldId: world\.worldId \|\| undefined,/);
    // Back/Forward reuses worlds resolved this session (bounded LRU, world id checked).
    expect(main).toMatch(/if \(_linkWorlds\.size > 32\) _linkWorlds\.delete/);
    expect(main).toMatch(/\(hit && \(!world\.worldId \|\| hit\.id === world\.worldId\)\)/);
    expect(main).toMatch(/if \(npub\) _rememberLinkWorld\(npub, resolved\.world\);/);
    // Back/Forward to a world stays gate-only (v0.2.867): reopen the gate, never travel directly.
    const pop = main.slice(main.indexOf('async function _onPopstate()'), main.indexOf("window.addEventListener('popstate'"));
    expect(pop).toMatch(/_gwBrowseWorld\(row\)/);
    expect(pop).not.toMatch(/travelToWorld/);
    expect(main).toMatch(/peekWorld\(resolved\.world, \{ wsEndpoint: world\.wsEndpoint, ownerLabel, npub \}\)/);
  });
  it('the runtime reports location and can return home mid-game', () => {
    expect(rt).toMatch(/const _onLocation = \(loc\) => \{ try \{ if \(typeof hooks\.onLocation === 'function'\) hooks\.onLocation\(loc\);/);
    expect(rt).toMatch(/if \(result && result\.ok && npub\) _onLocation\(\{ home: false, npub, worldId: world\.id \|\| null \}\);/);
    expect(rt).toMatch(/_mp\.setWsEndpoint\(null\); \} catch \{ \/\* noop \*\/ \}\n\s*_onLocation\(\{ home: true \}\);/);
    const rh = rt.slice(rt.indexOf('async function returnHome()'), rt.indexOf('returnHome, isAtHome'));
    expect(rh).toMatch(/if \(_atHome \|\| !_homeWorld\) return \{ ok: false, reason: 'at-home' \};/);
    expect(rh).toMatch(/await _restoreHomeWorld\(\);/);
    expect(rh).toMatch(/_mp\.stop\('travel'\)/);
    expect(rh).toMatch(/_gz\.holdForNet\(\)/);
    expect(rh).toMatch(/_mp\.start\(\)/);
  });
});
