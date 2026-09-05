// tests/v0.2.768-regression.test.js — locks the three playtest regressions fixed
// in v0.2.768-alpha (Bug A: stuck character on re-entry; Bug B: FP body bleeding
// into the mirror frame; Bug C: phantom chiefmonkey peer / stale sessions).
//
// Static source contract (no THREE import) — mirrors guest-peer-character.test.js:
// the assertions read src/*.js + server/*.js as text and freeze the structural
// invariants that, when missing, re-open each bug. Kept cheap so it runs in CI
// without a WebGL/DOM harness.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN     = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const RUNTIME  = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const FPBODY   = readFileSync(join(ROOT, 'src/firstPersonBody.js'), 'utf8');
const SWS      = readFileSync(join(ROOT, 'server/arena-ws.js'), 'utf8');

describe('v0.2.768 — Bug A: character re-seated on every entry', () => {
  it('main.js extracts the seat into _seatCharacterIntoArena and calls it on re-entry', () => {
    expect(MAIN).toMatch(/function\s+_seatCharacterIntoArena\(/);
    // Re-entry branch of ensureArenaReady re-seats and reloads the models.
    expect(MAIN).toMatch(/if\s*\(\s*_arenaBootstrapped\s*\)\s*\{/);
    expect(MAIN).toMatch(/_seatCharacterIntoArena\(_arena\)/);
    expect(MAIN).toMatch(/reloadCharacterAssets/);
  });

  it('arenaRuntime exposes reloadCharacterAssets that re-loads both models', () => {
    expect(RUNTIME).toMatch(/async function\s+reloadCharacterAssets\(\)\s*\{/);
    expect(RUNTIME).toMatch(/await loadPlayerModel\(playerObj\)/);
    expect(RUNTIME).toMatch(/await loadFirstPersonBody\(playerObj\)/);
    expect(RUNTIME).toMatch(/reloadCharacterAssets,?/);
  });

  it('the seat ignores the own mesh only when a guest char was explicitly chosen', () => {
    expect(MAIN).toMatch(/if\s*\(\s*_guestCharChosen\s*\)\s*\{/);
    expect(MAIN).toMatch(/setCustomMeshUrl\(null\)/);
  });
});

describe('v0.2.768 — Bug B: FP body hidden near the mirror', () => {
  it('firstPersonBody gates visibility through _applyVisibility (fly + mirror compose)', () => {
    expect(FPBODY).toMatch(/let\s+_flyHidden\s*=/);
    expect(FPBODY).toMatch(/let\s+_mirrorHidden\s*=/);
    expect(FPBODY).toMatch(/function\s+_applyVisibility\(\)/);
    expect(FPBODY).toMatch(/!_flyHidden\s*&&\s*!_mirrorHidden/);
  });

  it('firstPersonBody hides the body within MIRROR_HIDE_DIST of the mirror', () => {
    expect(FPBODY).toMatch(/const\s+MIRROR_HIDE_DIST\s*=\s*[\d.]+/);
    expect(FPBODY).toMatch(/getMirror\(\)/);
    expect(FPBODY).toMatch(/_updateMirrorProximity\(\)/);
  });

  it('setFlyHidden still exists (the fly-camera hide must keep working)', () => {
    expect(FPBODY).toMatch(/export\s+function\s+setFlyHidden\(/);
  });
});

describe('v0.2.768 — Bug C: no phantom chiefmonkey peer / live session hygiene', () => {
  it('peer character resolution never silently falls back to chiefmonkey', () => {
    // The resolver + warn-on-unknown exists…
    expect(RUNTIME).toMatch(/function\s+_resolvePeerCharacter\(/);
    // …and returns the anonymous guest, not the owner identity.
    expect(RUNTIME).toMatch(/return\s+'guest'/);
    // …and it is used by the template loader / avatar builder / join path.
    expect(RUNTIME).toMatch(/character\s*=\s*_resolvePeerCharacter\(/);
    // No remaining `|| MP_PEER_CHARACTERS.chiefmonkey` silent coercion.
    expect(RUNTIME).not.toMatch(/\|\|\s*MP_PEER_CHARACTERS\.chiefmonkey/);
    expect(RUNTIME).not.toMatch(/character\s*\|\|\s*'chiefmonkey'/);
    expect(RUNTIME).not.toMatch(/\(peer\s*&&\s*peer\.character\)\s*\|\|\s*'chiefmonkey'/);
  });

  it('leaving the world disconnects the MP socket (no parked phantom session)', () => {
    expect(RUNTIME).toMatch(/function\s+leaveToTitle\(\)\s*\{/);
    expect(RUNTIME).toMatch(/_mp\.stop\('home'\)/);
  });

  it('re-entering re-dials the MP socket so we rejoin as a live character', () => {
    expect(RUNTIME).toMatch(/function\s+resumeFromTitle\(\)\s*\{/);
    expect(RUNTIME).toMatch(/_mp\.start\(\)/);
  });

  it('a stale session token is ignored unless the player is actually logged in', () => {
    expect(RUNTIME).toMatch(/isLoggedInHook/);
    expect(RUNTIME).toMatch(/isLoggedInHook\(\)\s*\?\s*getStoredToken\(\)\s*:\s*null/);
    expect(MAIN).toMatch(/isLoggedIn:\s*\(\)\s*=>\s*\/\^\[0-9a-f\]\{64\}\$/);
  });

  it('server raises the idle sweep to 15 min and stops counting PING as activity', () => {
    expect(SWS).toMatch(/const\s+IDLE_DISCONNECT_MS\s*=\s*15\s*\*\s*60_000/);
    expect(SWS).toMatch(/msg\.t\s*!==\s*MSG\.PING\s*&&\s*msg\.t\s*!==\s*MSG\.PONG/);
    expect(SWS).not.toMatch(/^\s*sess\.lastActivity\s*=\s*Date\.now\(\);?\s*$/m);
  });

  it('server never defaults an unauth session to chiefmonkey', () => {
    expect(SWS).toMatch(/character:\s*'guest'/);
    expect(SWS).toMatch(/isValidCharacterKey\(character\)\s*\?\s*character\s*:\s*'guest'/);
    // The constructor default must not be the owner identity.
    expect(SWS).not.toMatch(/character:\s*'chiefmonkey'/);
  });
});