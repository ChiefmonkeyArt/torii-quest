// tests/v0.2.803-regression.test.js — locks the v0.2.882-alpha REWORK of the
// v0.2.803 "looking down as a logged-in npub shows the wrong feet" fix.
//
// History: v0.2.803 set `_pendingGuestChar = 'chiefmonkey'` on NOSTR_LOGIN so a
// manifest without a headlessHash still got a full-height FP body. That assumed
// the logged-in player IS chiefmonkey — so a SECOND real player whose character
// predates the headless field saw chiefmonkey's feet. v0.2.882-alpha reverts the
// fallback to the neutral 'guest' key AND authors the player's OWN headless
// variant on demand (see engine/character/authorOwnHeadless.js).
//
// Static source contract — no THREE/DOM harness — matches the v0.2.768 regression
// style. Pins BOTH halves so a refactor can't silently drop either one.
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
  const bodyStart = MAIN.indexOf('{', start + marker.length - 1);
  let depth = 0;
  for (let i = bodyStart; i < MAIN.length; i++) {
    const ch = MAIN[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return MAIN.slice(bodyStart + 1, i); }
  }
  throw new Error('NOSTR_LOGIN handler body did not close');
}

describe('v0.2.882 — logged-in player gets their OWN headless body, never chiefmonkey\'s', () => {
  it('firstPersonBody still prefers the custom headless URL over any built-in', () => {
    expect(FPBODY).toMatch(/const customUrl = getCustomHeadlessUrl\(\);/);
    expect(FPBODY).toMatch(/FP_BODIES\[getCharacter\(\)\]/);
    // The built-in map still has all three authored headless variants (guest is the
    // neutral fallback; chiefmonkey/nostrich remain for those explicit cards.)
    expect(FPBODY).toMatch(/chiefmonkey:\s*\{\s*file:\s*'\/chiefmonkey-headless\.glb'/);
    expect(FPBODY).toMatch(/guest:\s*\{\s*file:\s*'\/guest-headless\.glb'/);
  });

  it('the NOSTR_LOGIN handler resets the key to the neutral \'guest\' (not chiefmonkey)', () => {
    const body = loginHandlerBody();
    expect(body).toMatch(/_guestCharChosen\s*=\s*false/);
    expect(body).toMatch(/_pendingGuestChar\s*=\s*'guest'/);
    // The old chiefmonkey default must be GONE from the login handler.
    expect(body).not.toMatch(/_pendingGuestChar\s*=\s*'chiefmonkey'/);
  });

  it('the login handler wires the player\'s own headless via authorOwnHeadless', () => {
    // The on-demand authoring is imported and the apply path calls it. The import
    // itself is outside the handler body, so assert on the full module text.
    expect(MAIN).toMatch(/import\s*\{[^}]*authorOwnHeadless[^}]*\}\s*from\s*'\.\/engine\/character\/authorOwnHeadless\.js'/);
    expect(MAIN).toMatch(/authorOwnHeadless\(\{\s*meshUrl:\s*_ownCharacterMeshUrl\s*\}\)/);
  });

  it('the reset co-locates the guest reset with the mesh apply (guardrail)', () => {
    const body = loginHandlerBody();
    const guestIdx = body.indexOf("_guestCharChosen = false");
    const pendingIdx = body.indexOf("_pendingGuestChar = 'guest'");
    expect(guestIdx).toBeGreaterThanOrEqual(0);
    expect(pendingIdx).toBeGreaterThan(guestIdx);
    // _applyOwnCharacterMesh is still invoked so the player's own mesh seats.
    expect(body).toMatch(/_applyOwnCharacterMesh\(\);/);
  });
});