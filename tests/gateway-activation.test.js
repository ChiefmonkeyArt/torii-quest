// tests/gateway-activation.test.js — locks the LIVE-WIRE seam for a CONFIRMED
// same-origin gateway hop (src/engine/gateway/gatewayActivation.js, v0.2.178,
// LEAN-2). Proves: a CONFIRMED hop over a usable transport actually navigates (the
// route reaches the host's pushState); navigation is IMPOSSIBLE without an explicit
// confirmed:true; the consent gate is preserved (a missing/mismatched grant blocks);
// unsafe routes and out-of-allowlist same-origin routes are rejected with NO
// navigation; the browser-window path builds a History-pushState transport but is
// never reached without confirmation; rollback/back-home maps through; and every
// external/world/network/sign/publish flag stays false. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import {
  ACTIVATION_VERSION, ACTIVATION_BADGE, ACTIVATION_STATUS, TRANSPORT_KIND,
  DEMO_ACTIVATION_OPTS,
  resolveHostTransport, activateGatewayHandoff,
} from '../src/engine/gateway/gatewayActivation.js';
import { createRecordingHost } from '../src/engine/gateway/hostTransport.js';
import { gatewayActivationReport } from '../src/engine/debug/shellReport.js';
import * as SDK from '../src/sdk/index.js';

const VALID_DEST = { zoneId: 'nap-garden', title: 'The Nap Garden', zoneType: 'nap', website: 'https://example.com/garden' };
const INPUT = Object.freeze({ destination: VALID_DEST });
const CTX = Object.freeze({ currentRoute: '/arena', rollbackRoute: '/home' });

// A minimal fake window exposing only the History API the browser transport uses.
function fakeWindow(initial = '/') {
  const calls = { pushState: [], replaceState: [] };
  let path = initial;
  return {
    calls,
    history: {
      pushState(_s, _t, r) { calls.pushState.push(r); path = r; },
      replaceState(_s, _t, r) { calls.replaceState.push(r); path = r; },
    },
    location: { get pathname() { return path; }, search: '' },
  };
}

describe('module shape', () => {
  it('pins a version and a confirmed-hop badge', () => {
    expect(ACTIVATION_VERSION).toBe(1);
    expect(ACTIVATION_BADGE).toBe('GATEWAY · CONFIRMED · SAME-ORIGIN HOP');
  });

  it('exposes NO bare browser-navigation method at module scope', () => {
    const mod = { resolveHostTransport, activateGatewayHandoff };
    const banned = /^(open|reload|goto|assign|href|pushState|replaceState|redirect|location|unload|navigate|travel)$/i;
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] === 'function') expect(name).not.toMatch(banned);
    }
  });

  it('the demo opts are confirmed with a same-origin allowlist', () => {
    expect(DEMO_ACTIVATION_OPTS.confirmed).toBe(true);
    expect(DEMO_ACTIVATION_OPTS.routeAllowlist).toContain('/zone/');
  });
});

describe('resolveHostTransport', () => {
  it('passes a ready transport through as "injected"', () => {
    const t = { navigate() { return true; } };
    const { transport, kind } = resolveHostTransport(t);
    expect(transport).toBe(t);
    expect(kind).toBe(TRANSPORT_KIND.INJECTED);
  });

  it('builds a "browser" transport from an injected window', () => {
    const { transport, kind } = resolveHostTransport(fakeWindow('/'));
    expect(kind).toBe(TRANSPORT_KIND.BROWSER);
    expect(typeof transport.navigate).toBe('function');
  });

  it('builds a "host" transport from a recording host', () => {
    const { transport, kind } = resolveHostTransport(createRecordingHost('/'));
    expect(kind).toBe(TRANSPORT_KIND.HOST);
    expect(typeof transport.navigate).toBe('function');
  });

  it('null/garbage yields no transport (safe no-op)', () => {
    expect(resolveHostTransport(null)).toEqual({ transport: null, kind: TRANSPORT_KIND.NONE });
    expect(resolveHostTransport(42).kind).toBe(TRANSPORT_KIND.NONE);
    expect(resolveHostTransport({}).kind).toBe(TRANSPORT_KIND.NONE);
  });
});

describe('confirmation gate', () => {
  it('without confirmed:true it NEVER navigates, even with a usable host', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, { host, hostContext: CTX });
    expect(r.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
    expect(r.confirmed).toBe(false);
    expect(r.transportKind).toBe(TRANSPORT_KIND.NONE);
    expect(host.calls.pushState).toEqual([]); // host was never touched
    expect(r.execution).toBeNull();
  });

  it('a truthy-but-not-true confirmed is rejected (literal boolean required)', () => {
    const host = createRecordingHost('/');
    for (const bad of [1, 'true', 'yes', {}, []]) {
      const r = activateGatewayHandoff(INPUT, true, { confirmed: bad, host, hostContext: CTX });
      expect(r.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
      expect(r.navigated).toBe(false);
    }
    expect(host.calls.pushState).toEqual([]);
  });
});

