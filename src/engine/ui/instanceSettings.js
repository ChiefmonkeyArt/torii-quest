// instanceSettings.js (v0.2.401-alpha) — instance-admin access settings surface.
//
// Pure, node-safe view-model + HTML renderer for the title-screen Instance
// Settings panel. DOM wiring + relay/sign interactions live in main.js; this file
// only computes the model and renders the panel HTML.

import { MP_ENABLED } from '../../config.js';
import {
  ARRIVAL_MODE_PUBLIC,
  ARRIVAL_MODE_FOLLOWS_ONLY,
  ARRIVAL_MODE_WHITELIST,
  ARRIVAL_MODE_INVITE_ONLY,
  FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER,
  normaliseArrivalMode,
  normaliseFollowPolicy,
} from '../gateway/handoffArrival.js';
import {
  WRITE_POLICY_OWNER_ONLY,
  WRITE_POLICY_DELEGATES,
  WRITE_POLICY_FOLLOWS_WRITE,
  normaliseWritePolicy,
} from '../gateway/writeAuthority.js';

const HEX64 = /^[0-9a-f]{64}$/;

export const EDITABLE_ARRIVAL_MODES = Object.freeze([
  Object.freeze({
    key: ARRIVAL_MODE_PUBLIC,
    label: 'Public',
    hint: 'Anyone can arrive. Travellers without SEC-2 proof still fail closed to anon.',
  }),
  Object.freeze({
    key: ARRIVAL_MODE_FOLLOWS_ONLY,
    label: 'Follows only',
    hint: 'Only travellers who follow the instance owner may enter after SEC-2 verification.',
  }),
]);

export const DISABLED_ARRIVAL_MODES = Object.freeze([
  Object.freeze({
    key: ARRIVAL_MODE_WHITELIST,
    label: 'Whitelist',
    hint: 'Coming next — unsupported in v0.2.400. If encountered on read, arrival fails closed to deny-all.',
  }),
  Object.freeze({
    key: ARRIVAL_MODE_INVITE_ONLY,
    label: 'Invite only',
    hint: 'Coming next — unsupported in v0.2.400. If encountered on read, arrival fails closed to deny-all.',
  }),
]);

export const EDITABLE_WRITE_POLICIES = Object.freeze([
  Object.freeze({
    key: WRITE_POLICY_OWNER_ONLY,
    label: 'Owner only',
    hint: 'Default. Only the instance owner may mutate world state.',
  }),
  Object.freeze({
    key: WRITE_POLICY_DELEGATES,
    label: 'Delegates',
    hint: 'Owner plus the saved delegate set may write. Missing delegate set fails closed to owner-only behaviour.',
  }),
  Object.freeze({
    key: WRITE_POLICY_FOLLOWS_WRITE,
    label: 'Follows write',
    hint: 'Crypto-verified followers may write. Relay failure resolving follow state denies visitor writes.',
  }),
]);

export const DISABLED_WRITE_POLICIES = Object.freeze([
  Object.freeze({
    key: 'open',
    label: 'Open',
    hint: 'Coming later — unsupported in v0.2.401. Read-path fail-closed keeps visitor writes denied.',
  }),
]);

function _arrivalModeRank(mode) {
  switch (mode) {
    case ARRIVAL_MODE_PUBLIC: return 0;
    case ARRIVAL_MODE_FOLLOWS_ONLY: return 1;
    case ARRIVAL_MODE_WHITELIST:
    case ARRIVAL_MODE_INVITE_ONLY:
      return 2;
    default:
      return 3;
  }
}

function _effectiveArrivalMode(deployArrivalMode, persistedArrivalMode) {
  const deploy = normaliseArrivalMode(deployArrivalMode);
  if (!deploy.ok) return { ok: false, mode: null, error: deploy.error };
  const persisted = normaliseArrivalMode(persistedArrivalMode);
  if (!persisted.ok) return { ok: true, mode: deploy.mode, error: null };
  return _arrivalModeRank(persisted.mode) > _arrivalModeRank(deploy.mode)
    ? { ok: true, mode: persisted.mode, error: null }
    : { ok: true, mode: deploy.mode, error: null };
}

