// tests/torii-menu-layering.test.js — locks the home-screen modal z-index fix
// (PR #82). The user reported the Torii menu modal loaded BEHIND the centre panel
// on the home screen: the menu backdrop (z-75) + homepage stub (z-78) sat BELOW
// the title screen (#screen-title z-100), so the title screen painted over them.
// This test reads the real z-index values from the source files + asserts the
// layering constraint that prevents that regression: every interactive modal
// must sit ABOVE the title screen + the stub above the menu, both below the boot
// overlay (which must always win).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

function _read(rel) {
  return readFileSync(new URL(rel, ROOT), 'utf8');
}

// Extract the first `z-index: N` (CSS) from a source string.
function _cssZ(src, selector) {
  const re = new RegExp(`${selector}\\b[^}]*?z-index:\\s*(\\d+)`, 'i');
  const m = src.match(re);
  return m ? Number(m[1]) : null;
}

// Extract a `zIndex: 'N'` (inline style object) value for a given id anchor.
function _inlineZ(src, idAnchor) {
  const re = new RegExp(`${idAnchor}[^}]*?zIndex:\\s*['"]?(\\d+)`, 'i');
  const m = src.match(re);
  return m ? Number(m[1]) : null;
}

describe('Torii menu home-screen layering (regression for PR #82)', () => {
  const indexHtml = _read('index.html');
  const menuSrc = _read('src/engine/menu/toriiMenu.js');
  const stubSrc = _read('src/engine/homepage/homepageStub.js');

  const titleScreenZ = _cssZ(indexHtml, '#screen-title');
  const bootOverlayZ = _cssZ(indexHtml, '#boot-overlay');
  const menuZ = _inlineZ(menuSrc, "backdrop.id = 'torii-menu'");
  const stubZ = _inlineZ(stubSrc, 'backdrop.id =');

  it('parses every z-index value from the real source', () => {
    expect(titleScreenZ).not.toBeNull();
    expect(bootOverlayZ).not.toBeNull();
    expect(menuZ).not.toBeNull();
    expect(stubZ).not.toBeNull();
  });

  it('the Torii menu sits ABOVE the title screen (the reported bug)', () => {
    // Regression: menu was z-75, title screen z-100 → menu hidden behind it.
    expect(menuZ).toBeGreaterThan(titleScreenZ);
  });

  it('the homepage stub sits ABOVE the title screen', () => {
    expect(stubZ).toBeGreaterThan(titleScreenZ);
  });

  it('the homepage stub sits ABOVE the Torii menu (it opens from the menu)', () => {
    expect(stubZ).toBeGreaterThan(menuZ);
  });

  it('both modals stay BELOW the boot overlay (boot always wins)', () => {
    expect(menuZ).toBeLessThan(bootOverlayZ);
    expect(stubZ).toBeLessThan(bootOverlayZ);
  });

  it('the title screen itself stays BELOW the modals + boot overlay', () => {
    expect(titleScreenZ).toBeLessThan(menuZ);
    expect(titleScreenZ).toBeLessThan(stubZ);
    expect(titleScreenZ).toBeLessThan(bootOverlayZ);
  });
});
