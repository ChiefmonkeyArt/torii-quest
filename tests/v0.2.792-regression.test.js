// tests/v0.2.792-regression.test.js — "Replace character" re-upload path.
//
// The Character Forge's "found" view (a player already has a saved kind-35100
// character) previously offered ONLY an "Edit stickers" action — there was no
// way to swap the mesh once a character existed, so a stale/guest-sourced
// event (e.g. "Nostrich") left the player stuck. This ship adds a
// "Replace character" button that re-opens the upload flow (which signs +
// publishes a fresh kind-35100 event, replacing the old one via the
// parameterized-replaceable d-tag), and defaults the new character's display
// name to the uploaded file's stem instead of an empty "Unnamed" label.
// Source-locking keeps main.js's wiring honest without importing the entry module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = {
  main: read('src/main.js'),
  panel: read('src/engine/settings/characterForgePanel.js'),
  index: read('index.html'),
};

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

describe('v0.2.792 — "Replace character" re-upload path', () => {
  it('the found view offers a replace-character action beside edit stickers', () => {
    const src = stripComments(SRC.panel);
    expect(src).toContain('data-action="replace-character"');
    expect(src).toContain('Replace character');
    // Both actions are grouped in one row (not a bare stray button).
    expect(src).toContain('cf-summary-actions');
  });

  it('main.js routes replace-character back through the mesh picker', () => {
    const src = stripComments(SRC.main);
    expect(src).toContain("if (action === 'replace-character')");
    expect(src).toContain('_pickCustomMesh()');
  });

  it('main.js writes the uploaded manifest with a characterName (not a fixed empty string)', () => {
    // v0.2.792 introduced the characterName variable + non-empty manifest.name.
    // v0.2.793 changed the SOURCE of that name from the file stem to the
    // player's Nostr profile name; that source is locked in v0.2.793-regression.
    // Here we only lock the invariant this ship established: the manifest name
    // is a computed characterName, no longer a fixed empty string.
    const src = stripComments(SRC.main);
    expect(src).toContain('characterName');
    expect(src).toContain('name: characterName,');
  });

  it('index.html carries the actions-row layout style', () => {
    expect(SRC.index).toContain('.cf-summary-actions');
  });
});