export function coerceEditableArrivalMode(raw, fallback = ARRIVAL_MODE_PUBLIC) {
  const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (mode === ARRIVAL_MODE_PUBLIC || mode === ARRIVAL_MODE_FOLLOWS_ONLY) return mode;
  return fallback;
}

export function coerceEditableWritePolicy(raw, fallback = WRITE_POLICY_OWNER_ONLY) {
  const policy = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (policy === WRITE_POLICY_OWNER_ONLY || policy === WRITE_POLICY_DELEGATES || policy === WRITE_POLICY_FOLLOWS_WRITE) return policy;
  return fallback;
}

/**
 * Is the current logged-in operator the admin of this instance?
 * Returns `true` iff BOTH pubkeys are the same hex64 string. Anything else fails
 * closed to `false`.
 */
export function isInstanceAdmin(opts) {
  const o = opts || {};
  const op = typeof o.operatorPubkey === 'string' ? o.operatorPubkey.toLowerCase() : '';
  const host = typeof o.hostPubkey === 'string' ? o.hostPubkey.toLowerCase() : '';
  if (!HEX64.test(op) || !HEX64.test(host)) return false;
  return op === host;
}

function _buildAccessSection({
  deployArrivalMode,
  deployFollowPolicy,
  persistedArrivalMode,
  persistedFollowPolicy,
  persistedWritePolicy,
  persistedDelegateSet,
  selectedArrivalMode,
  selectedWritePolicy,
  hasSigner,
  loading,
  saving,
  statusMessage,
  statusTone,
}) {
  const deploy = normaliseArrivalMode(deployArrivalMode);
  const deployPolicy = normaliseFollowPolicy(deployFollowPolicy);
  const persisted = normaliseArrivalMode(persistedArrivalMode);
  const persistedPolicy = normaliseFollowPolicy(persistedFollowPolicy);
  const effective = _effectiveArrivalMode(deploy.mode || ARRIVAL_MODE_PUBLIC, persisted.mode || null);
  const fallbackSelected = persisted.ok ? persisted.mode : (deploy.ok ? deploy.mode : ARRIVAL_MODE_PUBLIC);
  const selected = coerceEditableArrivalMode(selectedArrivalMode, coerceEditableArrivalMode(fallbackSelected, ARRIVAL_MODE_PUBLIC));
  const persistedWrite = normaliseWritePolicy(persistedWritePolicy);
  const effectiveWritePolicy = persistedWrite.policy || WRITE_POLICY_OWNER_ONLY;
  const selectedWrite = coerceEditableWritePolicy(selectedWritePolicy, coerceEditableWritePolicy(effectiveWritePolicy, WRITE_POLICY_OWNER_ONLY));
  const delegateCount = Array.isArray(persistedDelegateSet) ? persistedDelegateSet.length : 0;
  const canEdit = !!hasSigner && !loading && !saving;
  const readOnlyReason = hasSigner
    ? (loading ? 'Loading the saved owner setting…' : '')
    : 'Connect a Nostr signer to save access changes.';
  const ownerSetting = persisted.ok ? persisted.mode : 'none saved';
  const savedWriteSetting = persistedWritePolicy ? effectiveWritePolicy : 'none saved';
  let note = 'The deploy seam is the local security floor. A saved public setting can never loosen a follows-only deploy.';
  if (effective.ok && effective.mode === ARRIVAL_MODE_FOLLOWS_ONLY) {
    const policy = persisted.ok && persisted.mode === ARRIVAL_MODE_FOLLOWS_ONLY && persistedPolicy.ok
      ? persistedPolicy.policy
      : (deployPolicy.ok ? deployPolicy.policy : FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER);
    note = `Effective follows-only gate: ${policy}. The follow graph is checked only after SEC-2 arrival verification.`;
  }
  if (effective.ok && (effective.mode === ARRIVAL_MODE_WHITELIST || effective.mode === ARRIVAL_MODE_INVITE_ONLY)) {
    note = 'Effective mode is unsupported in v0.2.400, so arrival fails closed to deny-all until a future slice adds the full engine path.';
  }
  let writeNote = 'Write authority is fail-closed. Missing, unreadable, or unsupported write policy defaults to owner-only; visitor writes never silently open.';
  if (effectiveWritePolicy === WRITE_POLICY_DELEGATES) {
    writeNote = delegateCount
      ? `Delegates mode is selected. ${delegateCount} saved delegate${delegateCount === 1 ? '' : 's'} may write alongside the owner.`
      : 'Delegates mode is selected, but no delegate set is saved yet — visitor writes still fail closed to owner-only behaviour.';
  } else if (effectiveWritePolicy === WRITE_POLICY_FOLLOWS_WRITE) {
    writeNote = 'Follows-write is selected. Only crypto-verified followers may write, and relay failure resolving the follow graph denies visitor writes.';
  }
  return {
    key: 'access',
    title: 'Access',
    status: canEdit ? 'editable' : 'read-only',
    deploy: deploy.ok ? deploy.mode : 'unreadable',
    persisted: ownerSetting,
    current: effective.ok ? effective.mode : 'unreadable',
    selected,
    followPolicy: effective.ok && effective.mode === ARRIVAL_MODE_FOLLOWS_ONLY
      ? (persisted.ok && persisted.mode === ARRIVAL_MODE_FOLLOWS_ONLY && persistedPolicy.ok
        ? persistedPolicy.policy
        : (deployPolicy.ok ? deployPolicy.policy : FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER))
      : FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER,
    editableModes: EDITABLE_ARRIVAL_MODES.map((m) => ({
      ...m,
      checked: m.key === selected,
      disabled: !canEdit,
    })),
    disabledModes: DISABLED_ARRIVAL_MODES.map((m) => ({ ...m, disabled: true })),
    writePolicy: effectiveWritePolicy,
    persistedWritePolicy: savedWriteSetting,
    selectedWritePolicy: selectedWrite,
    delegateCount,
    editableWritePolicies: EDITABLE_WRITE_POLICIES.map((policy) => ({
      ...policy,
      checked: policy.key === selectedWrite,
      disabled: !canEdit,
    })),
    disabledWritePolicies: DISABLED_WRITE_POLICIES.map((policy) => ({ ...policy, disabled: true })),
    writeNote,
    canEdit,
    hasSigner: !!hasSigner,
    loading: !!loading,
    saving: !!saving,
    readOnlyReason,
    statusMessage: statusMessage || '',
    statusTone: statusTone || '',
    note,
  };
}

