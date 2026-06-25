// engine/gateway/handoffPlan.js — host TRAVEL HANDOFF SEAM (GATEWAY / NAP-zone
// handoff, v0.2.167). Defines the host-side boundary that RECEIVES an allowed
// `gateway:travel` intent (from v0.2.165 `prepareTravelIntent`) and produces a
// DRY-RUN handoff plan + rollback plan: which inert same-site route / external
// https preview a future build WOULD navigate to, the preflight checks it WOULD
// run, and the rollback route it WOULD restore on failure. It is the final safe
// seam BEFORE v0.2.168 can implement a first controlled local/same-site travel.
//
// Pure + node-safe: NO browser navigation (`location.href`/`location.assign`/
// `window.open`/`history.pushState`/router), NO world unload/reload, NO Nostr
// client, NO WebSocket, NO relay I/O, NO signing, NO publishing, NO NIP-07, NO
// key handling, NO payments, NO auto-update, NO DOM, NO network, NO fetch. This
// module NEVER performs the travel and exposes NO navigate/goto/open/reload/
// unload/load/sign/publish/send/connect/apply method — it only names the commands
// a future executor WOULD run and shapes them into an inert plan. The host route /
// `window.location` is INJECTED via `hostContext` so this stays runtime-free and
// node-testable. Every plan pins `dryRun:true`, `navigated:false`,
// `worldReloaded:false`, `performed:false`, `readOnly:true`. Every route/url field
// is sanitised (same-origin path fragments or https-only preview URLs as inert
// strings) so a hostile destination can never inject a scheme or markup. Every
// helper degrades safely on malformed input and never throws.

import { prepareTravelIntent, TRAVEL_ACTION } from './travelConfirm.js';
import { CONSENT_REASON } from '../consent/consentGate.js';
import { safeProfileUrl } from '../nostr/profileRead.js';

// HANDOFF_PLAN_VERSION — bumped when the plan shape changes.
export const HANDOFF_PLAN_VERSION = 1;

// Badge stamped on every plan so a viewer can never mistake the dry-run for a live
// navigation. The plan SHOWS where a host could travel; it never travels.
export const HANDOFF_BADGE = 'HANDOFF · DRY-RUN · NO NAVIGATION';

// Plan status tiers. `ready` = a valid, consented intent → a host COULD proceed;
// `blocked` = consent withheld/mismatched; `invalid` = no usable destination.
export const HANDOFF_STATUS = Object.freeze({
  READY: 'ready',
  BLOCKED: 'blocked',
  INVALID: 'invalid',
});

// The ordered FUTURE command names a host executor WOULD run to perform a hop.
// These are DECLARED here for discoverability + audit; this module never invokes
// them and exposes no method by these names. v0.2.168+ wires a real executor.
export const HANDOFF_COMMANDS = Object.freeze([
  'preflight',       // re-validate the consented intent + destination
  'snapshotState',   // capture rollback route + carried state pointer
  'unloadWorld',     // tear down the current NAP zone scene
  'navigate',        // hand the safe route/url to the host transport
  'loadWorld',       // build the destination zone scene
  'spawnPlayer',     // place the traveller at the destination entry point
]);

// The default routes used when the host injects none. Same-origin, inert strings.
const DEFAULT_ROUTE = '/';
const ROUTE_MAX_LEN = 256;
const SLUG_MAX_LEN = 64;
// Control chars (C0 + DEL) + chars that could break out of a path fragment.
// `%` is rejected too: percent-encoding can smuggle a traversal/scheme past the
// raw-char checks (e.g. `%2e%2e` = `..`), and an internally-built same-site route
// never needs it — so any `%` is treated as hostile (SEC route-hardening v0.2.179).
const UNSAFE_ROUTE = /[\x00-\x1f\x7f<>"'`\\\s%]/;
// Path traversal — any `..` segment could climb out of an allowlisted prefix
// (e.g. `/zone/../admin`). Rejected outright (SEC route-hardening v0.2.179).
const TRAVERSAL_ROUTE = /\.\./;
// A zone-id slug keeps only url-safe chars; everything else becomes a separator.
const SLUG_STRIP = /[^a-z0-9]+/g;
const SLUG_TRIM = /^-+|-+$/g;

// safeRoutePath(raw) → a safe SAME-ORIGIN path fragment, or null. Pure, never
// throws. Accepts ONLY a string starting with a single `/` (rejects `//` protocol-
// relative, absolute schemes, `javascript:`/`data:`, whitespace, control chars,
// markup, backslashes, any `%` percent-encoding, and any `..` traversal segment)
// within a length cap. The leading-slash rule means an attacker can never smuggle
// a scheme through the injected current route; the `%`/`..` rejections close
// percent-encoded + dot-dot climb-out attempts (SEC route-hardening v0.2.179).
export function safeRoutePath(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > ROUTE_MAX_LEN) return null;
  if (raw[0] !== '/' || raw[1] === '/') return null;
  if (UNSAFE_ROUTE.test(raw)) return null;
  if (TRAVERSAL_ROUTE.test(raw)) return null;
  return raw;
}

