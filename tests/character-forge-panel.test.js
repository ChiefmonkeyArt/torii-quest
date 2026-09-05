// tests/character-forge-panel.test.js — locks the Character Forge settings-tab
// renderer (src/engine/settings/characterForgePanel.js). Pure HTML-string
// renderer → fully node-testable, no DOM.
import { describe, it, expect } from 'vitest';
import { renderCharacterForgePanel } from '../src/engine/settings/characterForgePanel.js';

describe('renderCharacterForgePanel', () => {
  it('shows a preview (presets + create cards) and a sign-in banner when logged out', () => {
    // v0.2.739: the tab renders the SAME preview shell logged-out as logged-out
    // — preset grid + Upload + Create-with-AI cards are visible so the player
    // can see what's on offer — but every action button is disabled behind a
    // "Sign in with Nostr to save your character" banner. Nothing is written
    // until they log in.
    const html = renderCharacterForgePanel({
      isLoggedIn: false,
      presets: [{ id: 'chiefmonkey', label: 'Chiefmonkey' }, { id: 'nostrich', label: 'Nostrich' }],
    });
    expect(html).toContain('Sign in with Nostr');
    expect(html).toContain('cf-preset-card');
    // gated: every action button is disabled while logged out
    expect(html).toMatch(/data-action="select-preset"[^>]*disabled/);
    expect(html).toMatch(/data-action="upload-mesh"[^>]*disabled/);
    expect(html).toMatch(/data-action="generate-ai"[^>]*disabled/);
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
    expect(html).toContain('already have a character');
    expect(html).toContain('Chiefmonkey');
    expect(html).toContain('chiefmonkey6');
    expect(html).toContain('Edit stickers');
  });

  it('renders the sticker editor in edit mode', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'found',
      mode: 'edit',
      character: {
        name: 'Chiefmonkey',
        meshName: 'chiefmonkey6',
        stickerCount: 1,
        stickers: [{ hash: 'c'.repeat(64), zoneId: 'torso', u: 0.5, v: 0.5, rot: 0 }],
      },
      stickerLibrary: [{ id: 'ftff', label: 'Torii sticker' }],
    });
    expect(html).toContain('data-action="remove-sticker"');
    expect(html).toContain('data-index="0"');
    expect(html).toContain('torso');
    expect(html).toContain('data-action="add-sticker"');
    expect(html).toContain('data-sticker="ftff"');
    expect(html).toContain('Torii sticker');
    expect(html).toContain('data-action="done-edit"');
  });

  it('shows an empty sticker state in edit mode with none placed', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'found',
      mode: 'edit',
      character: { name: 'N', meshName: 'm', stickerCount: 0, stickers: [] },
      stickerLibrary: [],
    });
    expect(html).toContain('No stickers yet');
    expect(html).toContain('No stickers available');
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

  // Upload + Create-with-AI are two clearly separated, fully-framed creation
  // paths on the SELECT + CREATE screen. Create-with-AI is now a LOCAL MOCK
  // generator (Step B — no backend/signing): it renders a prompt box + a
  // "Generate demo" action (main.js wires it to runMockGeneration), while
  // Upload stays a real, clickable action.
  it('renders separated Upload and Create-with-AI (mock) cards on the create screen', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'none',
      presets: [{ id: 'chiefmonkey', label: 'Chiefmonkey' }],
    });
    expect(html).toContain('Upload a character');
    expect(html).toContain('data-action="upload-mesh"');
    expect(html).not.toMatch(/data-action="upload-mesh"[^>]*disabled/);
    expect(html).toContain('Create with AI');
    expect(html).toContain('id="cf-ai-prompt"');
    expect(html).toContain('data-action="generate-ai"');
    expect(html).toContain('Generate demo');
    expect(html).not.toMatch(/data-action="generate-ai"[^>]*disabled/);
    expect(html.toLowerCase()).toContain('demo preview');
  });

  describe('Create-with-AI mock flow (ai sub-state)', () => {
    it('renders the thinking state while running', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: { status: 'running', prompt: 'a fox knight', result: null },
      });
      expect(html).toContain('Generating character');
      expect(html).not.toContain('data-action="generate-ai"');
    });

    it('renders the accepted verdict when done', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: {
          status: 'done',
          prompt: 'a fox knight',
          result: { planned: true, mode: 'mock', verdict: { accepted: true, rigConvention: 'generic', rigBoneCount: 22, reasons: [] } },
        },
      });
      expect(html).toContain('Validated');
      expect(html).toContain('generic');
      expect(html).toContain('22 bones');
      expect(html).toContain('data-action="ai-reset"');
    });

    it('renders the rejected verdict when the gate fails', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: {
          status: 'done',
          prompt: 'x',
          result: { planned: true, mode: 'mock', verdict: { accepted: false, reasons: ['manifest: mesh is required'] } },
        },
      });
      expect(html).toContain('Rejected');
      expect(html).toContain('manifest: mesh is required');
      expect(html).toContain('Try again');
    });

    it('renders an invalid-prompt state when planned is false', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: { status: 'done', prompt: '', result: { planned: false, reason: 'invalid-request' } },
      });
      expect(html).toContain("Couldn't start");
      expect(html).toContain('Try again');
    });

    it('keeps the create view when the ai state is idle', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        presets: [{ id: 'chiefmonkey', label: 'Chiefmonkey' }],
        ai: { status: 'idle', prompt: '', result: null },
      });
      expect(html).toContain('data-action="generate-ai"');
      expect(html).not.toContain('data-action="ai-reset"');
    });
  });
});
