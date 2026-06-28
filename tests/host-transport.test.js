// tests/host-transport.test.js — locks the real same-site host TRANSPORT ADAPTER
// (src/engine/gateway/hostTransport.js, v0.2.170). Proves it builds a transport
// compatible with handoffExecute that performs SAME-ORIGIN route changes ONLY
// through an injected host: safe paths reach the host's pushState; external URLs,
// protocol-relative routes, and unsafe paths are rejected; snapshot/rollback restore
// a safe route with no timers; a missing host yields the executor's no-op; no
// network/sign/publish/world flags are ever flipped; the browser seam stays inert by
// default; and the SDK/debug surface is exposed. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import {
  HOST_TRANSPORT_VERSION, HOST_TRANSPORT_BADGE,
  isRouteHost, createHostTransport, createRecordingHost, createBrowserHostTransport,
} from '../src/engine/gateway/hostTransport.js';
import { planHandoff } from '../src/engine/gateway/handoffPlan.js';
import { executeHandoff, EXECUTE_STATUS } from '../src/engine/gateway/handoffExecute.js';
import * as SDK from '../src/sdk/index.js';

const VALID_DEST = { zoneId: 'nap-garden', title: 'The Nap Garden', zoneType: 'nap', website: 'https://example.com/garden' };

function readyPlan(hostContext = { currentRoute: '/arena', rollbackRoute: '/home' }) {
  return planHandoff({ destination: VALID_DEST }, true, hostContext);
}

describe('module shape', () => {
  it('pins a version and an acting transport badge', () => {
    expect(HOST_TRANSPORT_VERSION).toBe(1);
    expect(HOST_TRANSPORT_BADGE).toBe('TRANSPORT · SAME-ORIGIN · HISTORY-PUSHSTATE');
  });

  it('exposes NO bare browser-navigation method at module scope', () => {
    const mod = {
      HOST_TRANSPORT_VERSION, HOST_TRANSPORT_BADGE,
      isRouteHost, createHostTransport, createRecordingHost, createBrowserHostTransport,
    };
    const banned = /^(open|reload|goto|assign|href|pushState|replaceState|redirect|location|unload|navigate)$/i;
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] === 'function') expect(name).not.toMatch(banned);
    }
  });
});

describe('isRouteHost', () => {
  it('accepts a callable or an object with pushState', () => {
    expect(isRouteHost(() => {})).toBe(true);
    expect(isRouteHost({ pushState() {} })).toBe(true);
    expect(isRouteHost({})).toBe(false);
    expect(isRouteHost({ pushState: 'x' })).toBe(false);
    expect(isRouteHost(null)).toBe(false);
    expect(isRouteHost([])).toBe(false);
  });
});

describe('createHostTransport — null when no usable host', () => {
  it('returns null for an unusable host', () => {
    expect(createHostTransport(null)).toBe(null);
    expect(createHostTransport({})).toBe(null);
    expect(createHostTransport(42)).toBe(null);
    expect(createHostTransport([])).toBe(null);
  });

  it('a null transport makes the executor NO-OP (missing host)', () => {
    const r = executeHandoff(readyPlan(), createHostTransport(null));
    expect(r.status).toBe(EXECUTE_STATUS.NOOP);
    expect(r.reason).toBe('no-transport');
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
  });
});

describe('same-origin navigation through an injected host', () => {
  it('hands the safe same-origin route to the host pushState', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host);
    expect(t.navigate('/zone/nap-garden')).toBe(true);
    expect(host.calls.pushState).toEqual(['/zone/nap-garden']);
    expect(host.route).toBe('/zone/nap-garden');
  });

  it('drives a full executor run end-to-end → done, in-memory only', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host, { home: '/home' });
    const r = executeHandoff(readyPlan(), t);
    expect(r.status).toBe(EXECUTE_STATUS.DONE);
    expect(r.navigated).toBe(true);
    expect(r.performed).toBe(true);
    expect(host.calls.pushState).toEqual(['/zone/nap-garden/']);
    expect(host.route).toBe('/zone/nap-garden/');
  });

  it('supports a bare callback host (treated as pushState)', () => {
    const seen = [];
    const t = createHostTransport((route) => seen.push(route));
    expect(t.navigate('/zone/x')).toBe(true);
    expect(seen).toEqual(['/zone/x']);
  });
});

describe('route rejection (defense in depth)', () => {
  it('rejects external URLs without touching the host', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host);
    for (const bad of ['https://evil.example.com', 'http://x/y', 'javascript:alert(1)', 'data:text/html,x']) {
      expect(t.navigate(bad)).toBe(false);
    }
    expect(host.calls.pushState).toEqual([]);
  });

  it('rejects protocol-relative and unsafe paths', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host);
    for (const bad of ['//evil.com/path', '/has space', '/has<markup>', '/back\\slash', 'no-leading-slash', '']) {
      expect(t.navigate(bad)).toBe(false);
    }
    expect(host.calls.pushState).toEqual([]);
  });
});

