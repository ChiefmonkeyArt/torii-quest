// Burner-key NIP-07 signer for the Torii Quest MP live test.
// Uses the project's own @noble/curves/@noble/hashes (torii-quest/node_modules).
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

const enc = new TextEncoder();

// NIP-01 canonical serialization for the event id.
function serializeForId(evt) {
  return JSON.stringify([
    0,
    evt.pubkey,
    evt.created_at,
    evt.kind,
    Array.isArray(evt.tags) ? evt.tags : [],
    typeof evt.content === 'string' ? evt.content : '',
  ]);
}

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b) {
  let h = '';
  for (const x of b) h += x.toString(16).padStart(2, '0');
  return h;
}

// Bech32 (BIP-173) encode for the npub.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) {
  let GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function bech32HrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(hrp.charCodeAt(c) >> 5);
  out.push(0);
  for (const c of hrp) out.push(hrp.charCodeAt(c) & 31);
  return out;
}
function bech32CreateChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data);
  const mod = bech32Polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const ret = [];
  for (let i = 0; i < 6; i++) ret.push((mod >> (5 * (5 - i))) & 31);
  return ret;
}
function convertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0; const out = [];
  const maxv = (1 << toBits) - 1, maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const v of data) {
    acc = ((acc << fromBits) | v) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; out.push((acc >> bits) & maxv); }
  }
  if (pad && bits) out.push((acc << (toBits - bits)) & maxv);
  return out;
}
function bech32Encode(hrp, data) {
  const combined = data.concat(bech32CreateChecksum(hrp, data));
  return hrp + '1' + combined.map(i => CHARSET[i]).join('');
}

export function generateKeyPair() {
  const priv = randomBytes(32);
  const privHex = bytesToHex(priv);
  const pubHex = bytesToHex(schnorr.getPublicKey(priv)); // x-only 32 bytes
  // npub = bech32 of the 32-byte pubkey
  const data5 = convertBits(Array.from(hexToBytes(pubHex)), 8, 5, true);
  const npub = bech32Encode('npub', data5);
  return { privHex, pubHex, npub };
}

// Finalize a NIP-01 event (kind 22242) — adds pubkey, id, sig.
export function finalizeEvent(evt, privHex) {
  const priv = hexToBytes(privHex);
  const pubHex = bytesToHex(schnorr.getPublicKey(priv));
  const event = {
    kind: evt.kind,
    created_at: evt.created_at,
    content: evt.content,
    tags: evt.tags,
    pubkey: pubHex,
  };
  const id = bytesToHex(sha256(enc.encode(serializeForId(event))));
  event.id = id;
  event.sig = bytesToHex(schnorr.sign(sha256(enc.encode(serializeForId(event))), priv));
  return event;
}
