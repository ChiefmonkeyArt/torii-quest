// kamiSeal.js — ADR-0025. Hybrid sealed-box encryption for Kami Mode ema.
//
// WHY THIS EXISTS
// Ema are private maintainer notes: free text, a full ToriiDebug snapshot and a
// screenshot of whatever was on screen. They are stored on the VPS, so anything
// that reads that disk (a backup, a stolen image, a mis-set permission) would
// otherwise read the notes. Ema are sealed IN THE BROWSER before they are sent;
// the server only ever holds ciphertext and NEVER holds a private key.
//
// DELIBERATELY NOT NIP-44. Ema never touch a relay (owner's explicit decision:
// "local only... no need for them to be nostr events ever"), so wire-format
// compatibility with other Nostr clients buys nothing, and strict NIP-44 v2
// would add a @noble/ciphers dependency for its ChaCha20. Instead this uses
// primitives ALREADY in the tree — @noble/curves secp256k1 ECDH, @noble/hashes
// HKDF — plus AES-256-GCM from the platform's own WebCrypto. Zero new deps.
//
// SCHEME (hybrid / "envelope" encryption)
//   1. A fresh random 256-bit content key (CEK) encrypts the payload ONCE.
//   2. The CEK is then wrapped separately for each recipient.
// Payload-once matters: a screenshot ema is ~200 KB, and per-recipient payload
// encryption would double stored bytes for every extra reader.
//
// Per-recipient wrap:
//   shared   = ECDH(ephemeralPriv, recipientPub)      // 33B compressed point
//   sharedX  = shared[1..33]                          // x coordinate only
//   wrapKey  = HKDF-SHA256(sharedX, salt=ephPub, info="torii-kami-v1/wrap")
//   wrapped  = AES-256-GCM(wrapKey, iv, CEK)
// A fresh ephemeral keypair per ema means the same CEK is never wrapped under a
// repeated key, and recipients are unlinkable across ema.
//
// THREAT MODEL — read before trusting this.
//   PROTECTS: data at rest. Root on the VPS, a leaked backup or a snapshotted
//     disk yields unreadable blobs, screenshots included.
//   DOES NOT PROTECT: a live compromise of the delivery pipeline. Whoever can
//     patch the JS that nginx serves can capture notes BEFORE they are sealed.
//     No server-side storage scheme can defend against that, and pretending
//     otherwise would be worse than saying it plainly here.
//   DOES NOT AUTHENTICATE the sender. Sealing needs only public keys, so anyone
//     holding them can forge an ema. That is deliberate — it keeps NIP-07 signer
//     quirks out of the capture hot path, and the POST route is separately
//     admin-gated by session token. Do not treat a sealed ema as proof of origin.
//
// Recipients are always: the instance owner's key AND the Kami key (whose
// private half lives off-box). Dropping a recipient revokes that reader for all
// FUTURE ema; already-sealed ema stay readable by whoever they were sealed to.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const KAMI_SEAL_VERSION = 1;
export const KAMI_SEAL_ALG     = 'kami-v1';

// HKDF `info` labels. This @noble/hashes version requires byte arrays here (a
// plain string throws), so they are encoded once at module load, not per call.
const WRAP_INFO = new TextEncoder().encode('torii-kami-v1/wrap');
const BODY_INFO = new TextEncoder().encode('torii-kami-v1/body');
const IV_BYTES  = 12;  // AES-GCM standard nonce length
const CEK_BYTES = 32;  // AES-256

// ── small byte helpers (no Buffer: this runs in the browser) ────────────────
export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) throw new Error('kamiSeal: bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) throw new Error('kamiSeal: bad hex');
    out[i] = byte;
  }
  return out;
}

// Accept either a 33-byte compressed pubkey (02/03 prefix) or a 32-byte x-only
// key as Nostr hands out (npub decodes to x-only). x-only is normalised to the
// even-Y compressed form, which is the Nostr/BIP-340 convention.
export function normalisePubkey(hex) {
  const clean = String(hex || '').trim().toLowerCase();
  if (clean.length === 66) return fromHex(clean);
  if (clean.length === 64) return fromHex(`02${clean}`);
  throw new Error('kamiSeal: pubkey must be 32-byte x-only or 33-byte compressed hex');
}

// The body ciphertext is the only large field (a screenshot ema is ~200 KB), so
// it is stored base64 rather than hex: hex costs 2.00x the payload, base64 1.37x.
// The small fields (eph/iv/wrap keys) stay hex — they are fixed-size and hex is
// easier to eyeball in a JSONL file.
export function toB64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    // Chunked to avoid blowing the argument limit on large arrays.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}

