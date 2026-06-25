// engine/gateway/hostTransport.js — the real same-site host TRANSPORT ADAPTER for
// gateway travel (GATEWAY / NAP-zone handoff, v0.2.170). Builds the `transport`
// object that v0.2.168 `handoffExecute.executeHandoff(plan, transport)` consumes:
// `{ navigate(route), snapshot(), rollback(route), log(entry) }`. This is the seam
// that lets the executor perform a CONTROLLED same-origin route change in a real
// host — but every browser primitive is INJECTED through a host object, so the
// module itself never touches `window`/`history`/`location` and stays node-safe.
//
// Constrained by construction:
//   - Same-origin ONLY: `navigate`/`rollback` re-validate the route with
//     `safeRoutePath` (defense in depth on top of the executor). An external URL,
//     a protocol-relative `//host` route, a `javascript:`/`data:` scheme, markup,
//     whitespace, or control chars is REJECTED — `navigate` returns false, nothing
//     is handed to the host.
//   - Browser APIs are INJECTED, never imported: the host exposes `pushState(route)`
//     (required) + optional `replaceState(route)`/`getRoute()`. The default safe
//     host (`createRecordingHost`) is a pure in-memory recorder — it performs NO
//     real navigation, so the debug shell + tests act through a fake. Real runtime
//     wiring is the `createBrowserHostTransport(win)` seam, which uses ONLY
//     `history.pushState`/`replaceState` (same-origin, reversible, no reload) — it
//     is NOT invoked anywhere by default.
//   - Rollback / back-home escape WITHOUT timers: `snapshot()` records the current
//     route; `rollback(route)` restores the given route, else the snapshot, else the
//     configured `home` — one synchronous call, no `setTimeout`.
//   - NO external navigation (`location.href`/`location.assign`/`window.open`/
//     `reload`), NO world unload/reload, NO network/fetch, NO WebSocket/relay, NO
//     signing, NO publishing, NO NIP-07, NO key handling, NO payments, NO auto-
//     update. The transport's only effect is a same-origin route change via the
//     injected host; all executor safety flags (external/worldReloaded/signed/
//     published/network) stay false.
//   - Pure + node-safe: no THREE/Rapier/DOM/fs imports; exposes NO bare
//     navigate/open/reload/goto/assign/href method of its own at module scope.

import { safeRoutePath } from './handoffPlan.js';

// HOST_TRANSPORT_VERSION — bumped when the transport/host shape changes.
export const HOST_TRANSPORT_VERSION = 1;

// Badge: this transport ACTS, but only same-origin via the History API.
export const HOST_TRANSPORT_BADGE = 'TRANSPORT · SAME-ORIGIN · HISTORY-PUSHSTATE';

// The safe fallback route used when no rollback/snapshot route is available.
const DEFAULT_HOME = '/';

// isRouteHost(host) → true when `host` can change the route: either a bare callable
// (treated as `pushState`) or a plain object exposing a `pushState` function. Pure,
// never throws. The presence of a usable host is what separates an ACTING transport
// from the default no-op.
export function isRouteHost(host) {
  if (typeof host === 'function') return true;
  return !!host && typeof host === 'object' && !Array.isArray(host) && typeof host.pushState === 'function';
}

// _normalizeHost(host) → { push, replace, read } of bound thunks, or null when the
// host is unusable. `push` is required; `replace` falls back to `push` (so a host
// without replaceState still rolls back, just via a new history entry); `read` is
// null when the host cannot report its current route. Pure; binds methods on the
// host so `this` is preserved.
function _normalizeHost(host) {
  if (typeof host === 'function') {
    return { push: (r) => host(r), replace: (r) => host(r), read: null };
  }
  if (!host || typeof host !== 'object' || Array.isArray(host) || typeof host.pushState !== 'function') return null;
  const push = (r) => host.pushState(r);
  const replace = typeof host.replaceState === 'function' ? (r) => host.replaceState(r) : push;
  const read = typeof host.getRoute === 'function' ? () => host.getRoute() : null;
  return { push, replace, read };
}

