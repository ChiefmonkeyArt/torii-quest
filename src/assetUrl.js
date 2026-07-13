// Resolve a static asset path against the Vite build base.
//
// Quest is mounted at a path prefix on the Torii Suite VPS (e.g. /quest/), so a
// root-relative path like '/torii-gate.glb' resolves to https://host/torii-gate.glb
// (404) instead of https://host/quest/torii-gate.glb. Vite sets
// import.meta.env.BASE_URL to the configured base ('/quest/' in Suite builds, '/'
// in local dev), so prefixing with it yields the correct URL in both cases.
//
// Mirrors the pattern already used in src/audio.js. Accepts inputs with or without
// a leading slash ('/foo.glb' or 'foo.glb') and a trailing slash for directories
// ('/draco/' -> '/quest/draco/').
export function assetUrl(input) {
  const rel = String(input).replace(/^\/+/, '');
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${rel}`;
}
