// tests/handoff-plan.test.js — locks the host TRAVEL HANDOFF SEAM
// (src/engine/gateway/handoffPlan.js, GATEWAY / NAP-zone handoff, v0.2.167).
// Proves the dry-run plan layer over the v0.2.165 travel intent: an allowed,
// matching gateway:travel intent yields a READY dry-run plan; blocked/mismatched/
// malformed intents are rejected; route/url fields are sanitised (same-origin path
// or https-only); a rollback route is always present; safety flags are pinned; no
// navigation/action method is exposed; SDK/debug exposure. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_PLAN_VERSION, HANDOFF_BADGE, HANDOFF_STATUS, HANDOFF_COMMANDS,
  safeRoutePath, handoffRouteFor, handoffUrlFor, summariseHandoff, planHandoff,
  DEMO_HANDOFF_INPUT,
} from '../src/engine/gateway/handoffPlan.js';
import { TRAVEL_ACTION } from '../src/engine/gateway/travelConfirm.js';
import { CONSENT_REASON } from '../src/engine/consent/consentGate.js';
import * as SDK from '../src/sdk/index.js';

const VALID_DEST = { zoneId: 'nap-garden', title: 'The Nap Garden', zoneType: 'nap', website: 'https://example.com/garden' };

describe('module shape', () => {
  it('pins a version, a dry-run badge, status tiers, and future command names', () => {
    expect(HANDOFF_PLAN_VERSION).toBe(1);
    expect(HANDOFF_BADGE).toBe('HANDOFF · DRY-RUN · NO NAVIGATION');
    expect(Object.values(HANDOFF_STATUS)).toEqual(['ready', 'blocked', 'invalid']);
    expect(HANDOFF_COMMANDS).toContain('navigate');
    expect(HANDOFF_COMMANDS).toContain('unloadWorld');
    expect(Object.isFrozen(HANDOFF_COMMANDS)).toBe(true);
  });
});

describe('safeRoutePath', () => {
  it('accepts a single-slash same-origin path', () => {
    expect(safeRoutePath('/zone/nap-garden')).toBe('/zone/nap-garden');
    expect(safeRoutePath('/')).toBe('/');
  });
  it('rejects protocol-relative, schemes, control chars, markup, whitespace, non-strings', () => {
    for (const bad of ['//evil.com', 'http://x', 'javascript:alert(1)', 'zone/x', '/a b', '/a<b>', '/a\\b', '/a\nb', '', 42, null, undefined]) {
      expect(safeRoutePath(bad)).toBeNull();
    }
  });
  it('rejects dot-dot traversal segments (SEC route-hardening v0.2.179)', () => {
    for (const bad of ['/zone/../admin', '/..', '/../etc', '/zone/..', '/a/../../b']) {
      expect(safeRoutePath(bad)).toBeNull();
    }
  });
  it('rejects any percent-encoding (SEC route-hardening v0.2.179)', () => {
    for (const bad of ['/zone/%2e%2e/admin', '/zone/%2fadmin', '/%00', '/a%20b']) {
      expect(safeRoutePath(bad)).toBeNull();
    }
  });
  it('still accepts a plain safe /zone/foo route after hardening', () => {
    expect(safeRoutePath('/zone/foo')).toBe('/zone/foo');
  });
});

describe('handoffRouteFor + handoffUrlFor', () => {
  it('derives a slugged same-site route from the zone id', () => {
    expect(handoffRouteFor({ zoneId: 'Nap Garden!!' })).toBe('/zone/nap-garden/');
    expect(handoffRouteFor({ zoneId: '' })).toBeNull();
    expect(handoffRouteFor(null)).toBeNull();
  });
  it('passes through only https external preview urls', () => {
    expect(handoffUrlFor({ website: 'https://example.com/x' })).toBe('https://example.com/x');
    expect(handoffUrlFor({ website: 'http://example.com' })).toBeNull();
    expect(handoffUrlFor({})).toBeNull();
  });
});

describe('planHandoff — allowed intent (dry-run plan)', () => {
  it('produces a READY plan with a matching grant, but performs nothing', () => {
    const p = planHandoff({ destination: VALID_DEST }, true, { currentRoute: '/arena' });
    expect(p.status).toBe(HANDOFF_STATUS.READY);
    expect(p.ok).toBe(true);
    expect(p.action).toBe(TRAVEL_ACTION);
    expect(p.reason).toBe('handoff-ready');
    expect(p.consent.allowed).toBe(true);
    expect(p.targetZoneId).toBe('nap-garden');
    expect(p.targetRoute).toBe('/zone/nap-garden/');
    expect(p.targetUrl).toBe('https://example.com/garden');
    expect(p.currentRoute).toBe('/arena');
    expect(p.rollbackRoute).toBe('/arena');
    // INERT invariants
    expect(p.dryRun).toBe(true);
    expect(p.navigated).toBe(false);
    expect(p.worldReloaded).toBe(false);
    expect(p.performed).toBe(false);
    expect(p.signed).toBe(false);
    expect(p.published).toBe(false);
    expect(p.readOnly).toBe(true);
    // preflight rows are display objects, all green for a ready plan
    for (const row of p.preflight) {
      expect(typeof row.check).toBe('string');
      expect(typeof row.ok).toBe('boolean');
    }
    expect(p.preflight.every((r) => r.ok)).toBe(true);
  });

  it('honours a scoped matching grant and reports the consent-granted reason', () => {
    const p = planHandoff({ destination: VALID_DEST }, { granted: true, action: TRAVEL_ACTION });
    expect(p.ok).toBe(true);
    expect(p.consent.reason).toBe(CONSENT_REASON.CONSENT_GRANTED);
  });

  it('falls back to the default route when the host injects none', () => {
    const p = planHandoff({ destination: VALID_DEST }, true);
    expect(p.currentRoute).toBe('/');
    expect(p.rollbackRoute).toBe('/');
  });

  it('uses an explicit injected rollback route distinct from the current route', () => {
    const p = planHandoff({ destination: VALID_DEST }, true, { currentRoute: '/arena', rollbackRoute: '/home' });
    expect(p.currentRoute).toBe('/arena');
    expect(p.rollbackRoute).toBe('/home');
  });
});

