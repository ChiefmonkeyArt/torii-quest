// tests/world-handoff.test.js — SEC-2 gate on src/world/handoff.js (v0.2.356).
// Locks the crypto-verified handoff floor: `resolveHandoffSpawn` no longer arms
// a spawn from a bare unsigned envelope. It REQUIRES a hex64
// `expectedPlayerPubkey` opt and runs a real BIP-340 schnorr verify over a
// re-derived NIP-01 event id. Structural checks stay as a fast pre-flight;
// crypto is the trust gate. `verifyHandoffCrypto` is exported so any future
// consumer (a router, an arrival controller) can reuse the same verdict shape
// as SEC-1 (verifyPublishGate) and SEC-2 gateway (handoffVerify).
import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import {
  HANDOFF_KIND,
  HANDOFF_NAMESPACE,
  HANDOFF_SCHEMA_VERSION,
  createHandoffEvent,
  verifyHandoffEvent,
  verifyHandoffCrypto,
  signHandoffEvent,
  deriveHandoffId,
  serializeHandoff,
  deserializeHandoff,
  resolveHandoffSpawn,
} from '../src/world/handoff.js';

const PLAYER_SK = hexToBytes('a1'.repeat(32));    // travelling player's secret key
const EVIL_SK   = hexToBytes('e7'.repeat(32));    // an attacker's secret key
const PLAYER_PK = bytesToHex(schnorr.getPublicKey(PLAYER_SK));
const EVIL_PK   = bytesToHex(schnorr.getPublicKey(EVIL_SK));
const NOW = Math.floor(Date.now() / 1000);

const DEST_META = { id: 'banker-bazaar', spawn: { x: 0, y: 0, z: 0 } };

function baseHandoff(overrides = {}) {
  return createHandoffEvent({
    player: PLAYER_PK,
    from: 'cm-home',
    to: 'banker-bazaar',
    display: { character: 'kappa', name: 'Chiefmonkey' },
    ts: NOW,
    ...overrides,
  });
}

describe('world/handoff constants', () => {
  it('exports the NIP-01 kind, namespace, and schema version', () => {
    expect(HANDOFF_KIND).toBe(30079);
    expect(HANDOFF_NAMESPACE).toBe('torii.handoff');
    expect(HANDOFF_SCHEMA_VERSION).toBe(1);
  });
});

describe('createHandoffEvent', () => {
  it('builds a well-shaped envelope with defaults', () => {
    const h = createHandoffEvent({ player: PLAYER_PK, to: 'banker-bazaar' });
    expect(h.v).toBe(HANDOFF_SCHEMA_VERSION);
    expect(h.kind).toBe(HANDOFF_NAMESPACE);
    expect(h.player).toBe(PLAYER_PK);
    expect(h.to).toBe('banker-bazaar');
    expect(h.from).toBe('');
    expect(typeof h.ts).toBe('number');
    expect(h.display).toEqual({});
    expect(h.carry).toEqual({});
  });

  it('accepts an explicit ts (unix seconds)', () => {
    const h = createHandoffEvent({ player: PLAYER_PK, to: 'z', ts: 1_800_000_000 });
    expect(h.ts).toBe(1_800_000_000);
  });

  it('coerces non-object display/carry to empty objects', () => {
    const h = createHandoffEvent({ player: PLAYER_PK, to: 'z', display: 'nope', carry: 42 });
    expect(h.display).toEqual({});
    expect(h.carry).toEqual({});
  });
});

describe('verifyHandoffEvent — structural (unchanged)', () => {
  it('accepts a fresh, well-shaped envelope', () => {
    const v = verifyHandoffEvent(baseHandoff(), { now: NOW });
    expect(v.ok).toBe(true);
  });

  it('rejects a stale envelope past the 5-minute window', () => {
    const v = verifyHandoffEvent(baseHandoff({ ts: NOW - 600 }), { now: NOW });
    expect(v.ok).toBe(false);
    expect(v.error).toBe('stale handoff');
  });

  it('rejects missing player, missing destination, and bad schema', () => {
    expect(verifyHandoffEvent(baseHandoff({ player: '' }), { now: NOW }).error).toBe('missing player npub');
    expect(verifyHandoffEvent(baseHandoff({ to: '' }), { now: NOW }).error).toBe('missing destination zone');
    expect(verifyHandoffEvent({ ...baseHandoff(), v: 99 }, { now: NOW }).error).toBe('bad schema version');
    expect(verifyHandoffEvent({ ...baseHandoff(), kind: 'nope' }, { now: NOW }).error).toBe('bad namespace');
  });
});

