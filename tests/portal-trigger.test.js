// tests/portal-trigger.test.js — locks the in-world PROXIMITY → CONFIRM trigger
// (src/engine/gateway/portalTrigger.js, v0.2.181) that drives the v0.2.180
// portal-activation boundary. Proves: walking INTO range arms the (inert) boundary
// and raises a prompt but NEVER navigates; walking OUT cancels + clears the prompt;
// only an explicit interact() confirms and navigates over the injected same-origin
// host; out-of-range never arms; reset() disarms; the boundary allowlist stays
// scoped to ['/zone/'] (never ['/']); an external website URL is never navigated;
// onPrompt fires only on range transitions; interact when not armed is a no-op.
// Pure module → node-safe (the boundary, which holds any injected window, is
// injected; this module never reaches a global window).
import { describe, it, expect } from 'vitest';
import {
  PORTAL_TRIGGER_VERSION, PORTAL_PROMPT_TEXT, createPortalTrigger,
} from '../src/engine/gateway/portalTrigger.js';
import { createGatewayPortalBoundary } from '../src/engine/gateway/gatewayPortalActivation.js';
import { ACTIVATION_STATUS } from '../src/engine/gateway/gatewayActivation.js';
import { createRecordingHost } from '../src/engine/gateway/hostTransport.js';
import { createToriiGateway } from '../src/engine/components/toriiGateway.js';
import { portalTriggerReport } from '../src/engine/debug/shellReport.js';
import * as SDK from '../src/sdk/index.js';

// A demo gateway carrying a real internal `target` (→ same-origin zone) AND an
// external website, to prove the website is never built into a navigated route.
const GATEWAY = createToriiGateway({
  npub: 'npub1demo0portal0trigger0fixture0traveller0xxxxxxxxxxxxx',
  relay: 'wss://relay.example.com',
  target: 'plebeian-market-bazaar',
  position: { x: 20, y: 0, z: 0 },
});
const CTX = Object.freeze({ title: 'Plebeian Bazaar', zoneType: 'shop', from: 'torii-quest' });
const PORTAL_POS = Object.freeze({ x: 20, y: 0, z: 0 });

// Build a trigger over a fresh recording-host boundary + a prompt-call recorder.
function makeTrigger(extra = {}) {
  const host = createRecordingHost('/');
  const boundary = createGatewayPortalBoundary({ host, routeAllowlist: ['/zone/'], ...extra });
  const prompts = [];
  const trigger = createPortalTrigger({
    boundary,
    component: GATEWAY,
    context: CTX,
    portalPos: PORTAL_POS,
    range: 3,
    onPrompt: (show, text) => prompts.push({ show, text }),
  });
  return { host, boundary, trigger, prompts };
}

describe('module shape', () => {
  it('pins a version and the interact prompt text', () => {
    expect(PORTAL_TRIGGER_VERSION).toBe(1);
    expect(PORTAL_PROMPT_TEXT).toBe('Press F to travel');
  });
  it('exposes NO bare browser-navigation method at module scope', () => {
    const mod = { createPortalTrigger };
    const banned = /^(open|reload|goto|assign|href|pushState|replaceState|redirect|location|unload|navigate|travel)$/i;
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] === 'function') expect(name).not.toMatch(banned);
    }
  });
});

describe('proximity (tick) is inert — arms but NEVER navigates', () => {
  it('entering range arms the boundary and raises the prompt without navigating', () => {
    const { host, trigger, prompts } = makeTrigger();
    const out = trigger.tick({ x: 21, y: 0, z: 0 }); // within radius 3 of (20,0,0)
    expect(out.inRange).toBe(true);
    expect(out.armed).toBe(true);
    expect(out.changed).toBe(true);
    expect(trigger.isArmed()).toBe(true);
    expect(trigger.promptShown()).toBe(true);
    expect(prompts).toEqual([{ show: true, text: PORTAL_PROMPT_TEXT }]);
    expect(host.calls.pushState).toEqual([]); // proximity NEVER navigates
  });

  it('out of range never arms and never prompts', () => {
    const { host, trigger, prompts } = makeTrigger();
    const out = trigger.tick({ x: 0, y: 0, z: 0 }); // far away
    expect(out.inRange).toBe(false);
    expect(out.armed).toBe(false);
    expect(trigger.isArmed()).toBe(false);
    expect(trigger.promptShown()).toBe(false);
    expect(prompts).toEqual([]);
    expect(host.calls.pushState).toEqual([]);
  });

  it('onPrompt fires ONLY on range transitions (not every in-range tick)', () => {
    const { trigger, prompts } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 }); // enter → show
    trigger.tick({ x: 21.5, y: 0, z: 0 }); // still in range → no new prompt
    trigger.tick({ x: 22, y: 0, z: 0 }); // still in range → no new prompt
    expect(prompts).toEqual([{ show: true, text: PORTAL_PROMPT_TEXT }]);
    trigger.tick({ x: 0, y: 0, z: 0 }); // leave → hide
    expect(prompts).toEqual([
      { show: true, text: PORTAL_PROMPT_TEXT },
      { show: false, text: '' },
    ]);
  });

  it('leaving range cancels the staged portal (disarms) without navigating', () => {
    const { host, boundary, trigger } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 });
    expect(boundary.armed()).toBe(true);
    trigger.tick({ x: 0, y: 0, z: 0 });
    expect(boundary.armed()).toBe(false);
    expect(trigger.isArmed()).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });
});

