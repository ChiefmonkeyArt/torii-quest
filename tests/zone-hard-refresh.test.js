// tests/zone-hard-refresh.test.js — the v0.2.244 HOST-SAFE canonical zone route. The
// published exact-path static host (chiefmonkey.art/quest) has NO SPA rewrite and NO
// directory index: it returns a JSON 404 for BOTH `/zone/<slug>` AND `/zone/<slug>/`, so
// every `/zone/*` PATH strategy failed live (v0.2.242 extensionless file → octet-stream
// download; v0.2.243 directory-index shell → 404). Only the root `/` reliably serves
// index.html as text/html. v0.2.244 makes the CANONICAL route a URL FRAGMENT
// `/#/zone/<slug>`: the fragment is never sent to the server, so the request path stays `/`
// and the root shell ALWAYS renders on a hard refresh; the client parser reads the
// fragment. These tests pin: the canonical route is hash-based and host-safe, the legacy
// `/zone/<slug>` path still PARSES (non-canonical fallback), and the build ships NO
// `/zone/*` file (no shell is generated any more — it would only 404 on the host).
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEPLOYABLE_ZONE_SLUGS, isValidZoneSlug, parseZoneRoute, zoneRouteFor,
  ZONE_ROUTE_KIND, ZONE_CANONICAL_PREFIX,
} from '../src/engine/gateway/zoneRoute.js';

const DIST = join(process.cwd(), 'dist');

describe('DEPLOYABLE_ZONE_SLUGS', () => {
  it('is a non-empty frozen list of valid, parseable zone slugs', () => {
    expect(Object.isFrozen(DEPLOYABLE_ZONE_SLUGS)).toBe(true);
    expect(DEPLOYABLE_ZONE_SLUGS.length).toBeGreaterThan(0);
    for (const slug of DEPLOYABLE_ZONE_SLUGS) {
      expect(isValidZoneSlug(slug)).toBe(true);
      const r = parseZoneRoute(zoneRouteFor(slug));
      expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
      expect(r.slug).toBe(slug);
    }
  });

  it('includes the live demo bazaar slug that 404d on the published host', () => {
    expect(DEPLOYABLE_ZONE_SLUGS).toContain('plebeian-market-bazaar');
  });
});

describe('canonical hash route is host-safe', () => {
  it('builds a /#/zone/<slug> fragment route whose request path is the root', () => {
    expect(zoneRouteFor('plebeian-market-bazaar')).toBe('/#/zone/plebeian-market-bazaar');
    // The fragment is everything after '#'; the path the server sees is always '/'.
    const route = zoneRouteFor('plebeian-market-bazaar');
    expect(route.startsWith(ZONE_CANONICAL_PREFIX)).toBe(true);
    const pathSentToServer = route.split('#')[0];
    expect(pathSentToServer).toBe('/');
  });

  it('resolves the canonical /#/zone/<slug> route to a zone display state', () => {
    const r = parseZoneRoute('/#/zone/plebeian-market-bazaar');
    expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(r.slug).toBe('plebeian-market-bazaar');
    expect(r.route).toBe('/#/zone/plebeian-market-bazaar');
    // Still inert — resolving a route never navigates.
    expect(r.navigated).toBe(false);
  });

  it('returns null for an invalid slug (never builds an unsafe route)', () => {
    expect(zoneRouteFor('Bad_Slug')).toBeNull();
    expect(zoneRouteFor('a/b')).toBeNull();
    expect(zoneRouteFor('')).toBeNull();
    expect(zoneRouteFor('-bad')).toBeNull();
  });
});

describe('legacy /zone/<slug> path stays parseable but is NON-CANONICAL', () => {
  it('still resolves a bare /zone/<slug> path client-side (legacy in-app hop / typed URL)', () => {
    const r = parseZoneRoute('/zone/plebeian-market-bazaar');
    expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(r.slug).toBe('plebeian-market-bazaar');
    // But the canonical route it reports is the host-safe hash form.
    expect(r.route).toBe('/#/zone/plebeian-market-bazaar');
  });

  it('also tolerates a legacy trailing-slash /zone/<slug>/ path', () => {
    const r = parseZoneRoute('/zone/plebeian-market-bazaar/');
    expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
    expect(r.slug).toBe('plebeian-market-bazaar');
  });
});

describe('built dist/ ships NO /zone/* file (when a build is present)', () => {
  it('emits index.html and never a /zone/* static file that would only 404 on the host', () => {
    const indexPath = join(DIST, 'index.html');
    if (!existsSync(indexPath)) return; // no build in this run — covered by test:release
    const zoneDir = join(DIST, 'zone');
    expect(existsSync(zoneDir), 'dist/zone/ must not exist — /zone/* 404s on the host').toBe(false);
    // Defensive: no top-level dist entry named "zone" of any kind.
    const top = readdirSync(DIST);
    for (const name of top) {
      if (name === 'zone') {
        const p = join(DIST, name);
        expect(statSync(p).isDirectory() || statSync(p).isFile()).toBe(false);
      }
    }
  });
});
