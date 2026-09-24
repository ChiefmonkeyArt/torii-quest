// tests/world/npc-nameplate-owner.test.js
//
// P2 — NPC nameplate owner identity on travel. The NAP-zone Nakama greeter's
// nameplate was resolving the LOCAL owner's kind:0 name (main.js _refreshOwnerLabel),
// so after travelling to another world the traveller's OWN name hung over the
// destination owner's NPC mesh. The fix carries the destination world's owner label
// (directory-row displayName/shortPubkey) through the peek→commit→travel chain and
// applies it on landing; homecoming re-applies the local owner's label via an
// injected onHomeRestored hook. The runtime is three-dependent, so we assert on the
// source text (same approach as exit-restores-home / ADR-0098), like the other
// source-contract suites.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

describe('P2 — NPC nameplate owner identity on travel (source contract)', () => {
  it('main.js imports worldDirectoryLabel and passes ownerLabel through peekWorld', () => {
    expect(MAIN).toMatch(/import\s*\{[^}]*worldDirectoryLabel[^}]*\}\s*from\s*'\.\/engine\/gateway\/gatewayRead\.js'/);
    expect(MAIN).toMatch(/const ownerLabel = worldDirectoryLabel\(world\);/);
    expect(MAIN).toMatch(/_arena\.peekWorld\(resolved\.world, \{ wsEndpoint: world\.wsEndpoint, ownerLabel \}\)/);
  });

  it('main.js wires onHomeRestored to the local owner-label repaint', () => {
    expect(MAIN).toMatch(/onHomeRestored: \(\) => _refreshOwnerLabel\(\)/);
  });

  it('runtime threads ownerLabel through _handlePeek → _pendingTravel → commitPeek', () => {
    expect(RUNTIME).toMatch(/_pendingTravel = \{ world, wsEndpoint, ownerLabel: typeof ownerLabel === 'string' \? ownerLabel : '' \};/);
    expect(RUNTIME).toMatch(/const \{ world, wsEndpoint, ownerLabel \} = _pendingTravel;/);
    // v0.2.884: commit awaits the swap so it can re-engage pointer lock when the
    // player walked through from the free-cursor state — ownerLabel is still passed.
    expect(RUNTIME).toMatch(/await travelToWorld\(world, \{ wsEndpoint, ownerLabel \}\);/);
  });

  it('travelToWorld applies the destination owner label to the NPC nameplate after the swap', () => {
    expect(RUNTIME).toMatch(/if \(opts && opts\.ownerLabel\) setNapNpcName\(opts\.ownerLabel\);/);
  });

  it('_restoreHomeWorld re-applies the LOCAL owner label via the onHomeRestored hook', () => {
    expect(RUNTIME).toMatch(/if \(onHomeRestoredHook\) onHomeRestoredHook\(\);/);
  });
});