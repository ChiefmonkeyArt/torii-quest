// tests/instance-settings.test.js (v0.2.358-alpha)
// Locks the pure view-model + renderer for the title-screen Instance Settings
// panel. The panel is INERT this version: visibility is gated by
// `isInstanceAdmin({ operatorPubkey, hostPubkey })` (host-pubkey seam), the
// Access section is a read-only "public + coming soon" placeholder, and the
// renderer returns an empty string when the model is not visible.
//
// Fail-closed on any malformed input.

import { describe, it, expect } from 'vitest';
import {
  isInstanceAdmin,
  buildInstanceSettingsModel,
  renderInstanceSettingsPanel,
  COMING_SOON_ARRIVAL_MODES,
} from '../src/engine/ui/instanceSettings.js';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_MIXED = 'A1B2C3D4E5F60718' + '9'.repeat(48); // 64 chars, mixed case

describe('isInstanceAdmin', () => {
  it('true when operatorPubkey === hostPubkey (both hex64)', () => {
    expect(isInstanceAdmin({ operatorPubkey: HEX_A, hostPubkey: HEX_A })).toBe(true);
  });

  it('is case-insensitive on hex input', () => {
    expect(isInstanceAdmin({
      operatorPubkey: HEX_MIXED,
      hostPubkey: HEX_MIXED.toLowerCase(),
    })).toBe(true);
  });

  it('false when the two pubkeys differ', () => {
    expect(isInstanceAdmin({ operatorPubkey: HEX_A, hostPubkey: HEX_B })).toBe(false);
  });

  it('false when the operator is anon (no operatorPubkey)', () => {
    expect(isInstanceAdmin({ hostPubkey: HEX_A })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: '', hostPubkey: HEX_A })).toBe(false);
  });

  it('false when the host has no configured pubkey', () => {
    expect(isInstanceAdmin({ operatorPubkey: HEX_A })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: HEX_A, hostPubkey: '' })).toBe(false);
  });

  it('false on malformed hex (short / non-hex / non-string)', () => {
    expect(isInstanceAdmin({ operatorPubkey: 'a'.repeat(63), hostPubkey: 'a'.repeat(63) })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: 'g'.repeat(64), hostPubkey: 'g'.repeat(64) })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: 123, hostPubkey: 123 })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: null, hostPubkey: null })).toBe(false);
  });

  it('false on no opts / no arg', () => {
    expect(isInstanceAdmin()).toBe(false);
    expect(isInstanceAdmin({})).toBe(false);
    expect(isInstanceAdmin(null)).toBe(false);
  });
});

describe('COMING_SOON_ARRIVAL_MODES', () => {
  it('is frozen so callers cannot mutate the shared source of truth', () => {
    expect(Object.isFrozen(COMING_SOON_ARRIVAL_MODES)).toBe(true);
    for (const m of COMING_SOON_ARRIVAL_MODES) {
      expect(Object.isFrozen(m)).toBe(true);
    }
  });

  it('lists follow-me, whitelist, invite-only in that order', () => {
    expect(COMING_SOON_ARRIVAL_MODES.map((m) => m.key)).toEqual([
      'follow-me',
      'whitelist',
      'invite-only',
    ]);
  });

  it('every mode has label + hint strings', () => {
    for (const m of COMING_SOON_ARRIVAL_MODES) {
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.hint).toBe('string');
      expect(m.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('buildInstanceSettingsModel', () => {
  it('is visible when the operator matches the host', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    expect(m.visible).toBe(true);
    expect(m.operatorPubkey).toBe(HEX_A);
  });

  it('is not visible when the operator does not match', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_B });
    expect(m.visible).toBe(false);
  });

  it('is not visible when either side is missing / malformed', () => {
    expect(buildInstanceSettingsModel({ operatorPubkey: '', hostPubkey: HEX_A }).visible).toBe(false);
    expect(buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: '' }).visible).toBe(false);
    expect(buildInstanceSettingsModel({}).visible).toBe(false);
    expect(buildInstanceSettingsModel().visible).toBe(false);
  });

  it('carries the Access section as the first section with arrival=public + coming-soon modes', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    expect(Array.isArray(m.sections)).toBe(true);
    expect(m.sections.length).toBeGreaterThanOrEqual(2);
    const access = m.sections[0];
    expect(access.key).toBe('access');
    expect(access.title).toBe('Access');
    expect(access.current).toBe('public');
    expect(Array.isArray(access.comingSoon)).toBe(true);
    expect(access.comingSoon.map((x) => x.key)).toEqual(['follow-me', 'whitelist', 'invite-only']);
    expect(typeof access.note).toBe('string');
    expect(access.note.toLowerCase()).toContain('public by default');
  });

  it('carries a second "More coming soon" placeholder section', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    const more = m.sections.find((s) => s.key === 'more');
    expect(more).toBeTruthy();
    expect(more.title.toLowerCase()).toContain('coming soon');
    // Placeholder section: no `current`, no `comingSoon` list — just the note.
    expect(more.current).toBeUndefined();
    expect(more.comingSoon).toBeUndefined();
    expect(typeof more.note).toBe('string');
  });

  it('does not share the COMING_SOON_ARRIVAL_MODES array by reference', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    const modes = m.sections[0].comingSoon;
    // Mutating the returned list must not corrupt the frozen source.
    expect(() => modes.push({ key: 'x' })).not.toThrow();
    expect(COMING_SOON_ARRIVAL_MODES.length).toBe(3);
  });

  it('is case-insensitive on pubkey inputs (normalises to lower-case)', () => {
    const m = buildInstanceSettingsModel({
      operatorPubkey: HEX_MIXED,
      hostPubkey: HEX_MIXED.toLowerCase(),
    });
    expect(m.visible).toBe(true);
    expect(m.operatorPubkey).toBe(HEX_MIXED.toLowerCase());
  });
});