describe('interact() is the ONLY navigating step', () => {
  it('explicit interact while armed navigates over the injected same-origin host', () => {
    const { host, trigger, prompts } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 }); // arm
    const rep = trigger.interact(true);
    expect(rep).not.toBeNull();
    expect(rep.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(rep.navigated).toBe(true);
    expect(rep.zoneId).toBe('plebeian-market-bazaar');
    expect(rep.targetRoute).toBe('/zone/plebeian-market-bazaar/');
    expect(host.calls.pushState).toEqual(['/zone/plebeian-market-bazaar/']);
    // The prompt is cleared after a confirmed hop.
    expect(trigger.promptShown()).toBe(false);
    expect(prompts[prompts.length - 1]).toEqual({ show: false, text: '' });
  });

  it('interact when NOT armed is a safe no-op (returns null, no navigation)', () => {
    const { host, trigger } = makeTrigger();
    const rep = trigger.interact(true); // never entered range
    expect(rep).toBeNull();
    expect(host.calls.pushState).toEqual([]);
  });

  it('a confirmed hop NEVER navigates an external website URL — only /zone/<slug>', () => {
    const { host, trigger } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 });
    trigger.interact(true);
    for (const route of host.calls.pushState) {
      expect(route.startsWith('/zone/')).toBe(true);
      expect(route).not.toMatch(/^https?:|^\/\/|wss:/i);
    }
  });

  it('a missing grant blocks the hop (consent gate preserved)', () => {
    const { host, trigger } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 });
    const rep = trigger.interact(null);
    expect(rep.status).toBe(ACTIVATION_STATUS.BLOCKED);
    expect(rep.navigated).toBe(false);
    expect(host.calls.pushState).toEqual([]);
  });
});

describe('allowlist stays scoped to ["/zone/"] (never permit-all)', () => {
  it('folds a ["/"] boundary allowlist to ["/zone/"] and the hop still lands on /zone/', () => {
    const { host, trigger } = makeTrigger({ routeAllowlist: ['/'] });
    trigger.tick({ x: 21, y: 0, z: 0 });
    const rep = trigger.interact(true);
    expect(rep.routeAllowlist).toEqual(['/zone/']);
    expect(host.calls.pushState).toEqual(['/zone/plebeian-market-bazaar/']);
  });
});

describe('reset() and lifecycle', () => {
  it('reset() disarms a staged portal and clears the prompt (inert)', () => {
    const { host, boundary, trigger, prompts } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 });
    trigger.reset();
    expect(boundary.armed()).toBe(false);
    expect(trigger.isArmed()).toBe(false);
    expect(trigger.promptShown()).toBe(false);
    expect(prompts[prompts.length - 1]).toEqual({ show: false, text: '' });
    expect(host.calls.pushState).toEqual([]);
  });

  it('re-enters range after leaving (arm → leave → arm again)', () => {
    const { boundary, trigger } = makeTrigger();
    trigger.tick({ x: 21, y: 0, z: 0 });
    trigger.tick({ x: 0, y: 0, z: 0 });
    expect(boundary.armed()).toBe(false);
    const out = trigger.tick({ x: 21, y: 0, z: 0 });
    expect(out.changed).toBe(true);
    expect(boundary.armed()).toBe(true);
  });

  it('exposes injected geometry copies', () => {
    const { trigger } = makeTrigger();
    expect(trigger.portalPos()).toEqual({ x: 20, y: 0, z: 0 });
    expect(trigger.range()).toBe(3);
  });
});

describe('never throws on malformed wiring', () => {
  it('tick/interact are safe no-ops with no boundary/component/portalPos', () => {
    const t = createPortalTrigger(null);
    expect(() => t.tick(null)).not.toThrow();
    expect(t.tick({ x: 0, y: 0, z: 0 }).armed).toBe(false);
    expect(t.interact(true)).toBeNull();
    expect(() => t.reset()).not.toThrow();
  });
});

describe('SDK + debug exposure', () => {
  it('re-exports the portal-trigger module at the experimental tier', () => {
    expect(typeof SDK.portalTrigger.createPortalTrigger).toBe('function');
    expect(SDK.portalTrigger.PORTAL_PROMPT_TEXT).toBe(PORTAL_PROMPT_TEXT);
    expect(SDK.SDK_SURFACE.portalTrigger.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });

  it('the debug shell proves approach→arm (inert)→confirm over an in-memory host', () => {
    const rep = portalTriggerReport();
    expect(rep.title).toBe('GATEWAY PORTAL TRIGGER');
    expect(rep.farInRange).toBe(false);       // far tick does NOT arm
    expect(rep.nearInRange).toBe(true);
    expect(rep.armedAfterApproach).toBe(true);
    expect(rep.pushStateAfterArm).toEqual([]); // arming is inert — no navigation
    expect(rep.status).toBe(ACTIVATION_STATUS.NAVIGATED);
    expect(rep.navigated).toBe(true);
    expect(rep.live).toBe(false);             // recording host, not a real browser
    expect(rep.inMemory).toBe(true);
    expect(rep.routeAllowlist).toEqual(['/zone/']);
    expect(rep.pushStateCalls).toEqual(['/zone/plebeian-market-bazaar/']);
    expect(rep.external).toBe(false);
    expect(rep.network).toBe(false);
  });

  it('the debug shell shows the armed-but-not-confirmed no-op when interact:false', () => {
    const rep = portalTriggerReport(undefined, undefined, { interact: false });
    expect(rep.armedAfterApproach).toBe(true);
    expect(rep.interacted).toBe(false);
    expect(rep.navigated).toBe(false);
    expect(rep.pushStateCalls).toEqual([]);
  });
});
