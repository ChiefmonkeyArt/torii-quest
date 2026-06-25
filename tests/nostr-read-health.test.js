// tests/nostr-read-health.test.js — pure READ-ONLY Nostr read-path health model
// (src/engine/nostr/readHealth.js, v0.2.194). Covers each individual signal
// (ok/fail), the folded runReadHealth result + summary, the read-only invariants
// (signed/published/readOnly pinned), and the text formatter on degraded input. No
// fs/network/relay — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  READ_HEALTH_BADGE, PUBLISH_VERB, FUTURE_GATED_TIERS,
  SAMPLE_PROFILE_EVENTS, SAMPLE_SCORE_EVENTS,
  checkRelayReadModel, checkNoPublishVerb, checkProfileReadPath,
  checkLeaderboardReadPath, checkWritePathsGated, checkFutureGatedTiers,
  runReadHealth, formatReadHealth,
} from '../src/engine/nostr/readHealth.js';
import { RELAY_READ_VERBS } from '../src/engine/nostr/relayRead.js';

describe('constants', () => {
  it('exports the badge, publish verb, and future-gated tiers', () => {
    expect(READ_HEALTH_BADGE).toMatch(/READ-ONLY/);
    expect(PUBLISH_VERB).toBe('EVENT');
    expect(FUTURE_GATED_TIERS).toEqual(['SEC-1', 'SEC-2', 'SEC-3']);
  });
  it('the relay read verbs never include the EVENT publish verb', () => {
    expect(RELAY_READ_VERBS).not.toContain(PUBLISH_VERB);
    expect([...RELAY_READ_VERBS].sort()).toEqual(['CLOSE', 'REQ']);
  });
});

describe('checkRelayReadModel', () => {
  it('passes — adapter is a read-only { read } surface with no write methods', () => {
    const s = checkRelayReadModel();
    expect(s.status).toBe('ok');
    expect(s.exposedWriteMethods).toEqual([]);
  });
});

describe('checkNoPublishVerb', () => {
  it('passes — read verbs are exactly REQ/CLOSE, no EVENT', () => {
    const s = checkNoPublishVerb();
    expect(s.status).toBe('ok');
    expect(s.verbs).toEqual(expect.arrayContaining(['REQ', 'CLOSE']));
    expect(s.verbs).not.toContain('EVENT');
  });
});

describe('checkProfileReadPath', () => {
  it('passes on the local sample — read-only, at least one profile', () => {
    const s = checkProfileReadPath();
    expect(s.status).toBe('ok');
    expect(s.count).toBeGreaterThanOrEqual(1);
    expect(s.signed).toBe(false);
    expect(s.published).toBe(false);
    expect(s.readOnly).toBe(true);
  });
  it('fails when the read path yields no usable profile', () => {
    // kind:1 (not a profile) → extraction skips it → no profiles.
    const notProfiles = [{ id: '1'.repeat(64), pubkey: 'a'.repeat(64), created_at: 1, kind: 1, tags: [], content: '', sig: 'f'.repeat(128) }];
    expect(checkProfileReadPath(notProfiles).status).toBe('fail');
  });
});

describe('checkLeaderboardReadPath', () => {
  it('passes on the local sample — read-only, at least one row', () => {
    const s = checkLeaderboardReadPath();
    expect(s.status).toBe('ok');
    expect(s.count).toBeGreaterThanOrEqual(1);
    expect(s.signed).toBe(false);
    expect(s.published).toBe(false);
    expect(s.readOnly).toBe(true);
  });
  it('fails when the read path yields no usable row', () => {
    const emptyBoard = [{ id: '2'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 1, tags: [], content: '', sig: 'e'.repeat(128) }];
    expect(checkLeaderboardReadPath(emptyBoard).status).toBe('fail');
  });
});

describe('checkWritePathsGated', () => {
  it('passes — reads allowed, writes blocked without a grant', () => {
    const s = checkWritePathsGated();
    expect(s.status).toBe('ok');
    expect(s.readActions).toBeGreaterThanOrEqual(1);
    expect(s.writeActions).toBeGreaterThanOrEqual(1);
    expect(s.writeAllowedByDefault).toEqual([]);
  });
});

describe('checkFutureGatedTiers', () => {
  it('passes — signed write (SEC-1) actions are gated, not open', () => {
    const s = checkFutureGatedTiers();
    expect(s.status).toBe('ok');
    expect(s.tiers).toEqual(['SEC-1', 'SEC-2', 'SEC-3']);
    expect(s.signedWriteActions.length).toBeGreaterThanOrEqual(1);
  });
});

describe('runReadHealth', () => {
  it('is all-green for the shipped read paths (6 signals, no fail)', () => {
    const r = runReadHealth();
    expect(r.ok).toBe(true);
    expect(r.badge).toBe(READ_HEALTH_BADGE);
    expect(r.summary.total).toBe(6);
    expect(r.summary.fail).toBe(0);
    expect(r.summary.ok).toBe(6);
    expect(r.errors).toEqual([]);
  });
  it('pins the read-only invariants on the folded report', () => {
    const r = runReadHealth();
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.readOnly).toBe(true);
  });
  it('surfaces a fail (and ok:false + errors) when a read path is broken', () => {
    const r = runReadHealth({ profileEvents: [], scoreEvents: [] });
    expect(r.ok).toBe(false);
    expect(r.summary.fail).toBeGreaterThan(0);
    expect(r.errors.join(' ')).toMatch(/read path/);
    // The read-only invariants stay pinned even on a degraded run.
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.readOnly).toBe(true);
  });
  it('is safe on no-arg / degraded input', () => {
    expect(() => runReadHealth(null)).not.toThrow();
    expect(runReadHealth(null).summary.total).toBe(6);
    expect(runReadHealth([]).ok).toBe(true);
  });
});

describe('formatReadHealth', () => {
  it('renders a block with the badge and summary line', () => {
    const out = formatReadHealth(runReadHealth());
    expect(out).toMatch(/Nostr read-path health/);
    expect(out).toMatch(/summary:/);
    expect(out).toMatch(/READ-ONLY OK/);
  });
  it('is safe on null / malformed', () => {
    expect(formatReadHealth(null)).toMatch(/no result/);
    expect(formatReadHealth({})).toMatch(/no result/);
  });
});
