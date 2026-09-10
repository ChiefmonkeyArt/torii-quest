// v0.2.808-alpha regression locks.
//
// Followup on v0.2.807-alpha. The user asked for six concrete layout /
// copy changes on the title screen:
//
//   1. Shrink the two guest character cards by 15% (max-width 160 -> 136,
//      gap 14 -> 12).
//   2. Grow the ENTER AS GUEST button by 10% (width 220 -> 242) AND grow
//      the other two CTAs (CREATE WITH AI, LOGIN NOSTR) to identical size
//      by dropping the smaller font-size/letter-spacing/padding inline
//      overrides they carried.
//   3. Move the ENTER-AS-GUEST caption ABOVE the two char cards and drop
//      the word "above" from its copy -> "pick a character".
//   4. Move the CREATE-WITH-AI caption ABOVE its button, text unchanged:
//      "design your own".
//   5. Move the LOGIN-NOSTR caption ABOVE its button AND change its copy
//      from "your character follows you" -> "regular players", reframing
//      the section as the returning-player path.
//   6. Add horizontal dividers between sections (below ENTER AS GUEST and
//      above "design your own"; below CREATE WITH AI and above "regular
//      players") styled in a japanese kamon + adventure + metaverse
//      aesthetic (thin ochre gradient hairline flanking a small orange
//      lozenge glyph).
//
// This file freezes those six changes. It intentionally does NOT duplicate
// v0.2.806 / v0.2.807 strip / band / overlay / backdrop-filter locks --
// those still run and still pass on their own; this file only covers the
// deltas introduced by v0.2.808.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('v0.2.808 — guest character cards shrunk 15%', () => {
  it('.char-card max-width is 136px (was 160px in v0.2.807, -15%)', () => {
    const rule = HTML.match(/\.char-card\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    expect(rule[0]).toMatch(/max-width:\s*136px/);
    // Anti-regression on the old value.
    expect(rule[0]).not.toMatch(/max-width:\s*160px/);
  });

  it('.char-picker gap tightened from 14px to 12px', () => {
    // Keeps the two cards visually a single unit at the smaller size,
    // matching the 15% shrink.
    const rule = HTML.match(/\.char-picker\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    expect(rule[0]).toMatch(/gap:\s*12px/);
    expect(rule[0]).not.toMatch(/gap:\s*14px/);
  });
});

describe('v0.2.808 — CTA buttons resized to identical 242px width', () => {
  it('#btn-enter-nap inline width is 242px (was 220px, +10%)', () => {
    // The button markup carries its own inline width -- neither the shared
    // .btn nor .btn-nap rule fixes a width. Locking the inline value keeps
    // it a single source of truth for the CTA size.
    const m = HTML.match(/id="btn-enter-nap"[^>]*style="([^"]*)"/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/width:\s*242px/);
    expect(m[1]).not.toMatch(/width:\s*220px/);
  });

  it('#btn-create-ai inline width is 242px and NO smaller-text overrides', () => {
    // v0.2.807 shipped `width:220px;font-size:10px;letter-spacing:2px;padding:10px;`
    // on this button, giving it a visibly smaller footprint than the guest
    // CTA. v0.2.808 drops those three overrides so it inherits the .btn
    // base sizing (font-size 13px, letter-spacing 3px, padding 11px 20px).
    const m = HTML.match(/id="btn-create-ai"[^>]*style="([^"]*)"/);
    expect(m).toBeTruthy();
    const style = m[1];
    expect(style).toMatch(/width:\s*242px/);
    expect(style).not.toMatch(/font-size\s*:\s*10px/);
    expect(style).not.toMatch(/letter-spacing\s*:\s*2px/);
    expect(style).not.toMatch(/padding\s*:\s*10px/);
  });

  it('#btn-nostr-centre inline width is 242px and NO smaller-text overrides', () => {
    // v0.2.809: margin-bottom:6px removed so all three CTAs have an
    // identical footprint (including trailing space). Height parity is
    // now purely a consequence of the .btn base padding + font sizing.
    const m = HTML.match(/id="btn-nostr-centre"[^>]*style="([^"]*)"/);
    expect(m).toBeTruthy();
    const style = m[1];
    expect(style).toMatch(/width:\s*242px/);
    expect(style).not.toMatch(/font-size\s*:\s*10px/);
    expect(style).not.toMatch(/letter-spacing\s*:\s*2px/);
    expect(style).not.toMatch(/padding\s*:\s*10px/);
    expect(style).not.toMatch(/margin-bottom/);
  });

  it('all three CTA button widths agree (identical footprint)', () => {
    // Cross-check that a future edit to one width has to touch all three.
    const widths = ['btn-enter-nap', 'btn-create-ai', 'btn-nostr-centre'].map((id) => {
      const m = HTML.match(new RegExp(`id="${id}"[^>]*style="([^"]*)"`));
      const w = m[1].match(/width:\s*(\d+)px/);
      return Number(w[1]);
    });
    expect(widths[0]).toBe(widths[1]);
    expect(widths[1]).toBe(widths[2]);
  });
});