/**
 * Build the pure view-model for the Instance Settings panel.
 */
export function buildInstanceSettingsModel(opts) {
  const o = opts || {};
  const op = typeof o.operatorPubkey === 'string' ? o.operatorPubkey.toLowerCase() : '';
  const host = typeof o.hostPubkey === 'string' ? o.hostPubkey.toLowerCase() : '';
  const visible = isInstanceAdmin({ operatorPubkey: op, hostPubkey: host });

  const deployArrivalMode = normaliseArrivalMode(o.arrivalMode).mode || ARRIVAL_MODE_PUBLIC;
  const deployFollowPolicy = normaliseFollowPolicy(o.followPolicy).policy || FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER;
  const persistedArrivalMode = typeof o.persistedArrivalMode === 'string' ? o.persistedArrivalMode : '';
  const persistedFollowPolicy = typeof o.persistedFollowPolicy === 'string' ? o.persistedFollowPolicy : '';
  const persistedWritePolicy = typeof o.persistedWritePolicy === 'string' ? o.persistedWritePolicy : '';
  const persistedDelegateSet = Array.isArray(o.persistedDelegateSet) ? o.persistedDelegateSet.slice() : [];

  const mpEnabled = typeof o.mpEnabled === 'boolean' ? o.mpEnabled : !!MP_ENABLED;
  const access = _buildAccessSection({
    deployArrivalMode,
    deployFollowPolicy,
    persistedArrivalMode,
    persistedFollowPolicy,
    persistedWritePolicy,
    persistedDelegateSet,
    selectedArrivalMode: o.selectedArrivalMode,
    selectedWritePolicy: o.selectedWritePolicy,
    hasSigner: o.hasSigner,
    loading: o.loading,
    saving: o.saving,
    statusMessage: o.statusMessage,
    statusTone: o.statusTone,
  });

  const sections = [
    access,
    {
      key: 'multiplayer',
      title: 'Multiplayer',
      status: 'placeholder',
      current: mpEnabled ? 'enabled' : 'disabled',
      note: 'MP-1 ships behind a build-time flag. Runtime toggle + per-zone opt-in land in MP-1.1.',
    },
    {
      key: 'more',
      title: 'More coming soon',
      status: 'placeholder',
      note: 'Additional admin sections (identity, appearance, moderation, delegate-set editing) will land here in future updates.',
    },
  ];

  return {
    visible,
    operatorPubkey: op,
    arrivalMode: access.current,
    deployArrivalMode,
    persistedArrivalMode: access.persisted,
    selectedArrivalMode: access.selected,
    followPolicy: access.followPolicy,
    writePolicy: access.writePolicy,
    selectedWritePolicy: access.selectedWritePolicy,
    sections,
    mpEnabled,
    canEditAccess: visible && access.canEdit,
    hasSigner: !!o.hasSigner,
  };
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _shortPubkey(pubkey) {
  const p = typeof pubkey === 'string' ? pubkey.toLowerCase() : '';
  if (!HEX64.test(p)) return '—';
  return `${p.slice(0, 8)}…${p.slice(-4)}`;
}

export function renderInstanceSettingsPanel(model) {
  if (!model || !model.visible) return '';
  const admin = _escape(_shortPubkey(model.operatorPubkey));
  const sections = Array.isArray(model.sections) ? model.sections : [];

  const sectionHtml = sections.map((s) => {
    const title = _escape((s && s.title) || '');
    const note = s && typeof s.note === 'string' ? `<p class="is-note">${_escape(s.note)}</p>` : '';
    let body = '';
    if (s && s.key === 'access') {
      const editableModes = Array.isArray(s.editableModes) ? s.editableModes : [];
      const disabledModes = Array.isArray(s.disabledModes) ? s.disabledModes : [];
      const editableWritePolicies = Array.isArray(s.editableWritePolicies) ? s.editableWritePolicies : [];
      const disabledWritePolicies = Array.isArray(s.disabledWritePolicies) ? s.disabledWritePolicies : [];
      const editableHtml = editableModes.map((mode) => `
        <label class="is-mode-option${mode.disabled ? ' is-mode-disabled' : ''}">
          <input type="radio" name="arrival-mode" value="${_escape(mode.key)}"${mode.checked ? ' checked' : ''}${mode.disabled ? ' disabled' : ''}>
          <span class="is-mode-copy">
            <span class="is-mode-label">${_escape(mode.label)}</span>
            <span class="is-mode-hint">${_escape(mode.hint)}</span>
          </span>
        </label>`).join('');
      const disabledHtml = disabledModes.map((mode) => `
        <label class="is-mode-option is-mode-disabled" data-mode-state="coming-next">
          <input type="radio" name="arrival-mode-disabled" value="${_escape(mode.key)}" disabled>
          <span class="is-mode-copy">
            <span class="is-mode-label">${_escape(mode.label)} <span class="is-coming-next-chip">coming next</span></span>
            <span class="is-mode-hint">${_escape(mode.hint)}</span>
          </span>
        </label>`).join('');
      const editableWriteHtml = editableWritePolicies.map((policy) => `
        <label class="is-mode-option${policy.disabled ? ' is-mode-disabled' : ''}">
          <input type="radio" name="write-policy" value="${_escape(policy.key)}"${policy.checked ? ' checked' : ''}${policy.disabled ? ' disabled' : ''}>
          <span class="is-mode-copy">
            <span class="is-mode-label">${_escape(policy.label)}</span>
            <span class="is-mode-hint">${_escape(policy.hint)}</span>
          </span>
        </label>`).join('');
      const disabledWriteHtml = disabledWritePolicies.map((policy) => `
        <label class="is-mode-option is-mode-disabled" data-mode-state="coming-later">
          <input type="radio" name="write-policy-disabled" value="${_escape(policy.key)}" disabled>
          <span class="is-mode-copy">
            <span class="is-mode-label">${_escape(policy.label)} <span class="is-coming-next-chip">coming later</span></span>
            <span class="is-mode-hint">${_escape(policy.hint)}</span>
          </span>
        </label>`).join('');
      const status = s.statusMessage
        ? `<p class="is-status" data-tone="${_escape(s.statusTone || '')}">${_escape(s.statusMessage)}</p>`
        : '';
      const readOnly = s.readOnlyReason
        ? `<p class="is-readonly">${_escape(s.readOnlyReason)}</p>`
        : '';
      body = `
        <div class="is-subhead">Arrival authority</div>
        <div class="is-row"><span class="is-row-label">Deploy floor</span><span class="is-row-value">${_escape(s.deploy || 'public')}</span></div>
        <div class="is-row"><span class="is-row-label">Saved owner setting</span><span class="is-row-value">${_escape(s.persisted || 'none saved')}</span></div>
        <div class="is-row"><span class="is-row-label">Effective arrival mode</span><span class="is-row-value">${_escape(s.current || 'public')}</span></div>
        <form class="is-access-form" data-form="access-settings">
          <div class="is-mode-group" data-group="editable-modes">${editableHtml}</div>
          <div class="is-mode-group" data-group="disabled-modes">${disabledHtml}</div>
          <p class="is-note">${_escape(s.note || '')}</p>
          <div class="is-subhead">Write authority</div>
          <div class="is-row"><span class="is-row-label">Saved write policy</span><span class="is-row-value">${_escape(s.persistedWritePolicy || 'owner-only')}</span></div>
          <div class="is-row"><span class="is-row-label">Effective write policy</span><span class="is-row-value">${_escape(s.writePolicy || 'owner-only')}</span></div>
          <div class="is-row"><span class="is-row-label">Saved delegates</span><span class="is-row-value">${_escape(String(s.delegateCount || 0))}</span></div>
          <div class="is-mode-group" data-group="editable-write-policies">${editableWriteHtml}</div>
          <div class="is-mode-group" data-group="disabled-write-policies">${disabledWriteHtml}</div>
          <p class="is-note">${_escape(s.writeNote || '')}</p>
          <button type="submit" class="is-save" data-action="save-access"${s.canEdit ? '' : ' disabled'}>${s.saving ? 'SAVING…' : 'SAVE ACCESS SETTINGS'}</button>
        </form>
        ${readOnly}
        ${status}`;
    }
    if (s && s.key === 'multiplayer') {
      const current = _escape(s.current || 'disabled');
      body = `<div class="is-row"><span class="is-row-label">Status</span><span class="is-row-value">${current}</span></div>`;
    }
    return `
      <section class="is-section" data-section="${_escape((s && s.key) || '')}">
        <h3 class="is-section-title">${title}</h3>
        ${body}
        ${note}
      </section>`;
  }).join('');

  return `
    <div class="is-header">
      <h2 class="is-title">Instance Settings</h2>
      <div class="is-admin">Admin: <code>${admin}</code></div>
      <button type="button" class="is-close" data-action="close" aria-label="Close settings">×</button>
    </div>
    <div class="is-body">
      ${sectionHtml}
    </div>
    <div class="is-footer">
      <span class="is-footer-note">Signed settings are verified on read. Invalid, tampered, or wrong-owner events are ignored.</span>
    </div>`;
}
