// tests/guest-character-picker.test.js — three-option login panel (v0.2.763-alpha).
//
// Static source contract: the title screen ships a guest character picker with
// two torso-thumbnail cards (nostrich / poo-poo-head) whose images are real
// on-disk assets, plus the Create-with-AI entry and the returning-player Nostr
// button. A silent id/asset-path/type would render a broken or dead card, so
// this freezes the structure + the referenced image files + the JS wiring. It
// also locks the headless-first-person-body fix: the FP body is chiefmonkey-only,
// so guest/nostrich no longer see chiefmonkey's teal body.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const FPB  = readFileSync(join(ROOT, 'src/firstPersonBody.js'), 'utf8');

describe('guest character picker — three-option login panel', () => {
  it('declares two selectable character cards (nostrich + poo-poo-head = guest)', () => {
    expect(HTML).toMatch(/data-char="nostrich"/);
    expect(HTML).toMatch(/data-char="guest"/);
    expect((HTML.match(/class="char-card/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('each card references its torso thumbnail, and the assets exist on disk', () => {
    expect(HTML).toContain('/ui/char-nostrich-torso.png');
    expect(HTML).toContain('/ui/char-guest-torso.png');
    expect(existsSync(join(ROOT, 'public/ui/char-nostrich-torso.png'))).toBe(true);
    expect(existsSync(join(ROOT, 'public/ui/char-guest-torso.png'))).toBe(true);
  });

  it('declares the Create-with-AI entry and the returning-player login button', () => {
    expect(HTML).toContain('id="btn-create-ai"');
    expect(HTML).toContain('id="btn-nostr-centre"');
  });

  it('main.js binds card selection and routes Create-with-AI to the Character Forge', () => {
    expect(MAIN).toMatch(/_selectGuestCharacter/);
    expect(MAIN).toMatch(/querySelectorAll\(\s*['"]\.char-card['"]\s*\)/);
    expect(MAIN).toMatch(/getElementById\(\s*['"]btn-create-ai['"]\s*\)/);
    expect(MAIN).toMatch(/openSettingsPanel\(\s*\{\s*initialTab:\s*['"]character['"]/);
  });

  it('firstPersonBody is character-aware — only chiefmonkey loads the headless FP body', () => {
    expect(FPB).toMatch(/getCharacter/);
    expect(FPB).toMatch(/!==\s*['"]chiefmonkey['"]/);
  });
});