describe('renderInstanceSettingsPanel', () => {
  it('returns an empty string when the model is not visible (defence-in-depth)', () => {
    const hidden = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_B });
    expect(renderInstanceSettingsPanel(hidden)).toBe('');
    expect(renderInstanceSettingsPanel(null)).toBe('');
    expect(renderInstanceSettingsPanel(undefined)).toBe('');
    expect(renderInstanceSettingsPanel({})).toBe('');
  });

  it('renders the header, Access section, and every coming-soon mode when visible', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    const html = renderInstanceSettingsPanel(m);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('Instance Settings');
    expect(html).toContain('Admin:');
    expect(html).toContain('Access');
    expect(html).toContain('Arrival');
    expect(html).toContain('public');
    // Each mode label and hint appear.
    for (const m2 of COMING_SOON_ARRIVAL_MODES) {
      expect(html).toContain(m2.label);
      expect(html).toContain(m2.hint);
    }
    // The placeholder "More coming soon" section appears.
    expect(html).toContain('More coming soon');
    // A visible read-only footer note appears.
    expect(html.toLowerCase()).toContain('read-only');
  });

  it('formats the admin pubkey short-form (first 8 + last 4 hex, ellipsis)', () => {
    const pubkey = 'deadbeef' + '0'.repeat(52) + 'cafe'; // 64 hex: deadbeef … cafe
    const m = buildInstanceSettingsModel({ operatorPubkey: pubkey, hostPubkey: pubkey });
    const html = renderInstanceSettingsPanel(m);
    expect(html).toContain('deadbeef…cafe');
    // Full pubkey must NOT leak into the panel body.
    expect(html).not.toContain(pubkey);
  });

  it('escapes hostile characters that would otherwise reach the DOM', () => {
    // The renderer walks section titles / notes / labels through _escape. We
    // simulate a hostile section by mutating the returned model (real callers
    // do not do this, but the renderer must still be robust).
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    m.sections.push({
      key: 'hostile',
      title: '<img src=x onerror=alert(1)>',
      note: '"><script>alert(1)</script>',
    });
    const html = renderInstanceSettingsPanel(m);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('tolerates a model with a missing sections array', () => {
    const m = { visible: true, operatorPubkey: HEX_A, sections: undefined };
    // Must not throw; renders the header/footer even with no sections.
    const html = renderInstanceSettingsPanel(m);
    expect(typeof html).toBe('string');
    expect(html).toContain('Instance Settings');
  });

  it('renders a close button with a data-action="close" hook the shell can bind to', () => {
    const m = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    const html = renderInstanceSettingsPanel(m);
    expect(html).toContain('data-action="close"');
    expect(html).toContain('aria-label="Close settings"');
  });
});
