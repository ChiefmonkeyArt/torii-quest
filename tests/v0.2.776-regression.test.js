// @vitest-environment jsdom
// tests/v0.2.776-regression.test.js — three-option entry panel copy + state
// machine (Bug I) and settings-panel close-X safety net (Bug J).
//
// Bug I (user report): "on the homescreen instead of '1. New Player' change to
// '1. Enter as Guest'. Do not have either button highlighted, not nostrich, not
// poo poo head. Only after a guest selects their character then the button
// should turn green and the text on it should read 'Enter'. Also on their 3rd
// option the button should read 'Login Nostr'. Then after someone has
// confirmed with their signer (or alternative) the button should turn green
// and say 'Enter'."
//
// Bug J (user report): "after clicking on the Create Character button and
// checking out that screen at some point i clicked off it and it froze in the
// state as seen in the attached screenshot... the settings popup half
// disappeared". The settings panel had NO explicit close control (backdrop
// click + ESC only), and when the layout half-broke there was no discoverable
// way to dismiss it. This freezes the always-visible ✕ close button that ships
// as a safety net regardless of the panel's layout state.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  openSettingsPanel, closeSettingsPanel, isSettingsPanelOpen, _resetForTest,
} from '../src/engine/settings/settingsPanel.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const BOOT = readFileSync(join(ROOT, 'src/engine/ui/loginBootstrap.js'), 'utf8');
const PANEL = readFileSync(join(ROOT, 'src/engine/settings/settingsPanel.js'), 'utf8');

