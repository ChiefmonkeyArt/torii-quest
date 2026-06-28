// tests/handoff-execute.test.js — locks the first controlled SAME-ORIGIN gateway
// travel EXECUTOR (src/engine/gateway/handoffExecute.js, v0.2.168). Proves it acts
// on a v0.2.167 READY plan ONLY through an injected host transport and ONLY for a
// safe same-origin route: missing transport / blocked / invalid plans are refused;
// a ready plan calls the fake navigate exactly once; an unsafe target route is
// rejected; the external targetUrl is never executed; a navigate failure triggers a
// single rollback; a rollback failure is captured; no bare browser-navigation method
// is exposed; safety flags are pinned; SDK/debug exposure. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import {
  EXECUTE_VERSION, EXECUTE_BADGE, EXECUTE_STATUS,
  isHostTransport, executeHandoff, executeHandoffFor,
} from '../src/engine/gateway/handoffExecute.js';
import { planHandoff } from '../src/engine/gateway/handoffPlan.js';
import { TRAVEL_ACTION } from '../src/engine/gateway/travelConfirm.js';
import * as SDK from '../src/sdk/index.js';

const VALID_DEST = { zoneId: 'nap-garden', title: 'The Nap Garden', zoneType: 'nap', website: 'https://example.com/garden' };

// A READY plan over a valid destination + matching grant.
function readyPlan(hostContext = { currentRoute: '/arena', rollbackRoute: '/home' }) {
  return planHandoff({ destination: VALID_DEST }, true, hostContext);
}

// A fake host transport that RECORDS calls instead of touching any browser API.
function fakeTransport(overrides = {}) {
  const calls = { navigate: [], rollback: [], snapshot: 0, log: [] };
  return {
    calls,
    navigate(route) { calls.navigate.push(route); return overrides.navigate ? overrides.navigate(route) : undefined; },
    snapshot() { calls.snapshot += 1; if (overrides.snapshot) return overrides.snapshot(); },
    rollback(route) { calls.rollback.push(route); return overrides.rollback ? overrides.rollback(route) : undefined; },
    log(entry) { calls.log.push(entry); },
  };
}

describe('module shape', () => {
  it('pins a version, an acting badge, and outcome tiers', () => {
    expect(EXECUTE_VERSION).toBe(1);
    expect(EXECUTE_BADGE).toBe('TRAVEL · SAME-ORIGIN · HOST-TRANSPORT');
    expect(Object.values(EXECUTE_STATUS)).toEqual(['done', 'no-op', 'blocked', 'failed', 'rolled-back']);
    expect(Object.isFrozen(EXECUTE_STATUS)).toBe(true);
  });
});

describe('isHostTransport', () => {
  it('requires a navigate function', () => {
    expect(isHostTransport({ navigate() {} })).toBe(true);
    expect(isHostTransport({})).toBe(false);
    expect(isHostTransport({ navigate: 'x' })).toBe(false);
    expect(isHostTransport(null)).toBe(false);
    expect(isHostTransport([])).toBe(false);
    expect(isHostTransport('navigate')).toBe(false);
  });
});

describe('refusals — no action attempted', () => {
  it('NO-OPs with no transport (ready plan, but nothing to act through)', () => {
    const r = executeHandoff(readyPlan(), null);
    expect(r.status).toBe(EXECUTE_STATUS.NOOP);
    expect(r.reason).toBe('no-transport');
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
    expect(r.targetRoute).toBe('/zone/nap-garden/');
  });

  it('NO-OPs when opts.dryRun forces it, even WITH a transport', () => {
    const t = fakeTransport();
    const r = executeHandoff(readyPlan(), t, { dryRun: true });
    expect(r.status).toBe(EXECUTE_STATUS.NOOP);
    expect(r.reason).toBe('dry-run');
    expect(t.calls.navigate).toEqual([]);
    expect(r.performed).toBe(false);
  });

  it('BLOCKS a non-ready plan (blocked consent) without calling the transport', () => {
    const blocked = planHandoff({ destination: VALID_DEST }); // no grant → blocked
    const t = fakeTransport();
    const r = executeHandoff(blocked, t);
    expect(r.status).toBe(EXECUTE_STATUS.BLOCKED);
    expect(r.reason).toBe('plan-not-ready');
    expect(t.calls.navigate).toEqual([]);
    expect(r.navigated).toBe(false);
  });

  it('BLOCKS an invalid plan (no destination)', () => {
    const invalid = planHandoff({ destination: { title: 'no zone id' } }, true);
    const r = executeHandoff(invalid, fakeTransport());
    expect(r.status).toBe(EXECUTE_STATUS.BLOCKED);
    expect(r.reason).toBe('plan-not-ready');
  });

  it('BLOCKS a hand-tampered plan whose targetRoute is unsafe', () => {
    const tampered = { ...readyPlan(), targetRoute: 'javascript:alert(1)' };
    const t = fakeTransport();
    const r = executeHandoff(tampered, t);
    expect(r.status).toBe(EXECUTE_STATUS.BLOCKED);
    expect(r.reason).toBe('unsafe-target-route');
    expect(t.calls.navigate).toEqual([]);
  });

  it('never throws on hostile/malformed input', () => {
    for (const bad of [null, undefined, 42, [], {}, 'nope', { status: 'ready' }]) {
      const r = executeHandoff(bad, bad, bad);
      expect(r.navigated).toBe(false);
      expect(r.performed).toBe(false);
      expect([EXECUTE_STATUS.BLOCKED, EXECUTE_STATUS.NOOP]).toContain(r.status);
    }
  });
});

