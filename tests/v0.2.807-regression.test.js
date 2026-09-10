// v0.2.807-alpha regression locks.
//
// Followup on v0.2.806-alpha (homepage strip + vertical readability band).
// Playwright measurement showed the v0.2.806 band was too subtle to read as a
// gradient — the peak alpha 0.32 shifted the underlying sunset by only ~10/255
// per channel. The user asked for three concrete changes in this ship:
//
//   1. Bump the .gp-band gradient peak from 0.32 to 0.70 (and proportionally
//      raise the 45%/55% shoulders 0.22 -> 0.48) so the band is a visibly
//      soft dark shape behind the buttons, not just a mathematical presence.
//   2. Remove every OTHER semi-transparent layer that was still darkening
//      the sunset photo behind the entry flow — specifically the fullscreen
//      #screen-title top-to-bottom overlay AND the invisible
//      backdrop-filter that #title-centre.glass-panel was inheriting from
//      .glass-panel. Only the .gp-band and the intentional layers (per-
//      button fills, per-char-card fills) may still tint the sunset.
//   3. Add short descriptor lines back under each entry-option button
//      (.entry-caption) that complement the button copy.
//
// This file freezes those three shape decisions. It intentionally does NOT
// duplicate v0.2.806's strip/positive-lock/anti-ring assertions — those
// still run and still pass; this file only asserts the deltas.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('v0.2.807 — .gp-band alpha bump (superseded by v0.2.810 removal)', () => {
  // The v0.2.807 alpha-bump assertions were retired in v0.2.810 when the
  // whole .gp-band vertical readability layer was removed per user
  // direction. Kept here as a small "the band stays gone" lock so a
  // future edit that resurrects the band fails loudly against the
  // original ship's own regression file, not just v0.2.810's.
  it('the .gp-band CSS rule no longer exists', () => {
    expect(HTML).not.toMatch(/\.gp-band\s*\{/);
  });

  it('the old v0.2.807 peak alpha 0.70 and shoulder 0.48 stops are gone with the band', () => {
    // Anti-regression on the exact peak/shoulder alphas the band shipped
    // with. They should no longer appear anywhere in the stylesheet.
    expect(HTML).not.toMatch(/rgba\(\s*12\s*,\s*8\s*,\s*6\s*,\s*0\.70?\)/);
    expect(HTML).not.toMatch(/rgba\(\s*12\s*,\s*8\s*,\s*6\s*,\s*0\.48\)/);
  });
});

