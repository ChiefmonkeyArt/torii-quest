// engine/crypto/npub.js — bech32 `npub1…` → 32-byte hex pubkey (UPD-2, v0.2.387-alpha).
//
// A nostr pubkey has two wire forms: the raw 32-byte X-only key as hex64, and the
// NIP-19 bech32 `npub1…` encoding of those same 32 bytes. The arena admin gate is
// configured with QUEST_ADMIN_NPUB, which an operator may paste in EITHER form, so
// this normalises both to the canonical lowercase hex64 the schnorr verifier and the
// session-token pubkeys already use.
//
// PURE + node-safe: no DOM, no socket, no deps. A minimal BIP-173 bech32 decoder
// (no external dependency — the project only ships @noble/curves, which has no
// bech32 export we rely on here). Never throws — malformed input returns null so the
// admin gate fails CLOSED.

const HEX64 = /^[0-9a-f]{64}$/;
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// bech32 polymod checksum (BIP-173).
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (let i = 0; i < values.length; i += 1) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ values[i];
    for (let j = 0; j < 5; j += 1) {
      if ((top >>> j) & 1) chk ^= GEN[j];
    }
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function verifyChecksum(hrp, data) {
  return polymod(hrpExpand(hrp).concat(data)) === 1;
}

// convertBits(data, from, to, pad) → regrouped bit stream, or null on overflow.
function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (value < 0 || value >>> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return out;
}

// bytesToHex(u8) → lowercase hex string.
function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// npubToHex(input) → the canonical lowercase hex64 pubkey, or null.
//   - A raw hex64 string (any case) is passed through, lowercased.
//   - A NIP-19 `npub1…` bech32 string is checksum-verified, decoded, its 5-bit
//     data words regrouped to 8-bit bytes, and required to be exactly 32 bytes.
// Never throws; any malformed / wrong-hrp / bad-checksum / wrong-length input → null.
export function npubToHex(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (HEX64.test(s.toLowerCase())) return s.toLowerCase();

  const lower = s.toLowerCase();
  // bech32 must be single-case; reject mixed case (BIP-173).
  if (s !== lower && s !== s.toUpperCase()) return null;
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;
  const hrp = lower.slice(0, pos);
  if (hrp !== 'npub') return null;
  const dataPart = lower.slice(pos + 1);
  const data = [];
  for (let i = 0; i < dataPart.length; i += 1) {
    const idx = CHARSET.indexOf(dataPart[i]);
    if (idx === -1) return null;
    data.push(idx);
  }
  if (!verifyChecksum(hrp, data)) return null;
  const payload = data.slice(0, data.length - 6); // strip 6-word checksum
  const bytes = convertBits(payload, 5, 8, false);
  if (!bytes || bytes.length !== 32) return null;
  return bytesToHex(bytes);
}

// v0.2.933 (ADR-0147 M3): hex64 pubkey → NIP-19 `npub1…` (BIP-173 encode), or null.
// The inverse of npubToHex, for /w/<npub>/<world> links built from directory rows.
export function hexToNpub(hex) {
  if (typeof hex !== 'string' || !HEX64.test(hex.toLowerCase())) return null;
  const h = hex.toLowerCase();
  const bytes = [];
  for (let i = 0; i < 64; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  const data = convertBits(bytes, 8, 5, true);
  const values = hrpExpand('npub').concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  let out = 'npub1';
  for (let i = 0; i < data.length; i += 1) out += CHARSET[data[i]];
  for (let i = 0; i < 6; i += 1) out += CHARSET[(mod >>> (5 * (5 - i))) & 31];
  return out;
}

// v0.2.916 (ADR-0145): NIP-19 `naddr1…` → "kind:pubkey:d" coordinate, or null.
// TLV: 0 = d identifier (utf-8), 1 = relay (ignored), 2 = author (32 bytes),
// 3 = kind (4-byte big-endian). A raw "kind:hex64:d" string passes through.
const COORD_RE = /^(\d{1,10}):([0-9a-f]{64}):(.{0,256})$/;
export function naddrToCoord(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^nostr:/i, '');
  const raw = COORD_RE.exec(s);
  if (raw) return `${Number(raw[1])}:${raw[2]}:${raw[3]}`;
  const lower = s.toLowerCase();
  if (s !== lower && s !== s.toUpperCase()) return null;
  if (!lower.startsWith('naddr1') || lower.length > 1000) return null;
  const data = [];
  for (const ch of lower.slice(6)) { const i = CHARSET.indexOf(ch); if (i === -1) return null; data.push(i); }
  if (!verifyChecksum('naddr', data)) return null;
  const bytes = convertBits(data.slice(0, data.length - 6), 5, 8, false);
  if (!bytes) return null;
  let d = null, author = null, kind = null;
  for (let i = 0; i + 2 <= bytes.length;) {
    const t = bytes[i], len = bytes[i + 1], v = bytes.slice(i + 2, i + 2 + len);
    if (v.length !== len) return null;
    if (t === 0) d = new TextDecoder().decode(new Uint8Array(v));
    else if (t === 2 && len === 32) author = bytesToHex(v);
    else if (t === 3 && len === 4) kind = ((v[0] << 24) | (v[1] << 16) | (v[2] << 8) | v[3]) >>> 0;
    i += 2 + len;
  }
  if (d == null || !author || kind == null || d.length > 256) return null;
  return `${kind}:${author}:${d}`;
}
