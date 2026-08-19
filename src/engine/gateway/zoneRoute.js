// engine/gateway/zoneRoute.js — the pure SPA zone ROUTE PARSER + resolver
// (GATEWAY / NAP-zone handoff, v0.2.182; CANONICAL HASH ROUTE since v0.2.244).
// This is the safe client-side INTERPRETATION of the gateway URL state the portal
// trigger pushes (`history.pushState('/#/zone/<slug>')`): given a path/fragment, it
// classifies it as HOME / a valid ZONE / INVALID, validates the slug strictly, and
// maps a valid zone to an INERT local display state (title + placeholder notice).
//
// CANONICAL ROUTE = `/#/zone/<slug>` (URL FRAGMENT, v0.2.244). The published static host
// (chiefmonkey.art/quest) serves by EXACT static-asset path with NO SPA rewrite and NO
// directory-index: it returns a JSON 404 for BOTH `/zone/<slug>` AND `/zone/<slug>/`, so
// EVERY `/zone/*` PATH strategy fails live (v0.2.242 extensionless file → octet-stream
// download; v0.2.243 directory-index shell → 404). Only the root path `/` reliably serves
// index.html as `text/html`. Putting the zone in the URL FRAGMENT (`/#/zone/<slug>`) means
// the request path is always `/` — the fragment is never sent to the server — so the root
// shell always renders on a hard refresh, and the client router reads the fragment.
//
// The parser STILL accepts the legacy no-hash `/zone/<slug>` path form (it normalises to
// the canonical `/#/zone/<slug>` `route`), so a legacy in-app hop or a typed bare path
// still resolves client-side once the bundle has loaded. But `/zone/<slug>` is NON-CANONICAL
// on this host (a cold deep-link 404s before the bundle loads); never generate/share it.
//
// It exists so a refresh / deep-link / back-forward on a `/zone/...` URL has a
// deterministic, safe meaning in app code instead of being brittle. It LOADS
// NOTHING: no network, no relay, no NIP-07, no payments, no external navigation, no
// world unload/reload. A future slice binds a real zone scene to a ZONE state; until
// then the app shows the placeholder notice.
//
// Constrained by construction:
//   - SAME-ORIGIN ONLY: every path first passes `safeRoutePath` (v0.2.179 hardening),
//     so protocol-relative `//host`, absolute schemes, `javascript:`/`data:`, `..`
//     traversal, any `%` percent-encoding, whitespace, control chars, markup, and
//     over-length paths are rejected as INVALID before any slug parsing.
//   - STRICT SLUG: a zone slug is lowercase alnum words joined by single hyphens
//     (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), length-capped; no slashes/sub-paths, no
//     leading/trailing/double hyphen. Anything else is INVALID.
//   - PURE + node-safe: no THREE/Rapier/DOM/window/location/fs/network imports. The
//     host reads `window.location.pathname` and feeds it in; this module never
//     reaches for a global. Exposes NO navigate/open/reload/goto/assign/href/pushState.
//   - Every result pins navigated/performed/external/signed/published/network = false.

import { safeRoutePath } from './handoffPlan.js';

// ZONE_ROUTE_VERSION — bumped when the parse result shape changes.
export const ZONE_ROUTE_VERSION = 1;

// Badge stamped on debug reports: this resolves URL state, but inertly + same-origin.
export const ZONE_ROUTE_BADGE = 'ZONE ROUTE · SAME-ORIGIN · INERT';

// The LEGACY same-origin path prefix. A legacy zone path is `/zone/<slug>` — still
// PARSED (so a legacy link resolves client-side) but NON-CANONICAL on the published host.
export const ZONE_ROUTE_PREFIX = '/zone/';

// The CANONICAL route prefix the portal trigger pushes (v0.2.244): a hash-fragment route
// `/#/zone/<slug>`. The fragment is never sent to the server, so the request path stays `/`
// and the root shell always renders — the only host-safe form on chiefmonkey.art/quest.
export const ZONE_CANONICAL_PREFIX = '/#/zone/';

