import { describe, it, expect } from 'vitest';
import {
  isInstanceAdmin,
  buildInstanceSettingsModel,
  renderInstanceSettingsPanel,
  EDITABLE_ARRIVAL_MODES,
  DISABLED_ARRIVAL_MODES,
  EDITABLE_WRITE_POLICIES,
  DISABLED_WRITE_POLICIES,
  coerceEditableArrivalMode,
  coerceEditableWritePolicy,
} from '../src/engine/ui/instanceSettings.js';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_MIXED = 'A1B2C3D4E5F60718' + '9'.repeat(48);

describe('isInstanceAdmin', () => {
  it('true when operatorPubkey === hostPubkey (both hex64)', () => {
    expect(isInstanceAdmin({ operatorPubkey: HEX_A, hostPubkey: HEX_A })).toBe(true);
  });

  it('is case-insensitive on hex input', () => {
    expect(isInstanceAdmin({ operatorPubkey: HEX_MIXED, hostPubkey: HEX_MIXED.toLowerCase() })).toBe(true);
  });

  it('false when the two pubkeys differ', () => {
    expect(isInstanceAdmin({ operatorPubkey: HEX_A, hostPubkey: HEX_B })).toBe(false);
  });

  it('false on missing or malformed input', () => {
    expect(isInstanceAdmin({ hostPubkey: HEX_A })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: HEX_A })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: 'a'.repeat(63), hostPubkey: HEX_A })).toBe(false);
    expect(isInstanceAdmin({ operatorPubkey: 'g'.repeat(64), hostPubkey: 'g'.repeat(64) })).toBe(false);
    expect(isInstanceAdmin()).toBe(false);
    expect(isInstanceAdmin(null)).toBe(false);
  });
});

describe('arrival + write policy option sources', () => {
  it('editable modes are frozen and limited to public + follows-only', () => {
    expect(Object.isFrozen(EDITABLE_ARRIVAL_MODES)).toBe(true);
    expect(EDITABLE_ARRIVAL_MODES.map((m) => m.key)).toEqual(['public', 'follows-only']);
  });

  it('disabled modes are frozen and limited to whitelist + invite-only', () => {
    expect(Object.isFrozen(DISABLED_ARRIVAL_MODES)).toBe(true);
    expect(DISABLED_ARRIVAL_MODES.map((m) => m.key)).toEqual(['whitelist', 'invite-only']);
  });

  it('coerces unsupported arrival selections back to an editable fallback', () => {
    expect(coerceEditableArrivalMode('public', 'follows-only')).toBe('public');
    expect(coerceEditableArrivalMode('follows-only', 'public')).toBe('follows-only');
    expect(coerceEditableArrivalMode('whitelist', 'follows-only')).toBe('follows-only');
    expect(coerceEditableArrivalMode('', 'public')).toBe('public');
  });

  it('exposes editable write policies and keeps open disabled', () => {
    expect(EDITABLE_WRITE_POLICIES.map((m) => m.key)).toEqual(['owner-only', 'delegates', 'follows-write']);
    expect(DISABLED_WRITE_POLICIES.map((m) => m.key)).toEqual(['open']);
    expect(coerceEditableWritePolicy('delegates', 'owner-only')).toBe('delegates');
    expect(coerceEditableWritePolicy('open', 'owner-only')).toBe('owner-only');
    expect(coerceEditableWritePolicy('garbage', 'follows-write')).toBe('follows-write');
  });
});