describe('snapshot + rollback / back-home escape (no timers)', () => {
  it('snapshot records the host current route', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host, { home: '/home' });
    expect(t.snapshot()).toBe('/arena');
  });

  it('rollback restores an explicit safe route', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host);
    expect(t.rollback('/home')).toBe(true);
    expect(host.calls.replaceState).toEqual(['/home']);
    expect(host.route).toBe('/home');
  });

  it('rollback() with no arg returns to the snapshot (back-home escape)', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host, { home: '/' });
    t.snapshot();            // captures /arena
    t.navigate('/zone/x');   // move away
    expect(t.rollback()).toBe(true);
    expect(host.route).toBe('/arena');
  });

  it('rollback falls back to home when nothing else is safe', () => {
    const host = createRecordingHost('/');
    const t = createHostTransport(host, { home: '/home' });
    expect(t.rollback(undefined)).toBe(true);
    expect(host.route).toBe('/home'); // no snapshot taken, no explicit route → home
  });

  it('executor rolls back through the host when navigate fails', () => {
    // A host whose pushState throws drives the executor failure → rollback path.
    let firstCall = true;
    const calls = { pushState: [], replaceState: [] };
    const host = {
      pushState(r) { calls.pushState.push(r); if (firstCall) { firstCall = false; throw new Error('nav-down'); } },
      replaceState(r) { calls.replaceState.push(r); },
      getRoute() { return '/arena'; },
    };
    const t = createHostTransport(host);
    const r = executeHandoff(readyPlan({ currentRoute: '/arena', rollbackRoute: '/home' }), t);
    expect(r.status).toBe(EXECUTE_STATUS.ROLLED_BACK);
    expect(r.rolledBack).toBe(true);
    expect(calls.replaceState).toEqual(['/home']);
  });
});

describe('safety: no network/sign/publish/world/external', () => {
  it('keeps every executor safety flag false on an acting run', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host);
    const r = executeHandoff(readyPlan(), t);
    expect(r.external).toBe(false);
    expect(r.worldReloaded).toBe(false);
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.network).toBe(false);
  });

  it('the recording host performs no real navigation — only in-memory records', () => {
    const host = createRecordingHost('/arena');
    const t = createHostTransport(host);
    executeHandoff(readyPlan(), t);
    // The only state changed is the host's own in-memory route/calls.
    expect(host.route).toBe('/zone/nap-garden/');
    expect(Object.keys(host.calls)).toEqual(['pushState', 'replaceState']);
  });

  it('module CODE (comments stripped) uses no timer / network / external-nav / sign / publish primitives', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(new URL('../src/engine/gateway/hostTransport.js', import.meta.url), 'utf8');
    // Strip `//` line comments so the safety-documentation prose (which deliberately
    // names what the module avoids) does not trigger the scan — only real code counts.
    const code = raw.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(/setTimeout|setInterval/.test(code)).toBe(false);
    expect(/\bfetch\b|WebSocket|XMLHttpRequest/.test(code)).toBe(false);
    expect(/location\.href|location\.assign|window\.open|\.reload\(/.test(code)).toBe(false);
    expect(/\bsign\(|publish/i.test(code)).toBe(false);
  });
});

describe('createBrowserHostTransport — runtime seam, inert by default', () => {
  it('returns null without a usable window/history', () => {
    expect(createBrowserHostTransport(null)).toBe(null);
    expect(createBrowserHostTransport({})).toBe(null);
    expect(createBrowserHostTransport({ history: {} })).toBe(null);
  });

  it('builds a transport over an injected fake window using ONLY pushState/replaceState', () => {
    const pushed = [];
    const replaced = [];
    const fakeWin = {
      history: {
        pushState(_s, _t, route) { pushed.push(route); },
        replaceState(_s, _t, route) { replaced.push(route); },
      },
      location: { pathname: '/arena', search: '' },
    };
    const t = createBrowserHostTransport(fakeWin);
    expect(t).toBeTruthy();
    expect(t.snapshot()).toBe('/arena');
    expect(t.navigate('/zone/nap-garden')).toBe(true);
    expect(pushed).toEqual(['/zone/nap-garden']);
    expect(t.navigate('https://evil.example.com')).toBe(false); // still same-origin only
    expect(t.rollback('/home')).toBe(true);
    expect(replaced).toEqual(['/home']);
  });
});

describe('SDK + debug exposure', () => {
  it('is exported on the SDK as the hostTransport namespace at EXPERIMENTAL', () => {
    expect(SDK.hostTransport).toBeTruthy();
    expect(typeof SDK.hostTransport.createHostTransport).toBe('function');
    expect(SDK.SDK_SURFACE.hostTransport.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
