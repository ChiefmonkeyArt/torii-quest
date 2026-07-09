// instanceSettings.js (v0.2.358-alpha) — instance-admin settings shell.
//
// A pure, node-safe view-model + HTML renderer for the Instance Settings page
// that a logged-in INSTANCE ADMIN reaches from the title screen (via the small
// corner link `#instance-settings-link`, wired in `main.js`).
//
// SCOPE (Phase A, shipping this version):
//   - Visibility rule: `isInstanceAdmin({ operatorPubkey, hostPubkey })` — the
//     entry point is shown ONLY when the logged-in operator's hex64 pubkey
//     matches the deployment's configured host pubkey (`window.__toriiHostPubkey`
//     / `<meta name="torii-host-pubkey">`, read by main.js `_hostIdentity()`).
//     Anyone else — anon session, or a different logged-in npub — does not see
//     the link. Fail-closed on any malformed input.
//   - Model: `buildInstanceSettingsModel({ operatorPubkey, hostPubkey })`
//     returns `{ visible, sections: [...] }`. One real section: Access, showing
//     the current arrival policy (`public`, hard-coded) + a "coming soon" list
//     of the three future modes (follow-me / whitelist / invite-only). A second
//     placeholder "More coming soon" section marks that the page will grow.
//   - Renderer: `renderInstanceSettingsPanel(model)` returns a pure HTML string
//     the shell drops into a hidden `<div id="instance-settings-panel">`.
//
// NON-GOALS (deferred — see ACC-* in torii-quest-todo.md):
//   - No policy check on arrival (SEC-2 crypto verify is unchanged; access
//     policy is a separate future layer).
//   - No owner-facing control to actually SET the policy — the page is INERT.
//   - No follow-graph query, no whitelist storage, no invite issuance.
//   - No write-authority admin group (ACC-3, deferred whole-slice).
//
// Invariants held:
//   - Pure + node-safe (no window/document at module scope; DOM wiring lives in
//     main.js and reads this module's HTML string).
//   - No gate downgraded (SEC-1 / SEC-2 / SEC-3 untouched).
//   - No new setTimeout, no new Vector3/Matrix4, no CSP change, no new deps.
//   - `state.phase` unaffected (panel is title-screen UI, not arena).
//   - Panel is same-origin and inert — no navigation, no relay call, no sign.

import { MP_ENABLED } from '../../config.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Is the current logged-in operator the admin of this instance?
 *
 * The visibility rule for the "⚙ INSTANCE SETTINGS" title-screen link. Returns
 * `true` iff BOTH `operatorPubkey` and `hostPubkey` are the SAME hex64 string.
 * Any other input (anon / mismatched / malformed) → `false`. Fail-closed.
 *
 * @param {{ operatorPubkey?: string, hostPubkey?: string }} [opts]
 * @returns {boolean}
 */
export function isInstanceAdmin(opts) {
  const o = opts || {};
  const op = typeof o.operatorPubkey === 'string' ? o.operatorPubkey.toLowerCase() : '';
  const host = typeof o.hostPubkey === 'string' ? o.hostPubkey.toLowerCase() : '';
  if (!HEX64.test(op) || !HEX64.test(host)) return false;
  return op === host;
}

/**
 * Curated list of arrival modes coming to Access. Stable ordering — the
 * renderer walks it as-is. Kept as a frozen array so callers cannot mutate the
 * shared source of truth.
 */
export const COMING_SOON_ARRIVAL_MODES = Object.freeze([
  Object.freeze({
    key: 'follow-me',
    label: 'Follow me to enter',
    hint: 'Only npubs that follow the instance admin can arrive.',
  }),
  Object.freeze({
    key: 'whitelist',
    label: 'Whitelist',
    hint: 'Only npubs on an admin-curated allow-list can arrive.',
  }),
  Object.freeze({
    key: 'invite-only',
    label: 'Invite only',
    hint: 'Arrival requires a per-visitor invite issued by the admin.',
  }),
]);

/**
 * Build the pure view-model for the Instance Settings panel.
 *
 * @param {{ operatorPubkey?: string, hostPubkey?: string }} [opts]
 * @returns {{
 *   visible: boolean,
 *   operatorPubkey: string,
 *   sections: Array<{
 *     key: string,
 *     title: string,
 *     status: string,
 *     current?: string,
 *     comingSoon?: Array<{ key: string, label: string, hint: string }>,
 *     note?: string,
 *   }>
 * }}
 */