describe('buildInstanceSettingsModel', () => {
  it('is visible only for the instance admin', () => {
    expect(buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A }).visible).toBe(true);
    expect(buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_B }).visible).toBe(false);
  });

  it('exposes an editable Access section for an admin with a signer', () => {
    const model = buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_A,
      arrivalMode: 'public',
      persistedArrivalMode: 'follows-only',
      persistedFollowPolicy: 'visitor-follows-owner',
      selectedArrivalMode: 'public',
      persistedWritePolicy: 'delegates',
      persistedDelegateSet: [HEX_B],
      selectedWritePolicy: 'follows-write',
      hasSigner: true,
      statusMessage: 'Loaded the latest valid signed access setting.',
      statusTone: 'ok',
    });
    const access = model.sections[0];
    expect(access.key).toBe('access');
    expect(access.deploy).toBe('public');
    expect(access.persisted).toBe('follows-only');
    expect(access.current).toBe('follows-only');
    expect(access.selected).toBe('public');
    expect(access.canEdit).toBe(true);
    expect(model.canEditAccess).toBe(true);
    expect(access.editableModes.map((m) => m.key)).toEqual(['public', 'follows-only']);
    expect(access.disabledModes.map((m) => m.key)).toEqual(['whitelist', 'invite-only']);
    expect(access.writePolicy).toBe('delegates');
    expect(access.selectedWritePolicy).toBe('follows-write');
    expect(access.delegateCount).toBe(1);
    expect(access.editableWritePolicies.map((m) => m.key)).toEqual(['owner-only', 'delegates', 'follows-write']);
    expect(access.disabledWritePolicies.map((m) => m.key)).toEqual(['open']);
    expect(access.statusMessage).toContain('latest valid signed access setting');
    expect(access.note.toLowerCase()).toContain('follow graph');
  });

  it('non-admin UI cannot write', () => {
    const model = buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_B,
      hasSigner: true,
    });
    expect(model.visible).toBe(false);
    expect(model.canEditAccess).toBe(false);
  });

  it('renders a clear read-only state when no signer is available', () => {
    const model = buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_A,
      hasSigner: false,
      arrivalMode: 'public',
      selectedArrivalMode: 'follows-only',
      selectedWritePolicy: 'delegates',
    });
    const access = model.sections[0];
    expect(access.canEdit).toBe(false);
    expect(access.readOnlyReason).toContain('Connect a Nostr signer');
    expect(access.editableWritePolicies.every((m) => m.disabled === true)).toBe(true);
  });

  it('deploy follows-only plus persisted public keeps the stricter effective mode', () => {
    const model = buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_A,
      arrivalMode: 'follows-only',
      persistedArrivalMode: 'public',
      hasSigner: true,
    });
    const access = model.sections[0];
    expect(access.deploy).toBe('follows-only');
    expect(access.persisted).toBe('public');
    expect(access.current).toBe('follows-only');
    expect(access.note.toLowerCase()).toContain('follow graph');
  });

  it('only public/follows-only are editable while whitelist/invite-only stay disabled and open stays off', () => {
    const model = buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_A,
      arrivalMode: 'whitelist',
      hasSigner: true,
      selectedArrivalMode: 'invite-only',
      selectedWritePolicy: 'open',
    });
    const access = model.sections[0];
    expect(access.current).toBe('whitelist');
    expect(access.selected).toBe('public');
    expect(access.editableModes.every((m) => m.disabled === false)).toBe(true);
    expect(access.disabledModes.every((m) => m.disabled === true)).toBe(true);
    expect(access.selectedWritePolicy).toBe('owner-only');
    expect(access.disabledWritePolicies.every((m) => m.disabled === true)).toBe(true);
    expect(access.note.toLowerCase()).toContain('deny-all');
  });

  it('carries multiplayer and more-coming-soon sections', () => {
    const model = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A });
    const multiplayer = model.sections.find((s) => s.key === 'multiplayer');
    const more = model.sections.find((s) => s.key === 'more');
    expect(multiplayer.current).toMatch(/enabled|disabled/);
    expect(more.title).toContain('More coming soon');
  });

  it('normalises admin pubkeys to lowercase', () => {
    const model = buildInstanceSettingsModel({ operatorPubkey: HEX_MIXED, hostPubkey: HEX_MIXED.toLowerCase() });
    expect(model.visible).toBe(true);
    expect(model.operatorPubkey).toBe(HEX_MIXED.toLowerCase());
  });
});

describe('renderInstanceSettingsPanel', () => {
  it('returns an empty string when the model is not visible', () => {
    expect(renderInstanceSettingsPanel(buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_B }))).toBe('');
    expect(renderInstanceSettingsPanel(null)).toBe('');
    expect(renderInstanceSettingsPanel(undefined)).toBe('');
  });

  it('renders the editable access form, disabled future modes, and save control', () => {
    const html = renderInstanceSettingsPanel(buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_A,
      hasSigner: true,
      arrivalMode: 'public',
      persistedArrivalMode: 'follows-only',
      selectedArrivalMode: 'follows-only',
      persistedWritePolicy: 'owner-only',
      selectedWritePolicy: 'delegates',
      statusMessage: 'Loaded the latest valid signed access setting.',
      statusTone: 'ok',
    }));
    expect(html).toContain('Instance Settings');
    expect(html).toContain('Access');
    expect(html).toContain('Deploy floor');
    expect(html).toContain('Saved owner setting');
    expect(html).toContain('Effective arrival mode');
    expect(html).toContain('Write authority');
    expect(html).toContain('Saved write policy');
    expect(html).toContain('Effective write policy');
    expect(html).toContain('coming later');
    expect(html).toContain('data-form="access-settings"');
    expect(html).toContain('data-action="save-access"');
    expect(html).toContain('SAVE ACCESS SETTINGS');
    expect(html).toContain('coming next');
    expect(html).toContain('Loaded the latest valid signed access setting.');
  });

  it('renders a disabled save button and signer-required copy when no signer is present', () => {
    const html = renderInstanceSettingsPanel(buildInstanceSettingsModel({
      operatorPubkey: HEX_A,
      hostPubkey: HEX_A,
      hasSigner: false,
      arrivalMode: 'public',
    }));
    expect(html).toContain('Connect a Nostr signer to save access changes.');
    expect(html).toContain('data-action="save-access" disabled');
  });

  it('formats the admin pubkey short-form and escapes hostile section content', () => {
    const model = buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A, hasSigner: true });
    model.sections.push({
      key: 'hostile',
      title: '<img src=x onerror=alert(1)>',
      note: '"><script>alert(1)</script>',
    });
    const html = renderInstanceSettingsPanel(model);
    expect(html).toContain('aaaaaaaa…aaaa');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders a close button hook for the shell', () => {
    const html = renderInstanceSettingsPanel(buildInstanceSettingsModel({ operatorPubkey: HEX_A, hostPubkey: HEX_A }));
    expect(html).toContain('data-action="close"');
    expect(html).toContain('aria-label="Close settings"');
  });
});
