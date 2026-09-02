// engine/settings/relayPanel.js — pure HTML-string renderer for the "Relay"
// settings tab (v0.4). Node-testable, no DOM at import time (mirrors
// gatewaySetupPanel.js / heartbeatPanel.js's shape exactly).
//
// Lets the node owner see which relay(s) their node currently publishes
// presence to, and add/remove entries. This is display + a single textarea
// input only — ALL validation, dedup, and persistence already lives in
// engine/presence/nodeRelays.js (setNodeRelays/getNodeRelays/readNodeRelays,
// re-exported via engine/menu/adminPrefs.js) and is reused as-is here, not
// duplicated. Relays are wss:// ONLY — that invariant is enforced in
// nodeRelays.js, not this renderer.
//
// renderRelayPanel(state) — state: { isOwner, nodeRelays, nodeRelaysInput }.
//   nodeRelays      — string[] of the currently VALIDATED wss relays in use
//                      (what the whole game connects to — reads + presence
//                      publish, ADR-0081). Every row carries a Remove button.
//   nodeRelaysInput — the raw stored string, shown pre-filled in the textarea
//                      so an owner editing the list sees exactly what's saved
//                      (including anything not yet valid), not a reformatted
//                      version.
// Returns an HTML string. main.js wires the save action via the same
// delegated 'click'/'submit' pattern already used for the other tabs
// (data-action="save-relays" reads the textarea and calls onSetNodeRelays).

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// _relayRow(url) — one relay row with a Remove button (used for every relay,
// default starter or operator-configured alike).
function _relayRow(url) {
  return `
    <div class="settings-row-inline" data-relay="${_escape(url)}">
      <span class="settings-dot" aria-hidden="true"></span>
      <span class="settings-row-value">${_escape(url)}</span>
      <button type="button" class="settings-btn settings-btn-ghost settings-btn-sm" data-action="remove-relay" data-relay="${_escape(url)}" aria-label="Remove ${_escape(url)}">Remove</button>
    </div>`;
}

export function renderRelayPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const nodeRelays = Array.isArray(st.nodeRelays) ? st.nodeRelays : [];
  const rawInput = typeof st.nodeRelaysInput === 'string' ? st.nodeRelaysInput : '';
  const gate = !isOwner
    ? '<div class="settings-gate">Log in as the node owner to change this.</div>'
    : '';

  const listHtml = nodeRelays.length
    ? nodeRelays.map(_relayRow).join('')
    : '<div class="settings-empty">No relays yet — add one below to publish presence.</div>';

  return `
    <div class="settings-header">
      <h2 class="settings-title">Relay</h2>
    </div>
    <div class="settings-subtitle">Relays this node reads from and publishes to.</div>
    <div class="settings-list">${listHtml}</div>
    ${gate}
    <div class="settings-row">
      <label class="settings-label" for="rl-add-input">Add or edit relays (comma or newline separated)</label>
      <textarea id="rl-add-input" class="settings-textarea" rows="3" placeholder="wss://relay.example.com"${isOwner ? '' : ' disabled'}>${_escape(rawInput)}</textarea>
      <button type="button" class="settings-btn settings-btn-primary" data-action="save-relays"${isOwner ? '' : ' disabled'}>Save relays</button>
    </div>
    <div class="settings-note">This list drives both reads and presence publish.</div>`;
}