// Max slug length (mirrors handoffPlan's SLUG_MAX_LEN so a route this parser accepts
// is one the route-builder could have produced).
export const ZONE_SLUG_MAX_LEN = 64;

// Route classifications. HOME = root / any non-`/zone/` same-origin path (nothing to
// resolve — stay on the title screen / arena). ZONE = a valid `/zone/<slug>`. INVALID
// = an unsafe path OR a `/zone/...` whose slug failed validation.
export const ZONE_ROUTE_KIND = Object.freeze({
  HOME: 'home',
  ZONE: 'zone',
  INVALID: 'invalid',
});

// Strict slug grammar: lowercase alnum words joined by single hyphens. No empty
// words (so no leading/trailing/double hyphen), no uppercase, no underscores, no
// slashes, no dots. Matches what handoffPlan's `_zoneSlug` produces.
const ZONE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// isValidZoneSlug(slug) → boolean. Pure, never throws.
export function isValidZoneSlug(slug) {
  return typeof slug === 'string'
    && slug.length > 0 && slug.length <= ZONE_SLUG_MAX_LEN
    && ZONE_SLUG_RE.test(slug);
}

// humanizeZoneSlug(slug) → a Title-Case display label, or '' for an invalid slug.
// Pure — a display string only, never navigated.
export function humanizeZoneSlug(slug) {
  if (!isValidZoneSlug(slug)) return '';
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// zoneRouteFor(slug) → the CANONICAL hash route `/#/zone/<slug>` for a valid slug, or
// null. The fragment keeps the request path at `/` so the root shell always renders on
// this exact-path host (v0.2.244). Pure — builds a string, navigates nothing.
export function zoneRouteFor(slug) {
  return isValidZoneSlug(slug) ? `${ZONE_CANONICAL_PREFIX}${slug}` : null;
}

// _result(fields) → a fully-shaped parse result with the inert invariants pinned
// LAST so a caller can never flip them.
function _result(fields) {
  return {
    version: ZONE_ROUTE_VERSION,
    badge: ZONE_ROUTE_BADGE,
    kind: ZONE_ROUTE_KIND.HOME,
    ok: false,
    slug: null,
    zoneId: null,
    route: null,
    title: null,
    notice: '',
    errors: [],
    ...fields,
    // Pinned invariants — ALWAYS. This parser interprets URL state; it never acts.
    navigated: false,
    performed: false,
    external: false,
    signed: false,
    published: false,
    network: false,
  };
}

// Placeholder notice shown for a valid zone until a real zone scene is bound. The
// in-world torii gate (v0.2.181) is the live travel path; a deep-linked zone URL is
// not yet a loadable scene, so the app shows this and keeps the player in the arena.
const ZONE_PLACEHOLDER = 'In-world zones are not loadable yet — explore the arena and use the torii gate to travel.';

// parseZoneRoute(path) → an inert parse result. Pure, never throws.
//
//   { version, badge, kind, ok, slug, zoneId, route, title, notice, errors,
//     navigated:false, performed:false, external:false, signed:false,
//     published:false, network:false }
//
// Classification:
//   - non-string / unsafe path (fails safeRoutePath) → kind 'invalid', ok:false.
//   - '/' or any non-`/zone/` same-origin path        → kind 'home',    ok:true.
//   - `/zone/<valid-slug>`                            → kind 'zone',    ok:true.
//   - `/zone/<bad-or-missing-slug>` / sub-path        → kind 'invalid', ok:false.
export function parseZoneRoute(path) {
  const safe = safeRoutePath(path);
  if (safe === null) {
    return _result({
      kind: ZONE_ROUTE_KIND.INVALID,
      ok: false,
      notice: 'That link is not a valid same-origin route — staying in the arena.',
      errors: ['unsafe or malformed path (rejected by safeRoutePath)'],
    });
  }
  // CANONICAL form carries the zone in the URL FRAGMENT (`/#/zone/<slug>`). If a `#` is
  // present, the route to classify is whatever follows it (an empty fragment → home);
  // otherwise this is a LEGACY path form (`/zone/<slug>`) and we drop any trailing query.
  // safeRoutePath has ALREADY rejected `..`, `%`, control chars, markup, backslashes and
  // whitespace across the WHOLE raw string, so re-anchoring on the fragment cannot smuggle
  // any of those back in.
  const hashAt = safe.indexOf('#');
  let clean;
  if (hashAt >= 0) {
    clean = safe.slice(hashAt + 1);
    if (clean === '') clean = '/';
  } else {
    clean = safe.split('?')[0];
  }
  if (clean === '/' || !clean.startsWith(ZONE_ROUTE_PREFIX)) {
    return _result({ kind: ZONE_ROUTE_KIND.HOME, ok: true, route: clean });
  }
  // Accept the canonical `/#/zone/<slug>` (fragment, already stripped above), the legacy
  // bare `/zone/<slug>`, and a tolerated trailing-slash `/zone/<slug>/`: strip exactly one
  // trailing slash, then the remainder must be a single slug segment (no further slashes →
  // no sub-path).
  const rest = clean.slice(ZONE_ROUTE_PREFIX.length);
  const slug = rest.endsWith('/') ? rest.slice(0, -1) : rest;
  if (slug.includes('/')) {
    return _result({
      kind: ZONE_ROUTE_KIND.INVALID,
      ok: false,
      notice: 'That zone link has an unexpected sub-path — staying in the arena.',
      errors: ['zone route must be exactly /zone/<slug>/ with no sub-path'],
    });
  }
  if (!isValidZoneSlug(slug)) {
    return _result({
      kind: ZONE_ROUTE_KIND.INVALID,
      ok: false,
      notice: 'That zone link is not valid — staying in the arena.',
      errors: [`invalid zone slug: must match ${ZONE_SLUG_RE} and be 1..${ZONE_SLUG_MAX_LEN} chars`],
    });
  }
  const title = humanizeZoneSlug(slug);
  return _result({
    kind: ZONE_ROUTE_KIND.ZONE,
    ok: true,
    slug,
    zoneId: slug,
    route: `${ZONE_CANONICAL_PREFIX}${slug}`,
    title,
    notice: `Zone link: ${title}. ${ZONE_PLACEHOLDER}`,
  });
}

// describeZoneRoute(path) → one stable, human-readable line for a notice / audit
// log. Pure, never throws.
export function describeZoneRoute(path) {
  const r = parseZoneRoute(path);
  switch (r.kind) {
    case ZONE_ROUTE_KIND.ZONE:    return `Zone route ${r.route} → ${r.title} (inert placeholder, not loaded).`;
    case ZONE_ROUTE_KIND.INVALID: return 'Invalid zone route — ignored, staying home (no navigation).';
    default:                      return 'Home route — no zone to resolve.';
  }
}

// DEMO_ZONE_ROUTE — deterministic sample CANONICAL route for the debug shell ONLY (the
// hash route the v0.2.181 portal trigger pushes). Not used by gameplay.
export const DEMO_ZONE_ROUTE = '/#/zone/plebeian-market-bazaar';

// DEPLOYABLE_ZONE_SLUGS — the zone slugs the app knows how to resolve client-side. Since
// v0.2.244 the canonical route is the hash form `/#/zone/<slug>` (request path always `/`),
// so NO per-slug static shell is generated: the published exact-path host
// (chiefmonkey.art/quest) has no SPA rewrite and no directory index and 404s every `/zone/*`
// PATH (both the v0.2.242 extensionless file and the v0.2.243 directory-index shell failed
// live), while the root `/` always serves index.html as `text/html`. The hash fragment is
// never sent to the server, so the root shell renders and the parser resolves the slug.
// Every entry MUST be a valid slug (isValidZoneSlug).
export const DEPLOYABLE_ZONE_SLUGS = Object.freeze(['plebeian-market-bazaar']);