describe('ready plan executes through the injected transport', () => {
  it('hands the SAFE same-origin route to navigate exactly once → done', () => {
    const t = fakeTransport();
    const r = executeHandoff(readyPlan(), t);
    expect(r.status).toBe(EXECUTE_STATUS.DONE);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('navigated');
    expect(r.navigated).toBe(true);
    expect(r.performed).toBe(true);
    expect(t.calls.navigate).toEqual(['/zone/nap-garden/']);
    expect(t.calls.snapshot).toBe(1);
    expect(r.fromRoute).toBe('/arena');
    expect(r.steps.some((s) => s.step === 'navigate' && s.ok)).toBe(true);
  });

  it('NEVER hands the external targetUrl to the transport', () => {
    const t = fakeTransport();
    const plan = readyPlan();
    expect(plan.targetUrl).toBe('https://example.com/garden'); // present as preview only
    executeHandoff(plan, t);
    // navigate only ever receives the same-origin path, never the https url
    expect(t.calls.navigate).toEqual(['/zone/nap-garden/']);
    for (const route of t.calls.navigate) {
      expect(route.startsWith('/')).toBe(true);
      expect(route).not.toContain('https://');
    }
  });

  it('executeHandoffFor builds the plan then acts through the transport', () => {
    const t = fakeTransport();
    const r = executeHandoffFor({ destination: VALID_DEST }, true, t, { hostContext: { currentRoute: '/x' } });
    expect(r.status).toBe(EXECUTE_STATUS.DONE);
    expect(t.calls.navigate).toEqual(['/zone/nap-garden/']);
    expect(r.fromRoute).toBe('/x');
  });
});

describe('navigate failure → rollback', () => {
  it('attempts a single rollback when navigate throws → rolled-back', () => {
    const t = fakeTransport({ navigate() { throw new Error('boom'); } });
    const r = executeHandoff(readyPlan(), t);
    expect(r.status).toBe(EXECUTE_STATUS.ROLLED_BACK);
    expect(r.ok).toBe(false);
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
    expect(r.rolledBack).toBe(true);
    expect(r.rollback).toEqual({ attempted: true, ok: true, route: '/home' });
    expect(t.calls.rollback).toEqual(['/home']);
    expect(r.errors.some((e) => /boom/.test(e))).toBe(true);
  });

  it('treats an explicit false navigate return as a failure', () => {
    const t = fakeTransport({ navigate() { return false; } });
    const r = executeHandoff(readyPlan(), t);
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
    expect(r.rolledBack).toBe(true);
  });

  it('captures a rollback that itself fails → failed', () => {
    const t = fakeTransport({
      navigate() { throw new Error('nav-down'); },
      rollback() { throw new Error('rollback-down'); },
    });
    const r = executeHandoff(readyPlan(), t);
    expect(r.status).toBe(EXECUTE_STATUS.FAILED);
    expect(r.rolledBack).toBe(false);
    expect(r.rollback.attempted).toBe(true);
    expect(r.rollback.ok).toBe(false);
    expect(r.errors.some((e) => /rollback-down/.test(e))).toBe(true);
  });

  it('reports failed when navigate fails and no rollback transport exists', () => {
    const r = executeHandoff(readyPlan(), { navigate() { throw new Error('x'); } });
    expect(r.status).toBe(EXECUTE_STATUS.FAILED);
    expect(r.rolledBack).toBe(false);
    expect(r.rollback.attempted).toBe(false);
  });
});

describe('safety flags + no bare navigation surface', () => {
  it('pins external/world/sign/publish/network flags false on every report', () => {
    const reports = [
      executeHandoff(readyPlan(), fakeTransport()),
      executeHandoff(readyPlan(), null),
      executeHandoff(planHandoff({ destination: VALID_DEST }), fakeTransport()),
    ];
    for (const r of reports) {
      expect(r.external).toBe(false);
      expect(r.worldReloaded).toBe(false);
      expect(r.signed).toBe(false);
      expect(r.published).toBe(false);
      expect(r.network).toBe(false);
      expect(r.action).toBe(TRAVEL_ACTION);
    }
  });

  it('a caller cannot flip a pinned safety flag via the plan-ish input', () => {
    const sneaky = { ...readyPlan(), external: true, signed: true, network: true };
    const r = executeHandoff(sneaky, fakeTransport());
    expect(r.external).toBe(false);
    expect(r.signed).toBe(false);
    expect(r.network).toBe(false);
  });

  it('exposes NO bare browser-navigation method (location/open/reload/pushState/href/assign)', () => {
    const mod = { EXECUTE_VERSION, EXECUTE_BADGE, EXECUTE_STATUS, isHostTransport, executeHandoff, executeHandoffFor };
    const banned = /^(open|reload|goto|assign|href|pushState|replaceState|redirect|location|unload)/i;
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] === 'function') expect(name).not.toMatch(banned);
    }
  });

  it('is exported on the SDK as the handoffExecute namespace at EXPERIMENTAL', () => {
    expect(SDK.handoffExecute).toBeTruthy();
    expect(typeof SDK.handoffExecute.executeHandoff).toBe('function');
    expect(SDK.SDK_SURFACE.handoffExecute.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
