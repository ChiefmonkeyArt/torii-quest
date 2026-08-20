// tests/torii-menu-pointerlock.test.js — v0.2.606 regression guards for the
// pointer-lock / modal-state hardening. The user reported: menu opens but
// "nothing is clickable" (guest + logged in), the M key did nothing, clicking a
// Website link made the menu "reappear behind the panels", + entering the game
// froze until ESC. Root cause: pointer lock acquired in the arena was not
// released on return-to-title / menu-open from the home path, so a stale lock
// swallowed all mouse clicks; + a stale full-screen modal could sit over the
// canvas. These source-regression tests lock the fixes in place.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const _read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const MENU = _read('src/engine/menu/toriiMenu.js');
const ARENA = _read('src/arenaRuntime.js');
const MAIN = _read('src/main.js');

describe('v0.2.606 pointer-lock release', () => {
  it('openToriiMenu releases pointer lock on EVERY open (all 3 paths)', () => {
    // The home-screen + gateway menu-open paths did not release pointer lock;
    // only the in-game path did. Now the menu module itself does, so any open
    // path is covered.
    expect(MENU).toMatch(/exitPointerLock/);
    // Must be inside openToriiMenu, before the display toggle.
    const openFn = MENU.slice(MENU.indexOf('export function openToriiMenu'));
    expect(openFn).toMatch(/exitPointerLock/);
  });

  it('openToriiMenu reasserts z-index 200 on every open (anti z-75 regression)', () => {
    // Guards against a cached singleton / mutated inline style reappearing at
    // the old z-75 ("menu reappeared behind the panels" after a tab switch).
    const openFn = MENU.slice(MENU.indexOf('export function openToriiMenu'));
    expect(openFn).toMatch(/zIndex\s*=\s*['"]?200/);
    expect(openFn).toMatch(/pointerEvents\s*=\s*['"]?auto/);
  });

  it('stopMultiplayer releases pointer lock on arena exit / return-to-title', () => {
    // Without this, a stale pointer lock (canvas hidden but in the DOM) could
    // persist + swallow clicks on the title screen.
    const stopFn = ARENA.slice(ARENA.indexOf('function stopMultiplayer'));
    expect(stopFn).toMatch(/exitPointerLock/);
  });

  it('the ENTER button clears modals + releases pointer lock first', () => {
    // v0.2.611: ONE entry button (elNapBtn, labelled ENTER) — the old ENTER
    // ARENA button was removed. Prevents a stale full-screen modal sitting
    // over the canvas ("game frozen").
    expect(MAIN).toMatch(/_closeModalsAndReleasePointerLock/);
    const napHandler = MAIN.slice(MAIN.indexOf("elNapBtn?.addEventListener('click'"));
    expect(napHandler.slice(0, 600)).toMatch(/_closeModalsAndReleasePointerLock/);
  });
});

describe('v0.2.606 website-link + M-key behavior', () => {
  it('clicking a Website link closes the menu (no preventDefault; new tab opens)', () => {
    // Prevents a stale full-screen modal lingering across the tab switch /
    // bfcache return + reappearing in a weird layer state.
    expect(MENU).toMatch(/link\.addEventListener\('click'[^]*_close\(\)/);
  });

  it('the M-key in-game toggle binding is removed', () => {
    // The operator confirmed the M toggle is not needed; the menu opens from the
    // title/home burger button. The KeyM handler must be gone.
    expect(ARENA).not.toMatch(/code !== 'KeyM'/);
  });

  it('the footer hint no longer mentions the M toggle', () => {
    expect(MENU).not.toMatch(/M to toggle/);
    expect(MENU).toMatch(/ESC to close/);
  });
});
