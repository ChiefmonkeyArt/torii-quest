// v0.2.812-alpha regression tests
//
// Two title-screen tweaks per user direction on top of v0.2.811-alpha:
//
//   1. Inactive ENTER-AS-GUEST label swaps to "PICK A CHARACTER" on
//      hover. Implemented as two <span class="btn-label"> children
//      (base + hover) inside the button, swapped by CSS `display:` on
//      `#btn-enter-nap[data-armed="false"]:hover`. A stable
//      `aria-label="Enter as guest"` on the button holds the screen-
//      reader name steady; the hover span is aria-hidden. The armed
//      state (`_armGuestEnterButton()`) still wipes the innerHTML to
//      "ENTER" so no armed-state hover swap can fire.
//
//   2. `.torii-divider` vertical margin bumped 18px -> 32px so each of
//      the three sections (guest picker / AI create / nostr login)
//      gets more breathing room above and below the divider.
//
// These locks fail loudly if a future edit regresses the markup, the
// a11y label, the hover CSS, or the divider spacing.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let HTML = '';
beforeAll(() => { HTML = readFileSync(join(ROOT, 'index.html'), 'utf8'); });

describe('v0.2.812 — inactive-guest hover label swap (ENTER AS GUEST -> PICK A CHARACTER)', () => {
  it('the button carries a stable aria-label="Enter as guest" so the hover-swap does not affect the a11y name', () => {
    const btn = HTML.match(/<button[^>]*id="btn-enter-nap"[^>]*>/)?.[0] || '';
    expect(btn).toBeTruthy();
    expect(btn).toMatch(/aria-label="Enter as guest"/);
  });

  it('the button contains a .btn-label-base span with "ENTER AS GUEST"', () => {
    const idx = HTML.indexOf('id="btn-enter-nap"');
    const around = HTML.slice(idx, idx + 500);
    expect(around).toMatch(/<span class="btn-label btn-label-base">ENTER AS GUEST<\/span>/);
  });

  it('the button contains a .btn-label-hover span with "PICK A CHARACTER" and aria-hidden="true"', () => {
    const idx = HTML.indexOf('id="btn-enter-nap"');
    const around = HTML.slice(idx, idx + 500);
    // aria-hidden is required so screen readers do not see two labels
    // stacked in the accessibility tree.
    expect(around).toMatch(/<span class="btn-label btn-label-hover" aria-hidden="true">PICK A CHARACTER<\/span>/);
  });

  it('the CSS shows the base span and hides the hover span by default', () => {
    const base = HTML.match(/#btn-enter-nap\s+\.btn-label\s*\{[^}]*\}/s);
    expect(base).toBeTruthy();
    expect(base[0]).toMatch(/display:\s*inline/);
    const hoverHidden = HTML.match(/#btn-enter-nap\s+\.btn-label-hover\s*\{[^}]*\}/s);
    expect(hoverHidden).toBeTruthy();
    expect(hoverHidden[0]).toMatch(/display:\s*none/);
  });

  it('on inactive hover, the base is hidden and the hover span is shown', () => {
    const baseHidden = HTML.match(/#btn-enter-nap\[data-armed="false"\]:hover\s+\.btn-label-base\s*\{[^}]*\}/s);
    expect(baseHidden).toBeTruthy();
    expect(baseHidden[0]).toMatch(/display:\s*none/);

    const hoverShown = HTML.match(/#btn-enter-nap\[data-armed="false"\]:hover\s+\.btn-label-hover\s*\{[^}]*\}/s);
    expect(hoverShown).toBeTruthy();
    expect(hoverShown[0]).toMatch(/display:\s*inline/);
  });

  it('there is NO armed-state hover swap: the swap rules are scoped to data-armed="false"', () => {
    // Once the user picks a character, main.js _armGuestEnterButton()
    // sets btn.textContent = 'ENTER', wiping the label spans entirely.
    // But even before that runs, no armed-state swap CSS should exist,
    // so that in the rare window between arm and any hover the label
    // stays correct.
    const armedHoverSwap = HTML.match(/#btn-enter-nap\[data-armed="true"\]:hover\s+\.btn-label/);
    expect(armedHoverSwap).toBeNull();
  });

  it('_armGuestEnterButton() in main.js still sets textContent to "ENTER" (wiping the label spans)', () => {
    // Belt-and-braces: the armed relabel path stays unchanged, so no
    // stale "PICK A CHARACTER" copy can leak through after arming.
    const main = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
    // Grab the function body and confirm the textContent assignment.
    const fnStart = main.indexOf('function _armGuestEnterButton');
    expect(fnStart).toBeGreaterThan(0);
    const body = main.slice(fnStart, fnStart + 500);
    expect(body).toMatch(/btn\.textContent\s*=\s*['"]ENTER['"]/);
  });
});

describe('v0.2.812 — divider vertical breathing room (18px -> 32px)', () => {
  it('.torii-divider vertical margin is 32px auto (bumped from 18px)', () => {
    const rule = HTML.match(/\.torii-divider\s*\{[\s\S]*?\}/);
    expect(rule).toBeTruthy();
    expect(rule[0]).toMatch(/margin:\s*32px\s+auto/);
    // Explicit anti-regression on the previous value.
    expect(rule[0]).not.toMatch(/margin:\s*18px\s+auto/);
  });

  it('.torii-divider width and layout properties are preserved (only the margin changed)', () => {
    const rule = HTML.match(/\.torii-divider\s*\{[\s\S]*?\}/);
    expect(rule[0]).toMatch(/width:\s*260px/);
    expect(rule[0]).toMatch(/display:\s*flex/);
    expect(rule[0]).toMatch(/align-items:\s*center/);
    expect(rule[0]).toMatch(/justify-content:\s*center/);
  });

  it('short viewports and narrow phones drop divider margin back to 18px so the entry-panel does not scroll off-screen', () => {
    // The @media rule guards mobile (portrait phones <= 480px wide) AND
    // short viewports (landscape phones / small windows <= 720px tall).
    // Both conditions send the divider margin back to the pre-v0.2.812
    // value so the three sections + torii graphic + logo still fit in
    // one screen without scroll.
    const media = HTML.match(/@media\s*\(max-height:\s*720px\)\s*,\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\}/);
    expect(media).toBeTruthy();
    expect(media[0]).toMatch(/\.torii-divider\s*\{\s*margin:\s*18px\s+auto/);
  });
});
