// tests/multiplayer/score-ledger.test.js — MP-3 (v0.2.366-alpha)
// Pure per-peer accumulator; no wire, no timers.
import { describe, it, expect } from 'vitest';
import { createScoreLedger, newSessionId } from '../../server/combat/scoreLedger.js';

const npubA = 'a'.repeat(64);
const npubB = 'b'.repeat(64);

describe('scoreLedger — register/snapshot', () => {
  it('register requires 64-hex npub', () => {
    const l = createScoreLedger();
    expect(() => l.register('p1', 'not-hex')).toThrow(/64-hex/);
    expect(() => l.register('', npubA)).toThrow(/id required/);
    expect(l.register('p1', npubA)).toBeTruthy();
    expect(l.has('p1')).toBe(true);
  });

  it('register is idempotent for the same id', () => {
    const l = createScoreLedger();
    l.register('p1', npubA);
    l.register('p1', npubA); // no-op
    l.addKill('p1', 'p2'); // p2 not registered → false
    expect(l.get('p1')).toEqual({ id: 'p1', npub: npubA, kills: 0, deaths: 0, damage: 0 });
  });

  it('addDamage clamps and rejects invalid inputs', () => {
    const l = createScoreLedger();
    l.register('p1', npubA);
    expect(l.addDamage('p1', 0)).toBe(false);
    expect(l.addDamage('p1', -5)).toBe(false);
    expect(l.addDamage('p1', NaN)).toBe(false);
    expect(l.addDamage('p1', 3)).toBe(true);
    expect(l.addDamage('p1', 9)).toBe(true);
    expect(l.get('p1').damage).toBe(12);
    // Missing peer → false
    expect(l.addDamage('nope', 3)).toBe(false);
  });

  it('addKill rejects self-kills and unknown peers', () => {
    const l = createScoreLedger();
    l.register('p1', npubA);
    l.register('p2', npubB);
    expect(l.addKill('p1', 'p1')).toBe(false); // self-kill
    expect(l.addKill('p1', 'p3')).toBe(false); // unknown victim
    expect(l.addKill('p3', 'p2')).toBe(false); // unknown shooter
    expect(l.addKill('p1', 'p2')).toBe(true);
    expect(l.get('p1').kills).toBe(1);
    expect(l.get('p2').deaths).toBe(1);
  });

  it('snapshot returns rows sorted by (kills desc, damage desc, id asc)', () => {
    const l = createScoreLedger();
    l.register('p1', npubA);
    l.register('p2', npubB);
    l.register('p3', 'c'.repeat(64));
    l.addKill('p2', 'p1');
    l.addKill('p2', 'p3');
    l.addDamage('p1', 5);
    l.addDamage('p3', 5);
    const snap = l.snapshot();
    expect(snap[0].id).toBe('p2');
    expect(snap[0].kills).toBe(2);
    // p1 and p3 both 0 kills, 5 damage; tie broken by id asc
    expect(snap[1].id).toBe('p1');
    expect(snap[2].id).toBe('p3');
  });

  it('drop removes a peer; size + clear behave', () => {
    const l = createScoreLedger();
    l.register('p1', npubA);
    l.register('p2', npubB);
    expect(l.size()).toBe(2);
    expect(l.drop('p1')).toBe(true);
    expect(l.has('p1')).toBe(false);
    expect(l.drop('p1')).toBe(false);
    l.clear();
    expect(l.size()).toBe(0);
  });
});

describe('newSessionId', () => {
  it('produces 16 hex chars from randomFn', () => {
    const id = newSessionId((n) => new Uint8Array(n));
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
  it('fallback path still yields 16 hex chars', () => {
    const id = newSessionId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
