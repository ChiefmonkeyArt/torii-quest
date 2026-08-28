// engine/settings/relayPanel.js — pure HTML-string renderer for the "Relay"
// settings tab (v0.4). Node-testable, no DOM at import time (mirrors
// gatewaySetupPanel.js / heartbeatPanel.js's shape exactly).
//
// Lets the node owner see which relay(s) their node currently publishes
// presence to, and add/remove entries. This is display + a single textarea
// input only — ALL validation, dedup, and persistence already lives in
// engine/presence/nodeRelays.js (setNodeRelays/getNodeRelays/readNodeRelays,
// re-exported via engine/menu/adminPrefs.js) and is reused as-is here, not
// duplicated. Relays are wss:// ONLY and never fall back to the public
// RELAYS constant in nostr.js — that invariant is enforced in nodeRelays.js,
// not this renderer.
//
// renderRelayPanel(state) — state: { isOwner, nodeRelays, usingDefaults, nodeRelaysInput }.
//   nodeRelays      — string[] of the currently VALIDATED wss relays in use
//                      (what the heartbeat actually publishes to).
//   usingDefaults   — true when the operator has NOT configured their own set,
//                      so nodeRelays is the curated starter relays (ADR-0076).
//                      Renders a read-only "Starter relays active" banner
//                      instead of the removable list.
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

function _relayRow(url) {
  return `
    <div class="rl-row" data-relay="${_escape(url)}">
      <span class="rl-dot" aria-hidden="true"></span>
      <span class="rl-url">${_escape(url)}</span>
      <button type="button" class="rl-remove" data-action="remove-relay" data-relay="${_escape(url)}" aria-label="Remove ${_escape(url)}">Remove</button>
    </div>`;
}

// _defaultRelayRow(url) — a read-only starter relay row (no Remove button).
// Used when usingDefaults is true so the operator can SEE the curated starters
// the heartbeat is publishing to, without being able to delete a default (they
// override by saving their own set in the textarea below).
function _defaultRelayRow(url) {
  return `
    <div class="rl-row rl-row-default" data-relay="${_escape(url)}">
      <span class="rl-dot" aria-hidden="true"></span>
      <span class="rl-url">${_escape(url)}</span>
      <span class="rl-default-tag">starter</span>
    </div>`;
}

export function renderRelayPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const nodeRelays = Array.isArray(st.nodeRelays) ? st.nodeRelays : [];
  const usingDefaults = st.usingDefaults === true;
  const rawInput = typeof st.nodeRelaysInput === 'string' ? st.nodeRelaysInput : '';
  const gate = !isOwner
    ? '<div class="gs-gate">Log in as the node owner to configure this node.</div>'
    : '';

  // Starter relays active (no operator override): read-only banner + rows.
  // Otherwise: the removable custom list (or the empty-state prompt).
  const listHtml = nodeRelays.length
    ? (usingDefaults
        ? `<div class="rl-defaults-banner">Starter relays active — your node publishes presence to these trusted Torii relays by default. Customise below to override.</div>${nodeRelays.map(_defaultRelayRow).join('')}`
        : nodeRelays.map(_relayRow).join(''))
    : '<div class="rl-empty">No relays configured yet — your node will not publish presence until at least one wss:// relay is added.</div>';

  const badge = usingDefaults ? 'STARTER' : `${nodeRelays.length} CONFIGURED`;

  return `
    <div class="gs-header">
      <h2 class="gs-title">Relay</h2>
      <div class="gs-badge">${badge}</div>
    </div>
    <div class="gs-subtitle">Relays Torii Quest connects to (reads + presence publish)</div>
    <div class="rl-list">${listHtml}</div>
    ${gate}
    <div class="rl-add${isOwner ? '' : ' rl-add-disabled'}">
      <label class="rl-add-label" for="rl-add-input">Add / edit relays (comma or newline separated)</label>
      <textarea id="rl-add-input" class="rl-add-input" rows="3" placeholder="wss://relay.example.com"${isOwner ? '' : ' disabled'}>${_escape(rawInput)}</textarea>
      <button type="button" class="gs-btn" data-action="save-relays"${isOwner ? '' : ' disabled'}>Save Relays</button>
    </div>
    <div class="gs-note">These starter relays are active by default. Add your own above to override — this single list drives both reads and presence publish.</div>`;
}
