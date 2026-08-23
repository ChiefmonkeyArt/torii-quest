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
    expect(INPUT).toMatch(/if \(_inputSuppressed\) return; \/\/ ADR-0027: clicking the ema modal must not fire a shot/);
  });

  it('does not steal Escape into the pause menu while the ema note is open (ADR-0027)', () => {
    // arenaRuntime's capture-phase Escape listener fires BEFORE the textarea's
    // own keydown. Without a guard it calls stopImmediatePropagation + opens the
    // pause menu, so the ema's Escape handler (finish(false) → close) never runs
    // and the owner is trapped on the note screen. The guard must yield when the
    // note is open AND mark Escape as handled so the pointer-lock keyup fallback
    // doesn't open pause on the same gesture.
    expect(RUNTIME).toMatch(/kamiNoteOpen\(\)\) \{ _escapeHandledOnKeyDown = true; return; \}/);
    expect(RUNTIME).toMatch(/import \{ installKamiMode, kamiCapture, kamiNoteOpen \}/);
    expect(RUNTIME).toMatch(/setGameInputSuppressed,/);
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
    expect(KAMI).toMatch(/setGameInputSuppressed\(false\); \/\/ ADR-0027: hand game input back/);
  });
  it('stops propagation on its own Escape + Enter so no later listener sees them', () => {
    expect(KAMI).toMatch(/Escape'\) \{ ev\.preventDefault\(\); ev\.stopPropagation\(\); finish\(false\)/);
    expect(KAMI).toMatch(/Enter' && !ev\.shiftKey\) \{ ev\.preventDefault\(\); ev\.stopPropagation\(\); finish\(true\)/);
  });
});
