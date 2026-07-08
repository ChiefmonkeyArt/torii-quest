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

describe('createLeaderboardPublisher — signer + publisher (with explicit passthrough gate)', () => {
  it('signs then publishes via the injected deps when a gate is wired and trusts', async () => {
    // With SEC-1 hardened (v0.2.355), a publisher wired WITHOUT a gate fails
    // closed by default. To exercise the happy-path adapter shape (signs + ships)
    // in isolation from the real crypto gate, callers must inject a gate that
    // returns trusted:true — same pattern livePublish.js uses in prod.
    const sign = vi.fn(async (t) => ({ ...t, sig: 'sig' }));
    const publish = vi.fn(async () => 'OK');
    const gate = vi.fn(() => ({ ok: true, trusted: true, trust: 'crypto-verified', errors: [] }));
    const pub = createLeaderboardPublisher({ sign, publish, gate });
    const res = await pub.publishScore(STATS);
    expect(res.ok).toBe(true);
    expect(res.signed).toBe(true);
    expect(res.published).toBe(true);
    expect(publish).toHaveBeenCalledWith(res.event);
    expect(gate).toHaveBeenCalledOnce();
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
    // Passthrough gate keeps the publisher failure path isolated from SEC-1 gate logic.
    const sign = async (t) => ({ ...t, sig: 's' });
    const publish = async () => { throw new Error('relay down'); };
    const gate = () => ({ ok: true, trusted: true, trust: 'crypto-verified', errors: [] });
    const res = await createLeaderboardPublisher({ sign, publish, gate }).publishScore(STATS);
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

// SEC-1 hardening (v0.2.355): a publisher wired with `publish` but no gate — or with
// `gate: null` explicitly — must fail closed before signing. This closes the earlier
// bypass where a caller could quietly ship stub or unverified events to a relay just
// by omitting the gate arg.
describe('createLeaderboardPublisher — SEC-1 mandatory-gate fail-closed (v0.2.355)', () => {
  it('defaults to the real crypto gate when none is wired — rejects a stub-signed event', async () => {
    // No explicit gate → `gate` defaults to the real verifyPublishGate. A stub-
    // signed event cannot clear the BIP-340 schnorr layer (or the missing-consent
    // check), so the gate rejects and publish() is never called. This locks the
    // "default is fail-safe" invariant: omitting the gate no longer opts OUT of
    // SEC-1 — it opts INTO the real gate.
    const sign = vi.fn(async (t) => ({ ...t, sig: 'c'.repeat(128), id: 'a'.repeat(64), pubkey: 'b'.repeat(64) }));
    const publish = vi.fn(async () => 'OK');
    const pub = createLeaderboardPublisher({ sign, publish }); // no gate
    const res = await pub.publishScore(STATS);
    expect(res.ok).toBe(false);
    expect(res.signed).toBe(true);
    expect(res.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.some((e) => e.startsWith('SEC-1 gate blocked publish'))).toBe(true);
  });

  it('fails closed when publish is wired and gate is explicitly null (opt-out is refused)', async () => {
    const sign = vi.fn(async (t) => ({ ...t, sig: 'x' }));
    const publish = vi.fn(async () => 'OK');
    const pub = createLeaderboardPublisher({ sign, publish, gate: null });
    const res = await pub.publishScore(STATS);
    expect(res.ok).toBe(false);
    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/SEC-1: publish is wired without a gate/);
  });

  it('still allows the build-only path (no publish) with no gate — nothing ships anyway', async () => {
    const sign = vi.fn(async (t) => ({ ...t, sig: 'sig' }));
    const pub = createLeaderboardPublisher({ sign }); // no publish, no gate
    const res = await pub.publishScore(STATS);
    expect(res.ok).toBe(true);
    expect(res.signed).toBe(true);
    expect(res.published).toBe(false);
    expect(sign).toHaveBeenCalledOnce();
  });
});

describe('leaderboardPublisher — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.leaderboardPublisher.createLeaderboardPublisher).toBe('function');
    expect(SDK.SDK_SURFACE.leaderboardPublisher.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('leaderboardPublisher');
  });
});
