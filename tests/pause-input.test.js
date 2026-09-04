// tests/pause-input.test.js - source contract for the pause modal input boundary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'src/input.js'), 'utf8');

describe('pause modal input boundary', () => {
  it('opens pause from Escape keydown or a browser-consumed pointer-lock Escape keyup', () => {
    expect(RUNTIME).toMatch(/if \(e\.code !== 'Escape' \|\| e\.repeat\) return;/);
    expect(RUNTIME).toMatch(/_escapeHandledOnKeyDown/);
    expect(RUNTIME).toMatch(/!handled && isPlaying\(\) && !document\.pointerLockElement/);
    expect(RUNTIME).not.toMatch(/onPointerLockLost/);
    expect(INPUT).not.toMatch(/_lockLostCbs|onPointerLockLost/);
    // _openPause transitions out of PLAYING before pointer-lock release. The
    // existing shoot gate therefore still blocks clicks on the pause panel.
    expect(INPUT).toMatch(/e\.button === 0 && isPlaying\(\)/);
  });

  it('clears held keys on blur / tab-hide / pointer-lock exit (stuck-key guard, v0.2.612)', () => {
    // The browser swallows keyups when focus leaves mid-hold — a latched W/A/S/D
    // reads as "sticky movement" (player keeps running after key release).
    expect(INPUT).toMatch(/export function clearKeys\(\)/);
    expect(INPUT).toMatch(/window\.addEventListener\('blur', clearKeys\)/);
    expect(INPUT).toMatch(/document\.addEventListener\('visibilitychange'/);
    expect(INPUT).toMatch(/pointerlockchange[\s\S]*clearKeys\(\)/);
  });

  it('drops Ctrl/Cmd-modified keys before movement (ADR-0025 Kami Mode guard)', () => {
    // Ctrl+E is Kami Mode's hotkey; bare E is a jump alias. The keydown handler
    // must return early on ctrlKey/metaKey so a modified press never reaches the
    // `keys` map (which would latch a jump AND double-fire the ema capture).
    expect(INPUT).toMatch(/if \(e\.ctrlKey \|\| e\.metaKey\) return;/);
  });

  it('does not latch movement/action keys while a text field has focus (ADR-0027 Kami ema)', () => {
    // The ema note is a <textarea>. Typing Space must insert a space, NOT also
    // fire the player's jump onKeyDown callback (player.js jumps on Space / bare
    // E). The keydown handler early-returns when the event target is a form
    // field, so `keys` is never latched + downCbs never fire while the owner
    // writes a note.
    expect(INPUT).toMatch(/_t\.tagName === 'INPUT'/);
    expect(INPUT).toMatch(/_t\.tagName === 'TEXTAREA'/);
    expect(INPUT).toMatch(/_t\.isContentEditable/);
  });

  it('suppresses ALL game input while the ema note is open (ADR-0027 suppression flag)', () => {
    // Focus can slip off the textarea (a click on the modal, a tab, a pointer-lock
    // edge). The form-field guard alone would miss a bare Space / E then. So the
    // arena toggles a single suppression flag while the note is open; while it is
    // set, keydown never latches `keys` / fires downCbs AND mousedown never fires
    // a shot — no matter where focus landed.
    expect(INPUT).toMatch(/export function setGameInputSuppressed/);
    expect(INPUT).toMatch(/if \(_inputSuppressed\) return;/);
    // ADR-0029: the mousedown shoot path now gates on the shooting-only suppress
    // too (Kami Mode keeps movement/look live but disables fire).
    expect(INPUT).toMatch(/if \(_inputSuppressed \|\| _shootingSuppressed\) return;/);
    expect(INPUT).toMatch(/export function setShootingSuppressed/);
  });

  it('Esc with the ema note open exits Kami (discard note + exit), not the pause menu (ADR-0027)', () => {
    // arenaRuntime's capture-phase Escape listener fires BEFORE the textarea's
    // own keydown. Without a guard it calls stopImmediatePropagation + opens the
    // pause menu, so the ema's Escape handler (finish(false) → close) never runs
    // and the owner is trapped on the note screen. The guard must yield when the
    // note is open: mark Escape as handled (so the pointer-lock keyup fallback
    // doesn't open pause) and call kamiExit() — which discards the open note AND
    // exits Kami Mode in one press, matching the ✕ button and the "ESC EXIT" badge.
    expect(RUNTIME).toMatch(/if \(kamiNoteOpen\(\)\) \{\s*_escapeHandledOnKeyDown = true;/);
    expect(RUNTIME).toMatch(/if \(kamiNoteOpen\(\)\) \{[\s\S]*?kamiExit\(\);/);
    expect(RUNTIME).toMatch(/if \(kamiNoteOpen\(\)\) \{[\s\S]*?stopImmediatePropagation\(\);/);
    // ADR-0031: import list must still carry kamiExit for the one-press exit.
    expect(RUNTIME).toMatch(/import \{ installKamiMode, kamiCapture, kamiNoteOpen, kamiBusy, kamiExit, kamiActive, kamiEntering, kamiIsOwner \}/);
    expect(RUNTIME).toMatch(/setGameInputSuppressed,/);
  });

  it('hides the ema overlay via style.display, not the dead [hidden] attribute (ADR-0027)', () => {
    // ROOT CAUSE of the Esc/Enter bug: the overlay's inline cssText set
    // display:flex, which beats the UA [hidden]{display:none} rule — so
    // root.setAttribute('hidden','') did NOT hide the modal. finish() set
    // _noteOpen=false but the box stayed visible, so the next Escape saw
    // kamiNoteOpen()=false + opened the pause menu. The overlay must toggle
    // style.display directly ('flex' to show, 'none' to hide), and the hide
    // + input release must run BEFORE the _noteOpen guard so a stuck-visible
    // modal always closes.
    const KAMI = readFileSync(join(ROOT, 'src/engine/kami/kamiMode.js'), 'utf8');
    expect(KAMI).toMatch(/root\.style\.display = 'none';/);
    expect(KAMI).toMatch(/root\.style\.display = 'flex';/);
    // the hide + suppression release must precede the `if (!_noteOpen) return` guard
    const finishIdx = KAMI.indexOf('const finish = (commit) =>');
    const guardIdx = KAMI.indexOf('if (!_noteOpen) return;', finishIdx);
    const hideIdx = KAMI.indexOf("root.style.display = 'none';", finishIdx);
    expect(hideIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeLessThan(guardIdx);
    // the dead [hidden] attribute toggle must NOT remain as the hide mechanism
    expect(KAMI.slice(finishIdx, finishIdx + 400)).not.toMatch(/setAttribute\('hidden', ''\)/);
  });
});

// ADR-0027 Kami Mode: the ema note input must own its keystrokes.
// - input.js: form fields swallow movement/action keys + a suppression flag
//   blanks ALL game input while the note is open (focus can slip off the field).
// - arenaRuntime.js: the capture-phase Escape listener yields to the open note.
// - kamiMode.js: toggles the suppression flag on open/finish + stops propagation
//   on its own Escape/Enter so no later listener sees the commit/discard.
describe('kami ema note input boundary (ADR-0027)', () => {
  const KAMI = readFileSync(join(ROOT, 'src/engine/kami/kamiMode.js'), 'utf8');
  it('exports kamiNoteOpen() for the arena input guard', () => {
    expect(KAMI).toMatch(/export function kamiNoteOpen\(\) \{ return _noteOpen; \}/);
  });
  it('toggles game-input suppression on open + finish', () => {
    expect(KAMI).toMatch(/setGameInputSuppressed\(true\)/);
    // ADR-0029: finish() restores the KAMI state (not full-normal): clears the
    // full input-suppress used for typing, then re-applies the shooting-only
    // suppress so the invincible-spirit state holds while the rack stays visible.
    expect(KAMI).toMatch(/_deps\.setGameInputSuppressed\(false\);[\s\S]*?_deps\.setShootingSuppressed\?\.\(_kamiActive\)/);
  });
  it('stops propagation on its own Escape + Enter so no later listener sees them', () => {
    expect(KAMI).toMatch(/Escape'\) \{ ev\.preventDefault\(\); ev\.stopPropagation\(\); finish\(false\)/);
    expect(KAMI).toMatch(/Enter' && !ev\.shiftKey\) \{ ev\.preventDefault\(\); ev\.stopPropagation\(\); finish\(true\)/);
  });

  it('hides the empty tray badge via style.display, not the dead [hidden] attribute (little-orange-box leak)', () => {
    // #kami-tray's cssText sets display:flex, which beats the UA [hidden]{display:none}
    // rule (the same ADR-0027 gotcha as #kami-overlay). The badge therefore leaked as
    // an empty amber-bordered pill at bottom-center whenever the rack was empty — the
    // «little orange box» the owner sees after opening + closing Kami. ensureTrayBadge
    // must set style.display:none explicitly, and renderTray must toggle style.display
    // (never add/remove the hidden attribute).
    const trayIdx = KAMI.indexOf('function ensureTrayBadge()');
    const renderTrayIdx = KAMI.indexOf('function renderTray()', trayIdx);
    expect(trayIdx).toBeGreaterThan(-1);
    const traySrc = KAMI.slice(trayIdx, renderTrayIdx);
    expect(traySrc).toMatch(/el\.style\.display = 'none';/);
    expect(traySrc).not.toMatch(/setAttribute\('hidden'\)/);
    // renderTray shows it back via style.display = 'flex'.
    const renderSrc = KAMI.slice(renderTrayIdx, KAMI.indexOf('function setStatus', renderTrayIdx));
    expect(renderSrc).toMatch(/el\.style\.display = 'flex';/);
    expect(renderSrc).toMatch(/el\.style\.display = 'none';/);
  });
});
