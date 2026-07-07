// tests/host-route-smoke.test.js — pure HOST ROUTE + ASSET SMOKE harness
// (src/engine/host/hostRouteSmoke.js, v0.2.197). Covers the folded
// runHostRouteSmoke() report (all 10 signals + summary), the read-only /
// no-deploy safety invariants (served/deployed/navigated/performed/external/
// network/wrote/fetched pinned false), the static-asset presence checks, the
// /zone/* SPA-fallback contract (unknown zone → index.html, no built file
// shadows the fallback), the route parser keeping a good slug ZONE and hostile
// paths INVALID, the absence of any serve/deploy/fetch callable on the outputs,
// and the text formatter on degraded input — plus deliberately-broken injected
// fixtures to prove the harness catches a failing layout without throwing.
// No fs/network/server/DOM — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  HOST_ROUTE_SMOKE_VERSION, HOST_ROUTE_SMOKE_BADGE, REQUIRED_ASSETS,
  SAMPLE_DIST_PATHS, SAMPLE_FALLBACK_DOCS, SAMPLE_ZONE_SLUG, HOSTILE_ZONE_PATHS,
  runHostRouteSmoke, formatHostRouteSmoke,
} from '../src/engine/host/hostRouteSmoke.js';

describe('constants', () => {
  it('exports a version, a read-only/no-deploy badge, and the required-asset list', () => {
    expect(HOST_ROUTE_SMOKE_VERSION).toBe(1);
    expect(HOST_ROUTE_SMOKE_BADGE).toMatch(/READ-ONLY/);
    expect(HOST_ROUTE_SMOKE_BADGE).toMatch(/NO DEPLOY/);
    expect(REQUIRED_ASSETS).toContain('index.html');
    expect(REQUIRED_ASSETS).toContain('dashboard.html');
    expect(REQUIRED_ASSETS).toContain('release-metadata.json');
  });
  it('exposes frozen, deterministic local fixtures (never a server)', () => {
    expect(Array.isArray(SAMPLE_DIST_PATHS)).toBe(true);
    expect(Object.isFrozen(SAMPLE_DIST_PATHS)).toBe(true);
    expect(SAMPLE_DIST_PATHS).toContain('index.html');
    expect(Object.isFrozen(SAMPLE_FALLBACK_DOCS)).toBe(true);
    expect(typeof SAMPLE_ZONE_SLUG).toBe('string');
    expect(Array.isArray(HOSTILE_ZONE_PATHS)).toBe(true);
    expect(Object.isFrozen(HOSTILE_ZONE_PATHS)).toBe(true);
    expect(HOSTILE_ZONE_PATHS.length).toBeGreaterThan(0);
  });
});

