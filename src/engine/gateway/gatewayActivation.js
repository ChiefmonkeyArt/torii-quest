// engine/gateway/gatewayActivation.js — the LIVE-WIRE seam for a CONFIRMED
// same-origin gateway hop (GATEWAY / NAP-zone handoff, v0.2.178, LEAN-2). This is
// the ONE place that connects the consent-gated travel chain to a REAL host
// transport so the v0.2.168 executor can finally ACT. It is the missing link
// between `planHandoff()`/`executeHandoff()` (which require an injected transport)
// and `createBrowserHostTransport(window)` (the real History-pushState adapter).
//
// Constrained by construction — navigation is impossible UNLESS the caller proves
// intent twice over:
//   - EXPLICIT CONFIRMATION: `activateGatewayHandoff` REFUSES to resolve a transport
//     or navigate unless `opts.confirmed === true` (a literal boolean — a truthy
//     string/1/object does NOT count). A read / preview / render path that never
//     sets `confirmed` can therefore NEVER cause a hop. Without confirmation the
//     function returns an `unconfirmed` report and NEVER touches `window`.
//   - CONSENT GATE preserved: the plan still flows through `planHandoff` →
//     `prepareTravelIntent` → the v0.2.162 consent gate, so a missing/mismatched
//     grant yields a `blocked` plan and no navigation, exactly as before.
//   - SAME-ORIGIN ONLY: the executor + transport already re-validate the route with
//     `safeRoutePath` (leading single `/`, rejecting `//host`, `javascript:`/`data:`,
//     absolute schemes, whitespace, markup). This module adds an OPTIONAL
//     `routeAllowlist` (path-prefix list) as defense in depth — when supplied, a
//     safe-but-unlisted route is BLOCKED before any navigation.
//   - NO external navigation (`location.href`/`location.assign`/`window.open`/
//     `reload`), NO world unload/reload, NO network/fetch, NO WebSocket/relay, NO
//     signing, NO publishing, NO NIP-07, NO key handling, NO payments, NO auto-
//     update, NO timers. The only effect is a same-origin `history.pushState` route
//     change via the injected/browser host. Every executor safety flag
//     (external/worldReloaded/signed/published/network) stays false.
//   - Pure + node-safe: no THREE/Rapier/DOM/fs imports; the browser `window` is
//     INJECTED by the caller, never reached for at module scope. exposes NO bare
//     navigate/open/reload/goto/assign/href method of its own.

import { planHandoff, safeRoutePath } from './handoffPlan.js';
import { executeHandoff, isHostTransport, EXECUTE_STATUS } from './handoffExecute.js';
import { createHostTransport, createBrowserHostTransport, isRouteHost } from './hostTransport.js';
import { TRAVEL_ACTION } from './travelConfirm.js';

// ACTIVATION_VERSION — bumped when the activation-report shape changes.
export const ACTIVATION_VERSION = 1;

// Badge stamped on every report: this acts, but only on an EXPLICIT confirmation
// and only same-origin via the host transport.
export const ACTIVATION_BADGE = 'GATEWAY · CONFIRMED · SAME-ORIGIN HOP';

// Activation outcomes (the OUTER status; the inner executor report carries its own).
//   navigated   = a real same-origin hop was performed
//   unconfirmed = opts.confirmed !== true → no transport resolved, nothing touched
//   no-transport= confirmed, but no usable transport (or forced dry-run) → no-op
//   blocked     = plan refused (consent/destination) OR route not in the allowlist
//   rolled-back = navigate failed but the rollback route was restored
//   failed      = navigate failed and could not be rolled back
export const ACTIVATION_STATUS = Object.freeze({
  NAVIGATED: 'navigated',
  UNCONFIRMED: 'unconfirmed',
  NO_TRANSPORT: 'no-transport',
  BLOCKED: 'blocked',
  ROLLED_BACK: 'rolled-back',
  FAILED: 'failed',
});

// How the transport was obtained, for audit. `browser` = built from an injected
// window via createBrowserHostTransport (the LIVE path); `host` = built from a
// route-host object/function; `injected` = a ready-made transport was passed;
// `none` = nothing usable (safe no-op).
export const TRANSPORT_KIND = Object.freeze({
  BROWSER: 'browser',
  HOST: 'host',
  INJECTED: 'injected',
  NONE: 'none',
});

// _looksLikeWindow(src) → true when `src` exposes a usable History API
// (`src.history.pushState`). This is what marks the REAL browser path. Pure.
function _looksLikeWindow(src) {
  return !!src && typeof src === 'object' && !Array.isArray(src)
    && !!src.history && typeof src.history.pushState === 'function';
}

