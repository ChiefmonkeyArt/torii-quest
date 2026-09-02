// kami-seal.test.js — ADR-0025 (v0.2.634-alpha).
//
// Locks the ema sealed-box contract. Ema carry free-text notes, a full debug
// snapshot and a screenshot, and they sit on a VPS disk — so the properties
// below are the whole reason the feature is safe to use:
//
//   1. BOTH readers can open the same ema. Owner and Kami key each get a wrap
//      slot; if this breaks, notes become write-only.
//   2. Nobody else can. A stranger's key must fail, not return garbage.
//   3. Tampering is detected, not silently tolerated.
//   4. The payload is stored ONCE, not once per recipient. Screenshots dominate
//      the size, so per-recipient bodies would double storage per extra reader.
//   5. Adding a recipient (a future Routstr/Continuum agent) does not change the
//      format or re-encrypt the body.
//
// Pure: Node WebCrypto + @noble. No browser, no network, no VPS.
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  sealTo, openSealed, sealJson, openJson, normalisePubkey, toHex, toB64, fromB64,
  KAMI_SEAL_ALG,
} from '../../src/engine/kami/kamiSeal.js';

const hex = (b) => Buffer.from(b).toString('hex');

function keypair() {
  const priv = secp256k1.utils.randomSecretKey();
  return { priv, xonly: hex(secp256k1.getPublicKey(priv, true)).slice(2) };
}

describe('kamiSeal — ema sealed box', () => {
  it('round-trips a JSON ema for the owner key', async () => {
    const owner = keypair();
    const ema = { note: 'gun did not fire', pos: { x: 1.5, y: 2, z: -3.25 } };
    const env = await sealJson(ema, [owner.xonly]);
    expect(await openJson(env, owner.priv)).toEqual(ema);
  });

  it('lets BOTH the owner and the Kami key open the same ema', async () => {
    const owner = keypair();
    const kami  = keypair();
    const ema = { note: 'dead bot still shooting' };
    const env = await sealJson(ema, [owner.xonly, kami.xonly]);
    expect(env.keys).toHaveLength(2);
    expect(await openJson(env, owner.priv)).toEqual(ema);
    expect(await openJson(env, kami.priv)).toEqual(ema);
  });

  it('stores the body ONCE regardless of recipient count', async () => {
    const a = keypair(), b = keypair(), c = keypair();
    const payload = new Uint8Array(4096).fill(9);
    const one   = await sealTo(payload, [a.xonly]);
    const three = await sealTo(payload, [a.xonly, b.xonly, c.xonly]);
    // Body ciphertext is identical in LENGTH; only the wrap-slot count grows.
    expect(three.ct.length).toBe(one.ct.length);
    expect(three.keys).toHaveLength(3);
    expect(one.keys).toHaveLength(1);
  });

  it('refuses a stranger key rather than returning garbage', async () => {
    const owner = keypair();
    const stranger = keypair();
    const env = await sealJson({ note: 'private' }, [owner.xonly]);
    await expect(openJson(env, stranger.priv)).rejects.toThrow(/no wrap slot/i);
  });

  it('detects a tampered body', async () => {
    const owner = keypair();
    const env = await sealJson({ note: 'original' }, [owner.xonly]);
    const flipped = fromB64(env.ct);
    flipped[flipped.length - 1] ^= 0xff;
    const bad = { ...env, ct: toB64(flipped) };
    await expect(openJson(bad, owner.priv)).rejects.toThrow();
  });

  it('detects a tampered wrap slot', async () => {
    const owner = keypair();
    const env = await sealJson({ note: 'original' }, [owner.xonly]);
    const bad = { ...env, keys: [{ ...env.keys[0], key: env.keys[0].key.replace(/^../, 'ff') }] };
    await expect(openJson(bad, owner.priv)).rejects.toThrow();
  });

  it('never leaves the plaintext visible in the envelope', async () => {
    const owner = keypair();
    const secret = 'SENSITIVE-NOTE-TEXT';
    const env = await sealJson({ note: secret }, [owner.xonly]);
    expect(JSON.stringify(env)).not.toContain(secret);
  });

  it('produces a different envelope every time (fresh ephemeral + IV)', async () => {
    const owner = keypair();
    const a = await sealJson({ note: 'same' }, [owner.xonly]);
    const b = await sealJson({ note: 'same' }, [owner.xonly]);
    expect(a.eph).not.toBe(b.eph);
    expect(a.ct).not.toBe(b.ct);
  });

  it('rejects an unknown algorithm rather than guessing', async () => {
    const owner = keypair();
    const env = await sealJson({ note: 'x' }, [owner.xonly]);
    await expect(openJson({ ...env, alg: 'rot13' }, owner.priv)).rejects.toThrow(/unsupported alg/i);
    expect(env.alg).toBe(KAMI_SEAL_ALG);
  });

  it('requires at least one recipient', async () => {
    await expect(sealTo(new Uint8Array([1]), [])).rejects.toThrow(/recipient/i);
  });

  it('accepts x-only (Nostr) and compressed pubkeys as the same key', () => {
    const { xonly } = keypair();
    expect(toHex(normalisePubkey(xonly))).toBe(`02${xonly}`);
    expect(toHex(normalisePubkey(`02${xonly}`))).toBe(`02${xonly}`);
  });

  it('base64 body costs ~1.34x, not the 2x a hex body would', async () => {
    const owner = keypair();
    const payload = new Uint8Array(200 * 1024).fill(7);
    const env = await sealTo(payload, [owner.xonly]);
    const ratio = env.ct.length / payload.length;
    expect(ratio).toBeLessThan(1.4);
    expect(ratio).toBeGreaterThan(1.3);
  });

  it('round-trips a screenshot-sized binary payload byte for byte', async () => {
    const owner = keypair();
    const payload = new Uint8Array(64 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) & 0xff;
    const env = await sealTo(payload, [owner.xonly]);
    const out = await openSealed(env, owner.priv);
    expect(Buffer.from(out).equals(Buffer.from(payload))).toBe(true);
  });

  it('base64 helpers round-trip binary containing every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(Buffer.from(fromB64(toB64(all))).equals(Buffer.from(all))).toBe(true);
  });
});
