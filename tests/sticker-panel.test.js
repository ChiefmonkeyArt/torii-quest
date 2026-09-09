// tests/sticker-panel.test.js — locks the Stickers settings-tab renderer
// (src/engine/settings/stickerPanel.js). Pure HTML-string renderer → fully
// node-testable, no DOM.
import { describe, it, expect } from 'vitest';
import { renderStickerPanel } from '../src/engine/settings/stickerPanel.js';

describe('renderStickerPanel', () => {
  it('shows a sign-in gate when logged out', () => {
    const html = renderStickerPanel({ isLoggedIn: false, library: [], ownedCount: 0 });
    expect(html).toContain('Sign in with Nostr');
  });

  it('lists the injected sticker library with label + zone', () => {
    const html = renderStickerPanel({
      isLoggedIn: true,
      library: [{ id: 'ftff', label: 'Torii sticker', hash: 'a'.repeat(64), recommendedZone: 'torso' }],
      ownedCount: 2,
    });
    expect(html).toContain('Torii sticker');
    expect(html).toContain('torso');
    expect(html).toContain('2'); // owned count value
  });

  it('shows an empty state when the library is empty', () => {
    const html = renderStickerPanel({ isLoggedIn: true, library: [], ownedCount: 0 });
    expect(html).toContain('No stickers available');
  });

  it('escapes hostile sticker labels', () => {
    const html = renderStickerPanel({
      isLoggedIn: true,
      library: [{ id: 'x', label: '<img src=x onerror=alert(1)>', hash: '', recommendedZone: '' }],
      ownedCount: 0,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});