// resolveHostTransport(source, opts) → { transport, kind }. Turns any accepted
// `source` into a transport the executor can drive, or { transport:null,
// kind:'none' } when nothing usable is given (so the executor safely no-ops).
// Pure of browser side effects — building a transport navigates nothing.
//
//   source  one of:
//             - a ready transport  ({ navigate(route), ... })        → kind 'injected'
//             - a browser window   ({ history.pushState, location }) → kind 'browser'
//             - a route host       (fn(route) | { pushState, ... })  → kind 'host'
//             - null/anything else                                   → kind 'none'
//   opts    { home?, onLog? } forwarded to createHostTransport/createBrowserHostTransport
//
// Order matters: a ready transport is detected first (it owns `navigate`), then a
// browser window (owns `history.pushState`), then a generic route host.
export function resolveHostTransport(source, opts = {}) {
  if (isHostTransport(source)) return { transport: source, kind: TRANSPORT_KIND.INJECTED };
  if (_looksLikeWindow(source)) {
    return { transport: createBrowserHostTransport(source, opts), kind: TRANSPORT_KIND.BROWSER };
  }
  if (isRouteHost(source)) {
    return { transport: createHostTransport(source, opts), kind: TRANSPORT_KIND.HOST };
  }
  return { transport: null, kind: TRANSPORT_KIND.NONE };
}

// Minimum meaningful allowlist-prefix length. A 1-char prefix like `'/'` matches
// EVERY same-origin route, making the allowlist trivially permissive — so such
// prefixes are NOT honoured. Callers must use meaningful prefixes like `'/zone/'`
// (SEC route-hardening v0.2.179).
const MIN_ALLOWLIST_PREFIX_LEN = 2;

// _routeAllowed(route, allowlist) → true when `route` is permitted. With NO
// allowlist supplied (null/non-array/empty) any safe same-origin route is allowed
// (safeRoutePath already constrains it). With a NON-EMPTY allowlist, the route must
// start with one of its meaningful (length >= MIN_ALLOWLIST_PREFIX_LEN) path
// prefixes. Trivially-permissive prefixes like `'/'` are IGNORED, so a caller that
// supplies ONLY such prefixes (e.g. `['/']`) gets a fail-CLOSED result: no route is
// allowed, rather than silently allowing everything. Pure, never throws.
function _routeAllowed(route, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  if (typeof route !== 'string') return false;
  for (const prefix of allowlist) {
    if (typeof prefix === 'string' && prefix.length >= MIN_ALLOWLIST_PREFIX_LEN
      && route.startsWith(prefix)) return true;
  }
  return false;
}

// _report(fields) → a fully-shaped activation report with the safety invariants
// pinned LAST so a caller can never flip them.
function _report(fields) {
  return {
    version: ACTIVATION_VERSION,
    badge: ACTIVATION_BADGE,
    action: TRAVEL_ACTION,
    status: ACTIVATION_STATUS.UNCONFIRMED,
    ok: false,
    confirmed: false,
    live: false,
    reason: '',
    transportKind: TRANSPORT_KIND.NONE,
    targetRoute: null,
    fromRoute: null,
    rollbackRoute: null,
    plan: null,
    execution: null,
    errors: [],
    ...fields,
    // Pinned invariants — ALWAYS, regardless of `fields`.
    navigated: fields.navigated === true,
    performed: fields.performed === true,
    external: false,
    worldReloaded: false,
    signed: false,
    published: false,
    network: false,
  };
}

// Map an inner executor status onto the outer activation status. Pure.
function _activationStatusFrom(execStatus) {
  switch (execStatus) {
    case EXECUTE_STATUS.DONE: return ACTIVATION_STATUS.NAVIGATED;
    case EXECUTE_STATUS.ROLLED_BACK: return ACTIVATION_STATUS.ROLLED_BACK;
    case EXECUTE_STATUS.FAILED: return ACTIVATION_STATUS.FAILED;
    case EXECUTE_STATUS.BLOCKED: return ACTIVATION_STATUS.BLOCKED;
    default: return ACTIVATION_STATUS.NO_TRANSPORT; // no-op
  }
}

