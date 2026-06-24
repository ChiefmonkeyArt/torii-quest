// tests/gateway-travel-confirm.test.js — locks the gateway TRAVEL CONFIRMATION /
// INTENT flow (src/engine/gateway/travelConfirm.js, GATEWAY / NAP-zone handoff,
// v0.2.165). Proves the inert travel path: a deterministic, sanitised destination is
// built from a gatewayRead preview model / plain descriptor, routed through the
// v0.2.162 consent gate (`gateway:travel`), and is BLOCKED unless an explicit matching
// grant is present. With a grant the report marks consent allowed but STILL never
// navigates/performs/signs/publishes (navigated/performed:false). Malformed/unknown
// destinations degrade safely. Pure module → node-testable.
import { describe, it, expect } from 'vitest';
import {
  TRAVEL_ACTION, DEMO_TRAVEL_INPUT,
  sanitizeDestination, summariseTravelConfirm, prepareTravelIntent,
} from '../src/engine/gateway/travelConfirm.js';
import * as travelConfirm from '../src/engine/gateway/travelConfirm.js';
import { CONSENT_REASON } from '../src/engine/consent/consentGate.js';
import { readGateways, DEMO_GATEWAY_EVENTS } from '../src/engine/gateway/gatewayRead.js';
import * as SDK from '../src/sdk/index.js';

const goodDest = (over = {}) => ({ zoneId: 'nap-garden', title: 'The Nap Garden', zoneType: 'nap', ...over });

describe('sanitizeDestination', () => {
  it('builds a sanitised destination from a clean descriptor', () => {
    const r = sanitizeDestination(goodDest({
      website: 'https://torii-quest.pplx.app/g', relays: ['wss://relay.example.com'],
    }));
    expect(r.ok).toBe(true);
    expect(r.destination.zoneId).toBe('nap-garden');
    expect(r.destination.title).toBe('The Nap Garden');
    expect(r.destination.zoneType).toBe('nap');
    expect(r.destination.website).toBe('https://torii-quest.pplx.app/g');
    expect(r.destination.relays).toEqual(['wss://relay.example.com/']);
  });

  it('consumes a v0.2.164 gatewayRead preview model directly (idempotent)', () => {
    const read = readGateways(DEMO_GATEWAY_EVENTS);
    const model = read.gateways[0];
    const r = sanitizeDestination(model);
    expect(r.ok).toBe(true);
    expect(r.destination.zoneId).toBe(model.zoneId);
    expect(r.destination.relays).toEqual(model.relays);
  });

  it('rejects a destination with no zone id', () => {
    expect(sanitizeDestination({ title: 'no id' }).ok).toBe(false);
    expect(sanitizeDestination({}).ok).toBe(false);
    expect(sanitizeDestination(null).ok).toBe(false);
  });

  it('strips control chars + HTML, https-only website, ws/wss-only relays, known zoneType', () => {
    const r = sanitizeDestination({
      zoneId: 'z<b>', title: 'Nap <b>Zone</b>', zoneType: 'evil',
      website: 'javascript:alert(1)', relays: ['http://bad', 'wss://ok.example.com', 'wss://u:p@creds'],
      npub: 'not-an-npub', pubkey: 'short',
    });
    expect(r.destination.zoneId).toBe('zb');
    expect(r.destination.title).toBe('Nap bZone/b');
    expect(r.destination.zoneType).toBeNull();
    expect(r.destination.website).toBeNull();
    expect(r.destination.relays).toEqual(['wss://ok.example.com/']);
    expect(r.destination.npub).toBeNull();
    expect(r.destination.pubkey).toBeNull();
  });

  it('keeps a valid npub + 64-hex pubkey and shortens the key', () => {
    const npub = 'npub1' + 'a'.repeat(40);
    const pub = 'b'.repeat(64);
    const r = sanitizeDestination(goodDest({ npub, pubkey: pub }));
    expect(r.destination.npub).toBe(npub);
    expect(r.destination.pubkey).toBe(pub);
    expect(r.destination.shortPubkey).toContain('…');
  });

  it('never throws on garbage', () => {
    for (const g of [null, undefined, 42, 'str', [], {}]) {
      expect(() => sanitizeDestination(g)).not.toThrow();
    }
  });
});

