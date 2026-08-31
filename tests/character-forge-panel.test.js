// tests/character-forge-panel.test.js — locks the Character Forge settings-tab
// renderer (src/engine/settings/characterForgePanel.js). Pure HTML-string
// renderer → fully node-testable, no DOM.
import { describe, it, expect } from 'vitest';
import { renderCharacterForgePanel } from '../src/engine/settings/characterForgePanel.js';

describe('renderCharacterForgePanel', () => {
  it('gates the tab behind login', () => {
    const html = renderCharacterForgePanel({ isLoggedIn: false });
    expect(html).toContain('Log in with Nostr');
    expect(html).not.toContain('select-preset');
  });

  it('shows the preset picker when logged in with no character', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'none',
      presets: [{ id: 'chiefmonkey', label: 'Chiefmonkey' }, { id: 'nostrich', label: 'Nostrich' }],
    });
    expect(html).toContain('data-action="select-preset"');
    expect(html).toContain('data-preset="chiefmonkey"');
    expect(html).toContain('Chiefmonkey');
    expect(html).toContain('Nostrich');
  });

  it('shows an empty state when no presets are available', () => {
    const html = renderCharacterForgePanel({ isLoggedIn: true, status: 'none', presets: [] });
    expect(html).toContain('No presets available');
  });

  it('shows the found summary when a character exists', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'found',
      character: { name: 'Chiefmonkey', meshName: 'chiefmonkey6', stickerCount: 3 },
    });
    expect(html).toContain('already has a character');
    expect(html).toContain('Chiefmonkey');
    expect(html).toContain('chiefmonkey6');
    expect(html).toContain('Edit character');
  });

  it('shows a retry affordance on failure', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'failed',
      error: 'relay unreachable',
    });
    expect(html).toContain('relay unreachable');
    expect(html).toContain('Retry');
  });

  it('escapes hostile text in the summary', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'found',
      character: { name: '<img src=x onerror=alert(1)>', meshName: 'm', stickerCount: 0 },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
