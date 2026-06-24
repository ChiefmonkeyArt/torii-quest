// tests/leaderboard-publisher.test.js — locks the leaderboard publisher adapter
// shape (LB-1 continuation, src/engine/nostr/leaderboardPublisher.js). Pure
// module → node-test with INJECTED fake signer/publisher. We assert: build-only
// with no signer, signed-not-shipped with a signer only, published with both,
// errors captured (never thrown) on dep failure, and invalid scores still throw
// before any signing. No real signing/relay/secrets anywhere.
import { describe, it, expect, vi } from 'vitest';
import { createLeaderboardPublisher } from '../src/engine/nostr/leaderboardPublisher.js';
import { LEADERBOARD_KIND } from '../src/engine/nostr/leaderboard.js';
import * as SDK from '../src/sdk/index.js';

const STATS = { runId: 'run-1', score: 10, kills: 5, headshots: 2, accuracy: 0.5 };

describe('createLeaderboardPublisher — build-only (no deps)', () => {
  it('returns the unsigned template and does not sign or publish', async () => {
    const pub = createLeaderboardPublisher();
    const res = await pub.publishScore(STATS);
    expect(res.ok).toBe(true);
    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(res.event).toBeNull();
    expect(res.template.kind).toBe(LEADERBOARD_KIND);
  });
});

describe('createLeaderboardPublisher — signer only', () => {
  it('signs the template but does not publish without a publisher', async () => {
    const sign = vi.fn(async (t) => ({ ...t, sig: 'deadbeef', pubkey: 'abc' }));
    const pub = createLeaderboardPublisher({ sign });
    const res = await pub.publishScore(STATS);
    expect(sign).toHaveBeenCalledOnce();
    expect(res.signed).toBe(true);
    expect(res.event.sig).toBe('deadbeef');
    expect(res.published).toBe(false);
  });
});

describe('createLeaderboardPublisher — signer + publisher', () => {
  it('signs then publishes via the injected deps', async () => {
    const sign = vi.fn(async (t) => ({ ...t, sig: 'sig' }));
    const publish = vi.fn(async () => 'OK');
    const pub = createLeaderboardPublisher({ sign, publish });
    const res = await pub.publishScore(STATS);
    expect(res.ok).toBe(true);
    expect(res.signed).toBe(true);
    expect(res.published).toBe(true);
    expect(publish).toHaveBeenCalledWith(res.event);
  });
});

describe('createLeaderboardPublisher — failures captured, not thrown', () => {
  it('captures a signer failure', async () => {
    const sign = async () => { throw new Error('no key'); };
    const res = await createLeaderboardPublisher({ sign }).publishScore(STATS);
    expect(res.ok).toBe(false);
    expect(res.published).toBe(false);
    expect(res.errors.join(' ')).toMatch(/sign failed: no key/);
  });

  it('captures a publisher failure', async () => {
    const sign = async (t) => ({ ...t, sig: 's' });
    const publish = async () => { throw new Error('relay down'); };
    const res = await createLeaderboardPublisher({ sign, publish }).publishScore(STATS);
    expect(res.ok).toBe(false);
    expect(res.signed).toBe(true);
    expect(res.errors.join(' ')).toMatch(/publish failed: relay down/);
  });

  it('still throws on an invalid score (before any signing)', async () => {
    const sign = vi.fn();
    const pub = createLeaderboardPublisher({ sign });
    await expect(pub.publishScore({ score: 5 })).rejects.toThrow(/invalid leaderboard score/);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('leaderboardPublisher — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.leaderboardPublisher.createLeaderboardPublisher).toBe('function');
    expect(SDK.SDK_SURFACE.leaderboardPublisher.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('leaderboardPublisher');
  });
});