describe('v0.2.807 — full-viewport #screen-title darkening overlay removed', () => {
  it('the #screen-title CSS rule background is only the sunset photo (no linear-gradient overlay)', () => {
    // v0.2.806 and earlier prepended a `linear-gradient(180deg,
    // rgba(20,13,9,0.55) 0%, rgba(20,13,9,0.72) 55%, rgba(14,9,6,0.88)
    // 100%)` on top of the photo, darkening the entire viewport behind
    // the homepage. The user asked for the sunset to sit unfiltered
    // behind everything, with only the vertical band providing
    // readability treatment.
    const rule = HTML.match(/#screen-title\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    // Sunset URL still there.
    expect(body).toMatch(/background:\s*url\('\/torii-gate-sunset\.jpg'\)/);
    // NO linear-gradient prepended inside the background declaration —
    // the darkening overlay is gone.
    const bgDecl = body.match(/background:\s*[^;]+;/);
    expect(bgDecl).toBeTruthy();
    expect(bgDecl[0]).not.toMatch(/linear-gradient/);
  });

  it('the specific v0.2.806 dark overlay alpha stops are not present anywhere in the stylesheet', () => {
    // The exact colour+alpha triplet from the old overlay was the
    // fingerprint that darkened the whole photo. If it ever comes back
    // (as part of #screen-title or anywhere else pretending to be a
    // background overlay) it undoes the intent of this ship.
    expect(HTML).not.toMatch(/rgba\(\s*20\s*,\s*13\s*,\s*9\s*,\s*0\.72\)/);
    expect(HTML).not.toMatch(/rgba\(\s*14\s*,\s*9\s*,\s*6\s*,\s*0\.88\)/);
  });
});

describe('v0.2.807 — #title-centre.glass-panel resets inherited backdrop-filter', () => {
  it('the rule sets backdrop-filter: none AND -webkit-backdrop-filter: none', () => {
    // .glass-panel (unchanged, still shared by e.g. settings modal) declares
    // `backdrop-filter: blur(10px) saturate(120%)`. Without an explicit
    // reset on #title-centre.glass-panel, the panel invisibly sampled the
    // sunset through blur+saturate — another semi-transparent layer the
    // user asked to remove. This ship resets both to `none`.
    const rule = HTML.match(/#title-centre\.glass-panel\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    expect(body).toMatch(/(?<!-webkit-)backdrop-filter:\s*none/);
    expect(body).toMatch(/-webkit-backdrop-filter:\s*none/);
  });

  it('the shared .glass-panel rule STILL declares backdrop-filter (only the panel-specific override drops it)', () => {
    // Guard against someone "cleaning up" by removing the blur from the
    // shared class — that would silently affect the settings modal and
    // other places .glass-panel is used.
    const rule = HTML.match(/\n    \.glass-panel\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    expect(body).toMatch(/backdrop-filter:\s*blur\(10px\)\s*saturate\(120%\)/);
  });
});

describe('v0.2.807 — soft descriptor lines under each entry-option button', () => {
  it('the .entry-caption CSS rule exists and paints small, dim, letter-spaced uppercase text', () => {
    const rule = HTML.match(/\.entry-caption\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    // v0.2.808-alpha nudge: caption sizing bumped as captions moved above
    // the option. v0.2.811-alpha bumped again per user direction so the
    // free-title copy reads at a comfortable size (font-size 11 -> 13,
    // letter-spacing 3 -> 3.5). Kept in-file to keep the "exists + dim +
    // spaced + uppercase + no fill" shape assertion together.
    expect(body).toMatch(/font-size:\s*13px/);
    expect(body).toMatch(/letter-spacing:\s*3\.5px/);
    expect(body).toMatch(/text-transform:\s*uppercase/);
    // Alpha < 1 so it reads as a secondary line, not competing with the button.
    expect(body).toMatch(/color:\s*rgba\([^)]+,\s*0\.\d+\)/);
    // No background fill on this element — in v0.2.810 the .gp-band
    // underneath was removed, so the caption now sits directly on the
    // sunset photo. Keeping the "no background" invariant so a future edit
    // does not compensate by putting a fill on the caption itself.
    expect(body).not.toMatch(/background\s*:/);
  });

  it('every entry-option button has exactly one .entry-caption span referencing it via data-for', () => {
    // v0.2.808-alpha reshape: captions no longer required to sit after
    // the button. In v0.2.808 they moved ABOVE the option (over the char
    // picker for ENTER AS GUEST, over the button for the other two).
    // The structural contract is now purely relational: for every CTA
    // button id, exactly one .entry-caption[data-for=<id>] exists somewhere
    // in the doc, and has non-empty text content. Positional layout is
    // owned by v0.2.808-regression.test.js.
    for (const btnId of ['btn-enter-nap', 'btn-create-ai', 'btn-nostr-centre']) {
      const re = new RegExp(`<span class="entry-caption"[^>]*data-for="${btnId}"[^>]*>([^<]+)</span>`, 'g');
      const matches = [...HTML.matchAll(re)];
      expect(matches.length, `caption count for ${btnId}`).toBe(1);
      expect(matches[0][1].trim().length, `caption text non-empty for ${btnId}`).toBeGreaterThan(0);
    }
  });

  it('exactly three .entry-caption spans exist on the title screen (one per option, no dupes)', () => {
    const captions = HTML.match(/<span class="entry-caption"[^>]*>/g) || [];
    expect(captions.length).toBe(3);
  });
});
