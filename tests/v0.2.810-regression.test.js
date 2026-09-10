// v0.2.810-alpha: remove the .gp-band vertical readability band.
//
// v0.2.806 introduced a single .gp-band child inside #title-centre as a
// vertical readability tint that peaked on the centre axis. v0.2.807
// cranked its peak alpha 0.32 -> 0.70 so it was actually visible. In
// v0.2.810 the user asked for the whole layer to be removed: the
// title/eyebrow/char-cards/buttons/captions now sit directly on the
// sunset photo with only their own per-element fills for contrast.
//
// This file locks the removal so a future refactor cannot silently
// bring the band back (through the same class name, or by adding a
// similar full-column tint at a different name).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('v0.2.810 — .gp-band vertical readability band removed', () => {
  it('no .gp-band DOM element is rendered anywhere in the document', () => {
    expect(HTML).not.toMatch(/class="gp-band"/);
    expect(HTML).not.toMatch(/<div\s+class="gp-band"/);
  });

  it('no .gp-band CSS rule exists', () => {
    // The whole rule block is gone, so no selector matches ".gp-band".
    // Comments referencing .gp-band historically are allowed (they are
    // narrative), but no active rule may re-declare it.
    expect(HTML).not.toMatch(/\.gp-band\s*\{/);
  });

  it('#title-centre now contains exactly one direct child wrapper (.gp-content)', () => {
    // Before v0.2.810 the panel had two direct children: .gp-band then
    // .gp-content. After removal only .gp-content remains, so a future
    // edit that tries to sneak the band back in as a second child (under
    // a fresh class name) is caught by the child-count assertion.
    const centreOpen = HTML.indexOf('id="title-centre"');
    expect(centreOpen).toBeGreaterThan(-1);
    // Slice up to (and including) the .gp-content opener; that's enough
    // to see every element that appears BEFORE .gp-content inside the panel.
    const gpContentIdx = HTML.indexOf('class="gp-content"', centreOpen);
    expect(gpContentIdx).toBeGreaterThan(centreOpen);
    const preamble = HTML.slice(centreOpen, gpContentIdx);
    // No <div ...> tags before .gp-content — just the panel opener,
    // comments, and whitespace.
    const divsBefore = preamble.match(/<div\b/g) || [];
    // The panel's own <div id="title-centre" ...> counts as one; nothing
    // else may appear before .gp-content.
    expect(divsBefore.length).toBe(1);
  });

  it('the panel-treatment palette (the dark rgba(12,8,6,*) band ink) is gone from the stylesheet', () => {
    // The band's tint colour was rgba(12,8,6,*) at various alphas. All
    // stops are now gone. Freezing the whole colour so a future edit
    // that re-adds a "small" version of the same tint at a lower alpha
    // still fails.
    expect(HTML).not.toMatch(/rgba\(\s*12\s*,\s*8\s*,\s*6\s*,/);
  });

  it('the sunset background on #screen-title is still unfiltered (no linear-gradient overlay)', () => {
    // Post-v0.2.807 the #screen-title background is just the sunset
    // photo. v0.2.810 must NOT compensate for removing the band by
    // silently re-adding a viewport-wide darkening layer here.
    const rule = HTML.match(/#screen-title\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const bgDecl = rule[0].match(/background:\s*[^;]+;/);
    expect(bgDecl).toBeTruthy();
    expect(bgDecl[0]).not.toMatch(/linear-gradient/);
  });
});
