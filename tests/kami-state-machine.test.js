// @vitest-environment jsdom
// ADR-0029 Kami Mode state machine (NORMAL ⇄ KAMI ⇄ EMA_OPEN).
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// scene.js constructs a WebGLRenderer at module top-level, which jsdom cannot
// satisfy. kamiMode only needs requestFrameGrab from it — mock it out so the
// import chain doesn't pull in WebGL.
vi.mock('../src/scene.js', () => ({ requestFrameGrab: () => {} }));
// Drives the real install path with a fake owner capability (so checkOwner
// resolves true) + a minimal DOM. Covers: 1st K enters KAMI (note no-ops with
// no target here, so rack shown, shooting suppressed, invincible on);
// kamiExit() restores NORMAL (rack hidden, shooting restored); leaving the
// arena (PHASE_CHANGE → TITLE) auto-exits.
import { installKamiMode, kamiActive, kamiInvincible, kamiExit, kamiNoteOpen } from '../src/engine/kami/kamiMode.js';
import { emit, EV } from '../src/events.js';
import { state, PHASE } from '../src/state.js';

const OWNER_PUBKEY = 'a'.repeat(64);

// ADR-0031: bare K, no Ctrl/Cmd — Ctrl/Cmd+E never reached the page because
// Brave (and most Chromium browsers) reserves that combo for the address bar.
function ctrlE(shift = false) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyK', shiftKey: shift, bubbles: true,
  }));
}
function flush() { return new Promise(r => setTimeout(r, 0)); }

describe('Kami Mode state machine (ADR-0029)', () => {
  let shootingSuppressedCalls = [];
  let fullSuppressedCalls = [];
  let kamiStateCalls = [];
  let prevPhase;

  beforeAll(() => {
    prevPhase = state.phase;
    // Minimal DOM the glue touches: the rack container + the note overlay shell.
    document.body.innerHTML = '<div id="emagake" hidden></div><div id="kami-overlay" style="display:none"></div>';
    // jsdom has no elementFromPoint; captureTarget falls back to it when not
    // pointer-locked. Returning null → "NOTHING TO PIN HERE" → openNote no-ops.
    document.elementFromPoint = () => null;

    installKamiMode({
      getOwnerPubkey: () => OWNER_PUBKEY,
      requestPointerLock: () => {},
      getDocument: () => document,
      setGameInputSuppressed: (v) => { fullSuppressedCalls.push(v); },
      setShootingSuppressed: (v) => { shootingSuppressedCalls.push(v); },
      // ADR-0032: records every outbound KAMI_STATE the client would have sent
      // to the server (the real sender lives in multiplayerHost.js — this fake
      // only proves kamiMode.js calls it at the right moments).
      sendKamiState: (active) => { kamiStateCalls.push(active); },
      // Fake owner-capability endpoint: returns the owner pubkey as admin.
      fetchImpl: async () => ({ ok: true, json: async () => ({ adminPubkey: OWNER_PUBKEY }) }),
    });
  });
  afterAll(() => { state.phase = prevPhase; });

  beforeEach(() => {
    shootingSuppressedCalls = [];
    fullSuppressedCalls = [];
    kamiStateCalls = [];
    state.phase = 'playing';
    // Reset to NORMAL before each scenario.
    kamiExit();
    kamiStateCalls = []; // drop the exit-side effect of the reset above
  });

  test('1st K enters KAMI (no target → note no-ops): rack shown, shooting suppressed, invincible on', async () => {
    expect(kamiActive()).toBe(false);
    ctrlE();
    await flush();
    expect(kamiActive()).toBe(true);
    expect(kamiInvincible()).toBe(true);
    // Rack shown (hidden attribute removed).
    expect(document.getElementById('emagake').hasAttribute('hidden')).toBe(false);
    // Shooting suppressed (invincible spirit doesn't fire); movement NOT suppressed.
    expect(shootingSuppressedCalls).toContain(true);
    expect(fullSuppressedCalls).not.toContain(true);
    // ADR-0032: entering Kami tells the server so it excludes us from bot
    // targeting and blocks damage — this is what makes invincibility real
    // in multiplayer (the local _invincible flag above never reached the
    // server on its own).
    expect(kamiStateCalls).toEqual([true]);
  });

  test('kamiExit() restores NORMAL: rack hidden, shooting restored, invincible off', async () => {
    ctrlE();
    await flush();
    expect(kamiActive()).toBe(true);
    kamiStateCalls = []; // isolate this test's exit call from ctrlE()'s enter call
    kamiExit();
    expect(kamiActive()).toBe(false);
    expect(kamiInvincible()).toBe(false);
    expect(document.getElementById('emagake').hasAttribute('hidden')).toBe(true);
    expect(shootingSuppressedCalls).toContain(false);
    // ADR-0032: leaving Kami tells the server too, so the owner becomes a
    // normal targetable/vulnerable player again.
    expect(kamiStateCalls).toEqual([false]);
  });

  test('leaving the arena (PHASE_CHANGE → TITLE) auto-exits KAMI', async () => {
    ctrlE();
    await flush();
    expect(kamiActive()).toBe(true);
    // Emulate the Home button / exit-to-title transition.
    emit(EV.PHASE_CHANGE, { to: PHASE.TITLE, from: PHASE.PLAYING });
    expect(kamiActive()).toBe(false);
    expect(document.getElementById('emagake').hasAttribute('hidden')).toBe(true);
  });

  test('a 2nd K while in KAMI with no target no-ops but stays in KAMI (no re-enter)', async () => {
    ctrlE();
    await flush();
    expect(kamiActive()).toBe(true);
    const callsBefore = shootingSuppressedCalls.length;
    ctrlE(); // already in KAMI → openNote → no target → no-op
    await flush();
    // Still in KAMI; enterKamiMode is a no-op fast path (no extra suppress call).
    expect(kamiActive()).toBe(true);
    expect(shootingSuppressedCalls.length).toBe(callsBefore);
  });

  // ADR-0031 regression: bare K enters Kami, but Ctrl+K / Cmd+K must NOT — those
  // are real browser-reserved combos (Ctrl/Cmd+K focuses the address bar in
  // Chromium browsers) and must reach the browser chrome untouched, exactly the
  // failure mode that made Ctrl+E silently do nothing in Brave.
  test('Ctrl+K / Cmd+K do NOT enter Kami Mode (browser owns that combo)', async () => {
    expect(kamiActive()).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, bubbles: true }));
    await flush();
    expect(kamiActive()).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', metaKey: true, bubbles: true }));
    await flush();
    expect(kamiActive()).toBe(false);
  });

  // A focused text field owns bare K (typing the letter k must not open Kami).
  test('bare K typed into a focused text field does not enter Kami Mode', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(kamiActive()).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', bubbles: true }));
    await flush();
    expect(kamiActive()).toBe(false);
    input.remove();
  });
});

