// damage-table-parity.test.js — server damageTable ↔ client damage.js parity lock.
//
// The server copies constants rather than importing from src/ (see damageTable.js).
// This test is the CI trip-wire: if either side drifts, MP-2 damage stops
// matching the shipped client HUD, and this fails loudly.
import { describe, it, expect } from 'vitest';
import * as server from '../../server/combat/damageTable.js';
import * as client from '../../src/engine/combat/damage.js';

describe('damage-table parity (MP-2 server ↔ client)', () => {
  it('HEADSHOT_DAMAGE matches', () => {
    expect(server.HEADSHOT_DAMAGE).toBe(client.HEADSHOT_DAMAGE);
    expect(server.HEADSHOT_DAMAGE).toBe(9);
  });

  it('BODY_DAMAGE matches', () => {
    expect(server.BODY_DAMAGE).toBe(client.BODY_DAMAGE);
    expect(server.BODY_DAMAGE).toBe(3);
  });

  it('damageFor(zone) matches client shotDamage(isHead)', () => {
    expect(server.damageFor('head')).toBe(client.shotDamage(true));
    expect(server.damageFor('body')).toBe(client.shotDamage(false));
  });

  it('unknown zone returns 0 (safe fallback for corrupt wire input)', () => {
    expect(server.damageFor('nose')).toBe(0);
    expect(server.damageFor('')).toBe(0);
    expect(server.damageFor(undefined)).toBe(0);
  });

  it('limb (reserved zone, valid on wire) maps to body damage', () => {
    expect(server.damageFor('limb')).toBe(server.BODY_DAMAGE);
  });
});