export function buildInstanceSettingsModel(opts) {
  const o = opts || {};
  const op = typeof o.operatorPubkey === 'string' ? o.operatorPubkey.toLowerCase() : '';
  const host = typeof o.hostPubkey === 'string' ? o.hostPubkey.toLowerCase() : '';
  const visible = isInstanceAdmin({ operatorPubkey: op, hostPubkey: host });

  // MP-1: allow tests / future runtime override to force the reported flag.
  // Reads `mpEnabled` from opts; falls back to the build-time constant.
  const mpEnabled = typeof o.mpEnabled === 'boolean' ? o.mpEnabled : !!MP_ENABLED;

  const sections = [
    {
      key: 'access',
      title: 'Access',
      status: 'placeholder',
      current: 'public',
      comingSoon: COMING_SOON_ARRIVAL_MODES.map((m) => ({ ...m })),
      note: 'Travel between instances is public by default. Admin-set restrictions are coming soon.',
    },
    {
      key: 'multiplayer',
      title: 'Multiplayer',
      status: 'placeholder',
      current: mpEnabled ? 'enabled' : 'disabled',
      note: 'MP-1 (advisory hit detection) ships behind a build-time flag. Runtime toggle + per-zone opt-in land in MP-1.1.',
    },
    {
      key: 'more',
      title: 'More coming soon',
      status: 'placeholder',
      note: 'Additional admin sections (identity, appearance, moderation, write-authority admin group) will land here in future updates.',
    },
  ];

  return { visible, operatorPubkey: op, sections, mpEnabled };
}

// ── HTML rendering (pure string; injected as-is into a hidden panel) ─────────

/**
 * Minimal HTML-escape. Enough for text nodes + attribute values in the small,
 * controlled strings this module renders (section titles, notes, admin pubkey
 * short-form). Not a general sanitiser.
 * @param {string} s
 * @returns {string}
 */
function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an operator pubkey as a short display token (first 8 + last 4 hex).
 * Falls back to a placeholder for missing / invalid input.
 * @param {string} pubkey
 * @returns {string}
 */
function _shortPubkey(pubkey) {
  const p = typeof pubkey === 'string' ? pubkey.toLowerCase() : '';
  if (!HEX64.test(p)) return '—';
  return `${p.slice(0, 8)}…${p.slice(-4)}`;
}

/**
 * Render the Instance Settings panel as an HTML string. Returns an empty
 * string when the model is not visible (defence-in-depth — the shell should
 * also gate the link's visibility on `model.visible`).
 *
 * @param {ReturnType<typeof buildInstanceSettingsModel>} model
 * @returns {string}
 */
export function renderInstanceSettingsPanel(model) {
  if (!model || !model.visible) return '';
  const admin = _escape(_shortPubkey(model.operatorPubkey));
  const sections = Array.isArray(model.sections) ? model.sections : [];

  const sectionHtml = sections.map((s) => {
    const title = _escape(s && s.title || '');
    const note = s && typeof s.note === 'string' ? `<p class="is-note">${_escape(s.note)}</p>` : '';
    let body = '';
    if (s && s.key === 'access') {
      const current = _escape(s.current || 'public');
      const modes = Array.isArray(s.comingSoon) ? s.comingSoon : [];
      const modeItems = modes.map((m) => {
        const label = _escape(m && m.label || '');
        const hint = _escape(m && m.hint || '');
        return `<li><span class="is-mode-label">${label}</span><span class="is-mode-hint">${hint}</span></li>`;
      }).join('');
      body = `
        <div class="is-row"><span class="is-row-label">Arrival</span><span class="is-row-value">${current}</span></div>
        <div class="is-coming-soon">
          <div class="is-coming-soon-head">Coming soon</div>
          <ul class="is-mode-list">${modeItems}</ul>
        </div>`;
    }
    if (s && s.key === 'multiplayer') {
      const current = _escape(s.current || 'disabled');
      body = `
        <div class="is-row"><span class="is-row-label">Status</span><span class="is-row-value">${current}</span></div>`;
    }
    return `
      <section class="is-section" data-section="${_escape(s && s.key || '')}">
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
      <span class="is-footer-note">Read-only preview. Nothing on this page changes the world yet.</span>
    </div>`;
}
