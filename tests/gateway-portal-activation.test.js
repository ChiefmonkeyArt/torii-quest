// tests/gateway-portal-activation.test.js — locks the in-world GATEWAY PORTAL
// activation seam (src/engine/gateway/gatewayPortalActivation.js, v0.2.180). Proves:
// a gateway component maps to a same-origin activation input (internal `target` →
// `/zone/<slug>`, external website dropped); arming a portal NEVER navigates; only an
// explicit confirm acts and uses the injected browser/host transport; the allowlist
// is sanitised to a meaningful scoped prefix (a `['/']` is folded to `['/zone/']`,
// never permit-everything); rollback/back-home maps through; an unidentifiable /
// non-gateway destination is blocked with no navigation; and every external/world/
// network/sign/publish flag stays false. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import {
  PORTAL_ACTIVATION_VERSION, PORTAL_ACTIVATION_BADGE, PORTAL_STATE,
  DEFAULT_PORTAL_ALLOWLIST,
  sanitizePortalAllowlist, portalActivationInput, withinPortalRange,
  activatePortalHandoff, createGatewayPortalBoundary,
} from '../src/engine/gateway/gatewayPortalActivation.js';
import { ACTIVATION_STATUS, TRANSPORT_KIND } from '../src/engine/gateway/gatewayActivation.js';
import { createRecordingHost } from '../src/engine/gateway/hostTransport.js';
import { createToriiGateway } from '../src/engine/components/toriiGateway.js';
import { gatewayPortalActivationReport } from '../src/engine/debug/shellReport.js';
import * as SDK from '../src/sdk/index.js';

// An ARMED demo gateway: a real internal `target` (so a same-origin zone resolves)
// plus an external website to prove the website is NEVER carried into the hop.
const GATEWAY = createToriiGateway({
  npub: 'npub1demo0portal0activation0fixture0traveller0xxxxxxxxxxx',
  relay: 'wss://relay.example.com',
  target: 'plebeian-market-bazaar',
  position: { x: 20, y: 0, z: 0 },
});
const CTX = Object.freeze({ title: 'Plebeian Bazaar', zoneType: 'shop' });

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
  it('pins a version and a confirmed-portal-hop badge', () => {
    expect(PORTAL_ACTIVATION_VERSION).toBe(1);
    expect(PORTAL_ACTIVATION_BADGE).toBe('GATEWAY PORTAL · CONFIRMED · SAME-ORIGIN HOP');
    expect(DEFAULT_PORTAL_ALLOWLIST).toContain('/zone/');
  });

  it('exposes NO bare browser-navigation method at module scope', () => {
    const mod = { sanitizePortalAllowlist, portalActivationInput, withinPortalRange, activatePortalHandoff, createGatewayPortalBoundary };
    const banned = /^(open|reload|goto|assign|href|pushState|replaceState|redirect|location|unload|navigate|travel)$/i;
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] === 'function') expect(name).not.toMatch(banned);
    }
  });
});

describe('portalActivationInput', () => {
  it('maps a gateway target to a same-origin zone input and DROPS the website', () => {
    const built = portalActivationInput(GATEWAY, CTX);
    expect(built.ok).toBe(true);
    expect(built.input.destination.zoneId).toBe('plebeian-market-bazaar');
    expect(built.input.destination.title).toBe('Plebeian Bazaar');
    expect(built.input.destination).not.toHaveProperty('website');
  });

  it('rejects a non-gateway component', () => {
    const built = portalActivationInput({ manifest: { kind: 'product' } });
    expect(built.ok).toBe(false);
    expect(built.input).toBeNull();
    expect(built.errors.length).toBeGreaterThan(0);
  });

  it('rejects a gateway with no same-origin target zone', () => {
    const noTarget = createToriiGateway({ npub: 'npub1demo0no0target0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', relay: 'wss://relay.example.com' });
    const built = portalActivationInput(noTarget);
    expect(built.ok).toBe(false);
    expect(built.input).toBeNull();
  });
});