// ADR-0034: the note bar's visual shape (bottom-anchored, no full-screen
// backdrop) + the 2nd-K-while-open highlight behavior. Reuses the single
// installKamiMode() instance above (the module is a singleton — see
// vite.config.js's isolate:false comment: a second install in this worker
// would silently no-op and leave the wrong fixture's elementFromPoint wired
// up). Temporarily swaps document.elementFromPoint to a real element so
// captureTarget() resolves and openNote() actually opens, then restores the
// outer suite's null stub in afterAll so those tests are unaffected.
describe('Kami note bar (ADR-0034)', () => {
  let prevElementFromPoint;
  let clickable;

  beforeAll(() => {
    prevElementFromPoint = document.elementFromPoint;
    clickable = document.createElement('button');
    clickable.id = 'some-ui-target';
    document.body.appendChild(clickable);
    document.elementFromPoint = () => clickable;
    // The outer suite's beforeAll seeded a plain empty '#kami-overlay' shell
    // (just enough for its own display-toggle assertions). ensureOverlay()
    // returns early on any existing '#kami-overlay', so that empty shell has
    // no '#kami-note-box'/'#kami-note-input' children — remove it so the real
    // note bar gets built fresh here.
    document.getElementById('kami-overlay')?.remove();
  });
  afterAll(() => {
    document.elementFromPoint = prevElementFromPoint;
    clickable.remove();
  });
  beforeEach(() => {
    state.phase = 'playing';
    kamiExit();
  });

  test('1st K enters KAMI and immediately opens the note as a bottom-anchored bar (ADR-0064)', async () => {
    ctrlE();
    await flush();
    expect(kamiActive()).toBe(true);
    // ADR-0064: the note opens on the SAME K press that enters Kami Mode, so
    // the player can start typing right away — no second K required.
    expect(kamiNoteOpen()).toBe(true);

    const overlay = document.getElementById('kami-overlay');
    expect(overlay).not.toBeNull();
    // Bottom-anchored bar, not the old full-screen dark backdrop — no inset
    // fill, positioned via bottom + left:50%/translateX, not a centered
    // fixed-viewport cover.
    expect(overlay.style.bottom).toBe('14px');
    expect(overlay.style.cssText).not.toContain('inset');
    expect(overlay.style.display).toBe('flex');

    const box = document.getElementById('kami-note-box');
    expect(box).not.toBeNull();
    // Smoked-glass component language matching #emagake-header/.ema-row.
    expect(box.style.background).toBe('rgba(8, 10, 20, 0.55)');
    expect(box.style.border).toContain('rgba(255, 194, 71, 0.45)');
  });

  test('a 2nd K while the note is already open highlights it instead of no-op (ADR-0034)', async () => {
    ctrlE();
    await flush();
    expect(kamiNoteOpen()).toBe(true);
    const box = document.getElementById('kami-note-box');
    const input = document.getElementById('kami-note-input');
    const focusSpy = vi.spyOn(input, 'focus');

    ctrlE(); // 2nd press: note already open → highlight, not reopen/no-op
    await flush();

    expect(kamiNoteOpen()).toBe(true); // still open, unaffected
    expect(focusSpy).toHaveBeenCalled();
    // Pulsed border/shadow applied immediately (revert is on a 450ms timer,
    // not asserted here to keep the test fast/deterministic).
    expect(box.style.borderColor).toBe('rgba(255, 224, 140, 0.95)');
  });
});
