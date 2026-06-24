// tests/gateway-handoff.test.js — locks the gateway portal/handoff shell (CMP-8
// continuation, src/engine/gateway/gatewayHandoff.js). Pure module → node-test.
// It bridges a gateway component to a validated travel intent / URL. We assert:
// the destination is extracted, the gateway block maps onto the intent fields,
// validation passes/fails correctly, the URL is a pure return value, and a
// non-gateway component is rejected. No navigation/relay/signing anywhere.
import { describe, it, expect } from 'vitest';
import {
  gatewayDestination, planGatewayTravel, gatewayTravelUrl,
} from '../src/engine/gateway/gatewayHandoff.js';
import { createToriiGateway } from '../src/engine/components/toriiGateway.js';
import { createProductDisplay } from '../src/engine/components/productDisplay.js';
import { parseTravelUrl } from '../src/engine/gateway/travelIntent.js';
import * as SDK from '../src/sdk/index.js';

describe('gatewayDestination', () => {
  it('extracts the gateway block from a gateway component', () => {
    const g = createToriiGateway({ npub: 'npub1dest', relay: 'wss://r.example', target: 'zone-9' });
    const dest = gatewayDestination(g);
    expect(dest.target).toBe('zone-9');
    expect(dest.relay).toBe('wss://r.example');
  });

  it('returns null for a non-gateway component', () => {
    expect(gatewayDestination(createProductDisplay())).toBeNull();
    expect(gatewayDestination(null)).toBeNull();
    expect(gatewayDestination({ manifest: {} })).toBeNull();
  });
});

describe('planGatewayTravel', () => {
  it('maps gateway target/relay onto a valid travel intent', () => {
    const g = createToriiGateway({ target: 'banker-bazaar', relay: 'wss://r.example' });
    const plan = planGatewayTravel(g, { from: 'cm-home', player: 'npub1traveller000000000000000000' });
    expect(plan.valid).toBe(true);
    expect(plan.intent.to).toBe('banker-bazaar');
    expect(plan.intent.from).toBe('cm-home');
    expect(plan.intent.relays).toEqual(['wss://r.example']);
    expect(plan.intent.player).toBe('npub1traveller000000000000000000');
  });

  it('falls back to the destination npub when no target id', () => {
    const g = createToriiGateway({ npub: 'npub1destination00000000000000000' });
    const plan = planGatewayTravel(g, {});
    expect(plan.valid).toBe(true);
    expect(plan.intent.to).toBe('npub1destination00000000000000000');
  });

  it('rejects a bad traveller npub', () => {
    const g = createToriiGateway({ target: 'zone-1' });
    const plan = planGatewayTravel(g, { player: 'not-an-npub' });
    expect(plan.valid).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/player must be an npub/);
  });

  it('rejects a non-gateway component', () => {
    const plan = planGatewayTravel(createProductDisplay(), {});
    expect(plan.valid).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/not a gateway/);
  });
});

describe('gatewayTravelUrl', () => {
  it('returns a parseable URL for a valid plan (no navigation)', () => {
    const g = createToriiGateway({ target: 'zone-42', relay: 'wss://r.example' });
    const res = gatewayTravelUrl(g, { from: 'cm-home' }, { base: '/travel' });
    expect(res.valid).toBe(true);
    expect(res.url.startsWith('/travel?')).toBe(true);
    const round = parseTravelUrl(res.url);
    expect(round.valid).toBe(true);
    expect(round.intent.to).toBe('zone-42');
    expect(round.intent.relays).toEqual(['wss://r.example']);
  });

  it('returns an empty url + errors for an invalid plan', () => {
    const res = gatewayTravelUrl(createProductDisplay(), {});
    expect(res.valid).toBe(false);
    expect(res.url).toBe('');
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

describe('gatewayHandoff — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.gatewayHandoff.planGatewayTravel).toBe('function');
    expect(SDK.SDK_SURFACE.gatewayHandoff.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('gatewayHandoff');
  });
});