export function fromB64(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function requireSubtle(injected) {
  const subtle = injected || (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle);
  if (!subtle) throw new Error('kamiSeal: WebCrypto subtle unavailable');
  return subtle;
}

function randomBytes(n, injected) {
  const rng = injected || (typeof globalThis !== 'undefined' && globalThis.crypto);
  if (!rng || typeof rng.getRandomValues !== 'function') throw new Error('kamiSeal: CSPRNG unavailable');
  return rng.getRandomValues(new Uint8Array(n));
}

// HKDF-SHA256 over the ECDH x coordinate. Hashing the shared point (rather than
// using its bytes as a key directly) is what makes the output uniformly random;
// raw ECDH output is a curve point, not a key.
function deriveKey(sharedX, salt, info) {
  return hkdf(sha256, sharedX, salt, info, 32);
}

async function importAesKey(subtle, raw, usage) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

async function aesEncrypt(subtle, rawKey, iv, plaintext) {
  const key = await importAesKey(subtle, rawKey, 'encrypt');
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return new Uint8Array(ct);
}

async function aesDecrypt(subtle, rawKey, iv, ciphertext) {
  const key = await importAesKey(subtle, rawKey, 'decrypt');
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(pt);
}

/**
 * Seal bytes to one or more recipient public keys.
 *
 * @param {Uint8Array} payload           plaintext bytes (already UTF-8/binary encoded)
 * @param {string[]}   recipientPubkeys  hex, x-only (64) or compressed (66)
 * @param {object}     [deps]            { subtle, rng } injection seam for tests
 * @returns {Promise<object>}            JSON-serialisable envelope
 */
export async function sealTo(payload, recipientPubkeys, deps = {}) {
  // Realm-agnostic byte check: a Uint8Array produced in another realm (a
  // browser iframe/worker, or the vitest jsdom context) fails `instanceof
  // Uint8Array` because the constructor references differ. Any TypedArray /
  // DataView / ArrayBuffer carries a numeric byteLength, which is all
  // subtle.encrypt needs (it accepts any BufferSource).
  if (!payload || typeof payload.byteLength !== 'number') {
    throw new Error('kamiSeal: payload must be a byte array (Uint8Array)');
  }
  const recipients = Array.isArray(recipientPubkeys) ? recipientPubkeys.filter(Boolean) : [];
  if (recipients.length === 0) throw new Error('kamiSeal: at least one recipient required');

  const subtle = requireSubtle(deps.subtle);
  const ephPriv = deps.ephemeralPriv || randomBytes(32, deps.rng);
  const ephPub  = secp256k1.getPublicKey(ephPriv, true);
  const cek     = deps.cek || randomBytes(CEK_BYTES, deps.rng);

  // Body key is derived from the CEK rather than being the CEK itself, so the
  // wrapped secret and the body key are not literally the same bytes.
  const bodyKey = deriveKey(cek, ephPub, BODY_INFO);
  const bodyIv  = randomBytes(IV_BYTES, deps.rng);
  const body    = await aesEncrypt(subtle, bodyKey, bodyIv, payload);

  const keys = [];
  for (const pub of recipients) {
    const pubBytes = normalisePubkey(pub);
    const shared   = secp256k1.getSharedSecret(ephPriv, pubBytes, true);
    const sharedX  = shared.subarray(1, 33);
    const wrapKey  = deriveKey(sharedX, ephPub, WRAP_INFO);
    const wrapIv   = randomBytes(IV_BYTES, deps.rng);
    const wrapped  = await aesEncrypt(subtle, wrapKey, wrapIv, cek);
    keys.push({ to: toHex(pubBytes), iv: toHex(wrapIv), key: toHex(wrapped) });
  }

  return {
    v: KAMI_SEAL_VERSION,
    alg: KAMI_SEAL_ALG,
    eph: toHex(ephPub),
    iv: toHex(bodyIv),
    ct: toB64(body),
    keys,
  };
}

/**
 * Open an envelope with one recipient's private key.
 *
 * @param {object}            envelope  as produced by sealTo
 * @param {Uint8Array|string} privKey   32-byte secret key (bytes or hex)
 * @param {object}            [deps]    { subtle } injection seam
 * @returns {Promise<Uint8Array>}       plaintext bytes
 */
export async function openSealed(envelope, privKey, deps = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('kamiSeal: bad envelope');
  if (envelope.alg !== KAMI_SEAL_ALG) throw new Error(`kamiSeal: unsupported alg ${envelope.alg}`);
  const subtle = requireSubtle(deps.subtle);
  const priv   = typeof privKey === 'string' ? fromHex(privKey) : privKey;

  const ephPub  = fromHex(envelope.eph);
  const shared  = secp256k1.getSharedSecret(priv, ephPub, true);
  const sharedX = shared.subarray(1, 33);
  const wrapKey = deriveKey(sharedX, ephPub, WRAP_INFO);

  // Try every wrap slot: the caller need not know which recipient they are, and
  // GCM's tag makes a wrong slot fail cleanly rather than yield garbage.
  const slots = Array.isArray(envelope.keys) ? envelope.keys : [];
  let cek = null;
  for (const slot of slots) {
    try {
      cek = await aesDecrypt(subtle, wrapKey, fromHex(slot.iv), fromHex(slot.key));
      break;
    } catch { /* not our slot; keep looking */ }
  }
  if (!cek) throw new Error('kamiSeal: no wrap slot opened with this key');

  const bodyKey = deriveKey(cek, ephPub, BODY_INFO);
  return aesDecrypt(subtle, bodyKey, fromHex(envelope.iv), fromB64(envelope.ct));
}

// Convenience wrappers for the common "seal a JS object" case.
export async function sealJson(value, recipientPubkeys, deps = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return sealTo(bytes, recipientPubkeys, deps);
}

export async function openJson(envelope, privKey, deps = {}) {
  const bytes = await openSealed(envelope, privKey, deps);
  return JSON.parse(new TextDecoder().decode(bytes));
}
