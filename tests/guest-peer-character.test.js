// tests/guest-peer-character.test.js — v0.2.764 guest-peer render + own-mesh fix.
//
// Static source contract (no THREE import): freezes two bugs that shipped in
// v0.2.763 and made every guest look like chiefmonkey:
//   1. MP_PEER_CHARACTERS was missing the 'guest' entry, so any peer whose
//      `character` was 'guest' fell back to MP_PEER_CHARACTERS.chiefmonkey and
//      rendered as a teal monkey — the "multiple versions of chiefmonkey" bug.
//   2. A returning player's own kind-35100 mesh (setCustomMeshUrl) overrode an
//      explicit guest-torso-card pick, so "the character I chose" never stuck.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const SERVER = readFileSync(join(ROOT, 'server/auth/characterKeys.js'), 'utf8');

describe('guest peer character — peer renderer', () => {
  it('MP_PEER_CHARACTERS declares a guest entry pointing at guest-master.glb', () => {
    // MP_PEER_CHARACTERS block (chiefmonkey → … → guest → });)
    const block = RUNTIME.match(/MP_PEER_CHARACTERS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/);
    expect(block).toBeTruthy();
    expect(block[1]).toMatch(/\bguest\s*:\s*\{/);
    expect(block[1]).toMatch(/guest-master\.glb/);
  });

  it('guest is treated as a master-clip-table character (useMasterTable)', () => {
    expect(RUNTIME).toMatch(/useMasterTable\s*=\s*character\s*===\s*'chiefmonkey'\s*\|\|\s*character\s*===\s*'nostrich'\s*\|\|\s*character\s*===\s*'guest'/);
  });

  it('the server whitelist still accepts guest (so it is never stripped/coerced)', () => {
    expect(SERVER).toMatch(/VALID_CHARACTERS\s*=\s*new Set\(\[['"]guest['"],\s*['"]chiefmonkey['"],\s*['"]nostrich['"]\]\)/);
  });
});

describe('guest peer character — own-mesh does not override a guest pick', () => {
  it('main.js tracks an explicit guest card tap (_guestCharChosen)', () => {
    expect(MAIN).toMatch(/let\s+_guestCharChosen\s*=\s*false/);
    expect(MAIN).toMatch(/_guestCharChosen\s*=\s*true/);
  });

  it('the character seat (v0.2.768 helper) ignores the own mesh when a guest char was explicitly chosen', () => {
    expect(MAIN).toMatch(/if\s*\(\s*_guestCharChosen\s*\)\s*\{/);
    // v0.2.768-alpha moved the seat into _seatCharacterIntoArena(arena) (called on
    // every entry, not just first boot); the guest branch still clears the mesh.
    expect(MAIN).toMatch(/function\s+_seatCharacterIntoArena\(\S*\)\s*\{/);
    expect(MAIN).toMatch(/setCustomMeshUrl\(null\)/);
    expect(MAIN).toMatch(/setCustomMeshHash\(null\)/);
  });
});