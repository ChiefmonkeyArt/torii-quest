// tests/v0.2.813-nakama-nameplate.test.js — v0.2.813 Nakama NPC identity.
//
// Locks the pure behaviour of composeNakamaLabel (extracted into a node-safe
// module: engine/character/nakamaLabel.js) and the two source-integration
// wires: napNpc.js re-exports the composer + attaches the sprite; main.js's
// _refreshOwnerLabel calls setNapNpcName every time the owner label repaints.
// The visual sprite render itself is smoke-tested by the build + regression
// check; this file locks the pure rules and the plumbing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  composeNakamaLabel,
  NAKAMA_SUFFIX,
  NAKAMA_DEFAULT_LABEL,
  NAKAMA_NAME_MAX,
} from '../src/engine/character/nakamaLabel.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('v0.2.813 Nakama NPC — composeNakamaLabel', () => {
  it('returns the bare Nakama label when the owner name is empty', () => {
    expect(composeNakamaLabel('')).toBe('Nakama');
    expect(composeNakamaLabel(null)).toBe('Nakama');
    expect(composeNakamaLabel(undefined)).toBe('Nakama');
    expect(composeNakamaLabel(0)).toBe('Nakama'); // non-string → treated as empty
    expect(composeNakamaLabel('   ')).toBe('Nakama');
  });

  it('composes <OwnerName> Nakama for real names', () => {
    expect(composeNakamaLabel('Chiefmonkey')).toBe('Chiefmonkey Nakama');
    expect(composeNakamaLabel('BitcoinBekka')).toBe('BitcoinBekka Nakama');
    expect(composeNakamaLabel('  Alice  ')).toBe('Alice Nakama'); // trims
  });

  it('caps the owner name at NAKAMA_NAME_MAX chars so a hostile kind:0 cannot overflow the sprite', () => {
    expect(NAKAMA_NAME_MAX).toBe(32);
    const longName = 'A'.repeat(200);
    const out = composeNakamaLabel(longName);
    expect(out.startsWith('A'.repeat(NAKAMA_NAME_MAX))).toBe(true);
    expect(out.endsWith(` ${NAKAMA_SUFFIX}`)).toBe(true);
    expect(out.length).toBe(NAKAMA_NAME_MAX + 1 + NAKAMA_SUFFIX.length);
  });

  it('strips ASCII control chars from the owner name (0x00–0x1F, 0x7F)', () => {
    // A malicious kind:0 name embedding NUL / BEL / DEL. Composer must not
    // render them as tofu boxes on the sprite.
    expect(composeNakamaLabel('Alice\x00Bob')).toBe('AliceBob Nakama');
    expect(composeNakamaLabel('Bell\x07here')).toBe('Bellhere Nakama');
    expect(composeNakamaLabel('End\x7Fdelete')).toBe('Enddelete Nakama');
    expect(composeNakamaLabel('\x00\x01\x02\x03')).toBe('Nakama'); // all-control → empty
  });

  it('exports the canonical suffix + default label so callers can display them', () => {
    expect(NAKAMA_SUFFIX).toBe('Nakama');
    expect(NAKAMA_DEFAULT_LABEL).toBe('Nakama');
  });
});

describe('v0.2.813 Nakama NPC — main.js wires _refreshOwnerLabel → setNapNpcName', () => {
  // Guardrail: this is where the identity actually gets pushed to the world.
  // A future refactor that breaks the wire silently leaves every install
  // stuck on the bare 'Nakama' label, which we would never notice without CI.
  const MAIN = readFileSync(resolve(HERE, '../src/main.js'), 'utf8');

  // Extract the _refreshOwnerLabel function body, delimited by the next
  // top-level function declaration (avoid a magic slice size that silently
  // truncates when the function grows).
  function refreshBody() {
    const start = MAIN.indexOf('function _refreshOwnerLabel(');
    expect(start).toBeGreaterThan(-1);
    const end = MAIN.indexOf('\nfunction ', start + 1);
    return MAIN.slice(start, end > -1 ? end : start + 5000);
  }

  it("_refreshOwnerLabel imports napNpc and calls setNapNpcName with the resolved owner name", () => {
    // The dynamic import must be inside _refreshOwnerLabel (a repaint hook),
    // not at module load, so it fires on kind:0 resolve + login/logout.
    const body = refreshBody();
    expect(body).toMatch(/import\(['"]\.\/napNpc\.js['"]\)/);
    expect(body).toMatch(/setNapNpcName\(/);
  });

  it("uses the OWNER's kind:0 name (not the viewer's), pulled from _ownerProfileName", () => {
    // Critical: the Nakama's identity mirrors the instance owner, not whoever
    // is looking at it. On chiefmonkey.art, every visitor sees 'Chiefmonkey
    // Nakama' regardless of who they logged in as.
    const body = refreshBody();
    // The name resolution matches the same admin-scoped resolution used for
    // the homepage owner label (guards against a viewer-name regression).
    expect(body).toMatch(/_ownerProfileNamePubkey.*_ownerProfileName/);
  });
});

describe('v0.2.813 Nakama NPC — napNpc.js sprite plumbing', () => {
  const NPC = readFileSync(resolve(HERE, '../src/napNpc.js'), 'utf8');

  it('re-exports composeNakamaLabel + setNapNpcName + suffix/default label', () => {
    // napNpc is the world-facing module; main.js and stickerNpc.js import from
    // it, so the label API must remain reachable through the same path even
    // after the pure rules moved to engine/character/nakamaLabel.js.
    expect(NPC).toMatch(/from '\.\/engine\/character\/nakamaLabel\.js'/);
    expect(NPC).toMatch(/export \{ composeNakamaLabel, NAKAMA_SUFFIX, NAKAMA_DEFAULT_LABEL \}/);
    expect(NPC).toMatch(/export function setNapNpcName\(/);
  });

  it('renders the nameplate in Torii orange (#f0a04b) to match the toc-name greeting', () => {
    // Visual coherence: the Nakama's label uses the same orange as the
    // homepage "Welcome <name>," greeting so the identity reads as unified.
    expect(NPC).toMatch(/#f0a04b/);
  });

  it('attaches the nameplate after the NPC root is added to the scene', () => {
    // Guard against a rebuild that drops the nameplate attachment.
    expect(NPC).toMatch(/_nameplate = _makeNakamaNameplate\(_pendingLabel\)/);
    expect(NPC).toMatch(/scene\.add\(_nameplate\)/);
  });

  it('tracks the NPC by following the root position + head-height offset every tick', () => {
    // The sprite must move with the walking NPC, not stay pinned at spawn.
    expect(NPC).toMatch(/_nameplate\.position\.set\(_root\.position\.x/);
  });
});

describe('v0.2.813 Nakama NPC — pure module is node-safe (no three/DOM imports)', () => {
  const PURE = readFileSync(resolve(HERE, '../src/engine/character/nakamaLabel.js'), 'utf8');

  it('has zero imports (dependency-free)', () => {
    // If a future refactor ever pulls three or scene into the pure module,
    // node/vitest tests will fail to import it. Keep this module hermetic.
    expect(PURE).not.toMatch(/^import /m);
    expect(PURE).not.toMatch(/^from /m);
  });
});