describe('prepareTravelIntent — consent routing', () => {
  it('is BLOCKED with no grant (consent-required), ok:false', () => {
    const r = prepareTravelIntent(DEMO_TRAVEL_INPUT);
    expect(r.ok).toBe(false);
    expect(r.action).toBe(TRAVEL_ACTION);
    expect(r.consent.blocked).toBe(true);
    expect(r.consent.reason).toBe(CONSENT_REASON.CONSENT_REQUIRED);
    expect(r.destination).not.toBeNull(); // still previewed
  });

  it('is ALLOWED with a boolean grant — but never performs', () => {
    const r = prepareTravelIntent(DEMO_TRAVEL_INPUT, true);
    expect(r.ok).toBe(true);
    expect(r.consent.allowed).toBe(true);
    expect(r.consent.reason).toBe(CONSENT_REASON.CONSENT_GRANTED);
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
  });

  it('is ALLOWED with a matching scoped grant', () => {
    const r = prepareTravelIntent(DEMO_TRAVEL_INPUT, { granted: true, action: TRAVEL_ACTION });
    expect(r.ok).toBe(true);
    expect(r.consent.reason).toBe(CONSENT_REASON.CONSENT_GRANTED);
  });

  it('is BLOCKED on a grant minted for a different action (no privilege transfer)', () => {
    const r = prepareTravelIntent(DEMO_TRAVEL_INPUT, { granted: true, action: 'leaderboard:submit' });
    expect(r.ok).toBe(false);
    expect(r.consent.reason).toBe(CONSENT_REASON.CONSENT_MISMATCH);
  });

  it('is BLOCKED on { granted:false }', () => {
    const r = prepareTravelIntent(DEMO_TRAVEL_INPUT, { granted: false });
    expect(r.ok).toBe(false);
    expect(r.consent.blocked).toBe(true);
  });

  it('is ok:false with a null destination on a malformed target even WITH a grant', () => {
    const r = prepareTravelIntent({ destination: { title: 'no id' } }, true);
    expect(r.ok).toBe(false);
    expect(r.destination).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('accepts a bare descriptor and a { destination } wrapper equivalently', () => {
    const a = prepareTravelIntent(goodDest(), true);
    const b = prepareTravelIntent({ destination: goodDest() }, true);
    expect(a.ok).toBe(b.ok);
    expect(a.destination.zoneId).toBe(b.destination.zoneId);
  });
});

describe('inert-flag invariants', () => {
  it('pins navigated/performed/signed/published:false + readOnly:true on every report', () => {
    for (const grant of [null, true, { granted: false }, { granted: true, action: 'x' }]) {
      const r = prepareTravelIntent(DEMO_TRAVEL_INPUT, grant);
      expect(r.navigated).toBe(false);
      expect(r.performed).toBe(false);
      expect(r.signed).toBe(false);
      expect(r.published).toBe(false);
      expect(r.readOnly).toBe(true);
    }
  });
});

describe('summariseTravelConfirm', () => {
  it('renders one stable line carrying the consent stakes + destination, preview-only', () => {
    const line = summariseTravelConfirm(DEMO_TRAVEL_INPUT);
    expect(line).toContain('TRAVEL');
    expect(line).toContain('The Nap Garden');
    expect(line).toContain('preview only, not travelled');
  });

  it('reports a blocked line on an invalid destination', () => {
    expect(summariseTravelConfirm({ destination: {} })).toContain('no valid destination');
  });
});

describe('module surface — inert by construction', () => {
  it('exposes NO navigate/goto/travel/sign/publish/send/connect/apply/write method', () => {
    const forbidden = /^(navigate|goto|travelTo|sign|publish|send|connect|open|write|apply|post|fetch|request|unload|reload)/i;
    for (const key of Object.keys(travelConfirm)) {
      if (typeof travelConfirm[key] === 'function') {
        expect(forbidden.test(key)).toBe(false);
      }
    }
  });
});

describe('SDK exposure', () => {
  it('re-exports travelConfirm read-only on the SDK surface', () => {
    expect(SDK.travelConfirm).toBeTruthy();
    expect(typeof SDK.travelConfirm.prepareTravelIntent).toBe('function');
    expect(SDK.SDK_SURFACE.travelConfirm).toBeTruthy();
  });
});