// createHostTransport(host, opts) → a transport for `executeHandoff`, or null when
// no usable host is given (so the executor degrades to its safe NO-OP). Pure of
// browser side effects — its ONLY effect is whatever the injected host does.
//
//   host  fn(route) | { pushState(route), replaceState?(route), getRoute?() }
//   opts  { home?:string, onLog?:fn }  — `home` is the safe fallback rollback route
//
// Returns { navigate(route), snapshot(), rollback(route), log(entry) }:
//   - navigate(route): re-validate same-origin → host.push → true; unsafe → false.
//   - snapshot():      record current route (host.read, sanitised) or `home`.
//   - rollback(route): restore route|snapshot|home via host.replace → true; else false.
//   - log(entry):      best-effort sink (opts.onLog); never throws.
export function createHostTransport(host, opts = {}) {
  const h = _normalizeHost(host);
  if (!h) return null;

  const home = safeRoutePath(opts && opts.home) || DEFAULT_HOME;
  const onLog = opts && typeof opts.onLog === 'function' ? opts.onLog : null;
  let saved = null; // the route captured by snapshot() — the back-home escape target.

  const log = (entry) => { if (onLog) { try { onLog(entry); } catch { /* host log is best-effort */ } } };

  return {
    // navigate(route) — the single ACTING step. Same-origin re-validation is defense
    // in depth: the executor already checked, but the transport refuses anything that
    // is not a safe `/path`. Returns false (never throws on a bad route) so the
    // executor treats a rejected route as a navigation failure and rolls back.
    navigate(route) {
      const safe = safeRoutePath(route);
      if (!safe) { log({ event: 'transport:reject', route: String(route) }); return false; }
      h.push(safe);
      log({ event: 'transport:navigate', route: safe });
      return true;
    },
    // snapshot() — capture where we are now so a failed/aborted hop can return here.
    snapshot() {
      const here = h.read ? safeRoutePath(h.read()) : null;
      saved = here || home;
      log({ event: 'transport:snapshot', route: saved });
      return saved;
    },
    // rollback(route) — restore a safe route. Explicit route wins; else the snapshot;
    // else the configured home. Called by the executor on navigate failure, or
    // directly as a "back-home" escape (rollback() with no arg). One synchronous
    // call, no timers. Returns false only if no safe target can be resolved.
    rollback(route) {
      const target = safeRoutePath(route) || saved || home;
      if (!target) return false;
      h.replace(target);
      log({ event: 'transport:rollback', route: target });
      return true;
    },
    log,
  };
}

// createRecordingHost(initialRoute) → a pure IN-MEMORY host that records every
// route change instead of touching a browser. This is the DEFAULT-SAFE host: the
// debug shell + tests act through it, so an "acting" run performs no real
// navigation. Exposes `route` (current), `calls` ({pushState,replaceState}), and the
// host method surface. Pure, never throws.
export function createRecordingHost(initialRoute = DEFAULT_HOME) {
  const start = safeRoutePath(initialRoute) || DEFAULT_HOME;
  return {
    route: start,
    calls: { pushState: [], replaceState: [] },
    pushState(route) { this.calls.pushState.push(route); this.route = route; },
    replaceState(route) { this.calls.replaceState.push(route); this.route = route; },
    getRoute() { return this.route; },
  };
}

// createBrowserHostTransport(win, opts) → the REAL same-site runtime seam. Builds a
// host from an injected window-like object and returns a transport. It uses ONLY
// `win.history.pushState`/`replaceState` (same-origin, reversible, NO page reload)
// and reads `win.location.pathname+search` for the snapshot — it NEVER assigns
// `location.href`, calls `window.open`, or reloads. Returns null when `win` lacks a
// usable History API (so the executor safely no-ops). This module never calls it at
// import time; wiring it into the live app is the next, separately-reviewed step.
export function createBrowserHostTransport(win, opts = {}) {
  if (!win || typeof win !== 'object') return null;
  const history = win.history;
  if (!history || typeof history.pushState !== 'function') return null;
  const host = {
    pushState(route) { history.pushState({}, '', route); },
    replaceState(route) {
      if (typeof history.replaceState === 'function') history.replaceState({}, '', route);
      else history.pushState({}, '', route);
    },
    getRoute() {
      const loc = win.location;
      return loc ? `${loc.pathname || ''}${loc.search || ''}` : null;
    },
  };
  return createHostTransport(host, opts);
}
