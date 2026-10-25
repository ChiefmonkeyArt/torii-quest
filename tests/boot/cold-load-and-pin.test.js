// v0.2.907-alpha: title-screen engine preload, ?nuked=1 pin removal, ambient fill.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { enginePreloadFiles, enginePreloadMeta } from '../../tools/enginePreload.mjs';
import { engineChunkList, shouldPrefetch, prefetchEngine } from '../../src/engine/boot/enginePrefetch.js';
import { stripNukedParam, clearNukedPin } from '../../src/engine/boot/nukedParam.js';

const chunk = (fileName, o = {}) => ({ type: 'chunk', fileName, imports: [], ...o });

describe('enginePreloadFiles (build side)', () => {
  const bundle = {
    e: chunk('assets/torii-entry-1.js', { isEntry: true, imports: ['assets/shared-1.js'] }),
    s: chunk('assets/shared-1.js'),
    a: chunk('assets/arenaRuntime-1.js', { facadeModuleId: '/r/src/arenaRuntime.js', isDynamicEntry: true, imports: ['assets/three-vendor-1.js', 'assets/shared-1.js'] }),
    t: chunk('assets/three-vendor-1.js'),
    r: chunk('assets/rapier-1.js', { facadeModuleId: '/r/node_modules/@dimforge/rapier3d-compat/rapier.mjs', isDynamicEntry: true }),
    k: chunk('assets/kami-1.js', { facadeModuleId: '/r/src/kami.js', isDynamicEntry: true }),
    css: { type: 'asset', fileName: 'assets/x.css' },
  };
  it('lists the engine, its static deps and Rapier, minus what the entry already loads', () => {
    expect(enginePreloadFiles(bundle)).toEqual(['./assets/arenaRuntime-1.js', './assets/three-vendor-1.js', './assets/rapier-1.js']);
  });
  it('returns nothing when the engine chunk is missing', () => {
    expect(enginePreloadFiles({ e: bundle.e })).toEqual([]);
  });
  it('the meta tag only carries safe ./…js paths', () => {
    expect(enginePreloadMeta(['./assets/a-1.js', '"><script>x', 'https://evil/x.js'])).toBe('<meta name="torii-engine-preload" content="./assets/a-1.js">');
  });
});

function fakeDoc(content, existing) {
  const head = { kids: [], appendChild(n) { this.kids.push(n); } };
  return {
    head,
    querySelector: () => (content == null ? null : { getAttribute: () => content }),
    querySelectorAll: () => (existing || []).map((h) => ({ getAttribute: () => h })),
    createElement: () => ({}),
  };
}

describe('prefetchEngine (title screen)', () => {
  it('adds one modulepreload link per safe chunk, once', () => {
    const doc = fakeDoc('./assets/a-1.js ./assets/b-2.js javascript:alert(1)');
    expect(engineChunkList(doc)).toEqual(['./assets/a-1.js', './assets/b-2.js']);
    expect(prefetchEngine({ doc, nav: {} })).toBe(2);
    expect(doc.head.kids.map((l) => [l.rel, l.href])).toEqual([['modulepreload', './assets/a-1.js'], ['modulepreload', './assets/b-2.js']]);
    expect(prefetchEngine({ doc, nav: {} })).toBe(0); // idempotent
  });
  it('v0.2.933: anchors chunks to the app root (a /w/<npub>/<world> link)', () => {
    const doc = fakeDoc('./assets/a-1.js');
    expect(prefetchEngine({ doc, nav: {}, root: '/quest/' })).toBe(1);
    expect(doc.head.kids[0].href).toBe('/quest/assets/a-1.js');
    const doc2 = fakeDoc('./assets/a-1.js');
    prefetchEngine({ doc: doc2, nav: {}, root: 'https://evil/' }); // not a path → unchanged
    expect(doc2.head.kids[0].href).toBe('./assets/a-1.js');
  });
  it('skips chunks the bundler already preloads', () => {
    const doc = fakeDoc('./assets/a-1.js ./assets/b-2.js', ['/quest/assets/a-1.js']);
    expect(prefetchEngine({ doc, nav: {} })).toBe(1);
    expect(doc.head.kids[0].href).toBe('./assets/b-2.js');
  });
  it('respects Data Saver and 2G', () => {
    expect(shouldPrefetch({ connection: { saveData: true } })).toBe(false);
    expect(shouldPrefetch({ connection: { effectiveType: 'slow-2g' } })).toBe(false);
    expect(shouldPrefetch({ connection: { effectiveType: '2g' } })).toBe(false);
    expect(shouldPrefetch({ connection: { effectiveType: '4g' } })).toBe(true);
    expect(shouldPrefetch({})).toBe(true);
    const doc = fakeDoc('./assets/a-1.js');
    expect(prefetchEngine({ doc, nav: { connection: { saveData: true } } })).toBe(0);
    expect(doc.head.kids).toHaveLength(0);
  });
  it('never throws (no meta, broken doc)', () => {
    expect(prefetchEngine({ doc: fakeDoc(null), nav: {} })).toBe(0);
    expect(prefetchEngine({ doc: { get head() { throw new Error('x'); } }, nav: {} })).toBe(0);
  });
});

describe('?nuked=1 pin', () => {
  it('strips only the pin, keeping other params in order', () => {
    expect(stripNukedParam('?nuked=1')).toBe('');
    expect(stripNukedParam('?a=1&nuked=1&b=2')).toBe('?a=1&b=2');
    expect(stripNukedParam('?nuked=10')).toBe('?nuked=10');
    expect(stripNukedParam('?a=1')).toBe('?a=1');
    expect(stripNukedParam('')).toBe('');
  });
  it('replaces the URL without a reload or a new history entry', () => {
    const calls = [];
    const hist = { state: { s: 1 }, replaceState: (...a) => calls.push(a) };
    expect(clearNukedPin({ loc: { pathname: '/quest/', search: '?nuked=1', hash: '#x' }, hist })).toBe(true);
    expect(calls).toEqual([[{ s: 1 }, '', '/quest/#x']]);
    expect(clearNukedPin({ loc: { pathname: '/quest/', search: '', hash: '' }, hist })).toBe(false);
    expect(clearNukedPin({ loc: { pathname: '/', search: '?nuked=1', hash: '' }, hist: { replaceState() { throw new Error('x'); } } })).toBe(false);
  });
});

describe('wiring', () => {
  const M = readFileSync('src/main.js', 'utf8');
  it('clears the pin only AFTER the arena has booted (keeps the loop guard during boot)', () => {
    const boot = M.indexOf('await _arena.bootstrapPhysics();');
    const clear = M.indexOf('clearNukedPin();');
    expect(boot).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(boot);
    expect(clear - boot).toBeLessThan(300);
  });
  it('schedules the engine preload when the title is ready', () => {
    expect(M).toMatch(/window\.__toriiEnterReady = true;\n[^\n]*\nscheduleEnginePrefetch\(\);/);
  });
  it('the build injects the preload meta into index.html', () => {
    expect(readFileSync('vite.config.js', 'utf8')).toMatch(/enginePreloadMeta\(enginePreloadFiles\(ctx\.bundle\)\)/);
  });
  it('ambient fill is raised for shaded faces and stays a single light (no shader cost)', () => {
    const S = readFileSync('src/scene.js', 'utf8');
    expect(S).toMatch(/export const AMBIENT_FILL = 0\.8;/);
    expect((S.match(/new THREE\.AmbientLight\(/g) || []).length).toBe(2); // world + gun overlay
  });
});
