// tests/zone-route.test.js — locks the v0.2.182 pure SPA `/zone/<slug>` route
// parser/resolver (src/engine/gateway/zoneRoute.js): strict slug validation, home/
// zone/invalid classification, same-origin hardening (traversal/percent/protocol-
// relative/scheme/sub-path/malformed all rejected), the inert display state, and the
// no-navigation/no-network invariants. Pure module → node-safe.
import { describe, it, expect } from 'vitest';
import {
  ZONE_ROUTE_VERSION, ZONE_ROUTE_BADGE, ZONE_ROUTE_PREFIX, ZONE_SLUG_MAX_LEN,
  ZONE_ROUTE_KIND, DEMO_ZONE_ROUTE,
  isValidZoneSlug, humanizeZoneSlug, zoneRouteFor, parseZoneRoute, describeZoneRoute,
} from '../src/engine/gateway/zoneRoute.js';
import { zoneRouteReport } from '../src/engine/debug/shellReport.js';
import * as SDK from '../src/sdk/index.js';

describe('module shape', () => {
  it('pins version, badge, prefix, and slug cap', () => {
    expect(ZONE_ROUTE_VERSION).toBe(1);
    expect(ZONE_ROUTE_BADGE).toBe('ZONE ROUTE · SAME-ORIGIN · INERT');
    expect(ZONE_ROUTE_PREFIX).toBe('/zone/');
    expect(ZONE_SLUG_MAX_LEN).toBe(64);
    expect(ZONE_ROUTE_KIND).toEqual({ HOME: 'home', ZONE: 'zone', INVALID: 'invalid' });
    expect(DEMO_ZONE_ROUTE).toBe('/zone/plebeian-market-bazaar/');
  });
});

describe('isValidZoneSlug', () => {
  it('accepts lowercase alnum words joined by single hyphens', () => {
    expect(isValidZoneSlug('plebeian-market-bazaar')).toBe(true);
    expect(isValidZoneSlug('zone1')).toBe(true);
    expect(isValidZoneSlug('a')).toBe(true);
  });
  it('rejects empty, uppercase, underscores, dots, slashes, bad hyphenation', () => {
    expect(isValidZoneSlug('')).toBe(false);
    expect(isValidZoneSlug('Bazaar')).toBe(false);
    expect(isValidZoneSlug('a_b')).toBe(false);
    expect(isValidZoneSlug('a.b')).toBe(false);
    expect(isValidZoneSlug('a/b')).toBe(false);
    expect(isValidZoneSlug('-lead')).toBe(false);
    expect(isValidZoneSlug('trail-')).toBe(false);
    expect(isValidZoneSlug('double--hyphen')).toBe(false);
  });
  it('rejects an over-length slug', () => {
    expect(isValidZoneSlug('a'.repeat(ZONE_SLUG_MAX_LEN))).toBe(true);
    expect(isValidZoneSlug('a'.repeat(ZONE_SLUG_MAX_LEN + 1))).toBe(false);
  });
  it('non-strings are never valid', () => {
    expect(isValidZoneSlug(null)).toBe(false);
    expect(isValidZoneSlug(undefined)).toBe(false);
    expect(isValidZoneSlug(42)).toBe(false);
  });
});

describe('humanizeZoneSlug / zoneRouteFor', () => {
  it('title-cases a valid slug, empties an invalid one', () => {
    expect(humanizeZoneSlug('plebeian-market-bazaar')).toBe('Plebeian Market Bazaar');
    expect(humanizeZoneSlug('Bad Slug!')).toBe('');
  });
  it('builds the canonical trailing-slash /zone/<slug>/ only for a valid slug', () => {
    expect(zoneRouteFor('plebeian-market-bazaar')).toBe('/zone/plebeian-market-bazaar/');
    expect(zoneRouteFor('Bad Slug!')).toBeNull();
  });
});

describe('parseZoneRoute — happy path (the route the portal trigger pushes)', () => {
  const r = parseZoneRoute('/zone/plebeian-market-bazaar');
  it('classifies a valid /zone/<slug> as a ZONE with inert display state', () => {
    expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(r.ok).toBe(true);
    expect(r.slug).toBe('plebeian-market-bazaar');
    expect(r.zoneId).toBe('plebeian-market-bazaar');
    expect(r.route).toBe('/zone/plebeian-market-bazaar/');
    expect(r.title).toBe('Plebeian Market Bazaar');
    expect(r.notice).toContain('Plebeian Market Bazaar');
  });
  it('pins every action/network flag false (interprets URL, never acts)', () => {
    expect(r.navigated).toBe(false);
    expect(r.performed).toBe(false);
    expect(r.external).toBe(false);
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.network).toBe(false);
  });
  it('drops a trailing query/hash before classifying', () => {
    const q = parseZoneRoute('/zone/plebeian-market-bazaar?ref=x#frag');
    expect(q.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(q.slug).toBe('plebeian-market-bazaar');
  });
});

