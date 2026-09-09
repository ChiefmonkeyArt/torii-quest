// tests/v0.2.803-regression.test.js — locks the v0.2.803-alpha fix for "looking
// down as a logged-in npub still shows poo-poo-head's yellow feet".
//
// Repro: fresh load → tap the poo-poo-head guest card → log in as an npub whose
// kind-35100 manifest has no `mesh.headlessHash` → enter → look down. The v0.2.800
// login handler cleared `_guestCharChosen` so the world mesh loaded the player's
// own model, but `_pendingGuestChar` was still 'guest'. `getCharacter()` therefore
// returned 'guest' and the FP body fell back to FP_BODIES['guest'] =
// guest-headless.glb (the yellow poo-poo-head torso) — so looking down showed
// yellow cartoon feet while the world model rendered the player's own character.
//
// Fix: NOSTR_LOGIN also resets `_pendingGuestChar = 'chiefmonkey'` so a manifest
// without a headlessHash falls back to the full-height built-in headless. Static
// source contract — no THREE/DOM harness — matches the v0.2.768 regression style.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const FPBODY = readFileSync(join(ROOT, 'src/firstPersonBody.js'), 'utf8');

// Pull out the NOSTR_LOGIN handler body so assertions can't drift into other
// on(EV.NOSTR_LOGIN, ...) subscribers elsewhere in main.js.
function loginHandlerBody() {
  const marker = "on(EV.NOSTR_LOGIN, () => {";
  const start = MAIN.indexOf(marker);
  if (start < 0) throw new Error('primary NOSTR_LOGIN handler not found');
  // Balance braces from the opening `{` after the arrow.
  const bodyStart = MAIN.indexOf('{', start + marker.length - 1);
  let depth = 0;
  for (let i = bodyStart; i < MAIN.length; i++) {
    const ch = MAIN[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return MAIN.slice(bodyStart + 1, i); }
  }
  throw new Error('NOSTR_LOGIN handler body did not close');
}

describe('v0.2.803 — logged-in npub falls back to full-height FP body, not the guest torso', () => {
  it('firstPersonBody still keys the built-in FP body on getCharacter()', () => {
    // The bug relies on this fallback path. If it ever changes shape the fix
    // needs re-thinking, so the test pins the current contract.
    expect(FPBODY).toMatch(/const customUrl = getCustomHeadlessUrl\(\);/);
    expect(FPBODY).toMatch(/FP_BODIES\[getCharacter\(\)\]/);
    expect(FPBODY).toMatch(/chiefmonkey:\s*\{\s*file:\s*'\/chiefmonkey-headless\.glb'/);
    expect(FPBODY).toMatch(/guest:\s*\{\s*file:\s*'\/guest-headless\.glb'/);
  });

  it('the NOSTR_LOGIN handler resets _pendingGuestChar to a full-height built-in', () => {
    const body = loginHandlerBody();
    expect(body).toMatch(/_guestCharChosen\s*=\s*false/);
    expect(body).toMatch(/_pendingGuestChar\s*=\s*'chiefmonkey'/);
  });

  it('the reset lives in the primary NOSTR_LOGIN handler (not a later subscriber)', () => {
    // Guardrail: the fix must be co-located with the guest-flag reset so a
    // future refactor of that block cannot accidentally drop it.
    const body = loginHandlerBody();
    const guestIdx = body.indexOf("_guestCharChosen = false");
    const pendingIdx = body.indexOf("_pendingGuestChar = 'chiefmonkey'");
    expect(guestIdx).toBeGreaterThanOrEqual(0);
    expect(pendingIdx).toBeGreaterThan(guestIdx);
  });
});