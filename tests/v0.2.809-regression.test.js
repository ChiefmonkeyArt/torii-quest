// v0.2.809-alpha: unified CTA styling regression tests.
//
// Locks the invariants introduced when the three title-screen CTA buttons
// (ENTER AS GUEST, CREATE WITH AI, LOGIN NOSTR) were unified onto the
// transparent-outline base with a muted sage green hover + armed
// treatment. Kept together so a future edit that unpicks the shared
// styling fails with one clear signal instead of drifting silently
// across the ID rules.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Sage palette used across all three armed/hover treatments.
//   base fill:   rgba(77,122,58,*)   (#4d7a3a family)
//   accent edge: rgba(110,169,77,*)  (#6ea94d family)
const SAGE_FILL_RE = /rgba\(\s*77\s*,\s*122\s*,\s*58\s*,/;
const SAGE_EDGE_RE = /rgba\(\s*110\s*,\s*169\s*,\s*77\s*,/;

describe('v0.2.809-alpha: unified CTA styling', () => {
  describe('shared base', () => {
    it('all three CTAs share one selector list for the font-weight + transition base', () => {
      // A single rule keyed on all three IDs means a future edit has to
      // touch every CTA at once — no drift between them.
      expect(HTML).toMatch(
        /#btn-enter-nap\s*,\s*#btn-create-ai\s*,\s*#btn-nostr-centre\s*\{[^}]*font-weight:\s*bold[^}]*transition:/
      );
    });

    it('base transparent-outline treatment is shared across all three CTAs', () => {
      // Grep the shared selector that gives the unarmed state its
      // transparent bg + ochre outline + cream-ochre text.
      const sharedBase = HTML.match(
        /#btn-enter-nap\[data-armed="false"\]:not\(:hover\)\s*,\s*#btn-create-ai:not\(:hover\):not\(\[data-armed="true"\]\)\s*,\s*#btn-nostr-centre\[data-armed="false"\]:not\(:hover\)\s*\{([^}]*)\}/
      );
      expect(sharedBase).toBeTruthy();
      const body = sharedBase[1];
      expect(body).toMatch(/background:\s*transparent/);
      expect(body).toMatch(/border:\s*1px\s+solid\s+rgba\(232,178,120,0\.55\)/);
      expect(body).toMatch(/color:\s*#f4d5a8/);
    });

    it('LOGIN NOSTR button inline style no longer carries margin-bottom (height parity)', () => {
      // v0.2.808 kept margin-bottom:6px on the nostr button; v0.2.809
      // drops it so all three CTAs render at identical height AND stack
      // with identical spacing to the divider below.
      const m = HTML.match(/id="btn-nostr-centre"[^>]*style="([^"]*)"/);
      expect(m).toBeTruthy();
      expect(m[1]).not.toMatch(/margin-bottom/);
    });
  });

  describe('sage green hover (unarmed)', () => {
    it('CREATE WITH AI + LOGIN NOSTR-unarmed share the sage hover treatment', () => {
      // Guest button is pointer-events:none while unarmed so it never
      // reaches this rule. When ARMED, guest button uses the ARMED-hover
      // rule below.
      const hover = HTML.match(
        /#btn-create-ai:hover\s*,\s*#btn-nostr-centre\[data-armed="false"\]:hover\s*\{([^}]*)\}/
      );
      expect(hover).toBeTruthy();
      const body = hover[1];
      expect(body).toMatch(SAGE_FILL_RE);
      expect(body).toMatch(SAGE_EDGE_RE);
      expect(body).toMatch(/color:\s*#f4ecd0/);
      expect(body).toMatch(/box-shadow:/);
    });
  });

  describe('sage green armed (idle)', () => {
    it('guest + nostr armed-idle share the muted sage armed treatment', () => {
      const armed = HTML.match(
        /#btn-enter-nap\[data-armed="true"\]:not\(:hover\)\s*,\s*#btn-nostr-centre\[data-armed="true"\]:not\(:hover\)\s*\{([^}]*)\}/
      );
      expect(armed).toBeTruthy();
      const body = armed[1];
      expect(body).toMatch(SAGE_FILL_RE);
      expect(body).toMatch(SAGE_EDGE_RE);
      expect(body).toMatch(/color:\s*#f4ecd0/);
      expect(body).toMatch(/cursor:\s*pointer/);
    });

    it('no bright-lime relic (#22c55e/#16a34a/#eafff0) survives in armed CTAs', () => {
      // Anti-regression on the pre-v0.2.809 bright-green fill so a future
      // edit that resurrects it fails loudly.
      const window = HTML.split('/* ── v0.2.809-alpha:')[1] || '';
      const cutoff = window.split('/* ── v0.2.808-alpha: three-option')[0] || window;
      expect(cutoff).not.toMatch(/#22c55e/);
      expect(cutoff).not.toMatch(/#16a34a/);
      expect(cutoff).not.toMatch(/#eafff0/);
    });
  });

  describe('sage green armed (hover)', () => {
    it('guest-armed hover + nostr-armed hover share a stronger sage halo', () => {
      const armedHover = HTML.match(
        /#btn-enter-nap\[data-armed="true"\]:hover\s*,\s*#btn-nostr-centre\[data-armed="true"\]:hover\s*\{([^}]*)\}/
      );
      expect(armedHover).toBeTruthy();
      const body = armedHover[1];
      expect(body).toMatch(SAGE_FILL_RE);
      expect(body).toMatch(SAGE_EDGE_RE);
      // Stronger glow than armed-idle: two-stop shadow.
      expect(body).toMatch(/box-shadow:\s*[^;]*,\s*0 0/);
      expect(body).toMatch(/opacity:\s*1/);
    });
  });

  describe('inactive guest button is still click-blocked', () => {
    it('unarmed #btn-enter-nap sets opacity:0.55 + cursor:not-allowed + pointer-events:none', () => {
      // The visual moved from grey-slate to dimmed-transparent, but the
      // click-block must survive so the user cannot "enter" before they
      // have picked a character.
      const inactive = HTML.match(
        /#btn-enter-nap\[data-armed="false"\]\s*\{([^}]*)\}/
      );
      expect(inactive).toBeTruthy();
      const body = inactive[1];
      expect(body).toMatch(/opacity:\s*0\.55/);
      expect(body).toMatch(/cursor:\s*not-allowed/);
      expect(body).toMatch(/pointer-events:\s*none/);
    });
  });
});
