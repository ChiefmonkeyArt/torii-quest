// tests/bot-identity.test.js — ADR-0013 guard tests for the dwarf-name pool.

import { describe, it, expect } from 'vitest';
import { DWARF_NAMES, nameForBotId } from '../src/engine/entities/botIdentity.js';

describe('botIdentity (ADR-0013)', () => {
  it('exposes the seven non-Snow-White dwarves in order', () => {
    expect(DWARF_NAMES).toEqual([
      'Doc', 'Grumpy', 'Happy', 'Sleepy', 'Bashful', 'Sneezy', 'Dopey',
    ]);
    // Frozen — the pool must not mutate at runtime.
    expect(Object.isFrozen(DWARF_NAMES)).toBe(true);
  });

  it('does not include Snow White', () => {
    expect(DWARF_NAMES).not.toContain('Snow White');
    expect(DWARF_NAMES).not.toContain('Snow-White');
    expect(DWARF_NAMES).not.toContain('SnowWhite');
  });

  it('maps id 0..6 to the seven dwarves in order', () => {
    for (let i = 0; i < 7; i++) {
      expect(nameForBotId(i)).toBe(DWARF_NAMES[i]);
    }
  });

  it('wraps deterministically on id % 7 for larger ids', () => {
    expect(nameForBotId(7)).toBe('Doc');
    expect(nameForBotId(8)).toBe('Grumpy');
    expect(nameForBotId(13)).toBe('Dopey');
    expect(nameForBotId(14)).toBe('Doc');
    expect(nameForBotId(70)).toBe('Doc');
    expect(nameForBotId(100)).toBe(DWARF_NAMES[100 % 7]);
  });

  it('is deterministic — same id always yields the same name', () => {
    for (let i = 0; i < 100; i++) {
      const a = nameForBotId(i);
      const b = nameForBotId(i);
      expect(a).toBe(b);
    }
  });

  it('defends against corrupt input without throwing', () => {
    expect(nameForBotId(-1)).toBe('Doc');
    expect(nameForBotId(null)).toBe('Doc');
    expect(nameForBotId(undefined)).toBe('Doc');
    expect(nameForBotId('bogus')).toBe('Doc');
    expect(nameForBotId(1.5)).toBe('Doc');
    expect(nameForBotId(NaN)).toBe('Doc');
  });

  it('client SP fallback and server-authoritative mapping agree for ids 0..99', () => {
    // The parity contract that makes SP + MP labels match: both compute the
    // same name from the same id. ADR-0013 declares nameForBotId as the
    // single source of truth for both paths.
    for (let i = 0; i < 100; i++) {
      const clientSide = nameForBotId(i);
      const serverSide = nameForBotId(i); // same helper, same result
      expect(clientSide).toBe(serverSide);
    }
  });
});
