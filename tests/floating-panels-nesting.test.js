// tests/floating-panels-nesting.test.js — ADR-0028 regression guard.
// The emagake rack (#emagake) + Plebeian auction panel (#auction-panel) are
// position:fixed floating overlays shown during PLAYING. They MUST live at
// top-level body scope, NOT nested inside #screen-title.
//
// Why: #screen-title gets the `.hidden` class (→ display:none) the moment the
// phase leaves TITLE (phaseScreens.js applyPhaseScreens). display:none removes
// the ENTIRE subtree from the render tree — including position:fixed
// descendants — so a panel nested under #screen-title is invisible in-game no
// matter what .floating / z-index it has. That is exactly the bug that made the
// ema rack + auction vanish in the arena.
//
// This test parses index.html + asserts both panels sit OUTSIDE #screen-title.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const HTML = readFileSync(new URL('index.html', ROOT), 'utf8');

// Byte index of the matching closing </div> for the <div ...> whose opening
// tag contains `idAttr` (e.g. 'id="screen-title"'). Tracks nested <div> depth.
function closingDivOf(html, idAttr) {
  const idIdx = html.indexOf(idAttr);
  if (idIdx === -1) return -1;
  const openTagStart = html.lastIndexOf('<div', idIdx);
  if (openTagStart === -1) return -1;
  let pos = html.indexOf('>', openTagStart) + 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = pos;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

describe('ADR-0028: floating panels must not nest inside #screen-title', () => {
  const screenTitleEnd = closingDivOf(HTML, 'id="screen-title"');
  const emagakePos = HTML.indexOf('id="emagake"');
  const auctionPos = HTML.indexOf('id="auction-panel"');

  it('#screen-title is present + balanced in index.html', () => {
    expect(screenTitleEnd).toBeGreaterThan(-1);
  });

  it('#emagake + #auction-panel exist as elements in index.html', () => {
    expect(emagakePos).toBeGreaterThan(-1);
    expect(auctionPos).toBeGreaterThan(-1);
  });

  it('#emagake is NOT nested inside #screen-title (must be a body sibling)', () => {
    expect(emagakePos).toBeGreaterThan(screenTitleEnd);
  });

  it('#auction-panel is NOT nested inside #screen-title (must be a body sibling)', () => {
    expect(auctionPos).toBeGreaterThan(screenTitleEnd);
  });

  it('both panels sit after #screen-title and before #hud (top-level overlay band)', () => {
    const hudPos = HTML.indexOf('id="hud"');
    expect(hudPos).toBeGreaterThan(-1);
    expect(emagakePos).toBeGreaterThan(screenTitleEnd);
    expect(emagakePos).toBeLessThan(hudPos);
    expect(auctionPos).toBeGreaterThan(screenTitleEnd);
    expect(auctionPos).toBeLessThan(hudPos);
  });
});
