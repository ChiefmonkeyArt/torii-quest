#!/usr/bin/env node
// kami-keygen.mjs — ADR-0038. Generate a fresh Kami keypair for ema sealing.
//
// WHY: the Kami private key (off-box reader for sealed ema) was never saved when
// pubkey f69bbd44… was hardcoded. With the ema store empty, we rotate to a fresh
// keypair — zero data loss. This tool generates one and self-verifies it.
//
// Generation uses ONLY node:crypto (no npm deps) so it runs on any machine with
// Node. The self-verify (seal+open round-trip) imports kamiSeal where
// @noble/curves is present (e.g. the VPS repo checkout); if the import is absent
// the key is still valid, the verify step is just skipped.
//
// The PRIVATE key is written to ./kami-priv.hex (chmod 600) and is NEVER printed.
// Only the PUBLIC key is printed — paste that back to the agent to deploy.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

function die(msg) { console.error(`kami-keygen: ${msg}`); process.exit(1); }

// 1. Generate a secp256k1 keypair with Node's built-in crypto (no deps).
let pubHex, privHex;
try {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'jwk' },
  });
  // JWK x/d are base64url of the 32-byte coord / private scalar.
  pubHex  = Buffer.from(publicKey.x,  'base64url').toString('hex');
  privHex = Buffer.from(privateKey.d, 'base64url').toString('hex');
} catch (e) { die(`key generation failed: ${e.message}`); }

if (!/^[0-9a-f]{64}$/.test(pubHex))  die('bad pubkey shape');
if (!/^[0-9a-f]{64}$/.test(privHex)) die('bad privkey shape');

// 2. Self-verify: seal a test payload to the pubkey, open with the privkey.
//    Proves the generated keypair is compatible with kamiSeal's ECDH+HKDF+AES.
let verified = false, verifyNote = 'skipped (kamiSeal import unavailable)';
try {
  const { sealTo, openSealed } = await import('../src/engine/kami/kamiSeal.js');
  const msg = new TextEncoder().encode('kami-keygen self-test payload');
  const env = await sealTo(msg, [pubHex]);
  const opened = await openSealed(env, privHex);
  verified = opened.length === msg.length && opened.every((b, i) => b === msg[i]);
  if (!verified) verifyNote = 'round-trip mismatch';
} catch (e) { verifyNote = `failed: ${e.message}`; }

// 3. Write the private key to a file (chmod 600). NEVER print it.
const outPath = join(process.cwd(), 'kami-priv.hex');
writeFileSync(outPath, privHex + '\n', { mode: 0o600 });
chmodSync(outPath, 0o600);

console.log('┌─ Kami keypair generated ─────────────────────────────');
console.log('│ Public key (paste this to the agent — it is PUBLIC, safe to share):');
console.log(`│   ${pubHex}`);
console.log('│');
console.log(`│ Private key → written to: ${outPath}  (chmod 600)`);
console.log('│   This file is your Kami PRIVATE key. Keep it OFF the VPS');
console.log('│   (move it to a password manager or your local machine), then');
console.log('│   delete it from here. NEVER paste it in chat. NEVER commit it.');
console.log(verified
  ? '│ Self-verify: ✓ seal+open round-trip OK — this keypair works with kamiSeal.'
  : `│ Self-verify: ✗ ${verifyNote} (the key may still be valid — verify on a machine with @noble/curves).`);
console.log('└──────────────────────────────────────────────────────');