// activateGatewayHandoff(input, grant, opts) → an activation report. This is the
// confirmed, live-wire entry point a host calls AFTER the player has explicitly
// confirmed a gateway hop. Pure of browser side effects beyond whatever the
// resolved transport does; never throws.
//
//   input  a gatewayRead preview model / plain destination / { destination, origin? }
//   grant  the consent grant (boolean true, or scoped { granted:true, action?, token? })
//   opts   {
//            confirmed:   boolean,     // MUST be literal true to navigate
//            window:      Window,      // injected browser window (the LIVE path)
//            transport:   {...},       // OR a ready transport
//            host:        fn|{...},    // OR a route host
//            hostContext: {...},       // { currentRoute, rollbackRoute } for planHandoff
//            home:        string,      // safe fallback rollback route for the transport
//            onLog:       fn,          // best-effort transport log sink
//            routeAllowlist: string[], // OPTIONAL same-origin path-prefix allowlist
//            dryRun:      boolean,     // force a no-op even when confirmed + transport present
//          }
//
// Behaviour:
//   - confirmed !== true            → status 'unconfirmed', NO transport resolved.
//   - confirmed, plan not ready     → status 'blocked' (consent/destination), no nav.
//   - confirmed, route not allowed  → status 'blocked' (allowlist), no nav.
//   - confirmed, no transport/dryRun→ status 'no-transport' (safe no-op).
//   - confirmed, transport, ready   → executeHandoff → 'navigated'|'rolled-back'|'failed'.
export function activateGatewayHandoff(input = {}, grant = null, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const confirmed = o.confirmed === true;
  const dryRun = o.dryRun === true;
  const hostContext = (o.hostContext && typeof o.hostContext === 'object') ? o.hostContext : null;

  // Build the dry-run plan first — it is inert and reveals consent/destination
  // status + the routes regardless of confirmation, so the report is auditable.
  const plan = planHandoff(input, grant, hostContext);
  const fromRoute = plan.currentRoute || null;
  const rollbackRoute = plan.rollbackRoute || null;
  const targetRoute = safeRoutePath(plan.targetRoute);

  // GATE 1 — explicit confirmation. Without it we NEVER resolve a transport, so a
  // preview/render path cannot navigate even if a window was passed by mistake.
  if (!confirmed) {
    return _report({
      status: ACTIVATION_STATUS.UNCONFIRMED,
      confirmed: false,
      reason: 'not-confirmed',
      transportKind: TRANSPORT_KIND.NONE,
      targetRoute, fromRoute, rollbackRoute, plan,
      errors: ['gateway hop requires opts.confirmed === true — refusing to act'],
    });
  }

  // GATE 2 — the plan must be ready (consent allowed + valid destination). A
  // blocked/invalid plan is refused here so we never even resolve a transport.
  if (!plan.ok) {
    return _report({
      status: ACTIVATION_STATUS.BLOCKED,
      confirmed: true,
      reason: plan.reason || 'plan-not-ready',
      transportKind: TRANSPORT_KIND.NONE,
      targetRoute, fromRoute, rollbackRoute, plan,
      errors: plan.errors && plan.errors.length ? plan.errors : ['handoff plan is not ready'],
    });
  }

  // GATE 3 — optional same-origin route allowlist (defense in depth on top of
  // safeRoutePath). A safe-but-unlisted route is blocked before any navigation.
  if (!_routeAllowed(targetRoute, o.routeAllowlist)) {
    return _report({
      status: ACTIVATION_STATUS.BLOCKED,
      confirmed: true,
      reason: 'route-not-allowed',
      transportKind: TRANSPORT_KIND.NONE,
      targetRoute, fromRoute, rollbackRoute, plan,
      errors: ['target route is not in the same-origin allowlist — refusing to navigate'],
    });
  }

  // Resolve the transport ONLY now (after both gates). The browser path is taken
  // only when a real window is injected; otherwise an injected transport/host, else
  // a safe no-op.
  const source = o.transport != null ? o.transport
    : o.window != null ? o.window
    : o.host != null ? o.host
    : null;
  const { transport, kind } = resolveHostTransport(source, { home: o.home, onLog: o.onLog });
  const live = kind === TRANSPORT_KIND.BROWSER && isHostTransport(transport);

  // Drive the existing v0.2.168 executor. With no usable transport (or dryRun) it
  // is a safe no-op; with one it performs the single same-origin navigate + rollback.
  const execution = executeHandoff(plan, transport, { dryRun });
  const status = _activationStatusFrom(execution.status);

  return _report({
    status,
    ok: execution.ok === true,
    confirmed: true,
    live,
    reason: execution.reason || status,
    transportKind: kind,
    targetRoute: execution.targetRoute || targetRoute,
    fromRoute, rollbackRoute,
    plan,
    execution,
    navigated: execution.navigated === true,
    performed: execution.performed === true,
    errors: execution.errors || [],
  });
}

// DEMO_ACTIVATION_OPTS — deterministic sample options for the debug shell ONLY.
// Confirmed + a same-origin allowlist, but no window/transport (so the debug-shell
// call resolves a no-op unless a recording host is supplied). Not used by gameplay.
export const DEMO_ACTIVATION_OPTS = Object.freeze({
  confirmed: true,
  routeAllowlist: Object.freeze(['/zone/']),
  hostContext: Object.freeze({ currentRoute: '/', rollbackRoute: '/' }),
});
