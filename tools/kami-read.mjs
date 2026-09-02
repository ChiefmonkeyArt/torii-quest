#!/usr/bin/env node
// kami-read.mjs — ADR-0025. Node-side reader for the sealed ema backlog.
//
// The browser can SEAL ema (it has owner + Kami pubkeys) but cannot decrypt the
// backlog (no private keys on-box). This tool runs on a trusted machine that
// holds the Kami private key, reads the VPS's sealed ema.jsonl + shots/, and
// decrypts them for the maintainer. The VPS disk only ever held ciphertext.
//
// Usage:
//   KAMI_PRIV=<hex> node tools/kami-read.mjs [ema.jsonl path] [shots dir] [--shots-out <dir>]
//
// Defaults: ema.jsonl and shots/ under /var/lib/torii-quest/kami (the VPS path),
// but this is meant to run against a COPY of that dir, not the live VPS path —
// fetch the files first (e.g. scp -r vps:/var/lib/torii-quest/kami ./kami-bak).
//
// Output: one human-readable line per ema (id, time, kind, note, meta). With
// --shots-out, each sealed screenshot is decrypted to <shots-out>/<id>.jpg.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openJson, openSealed, fromB64 } from '../src/engine/kami/kamiSeal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function die(msg) { console.error(`kami-read: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const a = argv.slice(2);
  let emaPath = null;
  let shotsDir = '/var/lib/torii-quest/kami/shots';
  let shotsOut = null;
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--shots-out') { shotsOut = a[++i]; continue; }
    if (t === '--shots-dir') { shotsDir = a[++i]; continue; }
    if (!t.startsWith('-') && emaPath === null) { emaPath = t; continue; }
  }
  if (emaPath === null) emaPath = '/var/lib/torii-quest/kami/ema.jsonl';
  return { emaPath, shotsDir, shotsOut };
}

async function main() {
  const privHex = process.env.KAMI_PRIV || '';
  if (!/^[0-9a-f]{64}$/.test(privHex)) die('KAMI_PRIV must be a 64-char hex scalar (run on a trusted machine only)');
  const { emaPath, shotsDir, shotsOut } = parseArgs(process.argv);
  if (!existsSync(emaPath)) die(`ema.jsonl not found at ${emaPath} (copy the VPS kami dir first)`);
  if (shotsOut) { mkdirSync(shotsOut, { recursive: true }); }

  const raw = readFileSync(emaPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length === 0) { console.log('kami-read: no ema stored yet'); return; }

  let opened = 0, failed = 0, shotsWritten = 0;
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { console.error(`kami-read: skipping unparseable line`); failed++; continue; }
    const sealed = rec.sealed || rec.sealedEma;
    try {
      const ema = await openJson(sealed, privHex);
      const when = new Date(rec.ts || ema.ts || 0).toISOString();
      const kind = ema.kind || '?';
      const note = (ema.note || '').replace(/\s+/g, ' ').slice(0, 80);
      const meta = ema.world?.pos
        ? `world ${ema.world.pos.x.toFixed(1)} ${ema.world.pos.y.toFixed(1)} ${ema.world.pos.z.toFixed(1)}`
        : (ema.ui?.selector || 'ui');
      console.log(`${rec.id}  ${when}  [${kind}]  ${note}  · ${meta}`);
      opened++;
      // Decrypt the screenshot if present and an output dir was given.
      if (shotsOut && existsSync(join(shotsDir, `${rec.id}.bin`))) {
        try {
          const env = JSON.parse(readFileSync(join(shotsDir, `${rec.id}.bin`), 'utf8'));
          const bytes = await openSealed(env, privHex);
          writeFileSync(join(shotsOut, `${rec.id}.jpg`), bytes);
          shotsWritten++;
        } catch (e) { console.error(`  shot decrypt failed for ${rec.id}: ${e.message}`); }
      }
    } catch (e) {
      console.error(`kami-read: could not open ${rec.id || '(no id)'}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nopened ${opened} ema (${failed} failed)${shotsOut ? `, ${shotsWritten} shots written to ${shotsOut}` : ''}`);
}

main().catch((e) => die(e.message));