describe('confirmed same-origin hop', () => {
  it('navigates: the safe route reaches the host pushState', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, {
      confirmed: true, host, hostContext: CTX, routeAllowlist: ['/zone/'],
    });
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(r.ok).toBe(true);
    expect(r.navigated).toBe(true);
    expect(r.performed).toBe(true);
    expect(r.confirmed).toBe(true);
    expect(r.targetRoute).toBe('/zone/nap-garden');
    expect(host.calls.pushState).toEqual(['/zone/nap-garden']);
    expect(r.transportKind).toBe(TRANSPORT_KIND.HOST);
    expect(r.live).toBe(false); // a recording host is not the real browser path
  });

  it('the BROWSER window path builds a History-pushState transport and is "live"', () => {
    const win = fakeWindow('/');
    const r = activateGatewayHandoff(INPUT, true, {
      confirmed: true, window: win, routeAllowlist: ['/zone/'],
    });
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(r.navigated).toBe(true);
    expect(r.live).toBe(true);
    expect(r.transportKind).toBe(TRANSPORT_KIND.BROWSER);
    expect(win.calls.pushState).toEqual(['/zone/nap-garden']);
  });

  it('SAFETY: a confirmed hop never flips world/network/sign/publish/external flags', () => {
    const r = activateGatewayHandoff(INPUT, true, { confirmed: true, host: createRecordingHost('/') });
    expect(r.external).toBe(false);
    expect(r.worldReloaded).toBe(false);
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.network).toBe(false);
  });
});

describe('consent gate preserved', () => {
  it('a missing grant blocks the hop (no navigation) even when confirmed', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, null, { confirmed: true, host, hostContext: CTX });
    expect(r.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('an unidentifiable destination blocks the hop', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff({ destination: {} }, true, { confirmed: true, host });
    expect(r.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });
});

describe('route restrictions', () => {
  it('a same-origin route outside the allowlist is blocked (no navigation)', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, {
      confirmed: true, host, routeAllowlist: ['/other/'],
    });
    expect(r.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(r.reason).toBe('route-not-allowed');
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('with no allowlist any safe same-origin route is allowed', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, { confirmed: true, host });
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(host.calls.pushState).toEqual(['/zone/nap-garden']);
  });

  it('a trivially-permissive ["/"] allowlist does NOT allow an arbitrary route (SEC v0.2.179)', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, {
      confirmed: true, host, routeAllowlist: ['/'],
    });
    expect(r.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(r.reason).toBe('route-not-allowed');
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('a meaningful ["/zone/"] allowlist still allows /zone/foo (SEC v0.2.179)', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, {
      confirmed: true, host, routeAllowlist: ['/zone/'],
    });
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(host.calls.pushState).toEqual(['/zone/nap-garden']);
  });

  it('an injected transport handed an unsafe route refuses it (defense in depth)', () => {
    // The transport itself re-validates with safeRoutePath, so even a hostile
    // transport caller cannot smuggle an external/scheme route through.
    let seen = null;
    const transport = { navigate(route) { seen = route; return true; } };
    const r = activateGatewayHandoff(INPUT, true, { confirmed: true, transport });
    expect(r.targetRoute).toBe('/zone/nap-garden'); // only a same-origin /path is ever produced
    expect(seen).toBe('/zone/nap-garden');
  });
});

describe('no-transport and dry-run no-ops', () => {
  it('confirmed but no transport → safe no-op', () => {
    const r = activateGatewayHandoff(INPUT, true, { confirmed: true });
    expect(r.status).toBe(ACTIVATION_STATUS.NO_TRANSPORT);
    expect(r.navigated).toBe(false);
    expect(r.transportKind).toBe(TRANSPORT_KIND.NONE);
  });

  it('dryRun forces a no-op even with a usable transport', () => {
    const host = createRecordingHost('/');
    const r = activateGatewayHandoff(INPUT, true, { confirmed: true, host, dryRun: true });
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });
});

describe('rollback / back-home', () => {
  it('a failed navigate rolls back to the rollback route', () => {
    let rolledTo = null;
    const transport = { navigate() { return false; }, rollback(r) { rolledTo = r; return true; } };
    const r = activateGatewayHandoff(INPUT, true, {
      confirmed: true, transport, hostContext: { currentRoute: '/arena', rollbackRoute: '/home' },
    });
    expect(r.status).toBe(ACTIVATION_STATUS.ROLLED_BACK);
    expect(r.ok).toBe(false);
    expect(r.navigated).toBe(false);
    expect(rolledTo).toBe('/home');
    expect(r.execution.rolledBack).toBe(true);
  });

  it('a failed navigate with no rollback support reports "failed"', () => {
    const transport = { navigate() { throw new Error('boom'); } };
    const r = activateGatewayHandoff(INPUT, true, { confirmed: true, transport });
    expect(r.status).toBe(ACTIVATION_STATUS.FAILED);
    expect(r.navigated).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('never throws', () => {
  it('survives malformed input/grant/opts', () => {
    expect(() => activateGatewayHandoff(null, undefined, null)).not.toThrow();
    expect(() => activateGatewayHandoff(undefined, 'x', 'y')).not.toThrow();
    const r = activateGatewayHandoff(undefined, undefined, undefined);
    expect(r.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
  });
});

describe('SDK + debug exposure', () => {
  it('re-exports the activation module at the experimental tier', () => {
    expect(typeof SDK.gatewayActivation.activateGatewayHandoff).toBe('function');
    expect(SDK.gatewayActivation.ACTIVATION_BADGE).toBe(ACTIVATION_BADGE);
    expect(SDK.SDK_SURFACE.gatewayActivation.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });

  it('the debug shell drives a CONFIRMED in-memory hop (no live navigation)', () => {
    const rep = gatewayActivationReport();
    expect(rep.title).toBe('GATEWAY ACTIVATION');
    expect(rep.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(rep.confirmed).toBe(true);
    expect(rep.live).toBe(false); // recording host, not the real browser
    expect(rep.inMemory).toBe(true);
    expect(rep.pushStateCalls).toEqual(['/zone/nap-garden']);
    expect(rep.external).toBe(false);
    expect(rep.network).toBe(false);
  });

  it('the debug shell shows the unconfirmed no-op when confirmed:false', () => {
    const rep = gatewayActivationReport(undefined, true, { confirmed: false });
    expect(rep.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
    expect(rep.navigated).toBe(false);
    expect(rep.pushStateCalls).toEqual([]);
  });
});