// _zoneSlug(zoneId) → a url-safe slug for a same-site zone route, or ''. Pure.
function _zoneSlug(zoneId) {
  if (typeof zoneId !== 'string') return '';
  const slug = zoneId.toLowerCase().replace(SLUG_STRIP, '-').replace(SLUG_TRIM, '');
  return slug.length > SLUG_MAX_LEN ? slug.slice(0, SLUG_MAX_LEN) : slug;
}

// handoffRouteFor(destination) → the inert SAME-SITE route a host WOULD load for a
// destination zone (`/zone/<slug>`), or null when the zone id yields no safe slug.
// Pure — builds a string, navigates nothing.
export function handoffRouteFor(destination) {
  const slug = _zoneSlug(destination && destination.zoneId);
  return slug ? `/zone/${slug}` : null;
}

// handoffUrlFor(destination) → the https-only external preview URL a host MIGHT
// show for a destination (from its sanitised `website`), or null. Pure; the URL is
// an inert display string, never fetched or navigated.
export function handoffUrlFor(destination) {
  return destination && destination.website ? safeProfileUrl(destination.website) : null;
}

// _hostRoutes(hostContext) → the sanitised { currentRoute, rollbackRoute } the host
// injected, each falling back to DEFAULT_ROUTE. Pure. Injecting the route keeps
// this module free of any runtime `window.location` dependency (node-testable).
function _hostRoutes(hostContext) {
  const ctx = (hostContext && typeof hostContext === 'object' && !Array.isArray(hostContext)) ? hostContext : {};
  const currentRoute = safeRoutePath(ctx.currentRoute) || DEFAULT_ROUTE;
  // The rollback route is where "go back" returns on a failed/aborted hop — the
  // explicit fallback if given, else wherever we are now.
  const rollbackRoute = safeRoutePath(ctx.rollbackRoute) || currentRoute;
  return { currentRoute, rollbackRoute };
}

// summariseHandoff(input, grant, hostContext) → one stable, human-readable line for
// a confirm prompt / HUD row / audit log. Pure, never throws.
export function summariseHandoff(input = {}, grant = null, hostContext = null) {
  const intent = prepareTravelIntent(input, grant);
  if (!intent.destination) return 'Handoff blocked — no valid destination (dry-run, not travelled).';
  const dst = intent.destination;
  const label = dst.title || dst.zoneId;
  const route = handoffRouteFor(dst) || '(no route)';
  const { currentRoute } = _hostRoutes(hostContext);
  const verb = intent.consent.allowed ? 'would hand off' : 'blocked from handing off';
  return `${verb} ${currentRoute} → ${label} (${route}) — dry-run, not travelled.`;
}

