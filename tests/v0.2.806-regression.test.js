// @vitest-environment jsdom
// tests/v0.2.806-regression.test.js — homepage strip + vertical readability
// band (post-glass-panel).
//
// v0.2.805-alpha shipped a softened four-ring backdrop-blur smoked-glass
// treatment on #title-centre. The user rejected it: the panel's outer edge
// was still visible against the sunset photo, and the surrounding copy read
// as clutter that got in the way of the actual entry choices. v0.2.806-alpha
// resets the homepage:
//
//   1. Strip every piece of decorative or explanatory copy from the entry
//      panel — no eyebrow ("CHOOSE HOW YOU ENTER"), no numbered step labels
//      ("1 ENTER AS GUEST" / "2 CREATE WITH AI" / "3 LOGIN NOSTR"), no
//      per-option subheads ("pick your character" / "design your own
//      character" / "sign in — your character follows you"), no
//      keyboard-controls cheatsheet block, no c-divider rules, and no tagline
//      above the TORII QUEST logo (SOVEREIGNTY · OPEN WORLD · FREE MARKET ·
//      ABUNDANCE). What remains is the flow itself: two character cards, the
//      ENTER-AS-GUEST button, the CREATE-WITH-AI button, and the LOGIN-NOSTR
//      button.
//   2. Replace the four .gp-ring* backdrop-blur bands + .gp-tint on
//      #title-centre.glass-panel with a single .gp-band child — a flat
//      vertical readability band whose opacity peaks on the panel's centre
//      axis and fades continuously to 100% transparent at the left and right
//      sides. No backdrop-filter blur anywhere on the panel (so nothing can
//      draw a blur-sampling edge). No radial ring artefacts. No visible edge.
//
// These tests freeze both moves so a future refactor cannot silently bring
// the eyebrow copy back, restore the ring stack, or reintroduce a
// backdrop-filter blur on the panel itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('v0.2.806 — homepage copy strip (title screen minimalism)', () => {
  it('the tagline strip under the TORII QUEST logo is gone', () => {
    // The old .title-tagline-sm rendered "SOVEREIGNTY · OPEN WORLD · FREE
    // MARKET · ABUNDANCE" beneath the logo. Both the DOM node and the
    // literal copy are removed.
    expect(HTML).not.toMatch(/class="title-tagline-sm"/);
    expect(HTML).not.toMatch(/SOVEREIGNTY[^<]*OPEN WORLD/);
  });

  it('the "CHOOSE HOW YOU ENTER" eyebrow line above the buttons is gone', () => {
    // The section-header/eyebrow that used to sit above the three-option
    // panel. Both the class and the literal copy are removed.
    expect(HTML).not.toMatch(/class="entry-eyebrow"/);
    expect(HTML).not.toMatch(/CHOOSE HOW YOU ENTER/);
  });

  it('the numbered step labels (1/2/3 · ENTER AS GUEST/CREATE WITH AI/LOGIN NOSTR) are gone', () => {
    // The .entry-option-title heading (with a .entry-num circular badge) is
    // removed from all three options. The button copy itself carries the
    // label now.
    expect(HTML).not.toMatch(/class="entry-option-title"/);
    expect(HTML).not.toMatch(/class="entry-num"/);
    // Anti-regression on the actual heading strings that used to appear
    // there (each preceded by the numbered badge). Guard against any of the
    // three coming back in a section-title context.
    expect(HTML).not.toMatch(/<span class="entry-num">1<\/span>/);
    expect(HTML).not.toMatch(/<span class="entry-num">2<\/span>/);
    expect(HTML).not.toMatch(/<span class="entry-num">3<\/span>/);
  });

  it('the per-option subheads under each button are gone', () => {
    // The subheads used to read: "pick your character" (guest),
    // "design your own character" (create-with-AI), and "sign in — your
    // character follows you" (nostr). The DOM class and each literal
    // string are removed.
    expect(HTML).not.toMatch(/class="entry-option-sub"/);
    expect(HTML).not.toMatch(/pick your character/);
    expect(HTML).not.toMatch(/design your own character/);
    expect(HTML).not.toMatch(/sign in\s*—\s*your character/);
  });

  it('the keyboard-controls hint block (#title-controls + .ctrl-key rows) is gone', () => {
    // The WASD / mouse / space / R / esc cheatsheet is removed from the
    // homepage. Both the wrapper id and every .ctrl-key chip are gone.
    expect(HTML).not.toMatch(/id="title-controls"/);
    expect(HTML).not.toMatch(/class="ctrl-key"/);
    // Anti-regression on the literal cheatsheet strings that were inside.
    // "Move & strafe" was unique to the WASD hint row; the standalone "R \u00a0
    // Reload" chip used the .ctrl-key wrapper, so the class negative-lock
    // above already covers it — don't ban the bare word "Reload" here because
    // it collides with the service-worker's goReload() bootstrap identifier.
  });

  it('the .c-divider hairline rules inside the entry panel are gone', () => {
    // v0.2.805 had two <div class="c-divider"></div> hairlines between the
    // three options, plus a third above #title-controls. v0.2.806 removes
    // all three from #title-centre. (The class rule may still exist in the
    // stylesheet — that's fine; what matters is no divider is rendered
    // inside the entry panel any more.) Nail it by asserting no c-divider
    // markup appears anywhere between the #title-centre opener and its
    // matching #entry-status feedback line.
    const centreOpen = HTML.indexOf('id="title-centre"');
    const feedbackLine = HTML.indexOf('id="entry-status"', centreOpen);
    expect(centreOpen).toBeGreaterThan(-1);
    expect(feedbackLine).toBeGreaterThan(centreOpen);
    const panelSlice = HTML.slice(centreOpen, feedbackLine);
    expect(panelSlice).not.toMatch(/class="c-divider"/);
  });

  it('the ENTER-AS-GUEST button, CREATE-WITH-AI button, and LOGIN-NOSTR button are all still present', () => {
    // Positive lock: the strip must NOT accidentally take out any of the
    // three CTAs that actually drive the flow. Each keeps its stable id so
    // the wiring in main.js / loginBootstrap.js still binds.
    expect(HTML).toMatch(/id="btn-enter-nap"[^>]*>ENTER AS GUEST</);
    expect(HTML).toMatch(/id="btn-create-ai"[^>]*>✦ CREATE WITH AI</);
    expect(HTML).toMatch(/id="btn-nostr-centre"[^>]*>⚡ LOGIN NOSTR</);
  });

  it('both guest character cards (nostrich, guest) are still rendered', () => {
    // Positive lock on the character picker: the strip removes decorative
    // copy, NOT the actual choice mechanism above the ENTER-AS-GUEST button.
    expect(HTML).toMatch(/class="char-card"[^>]*data-char="nostrich"/);
    expect(HTML).toMatch(/class="char-card"[^>]*data-char="guest"/);
  });

  it('the #entry-status feedback line (v0.2.228) is still present', () => {
    // The status/error line under the CTAs (ENTER surfaces physics-load
    // failures, LOGIN surfaces "NIP-07 extension not found" etc.) must NOT
    // be swept away by the strip — it's load-bearing feedback, not decorative.
    expect(HTML).toMatch(/id="entry-status"/);
    expect(HTML).toMatch(/id="entry-status"[^>]*role="status"/);
    expect(HTML).toMatch(/id="entry-status"[^>]*aria-live="polite"/);
  });

  it('ARIA labels on each entry section survive the strip', () => {
    // With the visible section titles gone, the <section aria-label="…">
    // hooks are the only way a screen reader can announce which option a
    // user is on. All three must remain.
    expect(HTML).toMatch(/<section class="entry-option" aria-label="Enter as guest">/);
    expect(HTML).toMatch(/<section class="entry-option" aria-label="Create with AI">/);
    expect(HTML).toMatch(/<section class="entry-option" aria-label="Login with Nostr">/);
    // The char-picker keeps its group aria-label too.
    expect(HTML).toMatch(/class="char-picker"[^>]*aria-label="Choose a guest character"/);
  });
});

