#!/usr/bin/env node
// kami-keygen.mjs — ADR-0038. Generate a fresh Kami keypair for ema sealing.
//
// WHY: the Kami private key (off-box reader for sealed ema) was never saved when
// pubkey f69bbd44… was hardcoded. With the ema store empty, we rotate to a fresh
// keypair — zero data loss. This tool generates one and self-verifies it.
//
// Generation uses ONLY node:crypto (no npm deps) so it runs on any machine with
// Node. The self-verify (seal+open round-trip) imports kamiSeal where
// @noble/curves is present (e.g. the VPS repo checkout).
//
// SAFETY (audit F14):
//   - FAIL-CLOSED: the key is written ONLY after a successful seal+open
//     round-trip. A failed or unavailable self-test writes nothing — an
//     unverified key could be unusable for sealing, and must not be persisted.
//   - EXCLUSIVE: the default write uses O_EXCL, so a second run will NOT
//     overwrite an existing kami-priv.hex. Overwrite requires an explicit
//     --force (the deliberate rotate path).
//   - 0600: the private key is chmod 0600 and is NEVER printed. Only the PUBLIC
//     key is printed — paste that back to the agent to deploy.
//   - The output filename is excluded from git + docker build context.

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function die(msg) { console.error(`kami-keygen: ${msg}`); process.exit(1); }

// Default self-verify: seal a test payload to pubHex, open it with privHex, and
// confirm the bytes round-trip. Returns true ONLY on a verified round-trip.
async function defaultVerify(pubHex, privHex) {
  const { sealTo, openSealed } = await import('../src/engine/kami/kamiSeal.js');
  const msg = new TextEncoder().encode('kami-keygen self-test payload');
  const env = await sealTo(msg, [pubHex]);
  const opened = await openSealed(env, privHex);
  return opened.length === msg.length && opened.every((b, i) => b === msg[i]);
}

/**
 * Generate + verify + persist a fresh Kami keypair. Pure logic (no process.exit):
 * returns a status object. Callers map it to CLI output or test assertions.
 *
 * @param {object} [opts]
 * @param {string} [opts.outPath]      absolute output path (default ./kami-priv.hex)
 * @param {boolean} [opts.force]       "wx" by default (exclusive); force overwrites
 * @param {boolean} [opts.verify]      injected verifier (default defaultVerify)
 * @param {object} [opts.fs]           injectable { writeFileSync, chmodSync }
 * @returns {Promise<object>} { ok, pubHex, outPath, verified, reason? }
 */
export async function generateKamiKey({
  outPath = join(process.cwd(), 'kami-priv.hex'),
  force = false,
  verify = defaultVerify,
  fs = { writeFileSync, chmodSync },
} = {}) {
  // 1. Generate a secp256k1 keypair with Node's built-in crypto (no deps).
  let pubHex, privHex;
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
      publicKeyEncoding: { format: 'jwk' },
      privateKeyEncoding: { format: 'jwk' },
    });
    pubHex  = Buffer.from(publicKey.x,  'base64url').toString('hex');
    privHex = Buffer.from(privateKey.d, 'base64url').toString('hex');
  } catch (e) { return { ok: false, reason: `key generation failed: ${e.message}` }; }

  if (!/^[0-9a-f]{64}$/.test(pubHex))  return { ok: false, reason: 'bad pubkey shape' };
  if (!/^[0-9a-f]{64}$/.test(privHex)) return { ok: false, reason: 'bad privkey shape' };

  // 2. FAIL-CLOSED self-verify (F14): a key that cannot be proven compatible with
  //    kamiSeal is never persisted — write nothing on a failed/unavailable test.
  let verified = false;
  try {
    verified = !!(await verify(pubHex, privHex));
  } catch { verified = false; }
  if (!verified) {
    return { ok: false, reason: 'self-verify failed (key not written — re-run where @noble/curves is available)' };
  }

  // 3. EXCLUSIVE create (F14): O_EXCL default fails if the file already exists;
  //    --force is the deliberate rotate/overwrite path.
  const flag = force ? 'w' : 'wx';
  try {
    fs.writeFileSync(outPath, privHex + '\n', { mode: 0o600, flag });
    fs.chmodSync(outPath, 0o600);
  } catch (e) {
    if (!force && e && e.code === 'EEXIST') {
      return { ok: false, reason: `refusing to overwrite existing key (${outPath}) — use --force to rotate deliberately` };
    }
    return { ok: false, reason: `write failed: ${(e && e.message) || e}` };
  }

  return { ok: true, pubHex, outPath, verified };
}

// ---- CLI entry -------------------------------------------------------------
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? join(process.cwd(), args[outIdx + 1]) : join(process.cwd(), 'kami-priv.hex');

  const r = await generateKamiKey({ outPath, force });
  if (!r.ok) die(r.reason);

  console.log('┌─ Kami keypair generated ─────────────────────────────');
  console.log('│ Public key (paste this to the agent — it is PUBLIC, safe to share):');
  console.log(`│   ${r.pubHex}`);
  console.log('│');
  console.log(`│ Private key → written to: ${r.outPath}  (chmod 600)`);
  console.log('│   This file is your Kami PRIVATE key. Keep it OFF the VPS');
  console.log('│   (move it to a password manager or your local machine), then');
  console.log('│   delete it from here. NEVER paste it in chat. NEVER commit it.');
  console.log('│ Self-verify: ✓ seal+open round-trip OK — this keypair works with kamiSeal.');
  console.log('└──────────────────────────────────────────────────────');
}