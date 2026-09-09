// tests/character-forge-panel.test.js — locks the Character Forge settings-tab
// renderer (src/engine/settings/characterForgePanel.js). Pure HTML-string
// renderer → fully node-testable, no DOM.
import { describe, it, expect } from 'vitest';
import { renderCharacterForgePanel } from '../src/engine/settings/characterForgePanel.js';

describe('renderCharacterForgePanel', () => {
  it('shows the create cards + sign-in banner when logged out (no roster, buttons enabled)', () => {
    // The preset roster (Chiefmonkey/Nostrich) and the logged-out disabled gate
    // were removed: the tab now shows only the always-enabled Upload + AI cards
    // behind a "Sign in with Nostr" banner.
    const html = renderCharacterForgePanel({ isLoggedIn: false });
    expect(html).toContain('Sign in with Nostr');
    expect(html).not.toContain('cf-preset-card');
    expect(html).not.toContain('data-action="select-preset"');
    // Upload + AI cards render, and their buttons are NOT disabled
    expect(html).toContain('data-action="upload-mesh"');
    expect(html).not.toMatch(/data-action="upload-mesh"[^>]*disabled/);
    expect(html).toContain('data-action="generate-ai"');
    expect(html).not.toMatch(/data-action="generate-ai"[^>]*disabled/);
  });

  it('shows only the create paths (Upload + AI) when logged in with no character', () => {
    const html = renderCharacterForgePanel({ isLoggedIn: true, status: 'none' });
    expect(html).toContain('data-action="upload-mesh"');
    expect(html).toContain('data-action="generate-ai"');
    // no Chiefmonkey/Nostrich roster cards remain
    expect(html).not.toContain('cf-preset-card');
    expect(html).not.toContain('data-action="select-preset"');
    expect(html).not.toContain('Chiefmonkey');
    expect(html).not.toContain('Nostrich');
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
    expect(html).toContain('data-action="replace-character"');
    expect(html).toContain('Replace character');
    // Stickers moved to their own tab (v0.2.795-alpha) — no sticker editor here.
    expect(html).not.toContain('Edit stickers');
    expect(html).not.toContain('data-action="add-sticker"');
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
  // paths on the SELECT + CREATE screen. Create-with-AI is now LIVE (Step C,
  // ADR-0091): it renders a prompt box + a "Generate" action (main.js wires it to
  // requestMeshGeneration → the server-side Meshy proxy), while Upload is a real
  // .glb file picker.
  it('renders separated Upload and Create-with-AI (live) cards on the create screen', () => {
    const html = renderCharacterForgePanel({
      isLoggedIn: true,
      status: 'none',
    });
    expect(html).toContain('Upload a character');
    expect(html).toContain('data-action="upload-mesh"');
    expect(html).not.toMatch(/data-action="upload-mesh"[^>]*disabled/);
    expect(html).toContain('Create with AI');
    expect(html).toContain('id="cf-ai-prompt"');
    expect(html).toContain('data-action="generate-ai"');
    expect(html).toContain('Generate');
    expect(html).not.toMatch(/data-action="generate-ai"[^>]*disabled/);
    expect(html.toLowerCase()).toContain('meshy text-to-3d');
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

    it('maps no-session-token to a "Sign in to generate" message (not a bare error)', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: false,
        status: 'none',
        ai: { status: 'done', prompt: 'x', result: { ok: false, message: 'no-session-token' } },
      });
      expect(html).toContain('Sign in to generate');
      expect(html).toContain('Nostr session');
      expect(html).not.toContain('no-session-token');
    });

    it('maps generator-unavailable to a clear offline message', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: { status: 'done', prompt: 'x', result: { ok: false, message: 'generator unavailable' } },
      });
      expect(html).toContain('Generator is offline');
      expect(html).toContain('Meshy API key');
    });

    it('falls back to showing the raw message for an unknown error', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: { status: 'done', prompt: 'x', result: { ok: false, message: 'relay unreachable' } },
      });
      expect(html).toContain('Something went wrong');
      expect(html).toContain('relay unreachable');
    });

    it('keeps the create view when the ai state is idle', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'none',
        ai: { status: 'idle', prompt: '', result: null },
      });
      expect(html).toContain('data-action="generate-ai"');
      expect(html).not.toContain('data-action="ai-reset"');
    });
  });

  describe('upload rig verdict (validator-first)', () => {
    it('shows "Rig OK" for a riggable mesh during upload (creating)', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'creating',
        rig: { verdict: 'riggable', convention: 'mixamo', boneCount: 18, note: '' },
      });
      expect(html).toContain('cf-rig');
      expect(html).toContain('cf-rig-ok');
      expect(html).toContain('Rig OK');
      expect(html).toContain('mixamo');
      expect(html).toContain('18 bones');
      expect(html).not.toContain('cf-rig-warn');
    });

    it('shows "Rig warning" for a partial rig during upload', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'creating',
        rig: { verdict: 'partial', convention: 'mixamo', boneCount: 10, note: 'Missing required roles: Head.' },
      });
      expect(html).toContain('cf-rig-warn');
      expect(html).toContain('Rig warning');
      expect(html).toContain('Missing required roles: Head.');
      expect(html).not.toContain('cf-rig-ok');
    });

    it('shows "no bones" for an unrigged mesh during upload', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'creating',
        rig: { verdict: 'no-bones', convention: '', boneCount: 0, note: 'No bones found — the mesh is unrigged/static.' },
      });
      expect(html).toContain('cf-rig-warn');
      expect(html).toContain('Rig warning');
      expect(html).toContain('no bones');
    });

    it('surfaces the rig verdict in the found summary card', () => {
      const html = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'found',
        character: { name: 'Fox Knight', meshName: 'fox.glb', stickerCount: 0, stickers: [] },
        rig: { verdict: 'riggable', convention: 'mixamo', boneCount: 18, note: '' },
      });
      expect(html).toContain('cf-rig');
      expect(html).toContain('Rig OK');
      expect(html).toContain('mixamo');
    });

    it('renders no rig line when no verdict is present', () => {
      const checking = renderCharacterForgePanel({ isLoggedIn: true, status: 'checking' });
      expect(checking).not.toContain('cf-rig');
      const found = renderCharacterForgePanel({
        isLoggedIn: true,
        status: 'found',
        character: { name: 'N', meshName: 'm', stickerCount: 0, stickers: [] },
      });
      expect(found).not.toContain('cf-rig');
    });
  });
});
