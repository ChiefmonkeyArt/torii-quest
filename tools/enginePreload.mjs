// v0.2.907-alpha: the engine chunk (src/arenaRuntime.js) and every chunk it
// statically imports, minus what the entry already loaded. The shell preloads
// these on the title screen (<link rel="modulepreload">: download + compile,
// NO execution) so ENTER doesn't wait ~5 s fetching modules on a cold cache.
// Pure: takes a Rollup bundle, returns './assets/…' URLs (document-relative,
// base-agnostic like the entry import).
export const ENGINE_PRELOAD_META = 'torii-engine-preload';

// `extraRe`: lazily imported chunks that are ALWAYS loaded on ENTER (Rapier physics,
// ~2.2 MB, the largest download) also get preloaded.
export function enginePreloadFiles(bundle, facadeRe = /[\\/]src[\\/]arenaRuntime\.js$/, extraRe = /rapier3d/) {
  const chunks = Object.values(bundle || {}).filter((c) => c && c.type === 'chunk');
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.isEntry);
  const loaded = new Set();
  const walk = (c, into) => { if (!c || into.has(c.fileName)) return; into.add(c.fileName); for (const i of c.imports || []) walk(byName.get(i), into); };
  if (entry) walk(entry, loaded);
  const engine = chunks.find((c) => c.facadeModuleId && facadeRe.test(c.facadeModuleId));
  if (!engine) return [];
  const need = new Set();
  walk(engine, need);
  for (const c of chunks) if (c !== engine && c.isDynamicEntry && ((c.facadeModuleId && extraRe.test(c.facadeModuleId)) || extraRe.test(c.name || ''))) walk(c, need);
  return [...need].filter((f) => !loaded.has(f)).map((f) => './' + f);
}

export function enginePreloadMeta(files) {
  const safe = files.filter((f) => /^\.\/[\w./-]+\.js$/.test(f));
  return `<meta name="${ENGINE_PRELOAD_META}" content="${safe.join(' ')}">`;
}
