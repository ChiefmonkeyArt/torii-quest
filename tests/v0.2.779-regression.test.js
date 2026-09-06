// tests/v0.2.779-regression.test.js — Character Forge upload-only rework (Bug M pt.1).
//
// User request: "on the character tab in settings, remove the chiefmonkey and
// nostrich selectable panels … and enable the .glb upload and the character
// creation functions. Work on the upload .glb function first."
//
// The Character tab's curated roster (select-preset cards) was the only
// always-visible entry point, while the Upload/.glb + Create-with-AI cards were
// greyed out (disabled) until Nostr login. This suite freezes the rework:
//   1. characterForgePanel.js no longer renders the preset grid (no
//      _presetGrid / select-preset / cf-preset-card), and both creation buttons
//      are always enabled (no disabled attr).
//   2. main.js no longer carries the preset write half (_createOwnCharacter,
//      the select-preset delegate, the characterPresets import).
//   3. The .glb upload is now validator-first: _uploadCustomMesh reads the
//      file bytes through inspectGlb() and assessRig() before any network call.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderCharacterForgePanel } from '../src/engine/settings/characterForgePanel.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = {
  panel: read('src/engine/settings/characterForgePanel.js'),
  main: read('src/main.js'),
  glb: read('src/engine/character/glbInspect.js'),
};

// Remove line + block comments so prose describing the removal never falsely
// matches a "select-preset still renders here" assertion.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

describe('v0.2.779 — Character Forge: roster removed, upload enabled', () => {
  it('characterForgePanel no longer renders the preset grid', () => {
    const src = stripComments(SRC.panel);
    expect(src).not.toContain('_presetGrid');
    expect(src).not.toContain('cf-preset-card');
    expect(src).not.toContain('data-action="select-preset"');
    expect(src).not.toContain('No presets available');
  });

  it('the create screen renders both cards with no disabled action', () => {
    const html = renderCharacterForgePanel({ isLoggedIn: false });
    expect(html).not.toContain('select-preset');
    expect(html).not.toContain('cf-preset-card');
    expect(html).toContain('data-action="upload-mesh"');
    expect(html).toContain('data-action="generate-ai"');
    expect(html).not.toMatch(/data-action="upload-mesh"[^>]*disabled/);
    expect(html).not.toMatch(/data-action="generate-ai"[^>]*disabled/);
  });

  it('main.js no longer carries the preset write half', () => {
    const src = stripComments(SRC.main);
    expect(src).not.toContain('_createOwnCharacter');
    expect(src).not.toContain("action === 'select-preset'");
    expect(src).not.toContain("from './engine/character/characterPresets.js'");
  });

  it('the .glb picker accepts only .glb (validator targets glTF-binary)', () => {
    const pick = SRC.main.match(/function _pickCustomMesh\([\s\S]*?\n\}/)?.[0] || '';
    expect(pick).toContain("input.accept = '.glb'");
    expect(pick).not.toContain('.gltf');
  });

  it('the upload path runs the validator-first pipeline before any network call', () => {
    const upload = SRC.main.match(/async function _uploadCustomMesh\([\s\S]*?\n  }\n\}/)?.[0] || SRC.main;
    expect(upload).toContain('inspectGlb(');
    expect(upload).toContain('assessRig(');
    // Rejection happens before uploadBlossom is reached (validator before network).
    expect(upload.indexOf('inspectGlb(')).toBeLessThan(upload.indexOf('uploadBlossom('));
  });

  it('glbInspect exposes the GLB magic + JSON chunk constants', () => {
    const src = stripComments(SRC.glb);
    expect(src).toMatch(/export const GLB_MAGIC = 0x46546c67/);
    expect(src).toMatch(/export const JSON_CHUNK_TYPE = 0x4e4f534a/);
    expect(src).toMatch(/export const MAX_CHARACTER_GLB_BYTES/);
  });
});