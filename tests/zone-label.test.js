// tests/zone-label.test.js — locks the v0.2.184 portal-prompt + entered-zone display
// labels (zoneLabel.js). Covers: the in-range prompt naming the target zone, the
// generic fallback, the entered-zone notice, key/prefix overrides, safe sanitisation
// of hostile/free-form input (no markup or dangerous token can survive), the debug
// shell report, and SDK exposure. Pure helpers → node-safe.
import { describe, it, expect } from 'vitest';
import {
  ZONE_LABEL_VERSION, ZONE_LABEL_BADGE, DEFAULT_PORTAL_KEY, DEFAULT_ENTERED_PREFIX,
  portalPromptLabel, enteredZoneLabel, DEMO_ZONE_LABEL_OPTS,
} from '../src/engine/gateway/zoneLabel.js';
import { zoneLabelReport } from '../src/engine/debug/shellReport.js';
import * as SDK from '../src/sdk/index.js';

const DANGEROUS = /[<>"'`]|javascript:|data:|on\w+=/i;

describe('module shape', () => {
  it('exports version, badge, defaults, and the two label helpers', () => {
    expect(ZONE_LABEL_VERSION).toBe(1);
    expect(ZONE_LABEL_BADGE).toBe('ZONE LABEL · DISPLAY-ONLY · INERT');
    expect(DEFAULT_PORTAL_KEY).toBe('F');
    expect(DEFAULT_ENTERED_PREFIX).toBe('Entered');
    expect(typeof portalPromptLabel).toBe('function');
    expect(typeof enteredZoneLabel).toBe('function');
    expect(DEMO_ZONE_LABEL_OPTS).toEqual({ slug: 'plebeian-market-bazaar', key: 'F' });
  });
});

describe('portalPromptLabel', () => {
  it('names the target zone from a slug', () => {
    expect(portalPromptLabel({ slug: 'plebeian-market-bazaar' }))
      .toBe('Press F to travel to Plebeian Market Bazaar');
  });

  it('accepts a /zone/<slug> route', () => {
    expect(portalPromptLabel({ route: '/zone/night-market' }))
      .toBe('Press F to travel to Night Market');
  });

  it('falls back to the generic prompt when no zone is known', () => {
    expect(portalPromptLabel({})).toBe('Press F to travel');
    expect(portalPromptLabel()).toBe('Press F to travel');
    expect(portalPromptLabel({ slug: 'Not A Slug!' })).toBe('Press F to travel to Not A Slug');
  });

  it('honours a custom key', () => {
    expect(portalPromptLabel({ slug: 'night-market', key: 'E' }))
      .toBe('Press E to travel to Night Market');
  });

  it('never throws and never emits a dangerous token', () => {
    for (const bad of [null, undefined, 42, [], { slug: '<script>' }, { title: 'a"b\'c`<>' }]) {
      const out = portalPromptLabel(bad);
      expect(typeof out).toBe('string');
      expect(out.startsWith('Press ')).toBe(true);
      expect(DANGEROUS.test(out)).toBe(false);
    }
  });
});

describe('enteredZoneLabel', () => {
  it('names the entered zone from a slug', () => {
    expect(enteredZoneLabel('plebeian-market-bazaar')).toBe('Entered: Plebeian Market Bazaar');
  });

  it('accepts a /zone/<slug> route', () => {
    expect(enteredZoneLabel('/zone/night-market')).toBe('Entered: Night Market');
  });

  it('honours a custom prefix', () => {
    expect(enteredZoneLabel('night-market', { prefix: 'Zone' })).toBe('Zone: Night Market');
  });

  it('returns empty string for nothing usable', () => {
    expect(enteredZoneLabel('')).toBe('');
    expect(enteredZoneLabel(null)).toBe('');
    expect(enteredZoneLabel(undefined)).toBe('');
  });

  it('sanitises hostile/free-form input to a safe label', () => {
    const out = enteredZoneLabel('<img src=x onerror=alert(1)>');
    expect(DANGEROUS.test(out)).toBe(false);
    expect(out.startsWith('Entered: ')).toBe(true);
  });

  it('never emits a dangerous token for adversarial input', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '"><svg/onload=1>', '../admin']) {
      expect(DANGEROUS.test(enteredZoneLabel(bad))).toBe(false);
    }
  });
});

describe('zoneLabelReport (debug shell)', () => {
  it('reports prompt/entered labels, the generic fallback, and a safe flag', () => {
    const r = zoneLabelReport();
    expect(r.title).toBe('ZONE LABEL');
    expect(r.badge).toBe(ZONE_LABEL_BADGE);
    expect(r.prompt).toBe('Press F to travel to Plebeian Market Bazaar');
    expect(r.promptGeneric).toBe('Press F to travel');
    expect(r.entered).toBe('Entered: Plebeian Market Bazaar');
    expect(r.safe).toBe(true);
    expect(DANGEROUS.test(r.hostileSanitized)).toBe(false);
  });

  it('pins inert flags false', () => {
    const r = zoneLabelReport();
    for (const k of ['navigated', 'performed', 'external', 'signed', 'published', 'network', 'actionable']) {
      expect(r[k]).toBe(false);
    }
  });
});

describe('SDK exposure', () => {
  it('exposes zoneLabel helpers + an EXPERIMENTAL surface entry', () => {
    expect(typeof SDK.zoneLabel.portalPromptLabel).toBe('function');
    expect(typeof SDK.zoneLabel.enteredZoneLabel).toBe('function');
    expect(SDK.SDK_SURFACE.zoneLabel).toBeDefined();
    expect(SDK.SDK_SURFACE.zoneLabel.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
