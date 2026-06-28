// tools/zoneShells.mjs — PURE, node-safe planner for the static `/zone/<slug>/` SHELL
// files (v0.2.243). On the exact-path static host with no SPA rewrite (torii-quest.pplx.app
// returns a JSON 404 for an unknown path) the host infers Content-Type from file extension.
// v0.2.242 wrote the shell at the EXTENSIONLESS file `dist/zone/<slug>`; the host served it
// as `application/octet-stream`, so a real browser DOWNLOADED it instead of rendering (the
// Playwright smoke saw "Download is starting"). v0.2.243 reinstates the directory-index
// shell `dist/zone/<slug>/index.html`: the host DOES resolve the canonical trailing-slash
// URL `/zone/<slug>/` onto that nested index.html (the same directory-index resolution that
// serves root `/`), and a `.html` file is served as renderable `text/html`. index.html uses
// root-absolute asset URLs (`/assets/…`), so the shell loads the same bundle and the
// v0.2.182 parser resolves the slug client-side — no backend, no rewrite engine needed.
//
// NOTE: a file `dist/zone/<slug>` and a directory `dist/zone/<slug>/` cannot coexist under
// one name, so the directory-index shell REPLACES the v0.2.242 extensionless file; it does
// not sit alongside it. The canonical generated+navigated route is the trailing-slash form
// `/zone/<slug>/`; a cold no-slash deep-link degrades to the host default (documented
// residual) but still resolves client-side once the bundle has loaded.
//
// This module only PLANS the shell paths from a slug list; the fs writes live in
// tools/generate-zone-shells.mjs (the impure CLI). Kept pure + deterministic so the path
// shapes are unit-testable (tests/zone-hard-refresh.test.js) without touching disk.
//
// Constrained by construction: NO fs / network / child_process / THREE / DOM imports.
// It reaches for no global and writes nothing — it returns plain data only.

import { isValidZoneSlug, ZONE_ROUTE_PREFIX } from '../src/engine/gateway/zoneRoute.js';

// zoneShellPathFor(slug) → the dist-relative directory-index shell file
// `zone/<slug>/index.html` for a valid slug, or null. The `.html` extension is what makes
// the host serve it as renderable `text/html`. PURE — builds a string, writes nothing.
export function zoneShellPathFor(slug) {
  if (!isValidZoneSlug(slug)) return null;
  return `zone/${slug}/index.html`;
}

// zoneShellRouteFor(slug) → the canonical same-origin route a shell answers
// (`/zone/<slug>/`, trailing slash), or null. PURE — mirrors zoneRouteFor so the plan can
// be cross-checked against the parser.
export function zoneShellRouteFor(slug) {
  if (!isValidZoneSlug(slug)) return null;
  return `${ZONE_ROUTE_PREFIX}${slug}/`;
}

// planZoneShells(slugs) → { ok, shells, errors }. PURE, never throws.
//   slugs:  array of zone slugs (typically DEPLOYABLE_ZONE_SLUGS).
//   shells: [ { slug, path, route } ] for every VALID slug, de-duplicated.
//   errors: one message per invalid/duplicate slug; `ok` is true iff errors is empty.
export function planZoneShells(slugs = []) {
  const errors = [];
  const shells = [];
  const seen = new Set();
  const list = Array.isArray(slugs) ? slugs : [];
  for (const slug of list) {
    if (!isValidZoneSlug(slug)) {
      errors.push(`invalid zone slug (cannot build a shell): ${JSON.stringify(slug)}`);
      continue;
    }
    if (seen.has(slug)) {
      errors.push(`duplicate zone slug: ${slug}`);
      continue;
    }
    seen.add(slug);
    shells.push({ slug, path: zoneShellPathFor(slug), route: zoneShellRouteFor(slug) });
  }
  return { ok: errors.length === 0, shells, errors };
}
