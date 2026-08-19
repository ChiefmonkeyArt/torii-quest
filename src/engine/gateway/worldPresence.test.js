// src/engine/gateway/worldPresence.test.js — locks the Phase 0d NIP-40
// expiration tag on buildPresenceEvent. Pure vitest: the default-on expiration
// tag is present + correct; ttl bounds (min 60 / max 3600 clamp); ttl 0 opts
// out (no expiration tag). No three/DOM — importable in the node env.
import { describe, it, expect } from 'vitest';
import { buildPresenceEvent } from './worldPresence.js';

const GOOD_HEX = 'a'.repeat(64);

function expTag(event) {
  return event.tags.find((t) => t[0] === 'expiration') || null;
}

describe('buildPresenceEvent — NIP-40 expiration default-on', () => {
  it('adds an expiration tag by default (omitted ttl)', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1' });
    expect(r.ok).toBe(true);
    const tag = expTag(r.event);
    expect(tag).not.toBeNull();
    expect(tag[0]).toBe('expiration');
    // default ttl = 1200s; expiration = created_at + 1200
    const exp = Number(tag[1]);
    expect(exp).toBe(r.event.created_at + 1200);
  });

  it('uses the provided ttl (300s) for the expiration value', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1', expirationTtlSec: 300 });
    expect(r.ok).toBe(true);
    const tag = expTag(r.event);
    expect(tag).not.toBeNull();
    expect(Number(tag[1])).toBe(r.event.created_at + 300);
  });
});

describe('buildPresenceEvent — ttl bounds clamping', () => {
  it('clamps a sub-minimum ttl (30) up to 60', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1', expirationTtlSec: 30 });
    expect(r.ok).toBe(true);
    const tag = expTag(r.event);
    expect(Number(tag[1])).toBe(r.event.created_at + 60);
  });

  it('clamps an over-max ttl (99999) down to 3600', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1', expirationTtlSec: 99999 });
    expect(r.ok).toBe(true);
    const tag = expTag(r.event);
    expect(Number(tag[1])).toBe(r.event.created_at + 3600);
  });

  it('keeps a boundary ttl (60) exactly', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1', expirationTtlSec: 60 });
    expect(r.ok).toBe(true);
    const tag = expTag(r.event);
    expect(Number(tag[1])).toBe(r.event.created_at + 60);
  });

  it('keeps a boundary ttl (3600) exactly', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1', expirationTtlSec: 3600 });
    expect(r.ok).toBe(true);
    const tag = expTag(r.event);
    expect(Number(tag[1])).toBe(r.event.created_at + 3600);
  });
});

describe('buildPresenceEvent — ttl 0 opts out (no expiration tag)', () => {
  it('emits NO expiration tag when ttl is 0', () => {
    const r = buildPresenceEvent({ pubkey: GOOD_HEX, zoneId: 'z1', expirationTtlSec: 0 });
    expect(r.ok).toBe(true);
    expect(expTag(r.event)).toBeNull();
  });
});

describe('buildPresenceEvent — back-compat shape', () => {
  it('still returns { ok, event, errors } with the core tags intact', () => {
    const r = buildPresenceEvent({
      pubkey: GOOD_HEX, zoneId: 'quest-torii', title: 'Torii Quest', zoneType: 'arena',
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.event.kind).toBe(30078);
    expect(r.event.pubkey).toBe(GOOD_HEX);
    // core tags still present (d, t, zoneType) — expiration appended after
    const d = r.event.tags.find((t) => t[0] === 'd');
    expect(d).toEqual(['d', 'quest-torii']);
    const t = r.event.tags.find((t) => t[0] === 't');
    expect(t[1]).toBe('torii-gateway');
    const zt = r.event.tags.find((t) => t[0] === 'zoneType');
    expect(zt).toEqual(['zoneType', 'arena']);
  });

  it('fails on a missing/invalid pubkey', () => {
    const r = buildPresenceEvent({ zoneId: 'z1' });
    expect(r.ok).toBe(false);
    expect(r.event).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
