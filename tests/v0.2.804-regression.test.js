// tests/v0.2.804-regression.test.js — locks the v0.2.804-alpha fix for
// "logged-in npub clicks the LOGIN-NOSTR/ENTER surface but enters as the last
// guest character".
//
// Repro: log in as chiefmonkey npub → enter → exit; then either the user was
// previously a guest with nostrich in this session OR they tap a guest torso
// card between exits. Clicking the LOGIN-NOSTR button (armed to "ENTER" via
// loginBootstrap.js) routes into window.__toriiEnterArenaFromTitle. Before the
// fix that function just clicked the guest ENTER button, seating whatever
// _pendingGuestChar the last guest interaction left behind — so the player
// entered as nostrich (or poo-poo-head) even though the button represents the
// logged-in npub identity. NOSTR_LOGIN only fires on the FIRST login of the
// session, so its guest-reset (v0.2.800 + v0.2.803) never re-runs on later
// clicks.
//
// Fix: __toriiEnterArenaFromTitle now enforces the logged-in-npub character
// path when state.nostrPubkey is a valid 64-hex — resets _guestCharChosen and
// _pendingGuestChar to the full-height built-in and deselects the guest cards
// before delegating into the shared boot. Guarded by the 64-hex check so a
// genuine guest ENTER (button not yet armed) is unchanged. Static source
// contract — no THREE/DOM harness — matches the v0.2.803 regression style.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');

// Pull out the __toriiEnterArenaFromTitle body so assertions can't drift into
// other window handlers.
function enterArenaFromTitleBody() {
  const marker = '__toriiEnterArenaFromTitle = function _enterArenaFromTitle() {';
  const start = MAIN.indexOf(marker);
  if (start < 0) throw new Error('__toriiEnterArenaFromTitle not found');
  const bodyStart = MAIN.indexOf('{', start + marker.length - 1);
  let depth = 0;
  for (let i = bodyStart; i < MAIN.length; i++) {
    const ch = MAIN[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return MAIN.slice(bodyStart + 1, i); }
  }
  throw new Error('__toriiEnterArenaFromTitle body did not close');
}

describe('v0.2.804 — LOGIN-NOSTR/ENTER surface enforces the logged-in npub character', () => {
  it('guards the enforcement on a valid 64-hex nostrPubkey', () => {
    const body = enterArenaFromTitleBody();
    // A 64-hex regex against state.nostrPubkey — matches the same guard used
    // elsewhere so genuine guest ENTER (no login) is unchanged.
    expect(body).toMatch(/\/\^\[0-9a-f\]\{64\}\$\/\.test\(state\?\.nostrPubkey\s*\|\|\s*''\)/);
  });

  it('resets _guestCharChosen + _pendingGuestChar to a full-height built-in inside the guard', () => {
    const body = enterArenaFromTitleBody();
    // Both resets must live inside the guarded block, otherwise the guest ENTER
    // path would lose the guest pick too.
    const guardIdx = body.indexOf("state?.nostrPubkey");
    const guestFalseIdx = body.indexOf("_guestCharChosen = false");
    const pendingIdx = body.indexOf("_pendingGuestChar = 'chiefmonkey'");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(guestFalseIdx).toBeGreaterThan(guardIdx);
    expect(pendingIdx).toBeGreaterThan(guardIdx);
  });

  it('deselects the guest character cards inside the same guard', () => {
    const body = enterArenaFromTitleBody();
    expect(body).toMatch(/card\.classList\.remove\('selected'\)/);
    expect(body).toMatch(/card\.setAttribute\('aria-checked',\s*'false'\)/);
  });

  it('still delegates into the shared boot via the guest ENTER click', () => {
    const body = enterArenaFromTitleBody();
    // The one-code-path invariant (v0.2.775/6): the whole function still ends
    // by clicking the shared #btn-enter-nap so the dupe-boot self-heal wraps
    // every entry path.
    expect(body).toMatch(/elNapBtn\.click\(\)/);
    expect(body).toMatch(/elNapBtn\.hasAttribute\('disabled'\)/);
  });
});