describe('parseZoneRoute — canonical trailing slash (v0.2.243)', () => {
  it('accepts the canonical /zone/<slug>/ form and normalises route to trailing slash', () => {
    const r = parseZoneRoute('/zone/plebeian-market-bazaar/');
    expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(r.ok).toBe(true);
    expect(r.slug).toBe('plebeian-market-bazaar');
    expect(r.route).toBe('/zone/plebeian-market-bazaar/');
  });
  it('the no-slash form resolves identically (normalised to trailing slash)', () => {
    const a = parseZoneRoute('/zone/plebeian-market-bazaar');
    const b = parseZoneRoute('/zone/plebeian-market-bazaar/');
    expect(a.slug).toBe(b.slug);
    expect(a.route).toBe(b.route);
    expect(a.route).toBe('/zone/plebeian-market-bazaar/');
  });
  it('drops query/hash on the trailing-slash form too', () => {
    const q = parseZoneRoute('/zone/plebeian-market-bazaar/?ref=x#frag');
    expect(q.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(q.route).toBe('/zone/plebeian-market-bazaar/');
  });
});

describe('parseZoneRoute — home', () => {
  it('root path is HOME (nothing to resolve), ok:true', () => {
    const r = parseZoneRoute('/');
    expect(r.kind).toBe(ZONE_ROUTE_KIND.HOME);
    expect(r.ok).toBe(true);
    expect(r.slug).toBeNull();
  });
  it('a non-/zone same-origin path is HOME', () => {
    expect(parseZoneRoute('/about').kind).toBe(ZONE_ROUTE_KIND.HOME);
  });
});

describe('parseZoneRoute — same-origin hardening (all INVALID)', () => {
  const cases = {
    'dot-dot traversal':   '/zone/../admin',
    'percent-encoded':     '/zone/%2e%2e',
    'protocol-relative':   '//evil.example.com',
    'absolute scheme':     'javascript:alert(1)',
    'data scheme':         'data:text/html,x',
    'sub-path':            '/zone/a/b',
    'malformed slug':      '/zone/Bad Slug!',
    'empty slug':          '/zone/',
    'backslash':           '/zone/a\\b',
    'markup':              '/zone/<script>',
  };
  for (const [label, path] of Object.entries(cases)) {
    it(`rejects ${label} as INVALID with no navigation`, () => {
      const r = parseZoneRoute(path);
      expect(r.kind, label).toBe(ZONE_ROUTE_KIND.INVALID);
      expect(r.ok, label).toBe(false);
      expect(r.navigated).toBe(false);
      expect(r.network).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });
  }
  it('an over-length path is rejected (256-char cap via safeRoutePath)', () => {
    expect(parseZoneRoute('/zone/' + 'a'.repeat(300)).kind).toBe(ZONE_ROUTE_KIND.INVALID);
  });
  it('non-string input is INVALID, never throws', () => {
    expect(parseZoneRoute(null).kind).toBe(ZONE_ROUTE_KIND.INVALID);
    expect(parseZoneRoute(undefined).kind).toBe(ZONE_ROUTE_KIND.INVALID);
    expect(parseZoneRoute(123).kind).toBe(ZONE_ROUTE_KIND.INVALID);
  });
});

describe('describeZoneRoute', () => {
  it('gives a stable one-line summary per kind', () => {
    expect(describeZoneRoute('/zone/plebeian-market-bazaar')).toMatch(/Zone route .* → Plebeian Market Bazaar/);
    expect(describeZoneRoute('/zone/../admin')).toMatch(/Invalid zone route/);
    expect(describeZoneRoute('/')).toMatch(/Home route/);
  });
});

describe('zoneRouteReport (debug shell)', () => {
  const rep = zoneRouteReport();
  it('resolves the demo zone and labels every hostile path invalid', () => {
    expect(rep.title).toBe('ZONE ROUTE');
    expect(rep.badge).toBe(ZONE_ROUTE_BADGE);
    expect(rep.home).toEqual({ kind: 'home', ok: true });
    expect(rep.valid.kind).toBe('zone');
    expect(rep.valid.slug).toBe('plebeian-market-bazaar');
    for (const v of Object.values(rep.rejects)) expect(v).toBe('invalid');
  });
  it('pins inert/no-network flags', () => {
    expect(rep.navigated).toBe(false);
    expect(rep.network).toBe(false);
    expect(rep.external).toBe(false);
    expect(rep.signed).toBe(false);
    expect(rep.published).toBe(false);
    expect(rep.inMemory).toBe(true);
  });
});

describe('SDK exposure', () => {
  it('re-exports zoneRoute at the experimental tier', () => {
    expect(SDK.zoneRoute.ZONE_ROUTE_VERSION).toBe(1);
    expect(typeof SDK.zoneRoute.parseZoneRoute).toBe('function');
    expect(SDK.SDK_SURFACE.zoneRoute.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
  });
});