describe('deriveHandoffId + signHandoffEvent', () => {
  it('derives a stable hex64 id from a well-formed envelope', () => {
    const id = deriveHandoffId(baseHandoff());
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    // Re-deriving from the same envelope yields the same id.
    expect(deriveHandoffId(baseHandoff())).toBe(id);
  });

  it('returns null when player is not hex64 or ts is missing', () => {
    expect(deriveHandoffId(baseHandoff({ player: 'npub1notHex' }))).toBeNull();
    // Bypass the createHandoffEvent factory (which defaults ts) and pass ts explicitly non-integer.
    expect(deriveHandoffId({ ...baseHandoff(), ts: 'nope' })).toBeNull();
    expect(deriveHandoffId({ ...baseHandoff(), ts: -1 })).toBeNull();
  });

  it('signHandoffEvent produces a { id, sig } envelope that verifies', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    const v = verifyHandoffCrypto(signed, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.ok).toBe(true);
    expect(v.trusted).toBe(true);
    expect(v.trust).toBe('crypto-verified');
  });

  it('signHandoffEvent accepts a hex sk string', () => {
    const signed = signHandoffEvent(baseHandoff(), 'a1'.repeat(32));
    expect(verifyHandoffCrypto(signed, { expectedPlayerPubkey: PLAYER_PK, now: NOW }).trusted).toBe(true);
  });

  it('signHandoffEvent throws on an unsignable envelope', () => {
    expect(() => signHandoffEvent(baseHandoff({ player: 'not-hex' }), PLAYER_SK)).toThrow(/cannot derive handoff id/);
  });
});

describe('verifyHandoffCrypto — malformed inputs (ok:false)', () => {
  it('returns ok:false when the event is missing', () => {
    const v = verifyHandoffCrypto(null, { expectedPlayerPubkey: PLAYER_PK });
    expect(v.ok).toBe(false);
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('handoff event is required');
  });

  it('returns ok:false when expectedPlayerPubkey is not hex64', () => {
    const v = verifyHandoffCrypto(baseHandoff(), { expectedPlayerPubkey: 'npub1notHex' });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('expectedPlayerPubkey must be hex64');
  });

  it('returns ok:false when opts is missing entirely', () => {
    const v = verifyHandoffCrypto(baseHandoff());
    expect(v.ok).toBe(false);
    expect(v.trusted).toBe(false);
  });
});

