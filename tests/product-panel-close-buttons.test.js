// @vitest-environment jsdom
// tests/product-panel-close-buttons.test.js — locks ADR-0036's explicit close
// controls. The auction-panel + each of the three ADR-0035 owner-boards now
// open ONLY via the in-world PRODUCT sign trigger (see
// product-panel-trigger.test.js) and must close ONLY via their own close
// button — never an auto-hide, never a re-trigger toggle.
//
// setMarketActive/setBoardsActive construct a real WebSocket to a Plebeian
// relay URL when activated; jsdom has no WebSocket global, but both modules
// wrap that construction in try/catch (best-effort — read-only display), so
// activating under jsdom is safe and never throws.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setMarketActive, _resetMarketStall } from '../src/engine/plebeian/marketStall.js';
import { setBoardsActive, hideOwnerBoard, _resetOwnerBoards } from '../src/engine/plebeian/ownerBoards.js';

function isShown(id) {
  const el = document.getElementById(id);
  return el && !el.hasAttribute('hidden') && el.classList.contains('floating');
}
function isHidden(id) {
  const el = document.getElementById(id);
  return el && el.hasAttribute('hidden') && !el.classList.contains('floating');
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="auction-panel" hidden>
      <button id="auction-panel-close" class="owner-board-close" type="button">×</button>
      <div id="auction-panel-status"></div>
    </div>
    <div id="product-board" class="owner-board" hidden>
      <button class="owner-board-close" data-board-close="product-board" type="button">×</button>
    </div>
    <div id="live-auction-board" class="owner-board" hidden>
      <button class="owner-board-close" data-board-close="live-auction-board" type="button">×</button>
    </div>
    <div id="past-auction-board" class="owner-board" hidden>
      <button class="owner-board-close" data-board-close="past-auction-board" type="button">×</button>
    </div>
  `;
});

afterEach(() => {
  _resetMarketStall();
  _resetOwnerBoards();
});

describe('auction-panel close (setMarketActive(false))', () => {
  it('starts hidden, opens via setMarketActive(true), closes via close-button handler', () => {
    expect(isHidden('auction-panel')).toBe(true);
    setMarketActive(true);
    expect(isShown('auction-panel')).toBe(true);
    // Mirrors the click handler wired in arenaRuntime.js.
    setMarketActive(false);
    expect(isHidden('auction-panel')).toBe(true);
  });

  it('closing does not throw even with no WebSocket global (jsdom)', () => {
    expect(() => { setMarketActive(true); setMarketActive(false); }).not.toThrow();
  });
});

describe('owner-board close (hideOwnerBoard) — independent per board', () => {
  it('opening shows all three boards together', () => {
    setBoardsActive(true);
    expect(isShown('product-board')).toBe(true);
    expect(isShown('live-auction-board')).toBe(true);
    expect(isShown('past-auction-board')).toBe(true);
  });

  it('closing ONE board via hideOwnerBoard leaves the other two open', () => {
    setBoardsActive(true);
    hideOwnerBoard('product-board');
    expect(isHidden('product-board')).toBe(true);
    expect(isShown('live-auction-board')).toBe(true);
    expect(isShown('past-auction-board')).toBe(true);
  });

  it('closing all three individually hides all three', () => {
    setBoardsActive(true);
    hideOwnerBoard('product-board');
    hideOwnerBoard('live-auction-board');
    hideOwnerBoard('past-auction-board');
    expect(isHidden('product-board')).toBe(true);
    expect(isHidden('live-auction-board')).toBe(true);
    expect(isHidden('past-auction-board')).toBe(true);
  });

  it('re-opening via setBoardsActive(true) re-shows a board that was individually closed', () => {
    setBoardsActive(true);
    hideOwnerBoard('product-board');
    expect(isHidden('product-board')).toBe(true);
    // Re-trigger from the PRODUCT sign: onOpen calls setBoardsActive(true) only
    // (it does NOT reset to false first). This must re-show individually-hidden
    // boards. Regression for the v0.2.653 bug where the short-circuit
    // `if (active === _active) return` left boards hidden after a close cycle.
    setBoardsActive(true);
    expect(isShown('product-board')).toBe(true);
  });

  it('regression: open → close all boards individually → press Q again reopens ALL boards', () => {
    // First trigger press: all open.
    setBoardsActive(true);
    expect(isShown('product-board')).toBe(true);
    expect(isShown('live-auction-board')).toBe(true);
    expect(isShown('past-auction-board')).toBe(true);
    // Close each board via its own close button (the ADR-0036 close path).
    hideOwnerBoard('product-board');
    hideOwnerBoard('live-auction-board');
    hideOwnerBoard('past-auction-board');
    expect(isHidden('product-board')).toBe(true);
    expect(isHidden('live-auction-board')).toBe(true);
    expect(isHidden('past-auction-board')).toBe(true);
    // Second trigger press: onOpen → setBoardsActive(true) only.
    // Boards were hidden via hideOwnerBoard (which never touched _active),
    // so _active is still true here — this used to short-circuit and NOT re-show.
    setBoardsActive(true);
    expect(isShown('product-board')).toBe(true);
    expect(isShown('live-auction-board')).toBe(true);
    expect(isShown('past-auction-board')).toBe(true);
  });

  it('hideOwnerBoard on an unknown id is a safe no-op', () => {
    expect(() => hideOwnerBoard('nonexistent-board')).not.toThrow();
  });

  it('hideOwnerBoard does not throw with no matching DOM element', () => {
    document.body.innerHTML = '';
    expect(() => hideOwnerBoard('product-board')).not.toThrow();
  });
});

describe('close buttons exist and are wired to the right target id', () => {
  it('each panel has exactly one close control', () => {
    expect(document.querySelectorAll('#auction-panel-close').length).toBe(1);
    expect(document.querySelectorAll('[data-board-close="product-board"]').length).toBe(1);
    expect(document.querySelectorAll('[data-board-close="live-auction-board"]').length).toBe(1);
    expect(document.querySelectorAll('[data-board-close="past-auction-board"]').length).toBe(1);
  });

  it('clicking each owner-board close button (delegated handler pattern) hides only that board', () => {
    setBoardsActive(true);
    for (const btn of document.querySelectorAll('[data-board-close]')) {
      btn.addEventListener('click', () => hideOwnerBoard(btn.getAttribute('data-board-close')));
    }
    document.querySelector('[data-board-close="live-auction-board"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }),
    );
    expect(isHidden('live-auction-board')).toBe(true);
    expect(isShown('product-board')).toBe(true);
    expect(isShown('past-auction-board')).toBe(true);
  });
});
