// tests/lazy-shell.test.js — audit F06: the "lazy entry shell" must not eagerly
// reach the renderer. main.js is a huge entry module with top-level DOM/init side
// effects and is not designed for isolated import, so — consistent with the
// sibling source-lock tests — this locks the import graph at the source level.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('F06 — lazy entry shell stays renderer-free before ENTER', () => {
  it('does NOT statically import the portrait renderer (which pulls three + GLTF/Draco)', () => {
    expect(MAIN).not.toMatch(
      /import\s*\{\s*renderCharacterPortrait\s*\}\s*from\s*'\.\/engine\/character\/characterPortraitRenderer\.js'/,
    );
  });

  it('loads the portrait renderer lazily via a cached dynamic import', () => {
    expect(MAIN).toMatch(/import\('\.\/engine\/character\/characterPortraitRenderer\.js'\)/);
    expect(MAIN).toMatch(/let _portraitModule = null;/);
  });

  it('wraps renderCharacterPortrait so call sites go through the lazy loader', () => {
    expect(MAIN).toContain('_renderCharacterPortrait(meshUrl)');
    expect(MAIN).toContain('_renderCharacterPortrait(blobUrl)');
  });

  it('gates the stickerNpc debug hook (scene.js → WebGL) behind a dev flag', () => {
    expect(MAIN).toMatch(/if\s*\(\s*import\.meta\.env\.DEV\s*\)\s*\{/);
    expect(MAIN).toMatch(/import\('\.\/stickerNpc\.js'\)/);
  });

  it('keeps the napNpc owner-name sync as a dynamic import, not a static one', () => {
    expect(MAIN).toMatch(/import\('\.\/napNpc\.js'\)/);
    expect(MAIN).not.toMatch(/import\s*\{[^}]*setNapNpcName[^}]*\}\s*from\s*'\.\/napNpc\.js'/);
  });
});