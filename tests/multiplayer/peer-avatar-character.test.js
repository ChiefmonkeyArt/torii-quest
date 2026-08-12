import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const runtime = readFileSync(resolve(root, 'src/arenaRuntime.js'), 'utf8');
const playerModel = readFileSync(resolve(root, 'src/playerModel.js'), 'utf8');

describe('per-character peer avatar loader', () => {
  it('exports both character GLBs and their idle/walk clip names', () => {
    expect(playerModel).toMatch(/export const CHARACTERS/);
    expect(playerModel).toMatch(/chiefmonkey:[\s\S]*?file:\s*['"]\/models\/chiefmonkey7\.glb['"]/);
    expect(playerModel).toMatch(/nostrich:[\s\S]*?file:\s*['"]\/nostrich3\.glb['"]/);
    expect(playerModel).toMatch(/IDLE:\s*['"]Idle_10['"][\s\S]*?WALK:\s*['"]Stylish_Walk_inplace['"]/);
    expect(playerModel).toMatch(/nostrich:[\s\S]*?IDLE:\s*['"]Stylish_Walk_inplace['"][\s\S]*?WALK:\s*['"]Walking['"]/);
  });

  it('_createPeerAvatar resolves the GLB and clips from peer.character', () => {
    expect(runtime).toMatch(/CHARACTERS\[peer\.character\]\s*\?\s*peer\.character\s*:\s*['"]chiefmonkey['"]/);
    expect(runtime).toMatch(/loader\.load\(assetUrl\(CHARACTERS\[characterKey\]\.file\)/);
    expect(runtime).toMatch(/character\.anims\.IDLE/);
    expect(runtime).toMatch(/character\.anims\.WALK/);
    expect(runtime).toMatch(/const _mpTemplateCache = new Map\(\)/);
  });

  it('cross-fades between idle and walk based on per-frame position speed', () => {
    expect(runtime).toMatch(/distanceTo\(lastPos\)\s*\/\s*dt/);
    expect(runtime).toMatch(/speed\s*>\s*MP_WALK_THRESHOLD/);
    expect(runtime).toMatch(/fadeIn\(MP_ANIM_FADE\)\.play\(\)/);
    expect(runtime).toMatch(/prev\.fadeOut\(MP_ANIM_FADE\)/);
  });
});
