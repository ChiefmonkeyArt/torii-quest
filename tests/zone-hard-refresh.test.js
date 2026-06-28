// tests/zone-hard-refresh.test.js — the v0.2.243 renderable zone deep-link fix. The
// exact-path static host (torii-quest.pplx.app: no SPA rewrite) infers Content-Type from
// file EXTENSION, so the v0.2.242 EXTENSIONLESS file `dist/zone/<slug>` was served as
// application/octet-stream and a real browser DOWNLOADED it (Playwright: "Download is
// starting") instead of rendering. v0.2.243 reinstates the directory-index shell
// `dist/zone/<slug>/index.html`: the host resolves the canonical trailing-slash URL
// `/zone/<slug>/` onto that nested `.html` file and serves it as renderable text/html.
// These tests pin: the slug list is valid + parseable, the pure planner emits the
// directory-index `.html` shape + canonical trailing-slash route, and (when a build is
// present) every planned shell is the directory-index file, byte-identical to dist/index.html,
// with no leftover bare extensionless file.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEPLOYABLE_ZONE_SLUGS, isValidZoneSlug, parseZoneRoute, ZONE_ROUTE_KIND,
} from '../src/engine/gateway/zoneRoute.js';
import { planZoneShells, zoneShellPathFor, zoneShellRouteFor } from '../tools/zoneShells.mjs';

const DIST = join(process.cwd(), 'dist');

describe('DEPLOYABLE_ZONE_SLUGS', () => {
  it('is a non-empty frozen list of valid, parseable zone slugs', () => {
    expect(Object.isFrozen(DEPLOYABLE_ZONE_SLUGS)).toBe(true);
    expect(DEPLOYABLE_ZONE_SLUGS.length).toBeGreaterThan(0);
    for (const slug of DEPLOYABLE_ZONE_SLUGS) {
      expect(isValidZoneSlug(slug)).toBe(true);
      const r = parseZoneRoute(`/zone/${slug}/`);
      expect(r.kind).toBe(ZONE_ROUTE_KIND.ZONE);
      expect(r.slug).toBe(slug);
    }
  });

  it('includes the live demo bazaar slug that 404d on the published host', () => {
    expect(DEPLOYABLE_ZONE_SLUGS).toContain('plebeian-market-bazaar');
  });
});

describe('zoneShellPathFor / zoneShellRouteFor', () => {
  it('builds a directory-index (.html) shell path + canonical trailing-slash route for a valid slug', () => {
    expect(zoneShellPathFor('plebeian-market-bazaar')).toBe('zone/plebeian-market-bazaar/index.html');
    expect(zoneShellRouteFor('plebeian-market-bazaar')).toBe('/zone/plebeian-market-bazaar/');
  });

  it('shell path ends in /index.html so the host serves it as renderable text/html', () => {
    const p = zoneShellPathFor('plebeian-market-bazaar');
    expect(p.endsWith('/index.html')).toBe(true);
    // The canonical route is the directory (trailing slash); the file is its index.html.
    expect(zoneShellRouteFor('plebeian-market-bazaar')).toBe('/zone/plebeian-market-bazaar/');
    expect(`/${p}`.replace(/index\.html$/, '')).toBe(zoneShellRouteFor('plebeian-market-bazaar'));
  });

  it('returns null for an invalid slug (never builds an unsafe path)', () => {
    expect(zoneShellPathFor('Bad_Slug')).toBeNull();
    expect(zoneShellPathFor('a/b')).toBeNull();
    expect(zoneShellPathFor('')).toBeNull();
    expect(zoneShellRouteFor('-bad')).toBeNull();
  });
});

describe('planZoneShells', () => {
  it('plans one directory-index shell per deployable slug', () => {
    const plan = planZoneShells(DEPLOYABLE_ZONE_SLUGS);
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.shells.length).toBe(DEPLOYABLE_ZONE_SLUGS.length);
    for (const s of plan.shells) {
      expect(s.path).toBe(`zone/${s.slug}/index.html`);
      expect(s.route).toBe(`/zone/${s.slug}/`);
      expect(parseZoneRoute(s.route).kind).toBe(ZONE_ROUTE_KIND.ZONE);
    }
  });

  it('reports invalid and duplicate slugs without throwing', () => {
    const plan = planZoneShells(['plebeian-market-bazaar', 'Bad_Slug', 'plebeian-market-bazaar']);
    expect(plan.ok).toBe(false);
    expect(plan.shells.length).toBe(1);
    expect(plan.errors.some((e) => e.includes('invalid'))).toBe(true);
    expect(plan.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('is safe on bad input', () => {
    expect(planZoneShells(null).shells).toEqual([]);
    expect(planZoneShells(undefined).ok).toBe(true);
  });
});

describe('built dist/ shells (when a build is present)', () => {
  it('emits a byte-identical directory-index shell file for every deployable slug', () => {
    const indexPath = join(DIST, 'index.html');
    if (!existsSync(indexPath)) return; // no build in this run — covered by test:release
    const indexBody = readFileSync(indexPath, 'utf8');
    for (const slug of DEPLOYABLE_ZONE_SLUGS) {
      const shellPath = join(DIST, 'zone', slug, 'index.html');
      expect(existsSync(shellPath), `missing directory-index shell for /zone/${slug}/`).toBe(true);
      expect(statSync(shellPath).isFile(), `/zone/${slug}/index.html must be a file`).toBe(true);
      expect(readFileSync(shellPath, 'utf8')).toBe(indexBody);
    }
  });

  it('does NOT leave a bare extensionless file (the v0.2.242 form browsers downloaded)', () => {
    const indexPath = join(DIST, 'index.html');
    if (!existsSync(indexPath)) return; // no build in this run — covered by test:release
    for (const slug of DEPLOYABLE_ZONE_SLUGS) {
      // The v0.2.242 extensionless file dist/zone/<slug> served as octet-stream → download.
      // The directory-index shell needs dist/zone/<slug>/ to be a directory, which cannot
      // coexist with a file of the same name; assert the bare file is absent so the
      // renderable .html is the single served artifact.
      const bare = join(DIST, 'zone', slug);
      expect(existsSync(bare) && statSync(bare).isFile()).toBe(false);
    }
  });
});