describe('runHostRouteSmoke', () => {
  it('is all-green over the local fixtures (10 signals, no fail)', () => {
    const r = runHostRouteSmoke();
    expect(r.ok).toBe(true);
    expect(r.badge).toBe(HOST_ROUTE_SMOKE_BADGE);
    expect(r.version).toBe(HOST_ROUTE_SMOKE_VERSION);
    expect(r.summary.total).toBe(10);
    expect(r.summary.ok).toBe(10);
    expect(r.summary.fail).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it('emits exactly the expected signal keys, all ok', () => {
    const r = runHostRouteSmoke();
    const keys = r.signals.map((s) => s.key).sort();
    expect(keys).toEqual([
      'dashboard-asset-present',
      'expected-artifacts-present',
      'no-host-side-action',
      'no-zone-shadow',
      'required-files-documented',
      'root-index-present',
      'unknown-zone-served-index',
      'update-asset-present',
      'zone-fallback-documented',
      'zone-slug-kept-safe',
    ]);
    expect(r.signals.every((s) => s.status === 'ok')).toBe(true);
  });

  it('pins every safety flag false on the folded report', () => {
    const r = runHostRouteSmoke();
    expect(r.safety).toEqual({
      served: false, deployed: false, navigated: false, performed: false,
      external: false, network: false, wrote: false, fetched: false,
    });
    expect(r.rendered).toBe(false);
    expect(r.actionable).toBe(false);
  });

  it('confirms the root index.html (SPA entry / fallback document) is present', () => {
    const r = runHostRouteSmoke();
    const sig = r.signals.find((s) => s.key === 'root-index-present');
    expect(sig.status).toBe('ok');
  });

  it('confirms the torii-quest dashboard asset + data JSON ship', () => {
    const r = runHostRouteSmoke();
    const sig = r.signals.find((s) => s.key === 'dashboard-asset-present');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/dashboard\.html=true/);
  });

  it('confirms release-metadata.json ships and is manual-only / non-actionable', () => {
    const r = runHostRouteSmoke();
    const sig = r.signals.find((s) => s.key === 'update-asset-present');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/autoUpdate=false/);
    expect(sig.detail).toMatch(/actionable=false/);
  });

  it('treats an unknown /zone/<slug> as a fallback to index.html (not a built file)', () => {
    const r = runHostRouteSmoke();
    const sig = r.signals.find((s) => s.key === 'unknown-zone-served-index');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/builtFile=false/);
    expect(sig.detail).toMatch(/kind=zone/);
  });

  it('keeps the slug safe — good slug ZONE, every hostile path INVALID', () => {
    const r = runHostRouteSmoke();
    const sig = r.signals.find((s) => s.key === 'zone-slug-kept-safe');
    expect(sig.status).toBe('ok');
    expect(sig.detail).toMatch(/hostile paths rejected/);
  });

  it('fails no-zone-shadow when a built file is published under /zone/*', () => {
    const r = runHostRouteSmoke({ distPaths: [...SAMPLE_DIST_PATHS, 'zone/plebeian-market-bazaar.html'] });
    const sig = r.signals.find((s) => s.key === 'no-zone-shadow');
    expect(sig.status).toBe('fail');
    expect(r.ok).toBe(false);
    // Even a broken layout keeps the no-deploy safety posture pinned false.
    expect(r.safety.served).toBe(false);
    expect(r.safety.deployed).toBe(false);
    expect(r.safety.network).toBe(false);
  });

  it('surfaces ok:false (with reasons) when the built bundle has no index.html', () => {
    const r = runHostRouteSmoke({ distPaths: ['assets/index-x.js', 'dashboard.html'] });
    expect(r.ok).toBe(false);
    expect(r.summary.fail).toBeGreaterThan(0);
    expect(r.reasons.some((x) => x.startsWith('root-index-present'))).toBe(true);
  });

  it('fails zone-fallback-documented when the docs omit the index.html fallback', () => {
    const r = runHostRouteSmoke({ fallbackDocs: { 'VPS_INSTALL.md': 'no fallback here', 'torii-quest-handoff.md': 'nor here' } });
    const sig = r.signals.find((s) => s.key === 'zone-fallback-documented');
    expect(sig.status).toBe('fail');
    expect(r.ok).toBe(false);
  });

  it('catches a hostile slug that is NOT rejected (injected as the good slug)', () => {
    // Feeding an off-origin path as the "good" zone slug breaks the unknown-zone and
    // safe-slug signals — the harness must catch it, never throw.
    const r = runHostRouteSmoke({ zoneSlug: '../evil', hostile: ['/zone/ok-slug'] });
    expect(r.ok).toBe(false);
    expect(r.summary.fail).toBeGreaterThan(0);
  });

  it('is safe on no-arg / degraded opts (never throws)', () => {
    expect(() => runHostRouteSmoke(null)).not.toThrow();
    expect(() => runHostRouteSmoke([])).not.toThrow();
    expect(() => runHostRouteSmoke('nope')).not.toThrow();
    expect(runHostRouteSmoke(null).summary.total).toBe(10);
    expect(runHostRouteSmoke(null).ok).toBe(true);
  });
});

describe('formatHostRouteSmoke', () => {
  it('renders a block with the badge and a verdict line', () => {
    const out = formatHostRouteSmoke(runHostRouteSmoke());
    expect(out).toMatch(/HOST ROUTE SMOKE/);
    expect(out).toMatch(/verdict: OK/);
    expect(out).toMatch(/10\/10 signals/);
  });
  it('is safe on null (falls back to running the smoke)', () => {
    expect(() => formatHostRouteSmoke(null)).not.toThrow();
    expect(formatHostRouteSmoke(null)).toMatch(/HOST ROUTE SMOKE/);
  });
});