describe('v0.2.776 — Bug I: three-option entry panel copy + arm-state', () => {
  it('option 1 title reads "ENTER AS GUEST" (renamed from NEW PLAYER)', () => {
    // The section heading is the user-visible label above the character
    // cards. Freezing the exact string prevents a silent regression to
    // "NEW PLAYER" or a variant like "GUEST ENTRY".
    expect(HTML).toMatch(/<span class="entry-num">1<\/span>\s*ENTER AS GUEST/);
    expect(HTML).not.toMatch(/<span class="entry-num">1<\/span>\s*NEW PLAYER/);
  });

  it('option 3 title reads "LOGIN NOSTR" (renamed from RETURNING?)', () => {
    expect(HTML).toMatch(/<span class="entry-num">3<\/span>\s*LOGIN NOSTR/);
    expect(HTML).not.toMatch(/<span class="entry-num">3<\/span>\s*RETURNING\?/);
  });

  it('LOGIN button copy is "⚡ LOGIN NOSTR" (dropped the "WITH ")', () => {
    // The v0.2.775 button read "⚡ LOGIN WITH NOSTR". The v0.2.776 rename
    // drops "WITH " so the label matches the section title and reads more
    // like a CTA.
    expect(HTML).toMatch(/id="btn-nostr-centre"[^>]*>⚡ LOGIN NOSTR</);
    expect(HTML).not.toMatch(/⚡ LOGIN WITH NOSTR/);
  });

  it('neither character card is pre-selected (no aria-checked="true" default)', () => {
    // The v0.2.775 markup shipped POO POO HEAD as pre-selected
    // (class="char-card selected" aria-checked="true") which the user
    // objected to — the picker must start neutral so the choice is a
    // deliberate act. Both cards ship aria-checked="false" and no
    // "selected" class in the initial markup.
    const cards = HTML.match(/<button[^>]*class="char-card[^"]*"[^>]*>/g) || [];
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card).toMatch(/aria-checked="false"/);
      expect(card).not.toMatch(/class="char-card[^"]*\bselected\b/);
    }
  });

  it('ENTER-AS-GUEST button ships inactive: data-armed="false" + disabled + aria-disabled', () => {
    // Defence in depth: CSS ([data-armed="false"] { pointer-events:none })
    // + native disabled + aria-disabled ensure the button cannot fire the
    // boot handler before the user has picked a character. Any ONE of these
    // being missing would let the button click through.
    const btn = HTML.match(/<button[^>]*id="btn-enter-nap"[^>]*>/)?.[0] || '';
    expect(btn).toMatch(/data-armed="false"/);
    expect(btn).toMatch(/\bdisabled\b/);
    expect(btn).toMatch(/aria-disabled="true"/);
    // Initial label is "ENTER AS GUEST" — the button relabels to "ENTER"
    // only after main.js _armGuestEnterButton() fires.
    const idx = HTML.indexOf('id="btn-enter-nap"');
    const around = HTML.slice(idx, idx + 260);
    expect(around).toMatch(/>ENTER AS GUEST</);
  });

  it('LOGIN-NOSTR button ships unarmed: data-armed="false", no green treatment yet', () => {
    const btn = HTML.match(/<button[^>]*id="btn-nostr-centre"[^>]*>/)?.[0] || '';
    expect(btn).toMatch(/data-armed="false"/);
    // Not disabled — an unarmed login button is still clickable (it runs
    // the actual Nostr login handshake). data-armed just governs styling
    // + the on-click routing branch.
    expect(btn).not.toMatch(/\bdisabled\b/);
  });

  it('CSS drives the armed/inactive treatment declaratively from [data-armed]', () => {
    // Two style blocks per button — one for the unarmed grey/outline
    // treatment, one for the armed solid-green ENTER treatment. Freezes
    // the "styling is state-driven, not class-driven" invariant so a
    // manual DOM class toggle can't drift from the source of truth.
    expect(HTML).toMatch(/#btn-enter-nap\[data-armed="false"\]/);
    expect(HTML).toMatch(/#btn-enter-nap\[data-armed="true"\]/);
    expect(HTML).toMatch(/#btn-nostr-centre\[data-armed="false"\]/);
    expect(HTML).toMatch(/#btn-nostr-centre\[data-armed="true"\]/);
    // Armed treatment uses the on-brand green (matches ENTER-ARENA elsewhere).
    expect(HTML).toMatch(/#btn-enter-nap\[data-armed="true"\][^{}]*\{[^}]*#22c55e/);
    expect(HTML).toMatch(/#btn-nostr-centre\[data-armed="true"\][^{}]*\{[^}]*#22c55e/);
  });

  it('main.js exposes _armGuestEnterButton() called from _selectGuestCharacter()', () => {
    // The card-tap → armed transition is the pivot of the whole state
    // machine. Freezing the call site + the DOM side-effects it performs
    // (data-armed, aria-disabled, label swap) so a refactor can't quietly
    // drop the arm-on-select step.
    expect(MAIN).toMatch(/function _armGuestEnterButton\(\)/);
    expect(MAIN).toMatch(/_selectGuestCharacter[\s\S]{0,600}_armGuestEnterButton\(\)/);
    // Arming sets data-armed="true", removes disabled, and relabels.
    const armBody = MAIN.match(/function _armGuestEnterButton\(\)[\s\S]{0,400}\}/)?.[0] || '';
    expect(armBody).toMatch(/dataset\.armed\s*=\s*['"]true['"]/);
    expect(armBody).toMatch(/removeAttribute\(\s*['"]disabled['"]\s*\)/);
    expect(armBody).toMatch(/setAttribute\(\s*['"]aria-disabled['"]\s*,\s*['"]false['"]\s*\)/);
    expect(armBody).toMatch(/textContent\s*=\s*['"]ENTER['"]/);
  });

  it('loginBootstrap.js arms the login button on EV.NOSTR_LOGIN', () => {
    // Login-side arm-on-success: listens to EV.NOSTR_LOGIN (fired by
    // nostrLogin() right after state.nostrPubkey is set) so the flip is
    // driven by the SAME event that unlocks travel + reveals the gateway,
    // not a separate DOM inspection.
    expect(BOOT).toMatch(/import\s*\{[^}]*\bon\b[^}]*\bEV\b[^}]*\}\s*from\s*['"][^'"]+events\.js['"]/);
    expect(BOOT).toMatch(/on\(\s*EV\.NOSTR_LOGIN\s*,/);
    expect(BOOT).toMatch(/function armLoginEnterButton\(/);
    // Arming sets data-armed="true" and relabels to "ENTER".
    const armBody = BOOT.match(/function armLoginEnterButton\([\s\S]{0,800}\}/)?.[0] || '';
    // setAttribute is used (not dataset.armed) so fake DOM test doubles
    // don't crash the login round-trip on emit(EV.NOSTR_LOGIN). Either form
    // is accepted here so a future refactor to dataset (once fakes update)
    // still passes.
    expect(armBody).toMatch(/setAttribute\(\s*['"]data-armed['"]\s*,\s*['"]true['"]\s*\)|dataset\.armed\s*=\s*['"]true['"]/);
    expect(armBody).toMatch(/textContent\s*=\s*['"]ENTER['"]/);
  });

  it('armed LOGIN button routes to the shared enter-arena boot function', () => {
    // Both entry buttons must land in the SAME _bootArena code path so
    // the v0.2.775 dupe-boot guard + self-heal wraps both. main.js
    // exposes window.__toriiEnterArenaFromTitle for the login handler.
    expect(MAIN).toMatch(/window\.__toriiEnterArenaFromTitle\s*=\s*(?:function\s+_enterArenaFromTitle|_enterArenaFromTitle)/);
    expect(BOOT).toMatch(/window\.__toriiEnterArenaFromTitle/);
    // Guarded on typeof === 'function' so a missing shell doesn't crash.
    expect(BOOT).toMatch(/typeof enter\s*===?\s*['"]function['"]/);
  });

  it('_selectGuestCharacter still rejects unknown character ids (defence in depth)', () => {
    // Regression guard so the arm-on-select branch can't be tricked into
    // arming by an unrecognised data-char attribute (which would seat
    // '_pendingGuestChar' with garbage and boot with a broken mesh).
    const body = MAIN.match(/function _selectGuestCharacter\([\s\S]{0,600}\}/)?.[0] || '';
    expect(body).toMatch(/char\s*!==\s*['"]guest['"]\s*&&\s*char\s*!==\s*['"]nostrich['"]\s*\)\s*return/);
  });
});

describe('v0.2.776 — Bug J: settings panel always-visible ✕ close (safety net)', () => {
  beforeEach(() => {
    _resetForTest();
    document.body.innerHTML = '';
  });

  it('panel source declares an always-visible close-X button (source-level lock)', () => {
    // Frozen at source so the safety-net button can't be silently deleted.
    // Belt-and-braces: the DOM assertion below catches runtime removal too.
    expect(PANEL).toMatch(/className\s*=\s*['"]ts-close-x['"]/);
    expect(PANEL).toMatch(/data-action['\s]*=?\s*['"]close-settings-panel['"]|dataset\.action\s*=\s*['"]close-settings-panel['"]/);
    expect(PANEL).toMatch(/aria-label['\s]*=?\s*['"]Close settings['"]|['"]Close settings['"]/);
    // The click handler closes via closeSettingsPanel (the canonical API,
    // idempotent, fires the onClose callback).
    expect(PANEL).toMatch(/closeBtn\.addEventListener\(\s*['"]click['"][\s\S]{0,120}closeSettingsPanel\(\)/);
  });

  it('opening the panel renders the ✕ close button inside the card', () => {
    openSettingsPanel({ initialTab: 'character' });
    expect(isSettingsPanelOpen()).toBe(true);
    const x = document.querySelector('.ts-close-x');
    expect(x).toBeTruthy();
    expect(x.textContent).toBe('✕');
    expect(x.getAttribute('aria-label')).toBe('Close settings');
  });

  it('clicking the ✕ closes the panel (no dependency on backdrop hit-test)', () => {
    // The reported freeze was a backdrop-click that missed (layout half-
    // broken). The ✕ closes via its own listener → closeSettingsPanel(),
    // so it works even if the backdrop click delegation is broken.
    openSettingsPanel({ initialTab: 'character' });
    expect(isSettingsPanelOpen()).toBe(true);
    document.querySelector('.ts-close-x').click();
    expect(isSettingsPanelOpen()).toBe(false);
  });

  it('the ✕ is absolutely positioned + high z-index so it survives a broken flex layout', () => {
    // Explicit style ties: if the nav column vanishes or the card's flex
    // layout collapses (as in the frozen-modal screenshot), the ✕ still
    // renders at the top-right corner of the card via absolute positioning
    // + a z-index above the card content (200 = backdrop, 210 = X).
    openSettingsPanel({ initialTab: 'character' });
    const x = document.querySelector('.ts-close-x');
    expect(x.style.position).toBe('absolute');
    expect(Number(x.style.zIndex || 0)).toBeGreaterThanOrEqual(210);
    // Card must be positioned so the absolute X anchors to it, not the viewport.
    const card = document.getElementById('torii-settings-panel');
    expect(card.style.position).toBe('relative');
  });

  it('closing via ✕ still invokes the onClose callback so the host can resume play', () => {
    let closed = 0;
    openSettingsPanel({ initialTab: 'character', onClose: () => { closed += 1; } });
    document.querySelector('.ts-close-x').click();
    expect(closed).toBe(1);
    // Second close is a no-op (panel already closed) — must not re-fire onClose.
    closeSettingsPanel();
    expect(closed).toBe(1);
  });

  it('ESC-to-close still works (unchanged from prior behaviour — ✕ is additive, not a replacement)', () => {
    openSettingsPanel({ initialTab: 'character' });
    expect(isSettingsPanelOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    expect(isSettingsPanelOpen()).toBe(false);
  });

  it('clicking INSIDE the card (but not the ✕) does NOT close the panel', () => {
    openSettingsPanel({ initialTab: 'character' });
    // A click on the nav or content area (not the backdrop, not the X)
    // must be an inert no-op re: panel visibility — the panel closes only
    // via the explicit close controls.
    document.querySelector('.ts-nav').click();
    expect(isSettingsPanelOpen()).toBe(true);
    document.getElementById('torii-settings-content').click();
    expect(isSettingsPanelOpen()).toBe(true);
  });
});
