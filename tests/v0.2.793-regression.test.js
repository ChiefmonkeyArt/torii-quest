// tests/v0.2.793-regression.test.js — character name comes from the npub's
// published Nostr display name, NOT the uploaded file name.
//
// v0.2.792 defaulted the newly-uploaded character's display name to the file
// stem (chiefmonkey7.glb -> "chiefmonkey7"). The player pushed back: a
// character is named after the person, not the file. This ship changes the
// source of that default to `state.nostrName` (already sanitised at login by
// nostr.js from the player's kind:0 `name` / `display_name`), with a graceful
// pubkey-slice fallback when the profile is empty and a final 'Custom'
// fallback for guests.
//
// Source-locking keeps main.js's `_uploadCustomMesh` honest without importing
// the entry module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MAIN = read('src/main.js');

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

describe('v0.2.793 — character name defaults to the npub display name', () => {
  it('characterName is computed from state.nostrName, not the file name', () => {
    const src = stripComments(MAIN);
    // The name must be sourced from state.nostrName ...
    expect(src).toMatch(/characterName\s*=\s*\(state\.nostrName/);
    // ... and NOT from the uploaded file stem (the v0.2.792 default is gone).
    expect(src).not.toContain('fileName.replace(/\\.glb$/i,');
    expect(src).not.toMatch(/characterName\s*=\s*fileName\.replace/);
  });

  it('falls back to a short pubkey slice when the profile is empty', () => {
    const src = stripComments(MAIN);
    // Short-pubkey fallback matches the same shape used at login (nostr.js:
    // pk.slice(0,8).toUpperCase()) so the label is deterministic for anon npubs.
    expect(src).toMatch(/state\.nostrPubkey[^\n]*\.slice\(0,\s*8\)\.toUpperCase\(\)/);
  });

  it("final fallback is 'Custom' (never an empty string)", () => {
    const src = stripComments(MAIN);
    // The chained || 'Custom' guarantees a non-empty manifest.name for guest
    // uploads (state.nostrName + state.nostrPubkey may both be absent).
    expect(src).toMatch(/\|\|\s*'Custom'/);
  });

  it("manifest.name is written from the computed characterName (not a fixed '')", () => {
    const src = stripComments(MAIN);
    expect(src).toContain('name: characterName,');
    // Belt-and-braces: the old empty-string default is gone from the character manifest block.
    // We grep the surrounding upload block to keep the assertion tight.
    const block = src.slice(src.indexOf('_uploadCustomMesh'));
    // The manifest declared inside the block must NOT assign an empty name.
    expect(block).not.toMatch(/name:\s*'',/);
  });
});