describe('verifyHandoffCrypto — reject path (identity / structure)', () => {
  it('rejects an unsigned envelope (no id, no sig)', () => {
    const v = verifyHandoffCrypto(baseHandoff(), { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.trust).toBe('unverified');
    expect(v.errors).toContain('event id must be a hex64 string');
    expect(v.errors).toContain('event sig must be a hex128 schnorr signature');
  });

  it('rejects when player is not the expected traveller (anti-impersonation)', () => {
    // A genuinely-signed event from EVIL — sig is real, but the traveller pubkey differs.
    const signed = signHandoffEvent(baseHandoff({ player: EVIL_PK }), EVIL_SK);
    const v = verifyHandoffCrypto(signed, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('event player does not match expected traveller pubkey');
  });

  it('rejects when player field is not hex64', () => {
    const bogus = { ...baseHandoff({ player: 'npub1abc' }), id: 'a'.repeat(64), sig: 'c'.repeat(128) };
    const v = verifyHandoffCrypto(bogus, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.startsWith("event player must be hex64"))).toBe(true);
  });

  it('rejects when id is present but does not re-derive from the body (tampered)', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    // Tamper the destination AFTER signing — id will no longer match.
    const tampered = { ...signed, to: 'someone-elses-zone' };
    const v = verifyHandoffCrypto(tampered, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('event id does not match the envelope body (tampered)');
  });

  it('rejects a stub (well-shaped but non-real) signature', () => {
    const stub = { ...signHandoffEvent(baseHandoff(), PLAYER_SK), sig: 'c'.repeat(128) };
    const v = verifyHandoffCrypto(stub, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('schnorr signature verification failed');
  });

  it('rejects a sig from the wrong key over our id (schnorr layer catches it)', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    const forged = {
      ...signed,
      // EVIL_SK signs OUR id — the sig is valid over id, but not under PLAYER_PK.
      sig: bytesToHex(schnorr.sign(hexToBytes(signed.id), EVIL_SK)),
    };
    const v = verifyHandoffCrypto(forged, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('schnorr signature verification failed');
  });

  it('rejects a stale envelope by default (requireFresh)', () => {
    const stale = signHandoffEvent(baseHandoff({ ts: NOW - 600 }), PLAYER_SK);
    const v = verifyHandoffCrypto(stale, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('stale handoff');
  });

  it('waives staleness when requireFresh:false (round-trip use)', () => {
    const stale = signHandoffEvent(baseHandoff({ ts: NOW - 600 }), PLAYER_SK);
    const v = verifyHandoffCrypto(stale, { expectedPlayerPubkey: PLAYER_PK, now: NOW, requireFresh: false });
    expect(v.trusted).toBe(true);
    expect(v.trust).toBe('crypto-verified');
  });
});

describe('resolveHandoffSpawn — SEC-2 fail-closed', () => {
  it('SEC-2: refuses when expectedPlayerPubkey is missing (no crypto identity → null)', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    // No opts at all → refuse.
    expect(resolveHandoffSpawn(signed, DEST_META)).toBeNull();
    // Empty opts / non-hex64 pubkey → refuse.
    expect(resolveHandoffSpawn(signed, DEST_META, {})).toBeNull();
    expect(resolveHandoffSpawn(signed, DEST_META, { expectedPlayerPubkey: 'npub1abc' })).toBeNull();
  });

  it('SEC-2: refuses an unsigned envelope (structurally valid, no id/sig)', () => {
    // The old skeleton armed this. Now it fails closed.
    expect(resolveHandoffSpawn(baseHandoff(), DEST_META, { expectedPlayerPubkey: PLAYER_PK, now: NOW })).toBeNull();
  });

  it('SEC-2: refuses a tampered envelope (id no longer binds the body)', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    const tampered = { ...signed, to: 'someone-elses-zone' };
    // Also mismatches DEST_META, but the crypto check refuses BEFORE that reaches meta.
    expect(resolveHandoffSpawn(tampered, { id: 'someone-elses-zone', spawn: { x: 0, y: 0, z: 0 } }, { expectedPlayerPubkey: PLAYER_PK, now: NOW })).toBeNull();
  });

  it('SEC-2: refuses when the sig is from a different key (wrong-key)', () => {
    const forged = signHandoffEvent(baseHandoff({ player: EVIL_PK }), EVIL_SK);
    // The expected traveller is PLAYER — a valid EVIL-signed envelope does NOT arm.
    expect(resolveHandoffSpawn(forged, DEST_META, { expectedPlayerPubkey: PLAYER_PK, now: NOW })).toBeNull();
  });

  it('arms the spawn on a properly-signed, expected-player, fresh handoff', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    const spawn = resolveHandoffSpawn(signed, DEST_META, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(spawn).not.toBeNull();
    expect(spawn.zone).toBe('banker-bazaar');
    expect(spawn.player).toBe(PLAYER_PK);
    expect(spawn.spawn).toEqual({ x: 0, y: 0, z: 0 });
    expect(spawn.display).toEqual({ character: 'kappa', name: 'Chiefmonkey' });
  });

  it('refuses when destZoneMeta is missing or lacks a spawn', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    expect(resolveHandoffSpawn(signed, null, { expectedPlayerPubkey: PLAYER_PK, now: NOW })).toBeNull();
    expect(resolveHandoffSpawn(signed, { id: 'banker-bazaar' }, { expectedPlayerPubkey: PLAYER_PK, now: NOW })).toBeNull();
  });

  it('refuses when destZoneMeta.id disagrees with envelope.to', () => {
    const signed = signHandoffEvent(baseHandoff({ to: 'banker-bazaar' }), PLAYER_SK);
    const wrongDest = { id: 'grasslands', spawn: { x: 0, y: 0, z: 0 } };
    expect(resolveHandoffSpawn(signed, wrongDest, { expectedPlayerPubkey: PLAYER_PK, now: NOW })).toBeNull();
  });
});

describe('serializeHandoff / deserializeHandoff (round-trip is signature-preserving)', () => {
  it('a signed envelope round-trips through serialize → deserialize and still verifies', () => {
    const signed = signHandoffEvent(baseHandoff(), PLAYER_SK);
    const wire = serializeHandoff(signed);
    const back = deserializeHandoff(wire);
    expect(back).not.toBeNull();
    const v = verifyHandoffCrypto(back, { expectedPlayerPubkey: PLAYER_PK, now: NOW });
    expect(v.trusted).toBe(true);
  });

  it('deserializeHandoff returns null on non-strings and malformed JSON', () => {
    expect(deserializeHandoff(null)).toBeNull();
    expect(deserializeHandoff(42)).toBeNull();
    expect(deserializeHandoff('{not-json')).toBeNull();
  });
});
