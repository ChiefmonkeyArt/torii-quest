// v0.2.907-alpha: warm the engine code while the player is on the title screen
// (logging in takes ~30 s; a cold ENTER spent ~5 s on "Loading engine…").
// Reads the build-emitted <meta name="torii-engine-preload"> list and adds a
// <link rel="modulepreload"> per chunk: the browser downloads and compiles the
// modules but does NOT run them, so no WebGL context or scene is created early.
// The later import('./arenaRuntime.js') then resolves from the module map.
// Skipped on Data Saver / 2G. Idempotent. Never throws.

const META = 'torii-engine-preload';
const SAFE = /^\.\/[\w./-]+\.js$/;

export function engineChunkList(doc) {
  try {
    const m = doc.querySelector(`meta[name="${META}"]`);
    if (!m) return [];
    return String(m.getAttribute('content') || '').split(/\s+/).filter((f) => SAFE.test(f));
  } catch { return []; }
}

export function shouldPrefetch(nav) {
  const c = nav && nav.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/(^|-)2g$/.test(String(c.effectiveType || ''));
}

/** Adds the modulepreload links once. Returns the number added. */
export function prefetchEngine({ doc = globalThis.document, nav = globalThis.navigator } = {}) {
  try {
    if (!doc || !doc.head || doc.__toriiEnginePrefetched) return 0;
    doc.__toriiEnginePrefetched = true;
    if (!shouldPrefetch(nav)) return 0;
    // Skip chunks the bundler already hinted in index.html (same file name).
    const have = new Set();
    try { for (const l of doc.querySelectorAll('link[rel="modulepreload"]')) have.add(String(l.getAttribute('href') || '').split('/').pop()); } catch { /* none */ }
    let n = 0;
    for (const href of engineChunkList(doc)) {
      if (have.has(href.split('/').pop())) continue;
      const l = doc.createElement('link');
      l.rel = 'modulepreload';
      l.href = href;
      doc.head.appendChild(l);
      n++;
    }
    return n;
  } catch { return 0; }
}

/** Run once the title is idle (requestIdleCallback, else two frames). */
export function scheduleEnginePrefetch({ win = globalThis.window, ...o } = {}) {
  try {
    const run = () => prefetchEngine(o);
    if (win && typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 2000 });
    else if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => win.requestAnimationFrame(run));
    else run();
  } catch { /* prefetch is an optimisation only */ }
}
