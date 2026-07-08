// tests/live-update-check.test.js — LIVE + cached update-check orchestration
// (liveUpdateCheck.js, M2, v0.2.280). Asserts the pure version-delta + cache helpers
// and the async live probe: a newer release → "behind by N"; equal → "up to date";
// runtime ahead → "ahead"; network/rate-limit/404/no-fetcher → graceful "unable to
// check" (never throws, card never breaks); and a fresh cache short-circuits the wire.
import { describe, it, expect, vi } from 'vitest';
import {
  versionDelta, readCache, writeCache, liveStatusView, checkForUpdateLive,
  LIVE_STATUS, UPDATE_CACHE_KEY, DEFAULT_TTL_MS,
} from '../src/engine/update/liveUpdateCheck.js';
import * as SDK from '../src/sdk/index.js';

// A minimal in-memory Storage stand-in (the Web Storage subset the module touches).
function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const release = (tag) => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: `https://gh/${tag}` }) });

describe('versionDelta', () => {
  it('reports same for equal versions', () => {
    expect(versionDelta('v0.2.280-alpha', 'v0.2.280-alpha')).toEqual({ direction: 'same', count: 0 });
  });
  it('counts the patch gap when behind (shared major.minor)', () => {
    expect(versionDelta('v0.2.279-alpha', 'v0.2.284-alpha')).toEqual({ direction: 'behind', count: 5 });
  });
  it('reports ahead when the runtime is newer', () => {
    const d = versionDelta('v0.3.0-alpha', 'v0.2.999-alpha');
    expect(d.direction).toBe('ahead');
  });
  it('returns null count when only the prerelease tag differs', () => {
    const d = versionDelta('v0.2.280-alpha', 'v0.2.280-beta');
    expect(d.direction).not.toBe('same');
    expect(d.count).toBeNull();
  });
});

describe('cache read/write', () => {
  it('round-trips a fresh entry and skips the wire', () => {
    const s = memStorage();
    expect(writeCache(s, { latestVersion: '0.2.300-alpha', releaseUrl: 'https://gh/x' }, 1000)).toBe(true);
    const got = readCache(s, 1000 + DEFAULT_TTL_MS - 1, DEFAULT_TTL_MS);
    expect(got.latestVersion).toBe('0.2.300-alpha');
    expect(got.releaseUrl).toBe('https://gh/x');
  });
  it('treats an expired entry as a miss', () => {
    const s = memStorage();
    writeCache(s, { latestVersion: '0.2.300-alpha' }, 1000);
    expect(readCache(s, 1000 + DEFAULT_TTL_MS, DEFAULT_TTL_MS)).toBeNull();
  });
  it('never throws on malformed / missing / secured storage', () => {
    expect(readCache(null, 1)).toBeNull();
    expect(readCache(memStorage({ [UPDATE_CACHE_KEY]: 'not json' }), 1)).toBeNull();
    expect(writeCache(null, { latestVersion: '1' }, 1)).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readCache(throwing, 1)).toBeNull();
    expect(writeCache(throwing, { latestVersion: '1' }, 1)).toBe(false);
  });
});

describe('liveStatusView', () => {
  it('labels a behind verdict with the count and marks updateAvailable', () => {
    const v = liveStatusView({ currentVersion: 'v0.2.279-alpha', latestVersion: '0.2.283-alpha' });
    expect(v.status).toBe(LIVE_STATUS.BEHIND);
    expect(v.statusLabel).toBe('BEHIND BY 4');
    expect(v.updateAvailable).toBe(true);
    expect(v.behindBy).toBe(4);
    expect(v.actionable).toBe(false);
  });
  it('null latest → UNABLE fallback, never actionable', () => {
    const v = liveStatusView({ currentVersion: 'v0.2.280-alpha', latestVersion: null });
    expect(v.status).toBe(LIVE_STATUS.UNABLE);
    expect(v.statusLabel).toBe('UNABLE TO CHECK');
    expect(v.updateAvailable).toBe(false);
    expect(v.actionable).toBe(false);
  });
});

describe('checkForUpdateLive', () => {
  it('latest > installed → behind, fetched once, then cached (no 2nd fetch)', async () => {
    const s = memStorage();
    const fetcher = vi.fn(async () => release('v0.2.358-alpha'));
    const a = await checkForUpdateLive({ fetcher, storage: s, now: () => 1000, currentVersion: 'v0.2.280-alpha' });
    expect(a.status).toBe(LIVE_STATUS.BEHIND);
    expect(a.behindBy).toBe(78);  // 358-280=78 (tracks app version)
    expect(a.fromCache).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // second call within TTL → served from cache, fetcher not called again
    const b = await checkForUpdateLive({ fetcher, storage: s, now: () => 2000, currentVersion: 'v0.2.280-alpha' });
    expect(b.fromCache).toBe(true);
    expect(b.status).toBe(LIVE_STATUS.BEHIND);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('latest === installed → up to date', async () => {
    const fetcher = async () => release('v0.2.280-alpha');
    const v = await checkForUpdateLive({ fetcher, storage: memStorage(), now: () => 1, currentVersion: 'v0.2.280-alpha' });
    expect(v.status).toBe(LIVE_STATUS.UP_TO_DATE);
    expect(v.updateAvailable).toBe(false);
  });

  it('network failure → graceful unable, nothing cached', async () => {
    const s = memStorage();
    const fetcher = async () => { throw new Error('network down'); };
    const v = await checkForUpdateLive({ fetcher, storage: s, now: () => 1, currentVersion: 'v0.2.280-alpha' });
    expect(v.status).toBe(LIVE_STATUS.UNABLE);
    expect(s.getItem(UPDATE_CACHE_KEY)).toBeNull();
  });

  it('404 / non-ok with empty body → unable (fails closed)', async () => {
    const fetcher = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const v = await checkForUpdateLive({ fetcher, storage: memStorage(), now: () => 1, currentVersion: 'v0.2.280-alpha' });
    expect(v.status).toBe(LIVE_STATUS.UNABLE);
  });

  it('no fetcher injected → unable, never touches the wire', async () => {
    const v = await checkForUpdateLive({ storage: memStorage(), now: () => 1, currentVersion: 'v0.2.280-alpha' });
    expect(v.status).toBe(LIVE_STATUS.UNABLE);
  });

  it('a fresh cache short-circuits even without a fetcher', async () => {
    const s = memStorage();
    writeCache(s, { latestVersion: '0.2.352-alpha' }, 1000);
    const v = await checkForUpdateLive({ storage: s, now: () => 1500, currentVersion: 'v0.2.280-alpha' });
    expect(v.fromCache).toBe(true);
    expect(v.status).toBe(LIVE_STATUS.BEHIND);
    expect(v.behindBy).toBe(72);
  });
});

describe('SDK exposure', () => {
  it('exposes liveUpdateCheck at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.liveUpdateCheck.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.liveUpdateCheck.checkForUpdateLive).toBe('function');
    expect(typeof SDK.liveUpdateCheck.versionDelta).toBe('function');
  });
});
