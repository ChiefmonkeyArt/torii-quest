// tests/v0.2.796-regression.test.js — character portrait snapshot pipeline.\n//
// Each player gets a rendered PNG snapshot of their character (an "avatar"), so
// the UI shows their character's portrait instead of a bare initial. The render
// half lives in src/engine/character/characterPortraitRenderer.js (offscreen
// GLB → transparent PNG); the manifest gains an optional `portrait.hash` (the
// PNG's Blossom sha256) that the kind-35100 event round-trips and the panel + a
// "Generate portrait" affordance surface. The upload/replace flow auto-generates
// one (fails soft), and legacy characters can generate one from the found view.
//
// Source-locking keeps the render module, the manifest/event seams, main.js's
// wiring, and the panel renderer honest without importing the entry module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');
const MANIFEST = readFileSync(join(ROOT, 'src', 'engine', 'character', 'characterManifest.js'), 'utf8');
const MESH = readFileSync(join(ROOT, 'src', 'engine', 'character', 'characterMesh.js'), 'utf8');
const EVENT = readFileSync(join(ROOT, 'src', 'engine', 'character', 'characterEvent.js'), 'utf8');
const RENDER = readFileSync(join(ROOT, 'src', 'engine', 'character', 'characterPortraitRenderer.js'), 'utf8');
const FORGE = readFileSync(join(ROOT, 'src', 'engine', 'settings', 'characterForgePanel.js'), 'utf8');

describe('v0.2.796 — offscreen portrait renderer', () => {
  it('exports renderCharacterPortrait offscreen GLB→PNG', () => {
    expect(RENDER).toContain('export async function renderCharacterPortrait');
    expect(RENDER).toContain("canvas.toBlob((b) => resolve(b || null), 'image/png')");
  });

  it('stands the mesh upright with the same Z-up fix as playerModel', () => {
    expect(RENDER).toContain('function _standUpright');
    expect(RENDER).toContain('isZUp');
    expect(RENDER).toContain("new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)");
  });

  it('renders transparent with a neutral studio light rig', () => {
    expect(RENDER).toContain("renderer.setClearColor(0x000000, 0)");
    expect(RENDER).toContain('THREE.AmbientLight');
    expect(RENDER).toContain('THREE.DirectionalLight');
  });

  it('rejects non-fetchable/oversized sources without throwing', () => {
    expect(RENDER).toContain("error: 'bad-url'");
    expect(RENDER).toContain("error: 'mesh-too-large'");
    expect(RENDER).toContain('MAX_MESH_BYTES');
  });
});

describe('v0.2.796 — manifest portrait.hash', () => {
  it('seeds an empty manifest with portrait: null', () => {
    expect(MANIFEST).toMatch(/portrait: null,/);
  });

  it('validates portrait.hash as an optional 64-hex sha256', () => {
    expect(MANIFEST).toContain("portrait.hash must be a 64-hex sha256 if present");
  });

  it('resolves a portrait URL from the manifest', () => {
    expect(MESH).toContain('export function resolveCharacterPortraitUrl');
    expect(MESH).toContain('blossomMeshUrl(m.portrait.hash, o.server)');
  });

  it('round-trips a portrait tag through the character event', () => {
    expect(EVENT).toContain("manifest.portrait = { hash: rest[0] || '', name: rest[1] || '' };");
    expect(EVENT).toContain("tags.push(['portrait', m.portrait.hash, m.portrait.name || '']);");
  });
});

describe('v0.2.796 — main.js wiring', () => {
  it('auto-generates a portrait during upload/replace (fails soft)', () => {
    expect(MAIN).toContain('let portraitEntry = null;');
    expect(MAIN).toContain('renderCharacterPortrait(blobUrl)');
    expect(MAIN).toContain('portrait: portraitEntry,');
  });

  it('offers a generate-portrait path for legacy characters', () => {
    expect(MAIN).toContain('async function _generateOwnPortrait()');
    expect(MAIN).toContain("action === 'generate-portrait'");
  });

  it('surfaces the resolved portrait URL to the panel renderer', () => {
    expect(MAIN).toContain('resolveCharacterPortraitUrl(_characterForgeState.manifest)');
  });
});

describe('v0.2.796 — panel portrait (C placeholder swap)', () => {
  it('accepts a portraitUrl and renders a photo div or the initial fallback', () => {
    expect(FORGE).toContain('function _foundView(character, rig, portraitUrl)');
    expect(FORGE).toContain('cf-summary-portrait-photo');
    expect(FORGE).toContain("data-action=\"generate-portrait\"");
  });
});