describe('planHandoff — blocked / mismatched / malformed', () => {
  it('blocks with no grant (consent-required) and never readies', () => {
    const p = planHandoff({ destination: VALID_DEST });
    expect(p.status).toBe(HANDOFF_STATUS.BLOCKED);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe(CONSENT_REASON.CONSENT_REQUIRED);
    expect(p.navigated).toBe(false);
    expect(p.performed).toBe(false);
  });

  it('blocks a grant minted for a different action', () => {
    const p = planHandoff({ destination: VALID_DEST }, { granted: true, action: 'leaderboard:submit' });
    expect(p.status).toBe(HANDOFF_STATUS.BLOCKED);
    expect(p.reason).toBe(CONSENT_REASON.CONSENT_MISMATCH);
    expect(p.ok).toBe(false);
  });

  it('marks invalid (no destination) even WITH a grant, with errors', () => {
    const p = planHandoff({ destination: { title: 'no zone id' } }, true);
    expect(p.status).toBe(HANDOFF_STATUS.INVALID);
    expect(p.ok).toBe(false);
    expect(p.destination).toBeNull();
    expect(p.targetRoute).toBeNull();
    expect(p.errors.length).toBeGreaterThan(0);
  });

  it('never throws on hostile/malformed input and yields a non-actionable plan', () => {
    for (const bad of [null, undefined, 42, [], {}, { action: 123 }, 'nope']) {
      const p = planHandoff(bad, bad, bad);
      expect(p.ok).toBe(false);
      expect(p.navigated).toBe(false);
      expect(p.performed).toBe(false);
      expect(p.dryRun).toBe(true);
    }
  });
});

describe('route / url sanitisation', () => {
  it('drops an unsafe injected current route back to the default', () => {
    const p = planHandoff({ destination: VALID_DEST }, true, { currentRoute: 'javascript:alert(1)' });
    expect(p.currentRoute).toBe('/');
  });
  it('never emits an unsafe target url (non-https website is dropped)', () => {
    const p = planHandoff({ destination: { zoneId: 'z', website: 'javascript:alert(1)' } }, true);
    expect(p.targetUrl).toBeNull();
    expect(p.targetRoute).toBe('/zone/z/');
  });
  it('no rendered route/url string contains a scheme or markup', () => {
    const p = planHandoff(DEMO_HANDOFF_INPUT, true, { currentRoute: '/title' });
    for (const s of [p.targetRoute, p.currentRoute, p.rollbackRoute]) {
      expect(s).toMatch(/^\//);
      expect(s).not.toMatch(/[<>]/);
    }
    if (p.targetUrl) expect(p.targetUrl.startsWith('https://')).toBe(true);
  });
});

describe('rollback plan presence', () => {
  it('always carries a rollback route, even on a blocked plan', () => {
    const blocked = planHandoff({ destination: VALID_DEST });
    expect(typeof blocked.rollbackRoute).toBe('string');
    expect(blocked.rollbackRoute.length).toBeGreaterThan(0);
    expect(blocked.preflight.some((r) => r.check === 'rollback-route-present' && r.ok)).toBe(true);
  });
});

describe('summariseHandoff', () => {
  it('produces a stable preview-only line', () => {
    const a = summariseHandoff(DEMO_HANDOFF_INPUT, true, { currentRoute: '/x' });
    const b = summariseHandoff(DEMO_HANDOFF_INPUT, true, { currentRoute: '/x' });
    expect(a).toBe(b);
    expect(a).toContain('dry-run');
  });
  it('reports a blocked handoff when no destination resolves', () => {
    expect(summariseHandoff({ destination: {} })).toContain('blocked');
  });
});

describe('no action methods + SDK/debug exposure', () => {
  it('exposes NO navigate/goto/open/reload/unload/load/sign/publish/connect/apply function', () => {
    const mod = { HANDOFF_PLAN_VERSION, HANDOFF_BADGE, HANDOFF_STATUS, HANDOFF_COMMANDS,
      safeRoutePath, handoffRouteFor, handoffUrlFor, summariseHandoff, planHandoff };
    const banned = /^(navigate|goto|open|reload|unload|load|perform|travel|sign|publish|send|connect|apply|fetch|post|push|assign|redirect)/i;
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] === 'function') expect(name).not.toMatch(banned);
    }
  });

  it('is exported on the SDK as the handoffPlan namespace', () => {
    expect(SDK.handoffPlan).toBeTruthy();
    expect(typeof SDK.handoffPlan.planHandoff).toBe('function');
    expect(SDK.SDK_SURFACE.handoffPlan.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