// planHandoff(input, grant, hostContext) → an INERT, dry-run HANDOFF PLAN. Pure,
// never throws, NEVER navigates/unloads/reloads/performs.
//
//   {
//     version, badge,
//     action:        'gateway:travel',
//     status:        'ready'|'blocked'|'invalid',
//     ok:            boolean,        // status === 'ready' (host MAY proceed later)
//     reason:        CONSENT_REASON.* | 'handoff-ready' | 'destination-invalid',
//     targetZoneId:  string|null,
//     targetRoute:   string|null,    // safe SAME-SITE path the host WOULD load
//     targetUrl:     string|null,    // https-only external preview (inert string)
//     currentRoute:  string,         // injected host route (sanitised) or '/'
//     rollbackRoute: string,         // where a failed/aborted hop returns
//     preflight:     [{ check, ok, detail }],
//     commands:      [string],       // ordered FUTURE command names (never run)
//     destination:   {…}|null,       // the sanitised inert destination
//     consent:       {…},            // the inert consentGate decision
//     summary:       string,
//     dryRun:        true,           // ALWAYS
//     navigated:     false,          // ALWAYS
//     worldReloaded: false,          // ALWAYS
//     performed:     false,          // ALWAYS
//     signed:        false,          // ALWAYS
//     published:     false,          // ALWAYS
//     readOnly:      true,           // ALWAYS
//     errors:        [string],
//   }
//
// `input`/`grant` are forwarded to `prepareTravelIntent` (a `gatewayRead` preview
// model, plain descriptor, or `{ destination, origin? }`; boolean/scoped grant).
// Only an ALLOWED, matching `gateway:travel` intent over a VALID destination yields
// `status:'ready'`; a blocked/mismatched grant → `'blocked'`; a malformed/
// unidentifiable destination → `'invalid'`. Even when ready, the plan NEVER
// navigates — `ok:true` is proof of what a host COULD execute next, not the act.
export function planHandoff(input = {}, grant = null, hostContext = null) {
  const intent = prepareTravelIntent(input, grant);
  const destination = intent.destination;
  const consent = intent.consent;
  const { currentRoute, rollbackRoute } = _hostRoutes(hostContext);

  const targetZoneId = destination ? destination.zoneId : null;
  const targetRoute = destination ? handoffRouteFor(destination) : null;
  const targetUrl = destination ? handoffUrlFor(destination) : null;

  // status: invalid (no destination) > blocked (consent withheld) > ready.
  let status;
  let reason;
  if (!destination) {
    status = HANDOFF_STATUS.INVALID;
    reason = CONSENT_REASON.UNKNOWN_ACTION === consent.reason ? consent.reason : 'destination-invalid';
  } else if (!consent.allowed) {
    status = HANDOFF_STATUS.BLOCKED;
    reason = consent.reason;
  } else {
    status = HANDOFF_STATUS.READY;
    reason = 'handoff-ready';
  }

  const preflight = [
    { check: 'consent-allowed', ok: consent.allowed, detail: consent.reason },
    { check: 'destination-valid', ok: !!destination, detail: targetZoneId || 'none' },
    { check: 'target-route-safe', ok: !!targetRoute, detail: targetRoute || 'no safe route' },
    { check: 'rollback-route-present', ok: !!rollbackRoute, detail: rollbackRoute },
    { check: 'inert-dry-run', ok: true, detail: 'no navigation/world-reload performed' },
  ];

  const errors = [];
  if (!destination) errors.push(...(intent.errors && intent.errors.length ? intent.errors : ['no valid destination']));
  if (destination && !targetRoute) errors.push('destination zone id yields no safe route');

  return {
    version: HANDOFF_PLAN_VERSION,
    badge: HANDOFF_BADGE,
    action: TRAVEL_ACTION,
    status,
    ok: status === HANDOFF_STATUS.READY,
    reason,
    targetZoneId,
    targetRoute,
    targetUrl,
    currentRoute,
    rollbackRoute,
    preflight,
    commands: HANDOFF_COMMANDS,
    destination: destination || null,
    consent,
    summary: summariseHandoff(input, grant, hostContext),
    dryRun: true,
    navigated: false,
    worldReloaded: false,
    performed: false,
    signed: false,
    published: false,
    readOnly: true,
    errors,
  };
}

// DEMO_HANDOFF_INPUT — deterministic sample destination for the debug shell ONLY.
// Mirrors the v0.2.165 travel sample so the foundation map shows a representative
// dry-run plan. Not used by gameplay.
export const DEMO_HANDOFF_INPUT = Object.freeze({
  destination: Object.freeze({
    zoneId: 'nap-garden',
    title: 'The Nap Garden',
    zoneType: 'nap',
    npub: 'npub1demo000000000000000000000000000000000000000000000000000',
    website: 'https://torii-quest.pplx.app/nap-garden',
    relays: Object.freeze(['wss://relay.example.com']),
  }),
  origin: 'debug-shell',
});
