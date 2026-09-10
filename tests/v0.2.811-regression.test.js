// v0.2.811-alpha: three-part title-screen CTA polish.
//
// 1) 20% ochre fill on the shared CTA base rule so all three buttons have
//    visible body against the sunset while still reading as translucent.
// 2) Larger .entry-caption free-title copy (font-size 11 -> 13,
//    letter-spacing 3 -> 3.5, max-width 260 -> 284).
// 3) Ochre-halo hover on the inactive #btn-enter-nap (guest button before
//    a character is picked) so it mirrors the hover halo shape of the
//    other two CTAs. Achieved by removing `pointer-events:none` from the
//    inactive rule (native `disabled` still blocks the click) and adding
//    a dedicated inactive :hover rule in the ochre palette.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('v0.2.811 — CTA base rule carries a 20% ochre fill', () => {
  it('the shared base selector body sets background: rgba(232,178,120,0.20)', () => {
    // Lock the exact fill so a future edit cannot silently drop the alpha
    // back to 0 (transparent) or push it above ~0.35 (which would stop
    // reading as "very see-through" per user direction).
    const sharedBase = HTML.match(
      /#btn-enter-nap\[data-armed="false"\]:not\(:hover\)\s*,\s*#btn-create-ai:not\(:hover\):not\(\[data-armed="true"\]\)\s*,\s*#btn-nostr-centre\[data-armed="false"\]:not\(:hover\)\s*\{([^}]*)\}/
    );
    expect(sharedBase).toBeTruthy();
    const body = sharedBase[1];
    expect(body).toMatch(/background:\s*rgba\(\s*232\s*,\s*178\s*,\s*120\s*,\s*0\.20?\s*\)/);
    // Not a solid fill; keep the "still very see-through" invariant.
    expect(body).not.toMatch(/background:\s*rgba\([^)]*,\s*(?:0\.[5-9]\d?|1(?:\.0+)?)\s*\)/);
  });

  it('the base rule keeps the ochre outline + cream-ochre text from v0.2.809', () => {
    // Belt-and-braces so the fill addition does not also silently drop
    // the border or recolour the text.
    const sharedBase = HTML.match(
      /#btn-enter-nap\[data-armed="false"\]:not\(:hover\)\s*,\s*#btn-create-ai:not\(:hover\):not\(\[data-armed="true"\]\)\s*,\s*#btn-nostr-centre\[data-armed="false"\]:not\(:hover\)\s*\{([^}]*)\}/
    );
    const body = sharedBase[1];
    expect(body).toMatch(/border:\s*1px\s+solid\s+rgba\(232,178,120,0\.55\)/);
    expect(body).toMatch(/color:\s*#f4d5a8/);
  });
});

describe('v0.2.811 — .entry-caption free-title copy sized up', () => {
  it('.entry-caption font-size is 13px (was 11px in v0.2.808)', () => {
    const rule = HTML.match(/\.entry-caption\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    expect(rule[0]).toMatch(/font-size:\s*13px/);
    expect(rule[0]).not.toMatch(/font-size:\s*11px/);
    expect(rule[0]).not.toMatch(/font-size:\s*10px/);
  });

  it('.entry-caption letter-spacing is 3.5px (was 3px in v0.2.808)', () => {
    const rule = HTML.match(/\.entry-caption\s*\{[^}]*\}/s);
    expect(rule[0]).toMatch(/letter-spacing:\s*3\.5px/);
    expect(rule[0]).not.toMatch(/letter-spacing:\s*3px[^.]/); // reject "3px" but allow "3.5px"
  });

  it('.entry-caption max-width is 284px (aligned to the CTA + char-picker row width)', () => {
    // Freezes the alignment invariant: caption width = char-picker row
    // width = CTA button width = 284px (see v0.2.810 CTA-width test).
    const rule = HTML.match(/\.entry-caption\s*\{[^}]*\}/s);
    expect(rule[0]).toMatch(/max-width:\s*284px/);
    expect(rule[0]).not.toMatch(/max-width:\s*260px/);
  });
});

describe('v0.2.811 — inactive guest button gets a hover halo', () => {
  it('the inactive base rule (#btn-enter-nap[data-armed="false"]) no longer sets pointer-events:none', () => {
    // pointer-events:none was blocking :hover from firing on the inactive
    // button. Native `disabled` still blocks the click (see the
    // markup-defence test below + the v0.2.809 test that asserts
    // opacity:0.55 + cursor:not-allowed here).
    const inactive = HTML.match(
      /#btn-enter-nap\[data-armed="false"\]\s*\{([^}]*)\}/
    );
    expect(inactive).toBeTruthy();
    expect(inactive[1]).not.toMatch(/pointer-events\s*:/);
  });

  it('a dedicated #btn-enter-nap[data-armed="false"]:hover rule exists with an ochre halo', () => {
    // Halo shape MUST mirror the other two CTAs' hover shape (border
    // colour + two-stop box-shadow + opacity lift) so the interaction
    // reads consistently, but in the ochre palette not the sage palette
    // so it signals "needs a character" rather than "ready to enter".
    const hover = HTML.match(
      /#btn-enter-nap\[data-armed="false"\]:hover\s*\{([^}]*)\}/
    );
    expect(hover).toBeTruthy();
    const body = hover[1];
    // Ochre-family fill (not sage green). Alpha lifts a touch from the
    // base 0.20 so the halo feels connected without becoming opaque.
    expect(body).toMatch(/background:\s*rgba\(\s*232\s*,\s*178\s*,\s*120\s*,\s*0\.2[5-9]\)/);
    // Brighter ochre border on hover.
    expect(body).toMatch(/border-color:\s*rgba\(\s*247\s*,\s*180\s*,\s*110\s*,\s*0\.\d+\)/);
    // Two-stop soft ochre glow.
    expect(body).toMatch(/box-shadow:\s*[^;]*rgba\(\s*232\s*,\s*178\s*,\s*120[^;]*,\s*0 0/s);
    // Opacity lift so it does not feel dead under the pointer.
    expect(body).toMatch(/opacity:\s*0\.7[0-9]?/);
    // MUST NOT slip into the sage green palette used by the other two
    // hover rules — the whole point is to signal "not the same thing".
    expect(body).not.toMatch(/rgba\(\s*77\s*,\s*122\s*,\s*58/);
    expect(body).not.toMatch(/rgba\(\s*110\s*,\s*169\s*,\s*77/);
  });

  it('inactive #btn-enter-nap markup keeps `disabled` + `aria-disabled="true"` (native click-block)', () => {
    // The click-block moved from `pointer-events:none` (CSS) to the
    // native <button disabled> + aria-disabled defence. Freeze both so
    // a future edit cannot remove one and leave the click open.
    const tag = HTML.match(/<button[^>]*id="btn-enter-nap"[^>]*>/);
    expect(tag).toBeTruthy();
    expect(tag[0]).toMatch(/\sdisabled(\s|>)/);
    expect(tag[0]).toMatch(/aria-disabled="true"/);
  });
});