describe('v0.2.808 — captions moved above their option + copy adjusted', () => {
  it('ENTER-AS-GUEST caption is "pick a character" and sits above the .char-picker', () => {
    // Copy: "above" dropped (the picker is now literally beneath it).
    expect(HTML).toMatch(/<span class="entry-caption" data-for="btn-enter-nap">pick a character<\/span>/);
    // Positional: the caption appears BEFORE the char-picker element,
    // AND before the button, all inside the same entry-option section.
    const section = HTML.match(/<section class="entry-option" aria-label="Enter as guest">[\s\S]*?<\/section>/);
    expect(section).toBeTruthy();
    const body = section[0];
    const captionIdx = body.indexOf('data-for="btn-enter-nap"');
    const pickerIdx  = body.indexOf('class="char-picker"');
    const buttonIdx  = body.indexOf('id="btn-enter-nap"');
    expect(captionIdx).toBeGreaterThan(-1);
    expect(pickerIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(captionIdx).toBeLessThan(pickerIdx);
    expect(captionIdx).toBeLessThan(buttonIdx);
    // Anti-regression on the old copy.
    expect(HTML).not.toMatch(/pick a character above/);
  });

  it('CREATE-WITH-AI caption is "design your own" and sits above its button', () => {
    expect(HTML).toMatch(/<span class="entry-caption" data-for="btn-create-ai">design your own<\/span>/);
    const section = HTML.match(/<section class="entry-option" aria-label="Create with AI">[\s\S]*?<\/section>/);
    expect(section).toBeTruthy();
    const body = section[0];
    const captionIdx = body.indexOf('data-for="btn-create-ai"');
    const buttonIdx  = body.indexOf('id="btn-create-ai"');
    expect(captionIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(captionIdx).toBeLessThan(buttonIdx);
  });

  it('LOGIN-NOSTR caption is "regular players" and sits above its button', () => {
    expect(HTML).toMatch(/<span class="entry-caption" data-for="btn-nostr-centre">regular players<\/span>/);
    const section = HTML.match(/<section class="entry-option" aria-label="Login with Nostr">[\s\S]*?<\/section>/);
    expect(section).toBeTruthy();
    const body = section[0];
    const captionIdx = body.indexOf('data-for="btn-nostr-centre"');
    const buttonIdx  = body.indexOf('id="btn-nostr-centre"');
    expect(captionIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(captionIdx).toBeLessThan(buttonIdx);
    // Anti-regression on the old copy.
    expect(HTML).not.toMatch(/your character follows you/);
  });
});

describe('v0.2.808 — horizontal dividers between sections', () => {
  it('the .torii-divider CSS rule exists and uses ochre gradient hairline + orange lozenge', () => {
    const rule = HTML.match(/\.torii-divider\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    // Display flex so the ::before/::after gradient hairlines flank the glyph.
    expect(rule[0]).toMatch(/display:\s*flex/);
    expect(rule[0]).toMatch(/align-items:\s*center/);
    expect(rule[0]).toMatch(/justify-content:\s*center/);
  });

  it('the .torii-divider::before and ::after are 1px ochre gradient hairlines fading at both ends', () => {
    // Both pseudo-elements use the shared linear-gradient(to right, ...)
    // with rgba(232,178,120,0) at 0% and 100% -- the divider blends into
    // the panel edges instead of hitting them as a hard line.
    const before = HTML.match(/\.torii-divider::before,\s*\n\s*\.torii-divider::after\s*\{[^}]*\}/s);
    expect(before).toBeTruthy();
    const body = before[0];
    expect(body).toMatch(/height:\s*1px/);
    expect(body).toMatch(/linear-gradient\(to right/);
    expect(body).toMatch(/rgba\(232,178,120,0\)\s*0%/);
    expect(body).toMatch(/rgba\(232,178,120,0\)\s*100%/);
    // Peak alpha somewhere in the middle so it reads as a line.
    expect(body).toMatch(/rgba\(232,178,120,0\.\d+\)/);
  });

  it('.torii-divider__glyph is a small orange lozenge (rotated square with glow)', () => {
    const rule = HTML.match(/\.torii-divider__glyph\s*\{[^}]*\}/s);
    expect(rule).toBeTruthy();
    const body = rule[0];
    expect(body).toMatch(/transform:\s*rotate\(45deg\)/);
    // Orange fill: #f7931a family.
    expect(body).toMatch(/rgba\(247,147,26,0\.\d+\)/);
    // Soft glow to give it the metaverse HUD / adventure crystal feel.
    expect(body).toMatch(/box-shadow:[\s\S]*rgba\(247,147,26,0\.\d+\)/);
  });

  it('exactly two .torii-divider elements exist inside the entry panel, in the right positions', () => {
    // One between enter-as-guest and create-with-ai, one between
    // create-with-ai and login-nostr. Positional locks: each divider
    // sits AFTER the previous section's closing tag and BEFORE the next
    // section's opening tag.
    const dividers = HTML.match(/<div class="torii-divider"[^>]*>[\s\S]*?<\/div>/g) || [];
    expect(dividers.length).toBe(2);

    const enterEnd  = HTML.indexOf('id="btn-enter-nap"');
    const createStart = HTML.indexOf('<section class="entry-option" aria-label="Create with AI">');
    const createEnd = HTML.indexOf('id="btn-create-ai"');
    const nostrStart = HTML.indexOf('<section class="entry-option" aria-label="Login with Nostr">');
    const divIdx = [];
    const rx = /<div class="torii-divider"/g;
    let m;
    while ((m = rx.exec(HTML)) !== null) divIdx.push(m.index);
    expect(divIdx.length).toBe(2);
    // Divider 1 sits between the guest section (after the button) and the
    // create-ai section (before its opening tag).
    expect(divIdx[0]).toBeGreaterThan(enterEnd);
    expect(divIdx[0]).toBeLessThan(createStart);
    // Divider 2 sits between the create-ai section and the login-nostr section.
    expect(divIdx[1]).toBeGreaterThan(createEnd);
    expect(divIdx[1]).toBeLessThan(nostrStart);
  });

  it('each .torii-divider carries the central .torii-divider__glyph child', () => {
    const dividers = HTML.match(/<div class="torii-divider"[^>]*>[\s\S]*?<\/div>/g) || [];
    for (const d of dividers) {
      expect(d).toMatch(/<span class="torii-divider__glyph"[^>]*><\/span>/);
    }
  });

  it('.torii-divider is hidden from screen readers (aria-hidden + presentation)', () => {
    // Sections and captions carry the accessible naming; the dividers are
    // purely visual grouping. Attrs are shipped as `aria-hidden="true"`
    // AND `role="presentation"` on each element.
    const dividers = HTML.match(/<div class="torii-divider"[^>]*>/g) || [];
    for (const d of dividers) {
      expect(d).toMatch(/aria-hidden="true"/);
      expect(d).toMatch(/role="presentation"/);
    }
  });
});
