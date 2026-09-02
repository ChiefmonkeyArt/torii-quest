// engine/settings/gatewaySetupPanel.js — pure HTML-string renderer for the
// "Gateway Setup" settings tab (v0.3). Node-testable, no DOM at import time.
//
// Migrated from the old 4-card homepageStub.js overlay, minus "Visit a Node"
// (dropped by design decision — in-world travel already has a home at the
// physical Torii Gateway inside the NAP zone, so a second UI-level node
// directory would be redundant) and minus "Publish My Node" (v0.3: split out
// into its own "Heartbeat" tab — see heartbeatPanel.js — since node presence
// publishing is an operationally distinct concern from world choice, not a
// 3rd item in this list). The remaining 2 cards are UNCHANGED behavior, just
// re-skinned as data-action rows instead of a DOM-builder overlay:
//   1. Choose Blank             → onChooseWorld('gateway-blank')       (owner-only)
//   2. Use My World as Template → onChooseWorld('chiefmonkey-template') (owner-only)
//
// renderGatewaySetupPanel(state) — state: { isOwner, isLoggedIn, activeWorld }.
// Returns an HTML string. main.js wires clicks via a single delegated 'click'
// listener on the settings content container, matching `data-action`.

const HEX64 = /^[0-9a-f]{64}$/;

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CARDS = [
  { id: 'blank', icon: '⬜', label: 'Choose Blank', hint: 'Start from an empty world.', action: 'choose-blank' },
  { id: 'template', icon: '🗺️', label: 'Use My World as Template', hint: 'Seed the gateway from your world.', action: 'choose-template' },
];

function _cardHtml(card, state) {
  const isOwner = state.isOwner === true;
  const enabled = isOwner; // both remaining cards are owner-only
  const gate = !enabled
    ? '<div class="settings-gate">Log in as the node owner to change this.</div>'
    : '';
  return `
    <div class="settings-card" data-card="${_escape(card.id)}">
      <div class="settings-card-icon">${card.icon}</div>
      <div class="settings-card-body">
        <div class="settings-card-label">${_escape(card.label)}</div>
        <div class="settings-card-hint">${_escape(card.hint)}</div>
        ${gate}
      </div>
      <button type="button" class="settings-btn" data-action="${_escape(card.action)}"${enabled ? '' : ' disabled'} aria-label="${_escape(card.label)}">Choose</button>
    </div>`;
}

export function renderGatewaySetupPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const activeWorld = typeof st.activeWorld === 'string' && st.activeWorld !== '' ? st.activeWorld : null;
  const badge = activeWorld
    ? `● ACTIVE · ${_escape(activeWorld)}`
    : (isOwner ? '● NO ACTIVE WORLD' : '● DEFAULT WORLD');

  const cardsHtml = CARDS.map((c) => _cardHtml(c, st)).join('');
  // v0.4: dropped the trailing "To visit another world, use the Torii
  // Gateway inside the NAP zone." sentence per design direction — the
  // owner-gate reminder alone is the only note needed here now.
  const note = !isOwner
    ? '<div class="settings-note">Owner actions need the node owner signed in.</div>'
    : '';

  return `
    <div class="settings-header">
      <h2 class="settings-title">Gateway Setup</h2>
      <div class="settings-badge">${badge}</div>
    </div>
    <div class="settings-subtitle">Choose your homepage world.</div>
    <div class="settings-list">${cardsHtml}</div>
    ${note}`;
}

export function _isHex64(s) { return HEX64.test(String(s || '')); }