describe('v0.2.806 — vertical readability band (post-glass-panel treatment)', () => {
  it('the four .gp-ring* backdrop-blur children and .gp-tint child are gone from the panel markup', () => {
    // Every ring div and the flat-tint div that made up the old smoked-glass
    // stack are stripped from #title-centre. The child DOM is now: one
    // .gp-band + one .gp-content wrapper.
    const centreOpen = HTML.indexOf('id="title-centre"');
    expect(centreOpen).toBeGreaterThan(-1);
    // Look inside the first ~2500 chars after the opener (the panel body is
    // ~1.3KB after the strip; this is a comfortable ceiling).
    const panelSlice = HTML.slice(centreOpen, centreOpen + 2500);
    expect(panelSlice).not.toMatch(/class="gp-ring gp-ring1"/);
    expect(panelSlice).not.toMatch(/class="gp-ring gp-ring2"/);
    expect(panelSlice).not.toMatch(/class="gp-ring gp-ring3"/);
    expect(panelSlice).not.toMatch(/class="gp-ring gp-ring4"/);
    expect(panelSlice).not.toMatch(/class="gp-ring gp-tint"/);
  });

  it('a single .gp-band vertical readability band child is present inside #title-centre', () => {
    const centreOpen = HTML.indexOf('id="title-centre"');
    const panelSlice = HTML.slice(centreOpen, centreOpen + 2500);
    expect(panelSlice).toMatch(/<div class="gp-band" aria-hidden="true"><\/div>/);
  });

  it('the .gp-band CSS rule paints a horizontal linear-gradient with 0% opacity at both sides', () => {
    // Nail the "band peaks on centre, fades to 100% transparent at edges"
    // shape: the background is a `linear-gradient(to right, …)` whose
    // first-stop AND last-stop colours are fully transparent
    // (rgba(…,0)). Freezing this prevents a refactor from silently
    // switching to a two-stop ramp or a solid colour that reintroduces an
    // edge on either side of the panel.
    const rule = HTML.match(/\.gp-band\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    expect(body).toMatch(/background:\s*linear-gradient\(\s*to right/);
    // First stop is transparent (…,0) at 0%.
    expect(body).toMatch(/rgba\([^)]*,\s*0\)\s*0%/);
    // Last stop is transparent (…,0) at 100%.
    expect(body).toMatch(/rgba\([^)]*,\s*0\)\s*100%/);
  });

  it('the #title-centre.glass-panel CSS rule declares NO backdrop-filter blur', () => {
    // Whole point of the reset: nothing on #title-centre samples the world
    // through a filter, so there is nothing that can draw a hard blur edge.
    // The rule body is examined directly (backdrop-filter elsewhere in the
    // stylesheet, on e.g. the settings modal, is fine).
    const rule = HTML.match(/#title-centre\.glass-panel\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    expect(body).not.toMatch(/backdrop-filter/);
    expect(body).not.toMatch(/-webkit-backdrop-filter/);
  });

  it('the .gp-band CSS rule ALSO declares NO backdrop-filter (flat tint only)', () => {
    // The band paints a flat rgba tint through a mask — no blur, no
    // saturate, no filter of any kind. This is what stops the edge from
    // ever coming back through the band itself.
    const rule = HTML.match(/\.gp-band\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    expect(body).not.toMatch(/backdrop-filter/);
    expect(body).not.toMatch(/-webkit-backdrop-filter/);
  });
});
