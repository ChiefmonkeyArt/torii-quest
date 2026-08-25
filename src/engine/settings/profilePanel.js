// engine/settings/profilePanel.js — pure HTML-string renderer for the
// "Profile" settings tab (v0.4). Node-testable, no DOM at import time
// (mirrors gatewaySetupPanel.js / heartbeatPanel.js / relayPanel.js's shape).
//
// Standard Nostr kind:0 profile fields the installation owner can customise:
// Display name, Bio (about), Avatar URL (picture), Website, NIP-05, and
// Lightning address (lud16) — the conventional kind:0 keys most clients
// read. Saving writes a local draft (profileDraft.js) immediately and, when
// a signer is available, publishes a signed kind:0 (profileMetadata.js +
// nostr.js's existing signEvent/fanoutPublish — no new sign/publish path).
//
// renderProfilePanel(state) — state: { isOwner, isLoggedIn, draft, publishStatus }.
//   draft — { name, displayName, about, picture, website, nip05, lud16 }.
//   publishStatus — 'idle' | 'saved-local' | 'publishing' | 'published' | 'failed'.
// Returns an HTML string. main.js wires the save action via the same
// delegated 'click' pattern (data-action="save-profile" reads the form
// fields and calls onSaveProfile).

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FIELDS = [
  { id: 'displayName', label: 'Display name', type: 'text', placeholder: 'Chiefmonkey' },
  { id: 'about', label: 'Bio', type: 'textarea', placeholder: 'A short bio other players will see.' },
  { id: 'picture', label: 'Avatar URL', type: 'text', placeholder: 'https://example.com/avatar.png' },
  { id: 'website', label: 'Website', type: 'text', placeholder: 'https://example.com' },
  { id: 'nip05', label: 'NIP-05', type: 'text', placeholder: 'you@example.com' },
  { id: 'lud16', label: 'Lightning address', type: 'text', placeholder: 'you@getalby.com' },
];

function _statusLabel(status) {
  if (status === 'publishing') return 'Publishing…';
  if (status === 'published') return 'Published';
  if (status === 'saved-local') return 'Saved locally (not yet published)';
  if (status === 'failed') return 'Publish failed — saved locally';
  return '';
}

function _fieldHtml(field, draft, disabled) {
  const value = typeof draft[field.id] === 'string' ? draft[field.id] : '';
  const dis = disabled ? ' disabled' : '';
  const control = field.type === 'textarea'
    ? `<textarea id="pf-${field.id}" class="pf-input" data-field="${field.id}" rows="3" placeholder="${_escape(field.placeholder)}"${dis}>${_escape(value)}</textarea>`
    : `<input id="pf-${field.id}" class="pf-input" type="text" data-field="${field.id}" placeholder="${_escape(field.placeholder)}" value="${_escape(value)}"${dis}>`;
  return `
    <div class="pf-row">
      <label class="pf-label" for="pf-${field.id}">${_escape(field.label)}</label>
      ${control}
    </div>`;
}

export function renderProfilePanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const isLoggedIn = st.isLoggedIn === true;
  const draft = (st.draft && typeof st.draft === 'object') ? st.draft : {};
  const canEdit = isOwner && isLoggedIn;
  const statusText = _statusLabel(st.publishStatus);

  const gate = !isLoggedIn
    ? '<div class="gs-gate">Log in with Nostr to customise your profile.</div>'
    : (!isOwner ? '<div class="gs-gate">Log in as the node owner to configure this node.</div>' : '');

  const fieldsHtml = FIELDS.map((f) => _fieldHtml(f, draft, !canEdit)).join('');

  return `
    <div class="gs-header">
      <h2 class="gs-title">Profile</h2>
      ${statusText ? `<div class="gs-badge">${_escape(statusText)}</div>` : ''}
    </div>
    <div class="gs-subtitle">Customise your Nostr profile for this Quest installation</div>
    ${gate}
    <div class="pf-form">${fieldsHtml}</div>
    <button type="button" class="gs-btn" data-action="save-profile"${canEdit ? '' : ' disabled'}>Save Profile</button>`;
}