describe('sanitizePortalAllowlist', () => {
  it('folds a trivially-permissive ["/"] to the default scoped list (never permit-all)', () => {
    expect(sanitizePortalAllowlist(['/'])).toEqual(['/zone/']);
  });
  it('keeps meaningful scoped prefixes', () => {
    expect(sanitizePortalAllowlist(['/zone/', '/world/'])).toEqual(['/zone/', '/world/']);
  });
  it('falls back to the default for a non-array or all-garbage list', () => {
    expect(sanitizePortalAllowlist(null)).toEqual(['/zone/']);
    expect(sanitizePortalAllowlist(['/', 1, 'x'])).toEqual(['/zone/']);
  });
});

describe('withinPortalRange (scalar proximity, no Vector3)', () => {
  it('true inside the radius, false outside', () => {
    expect(withinPortalRange({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 3)).toBe(true);
    expect(withinPortalRange({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 3)).toBe(false);
  });
  it('false for missing points or a non-positive radius', () => {
    expect(withinPortalRange(null, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(withinPortalRange({ x: 0 }, { x: 0 }, 0)).toBe(false);
  });
});

describe('activatePortalHandoff (one-shot)', () => {
  it('unconfirmed does NOT navigate, even with a usable host', () => {
    const host = createRecordingHost('/');
    const r = activatePortalHandoff(GATEWAY, CTX, true, { host });
    expect(r.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
    expect(r.navigated).toBe(false);
    expect(r.confirmed).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('a confirmed same-origin hop uses the HOST transport and navigates', () => {
    const host = createRecordingHost('/');
    const r = activatePortalHandoff(GATEWAY, CTX, true, { confirmed: true, host });
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(r.navigated).toBe(true);
    expect(r.zoneId).toBe('plebeian-market-bazaar');
    expect(r.targetRoute).toBe('/zone/plebeian-market-bazaar/');
    expect(r.transportKind).toBe(TRANSPORT_KIND.HOST);
    expect(host.calls.pushState).toEqual(['/zone/plebeian-market-bazaar/']);
  });

  it('a confirmed hop over an injected BROWSER window is "live"', () => {
    const win = fakeWindow('/');
    const r = activatePortalHandoff(GATEWAY, CTX, true, { confirmed: true, window: win });
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(r.live).toBe(true);
    expect(r.transportKind).toBe(TRANSPORT_KIND.BROWSER);
    expect(win.calls.pushState).toEqual(['/zone/plebeian-market-bazaar/']);
  });

  it('a ["/"] allowlist is folded to ["/zone/"] so the scoped hop STILL navigates', () => {
    const host = createRecordingHost('/');
    const r = activatePortalHandoff(GATEWAY, CTX, true, { confirmed: true, host, routeAllowlist: ['/'] });
    expect(r.routeAllowlist).toEqual(['/zone/']);
    expect(r.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(host.calls.pushState).toEqual(['/zone/plebeian-market-bazaar/']);
  });

  it('a missing grant blocks the hop (consent gate preserved)', () => {
    const host = createRecordingHost('/');
    const r = activatePortalHandoff(GATEWAY, CTX, null, { confirmed: true, host });
    expect(r.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('a non-gateway component is blocked with no navigation', () => {
    const host = createRecordingHost('/');
    const r = activatePortalHandoff({ manifest: { kind: 'product' } }, CTX, true, { confirmed: true, host });
    expect(r.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(r.reason).toBe('no-portal-destination');
    expect(r.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('SAFETY: never flips world/network/sign/publish/external flags', () => {
    const r = activatePortalHandoff(GATEWAY, CTX, true, { confirmed: true, host: createRecordingHost('/') });
    expect(r.external).toBe(false);
    expect(r.worldReloaded).toBe(false);
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.network).toBe(false);
  });

  it('a failed navigate rolls back to the rollback route', () => {
    let rolledTo = null;
    const transport = { navigate() { return false; }, rollback(route) { rolledTo = route; return true; } };
    const r = activatePortalHandoff(GATEWAY, CTX, true, {
      confirmed: true, transport, hostContext: { currentRoute: '/arena', rollbackRoute: '/home' },
    });
    expect(r.status).toBe(ACTIVATION_STATUS.ROLLED_BACK);
    expect(r.navigated).toBe(false);
    expect(rolledTo).toBe('/home');
  });
});

describe('createGatewayPortalBoundary (arm → confirm)', () => {
  it('starts idle and arming a valid portal NEVER navigates', () => {
    const host = createRecordingHost('/');
    const boundary = createGatewayPortalBoundary({ host });
    expect(boundary.state()).toBe(PORTAL_STATE.IDLE);
    const armed = boundary.arm(GATEWAY, CTX);
    expect(armed.armed).toBe(true);
    expect(armed.zoneId).toBe('plebeian-market-bazaar');
    expect(boundary.state()).toBe(PORTAL_STATE.ARMED);
    expect(host.calls.pushState).toEqual([]); // arming is inert
  });

  it('confirm() performs the explicit same-origin hop over the injected host', () => {
    const host = createRecordingHost('/');
    const boundary = createGatewayPortalBoundary({ host });
    boundary.arm(GATEWAY, CTX);
    const rep = boundary.confirm(true);
    expect(rep.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(rep.navigated).toBe(true);
    expect(host.calls.pushState).toEqual(['/zone/plebeian-market-bazaar/']);
    expect(boundary.state()).toBe(PORTAL_STATE.NAVIGATED);
    expect(boundary.armed()).toBe(false);
  });

  it('confirm() before arm() is a refused no-op (no navigation)', () => {
    const host = createRecordingHost('/');
    const boundary = createGatewayPortalBoundary({ host });
    const rep = boundary.confirm(true);
    expect(rep.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
    expect(rep.reason).toBe('not-armed');
    expect(host.calls.pushState).toEqual([]);
  });

  it('cancel() clears a staged portal without navigating', () => {
    const host = createRecordingHost('/');
    const boundary = createGatewayPortalBoundary({ host });
    boundary.arm(GATEWAY, CTX);
    boundary.cancel();
    expect(boundary.state()).toBe(PORTAL_STATE.IDLE);
    expect(boundary.armed()).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });

  it('the boundary allowlist is always a meaningful scoped list (["/"] folded)', () => {
    const boundary = createGatewayPortalBoundary({ host: createRecordingHost('/'), routeAllowlist: ['/'] });
    expect(boundary.routeAllowlist()).toEqual(['/zone/']);
  });

  it('arming a non-gateway leaves the boundary idle', () => {
    const boundary = createGatewayPortalBoundary({ host: createRecordingHost('/') });
    const armed = boundary.arm({ manifest: { kind: 'product' } });
    expect(armed.armed).toBe(false);
    expect(boundary.state()).toBe(PORTAL_STATE.IDLE);
  });
});

describe('never throws', () => {
  it('survives malformed input/grant/opts', () => {
    expect(() => activatePortalHandoff(null, undefined, undefined, null)).not.toThrow();
    expect(() => createGatewayPortalBoundary(null).confirm()).not.toThrow();
    expect(() => portalActivationInput(undefined)).not.toThrow();
  });
});

describe('SDK + debug exposure', () => {
  it('re-exports the portal-activation module at the experimental tier', () => {
    expect(typeof SDK.gatewayPortalActivation.activatePortalHandoff).toBe('function');
    expect(SDK.gatewayPortalActivation.PORTAL_ACTIVATION_BADGE).toBe(PORTAL_ACTIVATION_BADGE);
    expect(SDK.SDK_SURFACE.gatewayPortalActivation.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });

  it('the debug shell drives a CONFIRMED in-memory portal hop (no live navigation)', () => {
    const rep = gatewayPortalActivationReport();
    expect(rep.title).toBe('GATEWAY PORTAL ACTIVATION');
    expect(rep.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(rep.confirmed).toBe(true);
    expect(rep.live).toBe(false); // recording host, not the real browser
    expect(rep.inMemory).toBe(true);
    expect(rep.pushStateCalls).toEqual(['/zone/plebeian-market-bazaar/']);
    expect(rep.external).toBe(false);
    expect(rep.network).toBe(false);
  });

  it('the debug shell shows the unconfirmed no-op when confirmed:false', () => {
    const rep = gatewayPortalActivationReport(undefined, undefined, true, { confirmed: false });
    expect(rep.status).toBe(ACTIVATION_STATUS.UNCONFIRMED);
    expect(rep.navigated).toBe(false);
    expect(rep.pushStateCalls).toEqual([]);
  });
});
